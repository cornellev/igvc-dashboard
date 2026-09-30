"""Checks for the Zenoh lidar path: ZenohClient -> LidarSubscriber.

Unit tests publish frames encoded exactly like `encode_points` in
virtual-rgbd-sensor's rslidar_sdk_node.rs on an isolated session (no multicast
discovery), so they never touch the LAN and need no lidar:

    python tests/test_lidar_zenoh.py

Live mode subscribes with the dashboard's default Zenoh config and prints the
frames the real `rslidar_viz` publisher sends (start it first):

    python tests/test_lidar_zenoh.py --live [seconds]

Needs Python 3.10+, numpy and eclipse-zenoh. ROS is stubbed out when it isn't
installed, since only the Zenoh side is exercised here.
"""

import importlib.util
from pathlib import Path
import struct
import sys
import time
import types
import unittest
from unittest.mock import MagicMock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

HAS_ZENOH = importlib.util.find_spec("zenoh") is not None


def stub_missing_ros_modules():
    """Let zenoh_client import outside the ROS container; the ROS classes are never used here."""
    if importlib.util.find_spec("rclpy") is None:
        for name in ("rclpy", "rclpy.executors", "rclpy.qos",
                     "sensor_msgs", "sensor_msgs.msg", "std_msgs", "std_msgs.msg"):
            sys.modules[name] = MagicMock()
        sys.modules["rclpy.node"] = types.SimpleNamespace(Node=object)
    if importlib.util.find_spec("cv2") is None:
        sys.modules["cv2"] = MagicMock()


def encode_points(stamp_sec, stamp_nanosec, data, point_step):
    """Mirror of `encode_points` in rslidar_sdk_node.rs."""
    width = len(data) // point_step
    return struct.pack("<iIII", stamp_sec, stamp_nanosec, width, point_step) + data


def segmented_data(points):
    """XYZI f32 + trailing i32 cluster id per point, like `build_segmented_data`."""
    return b"".join(struct.pack("<ffffi", *p) for p in points)


@unittest.skipUnless(HAS_ZENOH, "pip install eclipse-zenoh")
class LidarSubscriberTests(unittest.TestCase):
    def setUp(self):
        stub_missing_ros_modules()
        import zenoh
        import zenoh_client

        # Isolated session: no multicast discovery and no listening socket, so
        # the test only ever sees its own puts.
        config = zenoh.Config()
        config.insert_json5("scouting/multicast/enabled", "false")
        config.insert_json5("listen/endpoints", "[]")

        self.key = zenoh_client.LIDAR_KEY
        self.client = zenoh_client.ZenohClient(config)
        self.client.start()
        self.addCleanup(self.client.stop)

    def publish_and_wait(self, payload):
        before = self.client.lidar.get_latest()
        self.client.session.put(self.key, payload)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            latest = self.client.lidar.get_latest()
            if latest is not before:
                return latest
            time.sleep(0.01)
        return self.client.lidar.get_latest()

    def test_segmented_frame_is_decoded(self):
        points = [
            (1.0, 2.0, 3.0, 10.0, 0),
            (float("nan"), 0.0, 0.0, 0.0, -1),   # invalid return, dropped
            (-4.5, 0.5, -1.25, 99.0, 7),
        ]
        stamp, pts = self.publish_and_wait(encode_points(12, 500_000_000, segmented_data(points), 20))

        self.assertAlmostEqual(stamp, 12.5)
        self.assertEqual(pts.shape, (2, 5))
        np.testing.assert_allclose(pts[:, :4], [[1, 2, 3, 10], [-4.5, 0.5, -1.25, 99]])
        self.assertEqual(pts[:, 4].view(np.int32).tolist(), [0, 7])

    def test_raw_frame_is_decoded(self):
        data = struct.pack("<ffff", 0.5, -0.5, 1.5, 42.0)
        stamp, pts = self.publish_and_wait(encode_points(3, 0, data, 16))

        self.assertEqual(stamp, 3.0)
        np.testing.assert_allclose(pts, [[0.5, -0.5, 1.5, 42.0]])

    def test_malformed_payloads_keep_previous_frame(self):
        good = self.publish_and_wait(encode_points(1, 0, segmented_data([(1, 1, 1, 1, 1)]), 20))
        self.assertIsNotNone(good)

        truncated = encode_points(2, 0, segmented_data([(2, 2, 2, 2, 2)]), 20)[:-4]
        bad_step = struct.pack("<iIII", 2, 0, 1, 12) + b"\0" * 12
        for payload in (b"short", truncated, bad_step):
            self.assertIs(self.publish_and_wait(payload), good)


def live(seconds):
    stub_missing_ros_modules()
    import zenoh_client

    client = zenoh_client.ZenohClient()
    client.start()
    print(f"listening on {zenoh_client.LIDAR_KEY} for {seconds:.0f}s...")
    last_stamp = None
    frames = 0
    try:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            latest = client.lidar.get_latest()
            if latest is not None and latest[0] != last_stamp:
                last_stamp, pts = latest
                frames += 1
                line = f"ts={last_stamp:.6f} valid_points={len(pts):5}"
                if len(pts):
                    mn, mx = pts[:, :3].min(0), pts[:, :3].max(0)
                    line += (f" | bbox x[{mn[0]:.2f},{mx[0]:.2f}] y[{mn[1]:.2f},{mx[1]:.2f}]"
                             f" z[{mn[2]:.2f},{mx[2]:.2f}]")
                if pts.shape[1] == 5:
                    cluster = pts[:, 4].view(np.int32)
                    line += f" | clusters={len(np.unique(cluster[cluster >= 0]))}"
                print(line, flush=True)
            time.sleep(0.01)
    finally:
        client.stop()
    print(f"received {frames} frames")
    return frames


if __name__ == "__main__":
    if "--live" in sys.argv:
        args = sys.argv[sys.argv.index("--live") + 1:]
        sys.exit(0 if live(float(args[0]) if args else 10) else 1)
    unittest.main()
