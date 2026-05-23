"""Load YAML test cases as pytest.param entries with markers from `tags:`."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

TESTCASES_DIR = Path(__file__).resolve().parent.parent / "testcases"


def load_cases(file_name):
    """Return (params, ids) for `pytest.mark.parametrize("case", ...)`.

    Each YAML case must have an `id` and may have `tags`. Tags are turned
    into pytest markers, so `--incl_tests=<tag>` filters work without
    any extra wiring per file.
    """
    path = TESTCASES_DIR / file_name
    if not path.exists():
        raise FileNotFoundError(f"Test case file not found: {path}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    params, ids = [], []
    for case in raw.get("cases", []):
        case_id = case["id"]
        marks = [getattr(pytest.mark, t) for t in (case.get("tags") or [])]
        params.append(pytest.param(case, marks=marks, id=case_id))
        ids.append(case_id)
    return params, ids
