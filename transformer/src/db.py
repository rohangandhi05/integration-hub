"""Database connection and event logging for the transformer service."""

import os
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

_pool: Optional[ThreadedConnectionPool] = None


def get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        db_url = os.environ["DATABASE_URL"]
        _pool = ThreadedConnectionPool(minconn=1, maxconn=10, dsn=db_url)
        logger.info("Database pool created")
    return _pool


def get_conn():
    return get_pool().getconn()


def release_conn(conn):
    get_pool().putconn(conn)


def log_event(
    source_service: str,
    target_service: str,
    event_type: str,
    payload_in: dict,
    payload_out: Optional[dict] = None,
    status: str = "pending",
    error_message: Optional[str] = None,
    message_id: Optional[str] = None,
    pgp_signed: bool = False,
) -> str:
    """Insert an integration event and return its UUID."""
    event_id = str(uuid.uuid4())
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO integration_events
                  (id, source_service, target_service, event_type,
                   payload_in, payload_out, status, error_message,
                   message_id, pgp_signed)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    event_id,
                    source_service,
                    target_service,
                    event_type,
                    Json(payload_in),
                    Json(payload_out) if payload_out else None,
                    status,
                    error_message,
                    message_id,
                    pgp_signed,
                ),
            )
            conn.commit()
        return event_id
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to log event: {e}")
        raise
    finally:
        release_conn(conn)


def update_event(event_id: str, status: str, payload_out: Optional[dict] = None, error: Optional[str] = None):
    """Update an existing event's status and optional output payload."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE integration_events
                SET status=%s, payload_out=%s, error_message=%s, updated_at=now()
                WHERE id=%s
                """,
                (status, Json(payload_out) if payload_out else None, error, event_id),
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to update event {event_id}: {e}")
    finally:
        release_conn(conn)


def log_dead_letter(queue_name: str, raw_payload: dict, failure_reason: str, original_event_id: Optional[str] = None):
    """Record a dead-lettered message."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dead_letters (original_event, queue_name, raw_payload, failure_reason)
                VALUES (%s,%s,%s,%s)
                """,
                (original_event_id, queue_name, Json(raw_payload), failure_reason),
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to log dead letter: {e}")
    finally:
        release_conn(conn)


def get_field_mappings(source_fmt: str, target_fmt: str) -> list:
    """Fetch active field mappings from DB."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM field_mappings WHERE source_format=%s AND target_format=%s AND is_active=TRUE",
                (source_fmt, target_fmt),
            )
            return cur.fetchall()
    finally:
        release_conn(conn)
