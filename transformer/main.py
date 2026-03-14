"""
Transformer Service — FastAPI app.
Exposes REST endpoints for triggering transforms and checking status.
Azure SB subscriber runs as a background thread.
"""

import logging
import os
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from src.db import log_event, update_event, get_field_mappings
from src.transform import transform_employee_xml_to_json, xml_to_dict
from src.pgp import ensure_keys_exist, get_key_info, sign_payload
from src.subscriber import start_azure_subscriber, sync_all_employees

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Transformer service starting up...")
    try:
        ensure_keys_exist()
        logger.info("PGP keys ready")
    except Exception as e:
        logger.warning(f"PGP key setup failed (non-fatal): {e}")

    start_azure_subscriber()
    yield
    logger.info("Transformer service shutting down")


app = FastAPI(title="Integration Hub — Transformer", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TransformRequest(BaseModel):
    xml_payload: str
    source_format: str = "xml"
    target_format: str = "json"
    sign_output: bool = False
    employee_id: Optional[str] = None


class SyncRequest(BaseModel):
    employee_id: Optional[str] = None
    full_sync: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "service": "transformer"}


@app.post("/transform")
def transform_payload(req: TransformRequest):
    """Transform an XML payload to JSON using DB field mappings."""
    field_mappings = get_field_mappings(req.source_format, req.target_format)
    event_id = log_event(
        source_service="api",
        target_service="transformer",
        event_type="manual.transform",
        payload_in={"xml_preview": req.xml_payload[:200]},
        status="processing",
    )
    try:
        result = transform_employee_xml_to_json(req.xml_payload, field_mappings)

        if req.sign_output:
            signed_str, was_signed = sign_payload(json.dumps(result, default=str))
            result["_signed"] = was_signed

        update_event(event_id, "success", result)
        return {"eventId": event_id, "result": result}
    except Exception as e:
        update_event(event_id, "failed", error=str(e))
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/sync")
def trigger_sync(req: SyncRequest, background_tasks: BackgroundTasks):
    """Trigger an employee sync (HR → transform → payroll)."""
    if req.full_sync:
        background_tasks.add_task(sync_all_employees)
        return {"message": "Full sync triggered in background"}

    if req.employee_id:
        import requests as req_lib
        hr_url = os.environ.get("MOCK_HR_URL", "http://mock-hr:3001")
        resp = req_lib.get(f"{hr_url}/employees/{req.employee_id}", timeout=10)
        if not resp.ok:
            raise HTTPException(status_code=404, detail=f"Employee {req.employee_id} not found in HR")
        xml_data = resp.text
        field_mappings = get_field_mappings("xml", "json")
        result = transform_employee_xml_to_json(xml_data, field_mappings)
        return {"employeeId": req.employee_id, "transformed": result}

    raise HTTPException(status_code=400, detail="Provide employee_id or set full_sync=true")


@app.get("/pgp/info")
def pgp_info():
    """Return PGP key info."""
    return get_key_info()


@app.post("/pgp/sign")
def pgp_sign(body: dict):
    """Sign an arbitrary payload string."""
    payload_str = json.dumps(body, default=str)
    signed, success = sign_payload(payload_str)
    return {"signed": success, "payload": signed if success else payload_str}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
