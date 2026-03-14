"""
Azure Service Bus subscriber.
Listens on HR and payroll queues, transforms messages, logs to Postgres.
Falls back to polling mock services directly if Azure SB is not configured.
"""

import json
import logging
import os
import time
import threading
from typing import Optional

import requests

from .db import log_event, update_event, log_dead_letter, get_field_mappings
from .transform import transform_employee_xml_to_json, validate_employee_payload
from .pgp import sign_payload, verify_signature

logger = logging.getLogger(__name__)

HR_URL = os.environ.get("MOCK_HR_URL", "http://localhost:3001")
PAYROLL_URL = os.environ.get("MOCK_PAYROLL_URL", "http://localhost:3002")
AZURE_SB_CONN = os.environ.get("AZURE_SB_CONNECTION_STRING", "")
HR_QUEUE = os.environ.get("HR_QUEUE_NAME", "hr-events")
PAYROLL_QUEUE = os.environ.get("PAYROLL_QUEUE_NAME", "payroll-events")

MAX_RETRIES = 3


def _process_hr_message(raw_body: dict, message_id: str) -> dict:
    """Core processing logic for an HR event message."""
    event_id = log_event(
        source_service="mock-hr",
        target_service="transformer",
        event_type=raw_body.get("eventType", "employee.sync"),
        payload_in=raw_body,
        message_id=message_id,
        status="processing",
    )

    try:
        xml_payload = raw_body.get("xmlPayload") or raw_body.get("payload")
        if not xml_payload:
            # If no XML in message, fetch from HR service
            emp_id = raw_body.get("employeeId")
            if emp_id:
                resp = requests.get(f"{HR_URL}/employees/{emp_id}", timeout=10)
                resp.raise_for_status()
                xml_payload = resp.text
            else:
                raise ValueError("No xmlPayload and no employeeId in message")

        # Verify PGP signature if present
        if raw_body.get("pgpSigned"):
            valid, fp = verify_signature(xml_payload)
            if not valid:
                raise ValueError("PGP signature verification failed")
            logger.info(f"PGP signature verified: {fp[:16] if fp else 'unknown'}")

        field_mappings = get_field_mappings("xml", "json")
        transformed = transform_employee_xml_to_json(xml_payload, field_mappings)

        validation_errors = validate_employee_payload(transformed)
        if validation_errors:
            raise ValueError(f"Validation failed: {'; '.join(validation_errors)}")

        # Sign the transformed output
        signed_str, was_signed = sign_payload(json.dumps(transformed, default=str))
        transformed["_signed"] = was_signed

        # Forward to payroll service
        emp_id = transformed.get("employeeId")
        if emp_id:
            payroll_resp = requests.get(f"{PAYROLL_URL}/salary/{emp_id}", timeout=10)
            if payroll_resp.ok:
                payroll_data = payroll_resp.json()
                transformed["payrollData"] = payroll_data

        update_event(event_id, "success", transformed)
        logger.info(f"Processed HR event {event_id} for employee {transformed.get('employeeId')}")
        return transformed

    except Exception as e:
        logger.error(f"Failed to process HR message: {e}")
        update_event(event_id, "failed", error=str(e))
        raise


def start_azure_subscriber():
    """Start listening on Azure Service Bus queues."""
    try:
        from azure.servicebus import ServiceBusClient, ServiceBusMessage
        from azure.servicebus.exceptions import ServiceBusError
    except ImportError:
        logger.warning("azure-servicebus not installed, skipping Azure SB")
        return

    if not AZURE_SB_CONN:
        logger.info("AZURE_SB_CONNECTION_STRING not set — Azure SB subscriber disabled")
        return

    def _listen_queue(queue_name: str, handler):
        logger.info(f"Starting Azure SB listener on queue: {queue_name}")
        client = ServiceBusClient.from_connection_string(AZURE_SB_CONN)
        with client:
            receiver = client.get_queue_receiver(
                queue_name=queue_name,
                max_wait_time=30,
            )
            with receiver:
                while True:
                    try:
                        messages = receiver.receive_messages(max_message_count=10, max_wait_time=5)
                        for msg in messages:
                            msg_id = str(msg.message_id)
                            retry_count = msg.delivery_count or 0
                            try:
                                body = json.loads(str(msg))
                                handler(body, msg_id)
                                receiver.complete_message(msg)
                            except Exception as e:
                                logger.error(f"Message processing error: {e}")
                                if retry_count >= MAX_RETRIES:
                                    logger.error(f"Dead-lettering message {msg_id} after {retry_count} retries")
                                    try:
                                        receiver.dead_letter_message(msg, reason=str(e))
                                    except Exception:
                                        pass
                                    log_dead_letter(
                                        queue_name=queue_name,
                                        raw_payload={"raw": str(msg), "messageId": msg_id},
                                        failure_reason=str(e),
                                    )
                                else:
                                    receiver.abandon_message(msg)
                    except ServiceBusError as e:
                        logger.error(f"Service Bus error: {e}, retrying in 10s")
                        time.sleep(10)

    # Start each queue listener in its own thread
    hr_thread = threading.Thread(
        target=_listen_queue,
        args=(HR_QUEUE, _process_hr_message),
        daemon=True,
        name="hr-queue-listener",
    )
    hr_thread.start()
    logger.info("Azure Service Bus listeners started")


def sync_all_employees():
    """
    Poll-based fallback: fetch all employees from HR, transform, sync to payroll.
    Used when Azure SB is not configured or for manual full syncs.
    """
    logger.info("Starting full employee sync (poll mode)")
    try:
        resp = requests.get(f"{HR_URL}/employees", timeout=15)
        resp.raise_for_status()
        xml_data = resp.text
    except Exception as e:
        logger.error(f"Failed to fetch employees from HR: {e}")
        return {"error": str(e), "processed": 0}

    field_mappings = get_field_mappings("xml", "json")
    processed = 0
    errors = []

    try:
        import xmltodict
        raw = xmltodict.parse(xml_data)
        employees = raw.get("employees", {}).get("employee", [])
        if isinstance(employees, dict):
            employees = [employees]
    except Exception as e:
        logger.error(f"Failed to parse employee list XML: {e}")
        return {"error": str(e), "processed": 0}

    for emp in employees:
        emp_id = emp.get("id")
        if not emp_id:
            continue

        event_id = log_event(
            source_service="mock-hr",
            target_service="mock-payroll",
            event_type="employee.full_sync",
            payload_in=emp,
            status="processing",
        )

        try:
            import xmltodict
            xml_str = f"<?xml version='1.0'?><employee>{''.join(f'<{k}>{v}</{k}>' for k,v in emp.items() if v is not None)}</employee>"
            transformed = transform_employee_xml_to_json(xml_str, field_mappings)

            # Post to payroll
            payroll_resp = requests.post(
                f"{PAYROLL_URL}/salary",
                json={"employeeId": emp_id, "baseSalary": transformed.get("baseSalary")},
                timeout=10,
            )

            update_event(event_id, "success", transformed)
            processed += 1
            logger.info(f"Synced employee {emp_id}")
        except Exception as e:
            errors.append({"employeeId": emp_id, "error": str(e)})
            update_event(event_id, "failed", error=str(e))
            logger.error(f"Failed to sync employee {emp_id}: {e}")

    return {"processed": processed, "errors": errors, "total": len(employees)}
