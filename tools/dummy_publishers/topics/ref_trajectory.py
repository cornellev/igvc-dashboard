"""Dummy reference trajectory on cev/planning/ref_trajectory.

Little-endian u32 count, then f32 x, y (meters) and heading (radians) per point.
World frame. z is omitted.
"""

import os
import struct

NAME = "ref_trajectory"
KEY = os.getenv("REF_TRAJECTORY_ZENOH_KEY", "cev/planning/ref_trajectory")
RATE_HZ = 10

_POINTS = (
    (0.0, 0.0, 0.0),
    (2.0, 0.0, 0.0),
    (4.0, 0.2, 0.05),
    (6.0, 0.5, 0.1),
    (8.0, 0.5, 0.0),
)


def payload(frame, now_ns):
    body = b"".join(struct.pack("<fff", *point) for point in _POINTS)
    return struct.pack("<I", len(_POINTS)) + body
