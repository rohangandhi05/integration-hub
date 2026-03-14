"""XML ↔ JSON transformation engine with field mapping support."""

import logging
import re
from datetime import datetime
from typing import Any, Optional

import xmltodict

logger = logging.getLogger(__name__)


# ─── Transform functions ──────────────────────────────────────────────────────

TRANSFORM_FNS = {
    "trim":        lambda v: str(v).strip(),
    "uppercase":   lambda v: str(v).upper(),
    "lowercase":   lambda v: str(v).lower(),
    "parse_float": lambda v: float(str(v).replace(",", "")),
    "parse_int":   lambda v: int(str(v).replace(",", "")),
    "iso_date":    lambda v: datetime.strptime(str(v), "%Y-%m-%d").isoformat() if v else None,
    "bool":        lambda v: str(v).lower() in ("true", "1", "yes", "active"),
}


def apply_transform(value: Any, fn_name: Optional[str]) -> Any:
    if fn_name is None or value is None:
        return value
    fn = TRANSFORM_FNS.get(fn_name)
    if fn is None:
        logger.warning(f"Unknown transform fn: {fn_name}")
        return value
    try:
        return fn(value)
    except (ValueError, TypeError) as e:
        logger.warning(f"Transform '{fn_name}' failed on value '{value}': {e}")
        return value


def get_nested(data: dict, path: str) -> Any:
    """Get value from nested dict using dot notation."""
    parts = path.split(".")
    current = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def set_nested(data: dict, path: str, value: Any):
    """Set value in nested dict using dot notation, creating intermediate keys."""
    parts = path.split(".")
    current = data
    for part in parts[:-1]:
        if part not in current or not isinstance(current[part], dict):
            current[part] = {}
        current = current[part]
    current[parts[-1]] = value


# ─── XML → JSON ───────────────────────────────────────────────────────────────

def xml_to_dict(xml_string: str) -> dict:
    """Parse XML string to Python dict."""
    try:
        return xmltodict.parse(xml_string, force_list=False)
    except Exception as e:
        raise ValueError(f"Failed to parse XML: {e}") from e


def transform_employee_xml_to_json(xml_string: str, field_mappings: list) -> dict:
    """
    Transform HR XML employee payload to payroll-compatible JSON.
    Uses field_mappings from DB when available, falls back to defaults.
    """
    raw = xml_to_dict(xml_string)

    # Handle both single employee and wrapped response
    if "employee" in raw:
        emp = raw["employee"]
    elif "employees" in raw:
        # If given a list, transform all
        employees = raw["employees"].get("employee", [])
        if isinstance(employees, dict):
            employees = [employees]
        return {"employees": [transform_employee_xml_to_json(
            f"<?xml version='1.0'?><employee>{_dict_to_xml_inner(e)}</employee>", field_mappings
        ) for e in employees]}
    else:
        emp = raw  # assume top-level is employee

    result = {}

    if field_mappings:
        # Database-driven mapping
        for mapping in field_mappings:
            value = get_nested(emp, mapping["source_path"].replace("employee.", ""))
            transformed = apply_transform(value, mapping.get("transform_fn"))
            set_nested(result, mapping["target_path"], transformed)
    else:
        # Default hardcoded mapping (fallback)
        result = {
            "employeeId":       emp.get("id"),
            "fullName":         str(emp.get("n") or emp.get("name") or "").strip(),
            "department":       str(emp.get("department") or "").upper(),
            "startDate":        emp.get("startDate"),
            "baseSalary":       float(emp.get("salary") or 0),
            "employmentStatus": str(emp.get("status") or "").lower(),
            "manager":          emp.get("manager") or None,
            "location":         emp.get("location"),
        }

    # Always include metadata
    result["_meta"] = {
        "transformedAt": datetime.utcnow().isoformat() + "Z",
        "sourceFormat":  "xml",
        "targetFormat":  "json",
        "version":       "1.0",
    }

    return result


def _dict_to_xml_inner(d: dict) -> str:
    """Convert dict to XML inner content (no root tag)."""
    parts = []
    for k, v in d.items():
        if v is not None:
            parts.append(f"<{k}>{v}</{k}>")
    return "".join(parts)


# ─── JSON → XML ───────────────────────────────────────────────────────────────

def json_to_xml(data: dict, root_tag: str = "payload") -> str:
    """Convert a flat/nested dict to XML."""
    def _convert(obj, tag):
        if isinstance(obj, dict):
            inner = "".join(_convert(v, k) for k, v in obj.items() if not k.startswith("_"))
            return f"<{tag}>{inner}</{tag}>"
        elif isinstance(obj, list):
            return "".join(_convert(item, tag[:-1] if tag.endswith("s") else "item") for item in obj)
        else:
            safe = str(obj).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            return f"<{tag}>{safe}</{tag}>"

    return f'<?xml version="1.0" encoding="UTF-8"?>{_convert(data, root_tag)}'


# ─── Validation ───────────────────────────────────────────────────────────────

def validate_employee_payload(payload: dict) -> list:
    """Return list of validation errors (empty = valid)."""
    errors = []
    required = ["employeeId", "fullName", "department"]
    for field in required:
        if not payload.get(field):
            errors.append(f"Missing required field: {field}")

    if payload.get("baseSalary") is not None:
        try:
            s = float(payload["baseSalary"])
            if s < 0:
                errors.append("baseSalary cannot be negative")
        except (ValueError, TypeError):
            errors.append("baseSalary must be numeric")

    return errors
