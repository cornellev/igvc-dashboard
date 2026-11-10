"""Dummy lane boundaries on cev/mapping/lanes.

Two polylines in world meters. Each is a little-endian u32 count followed by
f32 x, y points. Left side first, then right side.
"""

import os
import struct

NAME = "lanes"
KEY = os.getenv("LANES_ZENOH_KEY", "cev/mapping/lanes")
RATE_HZ = 10

_LEFT = ((0.0, 1.5), (5.0, 1.5), (10.0, 1.5))
_RIGHT = ((0.0, -1.5), (5.0, -1.5), (10.0, -1.5))


def _polyline(points):
    body = b"".join(struct.pack("<ff", x, y) for x, y in points)
    return struct.pack("<I", len(points)) + body


def payload(frame, now_ns):
    return _polyline(_LEFT) + _polyline(_RIGHT)
