"""Checks for the Zenoh lidar path: ZenohClient -> LidarSubscriber / CostmapSubscriber.

Unit tests publish frames encoded exactly like `encode_points` and
`encode_costmap` in virtual-rgbd-sensor's rslidar_sdk_node.rs on an isolated
session (no multicast discovery), so they never touch the LAN and need no lidar:

    python tests/test_lidar_zenoh.py

Live mode subscribes with the dashboard's default Zenoh config and prints the
point cloud and costmap frames the real `rslidar_viz` publisher sends (start it
first):

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
    """Let zenoh_client import outside the ROS container; the ROS classes are never used here.

    Runs before every test, so skip modules already in sys.modules: find_spec()
    raises ValueError on a stub installed by an earlier call (it has no __spec__).
    """
    if "rclpy" not in sys.modules and importlib.util.find_spec("rclpy") is None:
        for name in ("rclpy", "rclpy.executors", "rclpy.qos",
                     "sensor_msgs", "sensor_msgs.msg", "std_msgs", "std_msgs.msg"):
            sys.modules[name] = MagicMock()
        sys.modules["rclpy.node"] = types.SimpleNamespace(Node=object)
    if "cv2" not in sys.modules and importlib.util.find_spec("cv2") is None:
        sys.modules["cv2"] = MagicMock()


"""
# Mimics the publisher from virtual-rgbd-sensor in Rust.
#
# Fake publisher that packs bits the same way as the
# original Rust repo
"""

def encode_points(stamp_sec, stamp_nanosec, data, point_step):
    """Mirror of `encode_points` in rslidar_sdk_node.rs."""
    width = len(data) // point_step
    return struct.pack("<iIII", stamp_sec, stamp_nanosec, width, point_step) + data


def segmented_data(points):
    """XYZI f32 + trailing i32 cluster id per point, like `build_segmented_data`."""
    return b"".join(struct.pack("<ffffi", *p) for p in points)


def encode_costmap(stamp_sec, stamp_nanosec, size_x, size_y, resolution, origin_x, origin_y, costs):
    """Mirror of `encode_costmap` in rslidar_sdk_node.rs: 32-byte header, then row-major u8 costs."""
    header = struct.pack("<iIIIfffI", stamp_sec, stamp_nanosec, size_x, size_y,
                         resolution, origin_x, origin_y, 0)
    return header + bytes(costs)


@unittest.skipUnless(HAS_ZENOH, "pip install eclipse-zenoh")
class ZenohSubscriberTestCase(unittest.TestCase):
    """Starts a ZenohClient on an isolated session for each test."""

    def setUp(self):
        stub_missing_ros_modules()
        import zenoh
        import zenoh_client

        # Isolated session: no multicast discovery and no listening socket, so
        # the test only ever sees its own puts.
        config = zenoh.Config()
        config.insert_json5("scouting/multicast/enabled", "false")
        config.insert_json5("listen/endpoints", "[]")

        self.lidar_key = zenoh_client.LIDAR_KEY
        self.costmap_key = zenoh_client.COSTMAP_KEY
        self.client = zenoh_client.ZenohClient(config)
        self.client.start()
        self.addCleanup(self.client.stop)

    def put_and_wait(self, subscriber, key, payload):
        before = subscriber.get_latest()
        self.client.session.put(key, payload)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            latest = subscriber.get_latest()
            if latest is not before:
                return latest
            time.sleep(0.01)
        return subscriber.get_latest()


class LidarSubscriberTests(ZenohSubscriberTestCase):
    def publish_and_wait(self, payload):
        return self.put_and_wait(self.client.lidar, self.lidar_key, payload)

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

    def test_costmap_does_not_reach_lidar(self):
        self.put_and_wait(self.client.costmap, self.costmap_key,
                          encode_costmap(1, 0, 2, 2, 0.1, 0.0, 0.0, [0, 0, 0, 0]))
        self.assertIsNone(self.client.lidar.get_latest())


class CostmapSubscriberTests(ZenohSubscriberTestCase):
    def publish_and_wait(self, payload):
        return self.put_and_wait(self.client.costmap, self.costmap_key, payload)

    def test_costmap_is_decoded(self):
        # 3 wide x 2 tall, row-major: row 0 is [free, inflated, lethal], row 1 is [unknown, free, inscribed]
        costs = [0, 128, 254,
                 255, 0, 253]
        stamp, info, grid = self.publish_and_wait(
            encode_costmap(7, 250_000_000, 3, 2, 0.05, -1.5, 2.25, costs))

        self.assertAlmostEqual(stamp, 7.25)
        self.assertAlmostEqual(info["resolution"], 0.05, places=6)
        self.assertEqual(info["origin_x"], -1.5)
        self.assertEqual(info["origin_y"], 2.25)
        self.assertEqual(grid.dtype, np.uint8)
        self.assertEqual(grid.shape, (2, 3))    # (size_y, size_x)
        self.assertEqual(grid.tolist(), [[0, 128, 254], [255, 0, 253]])

    def test_trailing_bytes_are_ignored(self):
        _, _, grid = self.publish_and_wait(
            encode_costmap(1, 0, 2, 1, 0.1, 0.0, 0.0, [1, 2, 99, 99]))
        self.assertEqual(grid.tolist(), [[1, 2]])

    def test_malformed_costmaps_keep_previous_frame(self):
        good = self.publish_and_wait(encode_costmap(1, 0, 2, 2, 0.1, 0.0, 0.0, [0, 1, 2, 3]))
        self.assertIsNotNone(good)

        truncated = encode_costmap(2, 0, 2, 2, 0.1, 0.0, 0.0, [0, 1, 2, 3])[:-1]
        zero_width = encode_costmap(2, 0, 0, 2, 0.1, 0.0, 0.0, [])
        zero_height = encode_costmap(2, 0, 2, 0, 0.1, 0.0, 0.0, [])
        for payload in (b"short", b"\0" * 31, truncated, zero_width, zero_height):
            self.assertIs(self.publish_and_wait(payload), good)

    def test_point_cloud_does_not_reach_costmap(self):
        self.put_and_wait(self.client.lidar, self.lidar_key,
                          encode_points(1, 0, segmented_data([(1, 1, 1, 1, 1)]), 20))
        self.assertIsNone(self.client.costmap.get_latest())


def live(seconds):
    stub_missing_ros_modules()
    import zenoh_client

    client = zenoh_client.ZenohClient()
    client.start()
    print(f"listening on {zenoh_client.LIDAR_KEY} and {zenoh_client.COSTMAP_KEY} for {seconds:.0f}s...")
    last_stamp = None
    last_costmap_stamp = None
    frames = 0
    costmap_frames = 0
    try:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            costmap = client.costmap.get_latest()
            if costmap is not None and costmap[0] != last_costmap_stamp:
                last_costmap_stamp, info, grid = costmap
                costmap_frames += 1
                size_y, size_x = grid.shape
                print(f"costmap ts={last_costmap_stamp:.6f} size={size_x}x{size_y}"
                      f" res={info['resolution']:.3f}"
                      f" origin=({info['origin_x']:.2f},{info['origin_y']:.2f})"
                      f" | lethal={int((grid == 254).sum())} unknown={int((grid == 255).sum())}"
                      f" free={int((grid == 0).sum())}", flush=True)

            latest = client.lidar.get_latest()
            if latest is not None and latest[0] != last_stamp:
                last_stamp, pts = latest
                frames += 1
                line = f"points  ts={last_stamp:.6f} valid_points={len(pts):5}"
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
    print(f"received {frames} point cloud frames and {costmap_frames} costmap frames")
    return frames and costmap_frames


if __name__ == "__main__":
    if "--live" in sys.argv:
        args = sys.argv[sys.argv.index("--live") + 1:]
        sys.exit(0 if live(float(args[0]) if args else 10) else 1)
    unittest.main()
