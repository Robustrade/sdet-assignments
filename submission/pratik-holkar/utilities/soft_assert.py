"""Collect multiple assertion failures and raise once at the end.

Usage:
    sa = SoftAssert(step_log)
    sa.check(resp.status_code == 201, "API status")
    sa.equals(db.balance("acc_alpha"), 5000, "source debit")
    sa.assert_all()
"""

from typing import Optional

from utilities.steps import StepLog


class SoftAssertionError(AssertionError):
    pass


class SoftAssert:
    def __init__(self, step_log: Optional[StepLog] = None):
        self._failures: list[str] = []
        self._log = step_log

    def check(self, cond, message, details=""):
        if cond:
            if self._log is not None:
                self._log.add(message, status="passed", details=details)
            return True
        line = message if not details else f"{message} ({details})"
        self._failures.append(line)
        if self._log is not None:
            self._log.add(message, status="failed", details=details)
        return False

    def equals(self, actual, expected, message):
        return self.check(
            actual == expected,
            message,
            details=f"expected={expected!r}, actual={actual!r}",
        )

    def assert_all(self):
        if not self._failures:
            return
        joined = "\n  - ".join(self._failures)
        raise SoftAssertionError(f"{len(self._failures)} soft assertion(s) failed:\n  - {joined}")
