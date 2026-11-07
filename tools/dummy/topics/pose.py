"""Dummy vehicle pose on cev/localization/pose.

Four little-endian f32s: x, y, z (meters), heading (radians). No covariance.
The sample is the origin, facing forward.
"""

import os
import struct

NAME = "pose"
KEY = os.getenv("POSE_ZENOH_KEY", "cev/localization/pose")
RATE_HZ = 20


def payload(frame, now_ns):
    return struct.pack("<ffff", 0.0, 0.0, 0.0, 0.0)
