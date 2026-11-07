"""Dummy measured steering angle on cev/sensors/steering/steering_angle.

One little-endian f32 in radians. Center is 0, counterclockwise is positive.
The sample is centered.
"""

import os
import struct

NAME = "steering_angle"
KEY = os.getenv("STEERING_ANGLE_ZENOH_KEY", "cev/sensors/steering/steering_angle")
RATE_HZ = 20


def payload(frame, now_ns):
    return struct.pack("<f", 0.0)
