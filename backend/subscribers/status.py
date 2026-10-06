"""Zenoh spi_data subscriber; FSM and health inputs are not defined yet.
Contains all the Telemetry Data from sensors (previously old subscriber from old RED)"""

import json
import os
import struct
import threading
import time

import zenoh

from state import DashboardState

SAMPLE_RATE_HZ = 40


def decode_json_payload(b: bytes) -> str:
    """Return the JSON text carried by a spi_data payload.

    A native Zenoh publisher sends the UTF-8 JSON as-is. Through
    zenoh-bridge-ros2dds the payload is still a CDR-serialized std_msgs/String:
    a 4-byte encapsulation header (0x00, 0x00 big- or 0x01 little-endian, then
    2 option bytes), a u32 length that counts the trailing NUL, then the string.
    JSON text never starts with a 0x00 byte, so the two can't be confused.
    """
    if len(b) >= 8 and b[0] == 0 and b[1] in (0, 1):
        (n,) = struct.unpack_from("<I" if b[1] == 1 else ">I", b, 4)
        if 8 + n <= len(b):
            return b[8:8 + n].rstrip(b"\0").decode("utf-8")
    return b.decode("utf-8")


class DataSubscriber:
    def __init__(self, session: zenoh.Session, key: str = "spi_data",
                 state: DashboardState | None = None, sample_rate_hz: float = SAMPLE_RATE_HZ):
        self._key = key
        self._state = state if state is not None else DashboardState()
        self._lock = threading.Lock()
        self._sample_interval = 1.0 / sample_rate_hz
        self._last_append_time = float("-inf")   # monotonic() can start near 0, so 0.0 would skip early messages
        self._sub = session.declare_subscriber(key, self._callback)

    def _callback(self, sample):
        self.handle_payload(sample.payload.to_bytes())

    def handle_payload(self, b: bytes):
        try:
            data = json.loads(decode_json_payload(b))
        except ValueError as e:  # covers JSONDecodeError and UnicodeDecodeError
            self._state.invalidate_latest(self._key)
            print(f"[ZENOH] {self._key}: dropping malformed payload ({len(b)} bytes): {e}", flush=True)
            return

        stamp = time.time_ns()
        self._state.update_latest(self._key, data, stamp)

        # Previously done by ros_spin_loop: forward to the broadcaster at most
        # SAMPLE_RATE_HZ times a second; anything in between only updates latest.
        now = time.monotonic()
        with self._lock:
            if now - self._last_append_time < self._sample_interval:
                return
            self._last_append_time = now
        self._state.append_snapshot(data, stamp)

    # Returns (data_dict_or_None, recv_time_ns_or_None)
    def get_latest(self):
        return self._state.get_latest(self._key)

    def close(self):
        self._sub.undeclare()


# use to test
def main():
    config = zenoh.Config.from_env() if os.getenv("ZENOH_CONFIG") else zenoh.Config()
    session = zenoh.open(config)
    node = DataSubscriber(session, os.getenv("TELEMETRY_ZENOH_KEY", "spi_data"))
    try:
        while True:
            time.sleep(0.5)
            data, stamp = node.get_latest()
            if data is not None:
                print("Latest:", data, "stamp_ns:", stamp)
    except KeyboardInterrupt:
        pass
    finally:
        node.close()
        session.close()

if __name__ == '__main__':
    main()
