"""JSON Schemas pinning the public API contract.

The bar these schemas enforce:
- response field names + types + required-ness
- enums for `status` and `currency` (so adding a new value silently is caught)
- `additionalProperties: False` so internal fields (payload_hash, etc.) cannot
  accidentally leak into responses
- formats for `id` (uuid) and timestamps (date-time)

Combining `assert_matches(...)` with plain assertions on status code + body
equality gives the full contract: shape + behavior.
"""

from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

VALID_CURRENCIES = ["AED", "USD", "EUR", "GBP"]
TRANSFER_STATUSES = ["pending", "completed", "failed"]

TRANSFER_RESPONSE: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": [
        "id",
        "source_wallet_id",
        "destination_wallet_id",
        "amount",
        "currency",
        "status",
        "created_at",
    ],
    "properties": {
        "id": {"type": "string", "format": "uuid"},
        "source_wallet_id": {"type": "string", "minLength": 1},
        "destination_wallet_id": {"type": "string", "minLength": 1},
        "amount": {"type": "integer", "minimum": 1},
        "currency": {"enum": VALID_CURRENCIES},
        "reference": {"type": ["string", "null"]},
        "status": {"enum": TRANSFER_STATUSES},
        "idempotency_key": {"type": ["string", "null"]},
        "created_at": {"type": "string", "format": "date-time"},
    },
    "additionalProperties": False,
}

WALLET_RESPONSE: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["id", "balance", "currency"],
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "balance": {"type": "integer", "minimum": 0},
        "currency": {"enum": VALID_CURRENCIES},
    },
    "additionalProperties": False,
}

ERROR_RESPONSE: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["error"],
    "properties": {
        "error": {"type": "string", "minLength": 1},
        "fields": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
        },
    },
    "additionalProperties": False,
}


def assert_matches(payload: dict[str, Any], schema: dict[str, Any]) -> None:
    """Raise AssertionError with all schema violations on failure."""
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.path))
    if errors:
        formatted = "; ".join(
            f"{list(e.path) or '<root>'}: {e.message}" for e in errors
        )
        raise AssertionError(f"schema mismatch: {formatted}\npayload={payload}")
