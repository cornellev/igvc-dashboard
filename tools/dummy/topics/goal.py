"""Dummy navigation goal on cev/commands/goal.

Two little-endian f32s: x, y in meters from the start. This matches the last
waypoint of the dummy global route.
"""

import os
import struct

NAME = "goal"
KEY = os.getenv("GOAL_ZENOH_KEY", "cev/commands/goal")
RATE_HZ = 10


def payload(frame, now_ns):
    return struct.pack("<ff", 10.0, 0.5)
