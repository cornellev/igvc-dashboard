"""Dummy global route on cev/planning/global_route.

Same point list as the reference trajectory: u32 count, then f32 x, y, heading.
This sample is the coarse version, three waypoints along that path.
"""

import os
import struct

NAME = "global_route"
KEY = os.getenv("GLOBAL_ROUTE_ZENOH_KEY", "cev/planning/global_route")
RATE_HZ = 10

_POINTS = (
    (0.0, 0.0, 0.0),
    (5.0, 0.2, 0.04),
    (10.0, 0.5, 0.0),
)


def payload(frame, now_ns):
    body = b"".join(struct.pack("<fff", *point) for point in _POINTS)
    return struct.pack("<I", len(_POINTS)) + body
