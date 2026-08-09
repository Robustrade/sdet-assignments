"""In-process test doubles for downstream side effects.

These replace what would be a real message broker (Kafka/Rabbit) and a real
notification service in production. They record every invocation so tests can
assert exactly-once semantics.
"""

from threading import Lock
from typing import Any


class StubPublisher:
    """Records every publish attempt. Used to assert exactly-once event emission."""

    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []
        self._lock = Lock()

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._events.append(dict(event))

    def events_for(self, transfer_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [e for e in self._events if e.get("transfer_id") == transfer_id]

    def count(self) -> int:
        with self._lock:
            return len(self._events)

    def clear(self) -> None:
        with self._lock:
            self._events.clear()


class NotificationRecorder:
    """Records every notification trigger. Used to assert exactly-once trigger."""

    def __init__(self) -> None:
        self._calls: list[dict[str, Any]] = []
        self._lock = Lock()

    def notify(self, transfer_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._calls.append({"transfer_id": transfer_id, "payload": dict(payload)})

    def calls_for(self, transfer_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [c for c in self._calls if c["transfer_id"] == transfer_id]

    def count(self) -> int:
        with self._lock:
            return len(self._calls)

    def clear(self) -> None:
        with self._lock:
            self._calls.clear()
