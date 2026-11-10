"""Dashboard controls published over Zenoh as CDR std_msgs/Int32.

zenoh-bridge-ros2dds forwards a Zenoh key to the ROS topic of the same name
(dashboard_control/autonomy_run -> /dashboard_control/autonomy_run) once a ROS
node subscribes to it, so vehicle-side subscribers keep receiving Int32 values.
"""

import struct
import threading

import zenoh

# CDR encapsulation header for little-endian plain CDR (0x00, 0x01), then 2 option bytes.
CDR_LE_HEADER = b"\x00\x01\x00\x00"


def encode_int32_cdr(value: int) -> bytes:
    """Serialize a std_msgs/Int32 as little-endian CDR: 4-byte header, then i32 data."""
    return CDR_LE_HEADER + struct.pack("<i", value)


def decode_int32_cdr(b: bytes) -> int:
    """Inverse of encode_int32_cdr; also accepts big-endian CDR. Raises ValueError if malformed."""
    if len(b) != 8 or b[0] != 0 or b[1] not in (0, 1):
        raise ValueError("not a CDR std_msgs/Int32 payload")
    (value,) = struct.unpack_from("<i" if b[1] == 1 else ">i", b, 4)
    return value


class DashboardControlPublisher:
    def __init__(self, session: zenoh.Session, topic_namespace: str, publish_hz: float):
        self._topic_namespace = topic_namespace.strip("/") or "dashboard_control"
        self._states = {
            "autonomy_run": False,
            "bag_recording": False,
        }
        self._lock = threading.Lock()
        self._topics = {
            key: f"{self._topic_namespace}/{key}" for key in self._states
        }
        self._control_publishers = {
            key: session.declare_publisher(topic)
            for key, topic in self._topics.items()
        }

        # Republish the current states periodically, as the ROS timer did, so a
        # subscriber that starts late still learns them.
        self._interval = 1.0 / max(publish_hz, 0.1)
        self._stop_evt = threading.Event()
        self._thread = threading.Thread(target=self._publish_loop, daemon=True)
        self._thread.start()

        print(
            f"[ZENOH] publishing dashboard control states under key namespace: {self._topic_namespace}",
            flush=True,
        )

    def start_autonomy_run(self):
        self._set_state("autonomy_run", True)

    def stop_autonomy_run(self):
        self._set_state("autonomy_run", False)

    def start_bag_recording(self):
        self._set_state("bag_recording", True)

    def stop_bag_recording(self):
        self._set_state("bag_recording", False)

    def get_autonomy_status(self):
        return self._get_control_status("autonomy_run", "running")

    def get_bag_status(self):
        return self._get_control_status("bag_recording", "recording")

    def get_status(self):
        return {
            "autonomy": self.get_autonomy_status(),
            "bag": self.get_bag_status(),
        }

    def close(self):
        self._stop_evt.set()
        self._thread.join(timeout=5.0)
        for publisher in self._control_publishers.values():
            publisher.undeclare()
        self._control_publishers.clear()

    def _get_control_status(self, key: str, status_name: str):
        with self._lock:
            enabled = self._states[key]

        return {
            status_name: enabled,
            "topic": self._topics[key],
            "value": 1 if enabled else 0,
        }

    def _set_state(self, key: str, enabled: bool):
        with self._lock:
            self._states[key] = enabled
            value = 1 if enabled else 0

        self._publish_value(key, value)

    def _publish_loop(self):
        while not self._stop_evt.wait(self._interval):
            self._publish_current_states()

    def _publish_current_states(self):
        with self._lock:
            states = self._states.copy()

        for key, enabled in states.items():
            self._publish_value(key, 1 if enabled else 0)

    def _publish_value(self, key: str, value: int):
        try:
            self._control_publishers[key].put(encode_int32_cdr(value))
        except Exception as e:   # a closed session must not kill the loop or a REST call
            print(f"[ZENOH] ERROR: failed to publish {self._topics[key]}: {e}", flush=True)
