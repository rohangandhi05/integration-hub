"""PGP key management and payload signing/verification."""

import os
import logging
import tempfile
from pathlib import Path
from typing import Optional, Tuple

import gnupg

logger = logging.getLogger(__name__)

KEYS_DIR = Path(os.environ.get("KEYS_DIR", "/app/keys"))
PASSPHRASE = os.environ.get("PGP_PASSPHRASE", "localdev-passphrase")
KEY_EMAIL = "hub@integration.internal"
KEY_NAME = "Integration Hub"


def _get_gpg() -> gnupg.GPG:
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    return gnupg.GPG(gnupghome=str(KEYS_DIR))


def ensure_keys_exist() -> str:
    """Generate a key pair if none exists. Returns the key fingerprint."""
    gpg = _get_gpg()
    keys = gpg.list_keys(True)  # secret keys

    if keys:
        fp = keys[0]["fingerprint"]
        logger.info(f"Using existing PGP key: {fp[:16]}...")
        return fp

    logger.info("Generating new PGP key pair...")
    input_data = gpg.gen_key_input(
        key_type="RSA",
        key_length=2048,
        name_real=KEY_NAME,
        name_email=KEY_EMAIL,
        passphrase=PASSPHRASE,
        expire_date="2y",
    )
    result = gpg.gen_key(input_data)
    if not result:
        raise RuntimeError("PGP key generation failed")

    fp = str(result)
    logger.info(f"Generated PGP key: {fp[:16]}...")

    # Export public key to a readable file
    pub_key = gpg.export_keys(fp)
    pub_path = KEYS_DIR / "integration-hub.pub"
    pub_path.write_text(pub_key)
    logger.info(f"Public key exported to {pub_path}")

    return fp


def sign_payload(payload: str) -> Tuple[str, bool]:
    """
    Sign a string payload. Returns (signed_payload, success).
    The signed payload includes the original data + detached PGP signature in ASCII armor.
    """
    gpg = _get_gpg()
    keys = gpg.list_keys(True)
    if not keys:
        logger.warning("No PGP key found, skipping signing")
        return payload, False

    signed = gpg.sign(
        payload,
        keyid=keys[0]["fingerprint"],
        passphrase=PASSPHRASE,
        clearsign=True,
    )
    if signed.status == "signature created":
        return str(signed), True
    else:
        logger.error(f"PGP signing failed: {signed.status}")
        return payload, False


def verify_signature(signed_payload: str) -> Tuple[bool, Optional[str]]:
    """
    Verify a PGP-signed payload. Returns (is_valid, signer_fingerprint).
    """
    gpg = _get_gpg()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".asc", delete=False) as f:
        f.write(signed_payload)
        tmp_path = f.name

    try:
        result = gpg.verify_file(open(tmp_path, "rb"))
        if result.valid:
            return True, result.fingerprint
        else:
            return False, None
    finally:
        os.unlink(tmp_path)


def get_public_key() -> Optional[str]:
    """Return the ASCII-armored public key."""
    gpg = _get_gpg()
    keys = gpg.list_keys()
    if not keys:
        return None
    return gpg.export_keys(keys[0]["fingerprint"])


def get_key_info() -> dict:
    """Return info about the current key pair."""
    gpg = _get_gpg()
    pub_keys = gpg.list_keys()
    sec_keys = gpg.list_keys(True)
    return {
        "hasPublicKey":  bool(pub_keys),
        "hasPrivateKey": bool(sec_keys),
        "fingerprint":   pub_keys[0]["fingerprint"] if pub_keys else None,
        "expires":       pub_keys[0]["expires"] if pub_keys else None,
        "email":         KEY_EMAIL,
    }
