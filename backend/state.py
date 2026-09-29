"""Storage extracted from the original telemetry and multi-topic subscribers.

Payloads and timestamps retain their original meaning. This is not yet the
normalized state model for the future autonomy dashboard.
"""

import collections
import threading
from typing import Any

DEQUE_SIZE = 1000


class DashboardState:
    def __init__(self, history_size: int = DEQUE_SIZE):
        self._lock = threading.Lock()
        self._latest: dict[str, Any] = {}
        self._timestamps: dict[str, int] = {}
        self._history: collections.deque = collections.deque(maxlen=history_size)
        self.data_ready = threading.Event()

    def update_latest(self, topic: str, data: Any, stamp_ns: int):
        with self._lock:
            self._latest[topic] = data
            self._timestamps[topic] = stamp_ns

    def invalidate_latest(self, topic: str):
        # Preserve the original subscriber's behavior on invalid JSON.
        with self._lock:
            self._latest[topic] = None

    def get_latest(self, topic: str):
        with self._lock:
            return self._latest.get(topic), self._timestamps.get(topic)

    def get_latest_all(self):
        with self._lock:
            return dict(self._latest), dict(self._timestamps)

    def append_snapshot(self, data: Any, stamp_ns: int):
        with self._lock:
            self._history.append((data, stamp_ns))
        self.data_ready.set()

    def get_latest_snapshot(self):
        with self._lock:
            return self._history[-1] if self._history else None

    def get_history(self):
        with self._lock:
            return list(self._history)
