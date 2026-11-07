"""Dummy segmented lidar cloud on cev/sensors/lidar/segmented_points.

Little-endian, matching LidarSubscriber and the panel decoder: a 16-byte
header (i32 seconds, u32 nanoseconds, u32 point count, u32 bytes per point),
then one 20-byte record per point (x, y, z, intensity as f32, cluster id as
i32). x is forward, y is left, z is up. Cluster id -1 means unclustered.
Points with NaN coordinates are included; the subscriber and the panel skip them.
"""

import math
import os
import struct

NAME = "segmented_points"
KEY = os.getenv("LIDAR_ZENOH_KEY", "cev/sensors/lidar/segmented_points")
RATE_HZ = 10


def encode_points(stamp_sec, stamp_nanosec, data, point_step):
    """Mirror of encode_points in rslidar_sdk_node.rs."""
    width = len(data) // point_step
    return struct.pack("<iIII", stamp_sec, stamp_nanosec, width, point_step) + data


def segmented_data(points):
    """XYZI f32 plus a trailing i32 cluster id per point."""
    return b"".join(struct.pack("<ffffi", *p) for p in points)


def _scene(frame):
    """A wall ahead, a post on the left, and a post on the right that slides."""
    points = []
    for y in (-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2):
        for z in (0.2, 1.0):
            points.append((6.0, float(y), z, 40.0, 0))
    for z in (0.0, 0.4, 0.8, 1.2):
        points.append((4.0, 1.6, z, 120.0, 1))
        points.append((4.2, 1.4, z, 120.0, 1))
    shift = 0.5 * math.sin(frame * 0.15)
    for z in (0.0, 0.4, 0.8, 1.2):
        points.append((4.0, -1.6 + shift, z, 200.0, 2))
        points.append((4.2, -1.4 + shift, z, 200.0, 2))
    nan = float("nan")
    for _ in range(3):
        points.append((nan, nan, nan, 0.0, -1))
    return points


def payload(frame, now_ns):
    points = _scene(frame)
    sec, nsec = divmod(int(now_ns), 1_000_000_000)
    return encode_points(sec, nsec, segmented_data(points), 20)
