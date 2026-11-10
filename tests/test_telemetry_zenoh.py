"""Checks for the Zenoh spi_data path: ZenohClient -> DataSubscriber -> DashboardState.

Publishes on an isolated session (no multicast discovery), so the tests never
touch the LAN and need no vehicle:

    python tests/test_telemetry_zenoh.py

Payloads are sent both as plain UTF-8 JSON (a native Zenoh publisher) and as a
CDR-serialized std_msgs/String (what zenoh-bridge-ros2dds forwards from ROS).
"""

import json
import struct
import time
import unittest

from test_lidar_zenoh import ZenohSubscriberTestCase


def cdr_string(text, little_endian=True):
    """std_msgs/String as CDR: encapsulation header, u32 length incl. NUL, bytes, NUL."""
    raw = text.encode() + b"\0"
    if little_endian:
        return b"\x00\x01\x00\x00" + struct.pack("<I", len(raw)) + raw
    return b"\x00\x00\x00\x00" + struct.pack(">I", len(raw)) + raw


class TelemetrySubscriberTests(ZenohSubscriberTestCase):
    def setUp(self):
        super().setUp()
        import zenoh_client
        self.telemetry_key = zenoh_client.TELEMETRY_KEY
        self.state = self.client.state

    def publish_and_wait(self, payload):
        # get_latest() builds a new tuple on every call, so compare values, not identity.
        node = self.client.telemetry
        before = node.get_latest()
        self.client.session.put(self.telemetry_key, payload)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            latest = node.get_latest()
            if latest != before:
                return latest
            time.sleep(0.01)
        return node.get_latest()

    def test_plain_json_is_stored_and_snapshotted(self):
        data, stamp = self.publish_and_wait(json.dumps({"speed": 2.5}).encode())

        self.assertEqual(data, {"speed": 2.5})
        self.assertGreater(stamp, 0)
        self.assertEqual(self.state.get_latest_snapshot(), ({"speed": 2.5}, stamp))
        self.assertTrue(self.state.data_ready.is_set())

    def test_bridged_cdr_string_is_decoded(self):
        for little_endian in (True, False):
            payload = cdr_string(json.dumps({"rpm": [1, 2, 3, 4]}), little_endian)
            data, _ = self.publish_and_wait(payload)
            self.assertEqual(data, {"rpm": [1, 2, 3, 4]})

    def test_invalid_payload_invalidates_latest(self):
        for bad in (b"invalid JSON", b"\xff\xfe not utf-8"):
            self.assertEqual(self.publish_and_wait(b'{"speed": 1}')[0], {"speed": 1})
            self.assertIsNone(self.publish_and_wait(bad)[0])

    def test_snapshots_are_rate_limited(self):
        node = self.client.telemetry
        node.handle_payload(b'{"n": 1}')
        node.handle_payload(b'{"n": 2}')   # well inside one 1/40 s sample interval

        self.assertEqual(node.get_latest()[0], {"n": 2})     # latest always updates
        self.assertEqual([d for d, _ in self.state.get_history()], [{"n": 1}])

        time.sleep(0.05)
        node.handle_payload(b'{"n": 3}')
        self.assertEqual([d for d, _ in self.state.get_history()], [{"n": 1}, {"n": 3}])


if __name__ == "__main__":
    unittest.main()
