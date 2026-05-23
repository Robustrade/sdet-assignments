"""Per-test step recorder used by the HTML report.

Each StepLog instance is attached to a single pytest item, so xdist
workers don't fight over a shared buffer.
"""

from contextlib import contextmanager
from dataclasses import dataclass, field
from time import perf_counter


@dataclass
class Step:
    name: str
    status: str  # passed | failed | info
    details: str = ""
    duration_ms: float = 0.0


@dataclass
class StepLog:
    steps: list[Step] = field(default_factory=list)

    def add(self, name, status="passed", details=""):
        self.steps.append(Step(name=name, status=status, details=details))

    @contextmanager
    def step(self, name, details=""):
        t0 = perf_counter()
        try:
            yield
        except Exception as e:
            self.steps.append(
                Step(
                    name=name,
                    status="failed",
                    details=f"{details}\n{type(e).__name__}: {e}".strip(),
                    duration_ms=(perf_counter() - t0) * 1000,
                )
            )
            raise
        else:
            self.steps.append(
                Step(
                    name=name,
                    status="passed",
                    details=details,
                    duration_ms=(perf_counter() - t0) * 1000,
                )
            )
