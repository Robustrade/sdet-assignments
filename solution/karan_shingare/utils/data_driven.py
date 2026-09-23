"""Helper for JSON-driven test classes.

Test data lives as JSON next to the test file that uses it, under a
`vars/` folder, one file per test class, named after the class exactly
(`vars/TestCreateSubscription.json` for `class TestCreateSubscription`).
A test class that needs data extends `DataDrivenTestCase`. pytest calls
`setup_method()` before every test method on the class, which calls
`_setup()`, which loads that class's JSON file into `self.data`. A test
method then pulls its own entry out with `self.case(...)`, using a typed
dataclass from `data/` so it still gets attribute access and defaults
instead of raw dict lookups everywhere.

This is the same vars-folder-per-class convention used in
qs-prospector-automation, applied here to keep test data as JSON and out
of the test bodies themselves.
"""
import json
import sys
from pathlib import Path
from typing import Type, TypeVar

CaseT = TypeVar("CaseT")


def load_class_json(cls: type) -> dict:
    """Load vars/<cls.__name__>.json from the directory of the module cls is defined in."""
    test_file = Path(sys.modules[cls.__module__].__file__)
    vars_file = test_file.parent / "vars" / f"{cls.__name__}.json"
    with open(vars_file) as f:
        return json.load(f)


class DataDrivenTestCase:
    """Base class for test classes backed by a vars/<ClassName>.json file."""

    data: dict

    def setup_method(self, method) -> None:
        self._setup()

    def _setup(self) -> None:
        self.data = load_class_json(type(self))

    def case(self, case_type: Type[CaseT], key: str) -> CaseT:
        """Build a typed case out of self.data[key], using key itself as the case name."""
        return case_type(name=key, **self.data[key])
