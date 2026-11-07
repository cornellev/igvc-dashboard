"""Dummy drive command on cev/commands/control.

Two little-endian f32s: velocity (m/s), then steering angle (degrees).
The sample is stopped and centered.
"""

import os
import struct

NAME = "control"
KEY = os.getenv("CONTROL_COMMAND_ZENOH_KEY", "cev/commands/control")
RATE_HZ = 20


def payload(frame, now_ns):
    return struct.pack("<ff", 0.0, 0.0)
