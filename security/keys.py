#!/usr/bin/env python3
"""
Security utilities for the Integration Hub.
Run these scripts to manage PGP keys and test signing/verification.

Usage:
  python security/keys.py generate       # Generate a new key pair
  python security/keys.py info           # Show current key info
  python security/keys.py sign <text>    # Sign a piece of text
  python security/keys.py verify <file>  # Verify a signed file
  python security/keys.py export         # Export public key to stdout
  python security/keys.py ssh            # Generate an SSH key pair
"""

import sys
import os
import json
import subprocess
from pathlib import Path

KEYS_DIR = Path(os.environ.get("KEYS_DIR", "./security/keys"))
PASSPHRASE = os.environ.get("PGP_PASSPHRASE", "localdev-passphrase")
KEY_EMAIL = "hub@integration.internal"


def get_gpg():
    import gnupg
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    return gnupg.GPG(gnupghome=str(KEYS_DIR))


def cmd_generate():
    gpg = get_gpg()
    existing = gpg.list_keys(True)
    if existing:
        print(f"Key already exists: {existing[0]['fingerprint']}")
        print("Delete ./security/keys to regenerate.")
        return

    print("Generating 2048-bit RSA key pair...")
    input_data = gpg.gen_key_input(
        key_type="RSA",
        key_length=2048,
        name_real="Integration Hub",
        name_email=KEY_EMAIL,
        passphrase=PASSPHRASE,
        expire_date="2y",
    )
    result = gpg.gen_key(input_data)
    if not result:
        print("ERROR: Key generation failed")
        sys.exit(1)

    fp = str(result)
    print(f"Generated key: {fp}")

    pub = gpg.export_keys(fp)
    pub_path = KEYS_DIR / "integration-hub.pub"
    pub_path.write_text(pub)
    print(f"Public key → {pub_path}")

    print("\nKey info:")
    cmd_info()


def cmd_info():
    gpg = get_gpg()
    pub_keys = gpg.list_keys()
    sec_keys = gpg.list_keys(True)
    if not pub_keys:
        print("No keys found. Run: python security/keys.py generate")
        return
    k = pub_keys[0]
    print(f"  Fingerprint : {k['fingerprint']}")
    print(f"  UID         : {k['uids']}")
    print(f"  Expires     : {k['expires'] or 'never'}")
    print(f"  Has private : {'yes' if sec_keys else 'NO'}")


def cmd_sign(text):
    gpg = get_gpg()
    keys = gpg.list_keys(True)
    if not keys:
        print("No private key. Run: python security/keys.py generate")
        sys.exit(1)

    signed = gpg.sign(text, keyid=keys[0]["fingerprint"], passphrase=PASSPHRASE, clearsign=True)
    if signed.status != "signature created":
        print(f"Signing failed: {signed.status}")
        sys.exit(1)

    out_path = KEYS_DIR / "signed_output.asc"
    out_path.write_text(str(signed))
    print(f"Signed output → {out_path}")
    print(f"\n{str(signed)}")


def cmd_verify(file_path):
    gpg = get_gpg()
    with open(file_path, "rb") as f:
        result = gpg.verify_file(f)
    if result.valid:
        print(f"VALID signature")
        print(f"  Fingerprint : {result.fingerprint}")
        print(f"  Timestamp   : {result.timestamp}")
    else:
        print(f"INVALID or missing signature: {result.status}")
        sys.exit(1)


def cmd_export():
    gpg = get_gpg()
    keys = gpg.list_keys()
    if not keys:
        print("No public key found")
        sys.exit(1)
    print(gpg.export_keys(keys[0]["fingerprint"]))


def cmd_ssh():
    ssh_dir = KEYS_DIR / "ssh"
    ssh_dir.mkdir(parents=True, exist_ok=True)
    key_path = ssh_dir / "integration_hub_ed25519"

    if key_path.exists():
        print(f"SSH key already exists at {key_path}")
        print(f"Public key: {(key_path.with_suffix('.pub')).read_text()}")
        return

    result = subprocess.run([
        "ssh-keygen", "-t", "ed25519",
        "-C", KEY_EMAIL,
        "-f", str(key_path),
        "-N", "",  # no passphrase for automation
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"ssh-keygen failed: {result.stderr}")
        sys.exit(1)

    pub_key = key_path.with_suffix(".pub").read_text()
    print(f"SSH key pair generated:")
    print(f"  Private : {key_path}")
    print(f"  Public  : {key_path}.pub")
    print(f"\nPublic key (add to authorized_keys or Azure deployment):")
    print(pub_key)


COMMANDS = {
    "generate": lambda: cmd_generate(),
    "info":     lambda: cmd_info(),
    "sign":     lambda: cmd_sign(" ".join(sys.argv[2:]) or "test payload"),
    "verify":   lambda: cmd_verify(sys.argv[2]),
    "export":   lambda: cmd_export(),
    "ssh":      lambda: cmd_ssh(),
}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "info"
    if cmd not in COMMANDS:
        print(f"Unknown command: {cmd}")
        print(f"Available: {', '.join(COMMANDS)}")
        sys.exit(1)
    try:
        COMMANDS[cmd]()
    except ImportError:
        print("Install python-gnupg first: pip install python-gnupg")
        sys.exit(1)
