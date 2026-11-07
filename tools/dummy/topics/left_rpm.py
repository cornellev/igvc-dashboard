"""Dummy left-wheel speed on cev/sensors/wheels/left_rpm.

One little-endian f32. The description says rotations/second, while the key
says RPM, so this sample is 2.0 rotations/second until the unit is confirmed.
"""

import os
import struct

NAME = "left_rpm"
KEY = os.getenv("WHEEL_LEFT_RPM_ZENOH_KEY", "cev/sensors/wheels/left_rpm")
RATE_HZ = 20


def payload(frame, now_ns):
    return struct.pack("<f", 2.0)
