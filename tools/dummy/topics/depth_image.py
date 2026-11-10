"""Dummy depth image on cev/sensors/camera/depth_image.

Little-endian u32 width, u32 height, then row-major f32 meters.
"""

import os
import struct

NAME = "depth_image"
KEY = os.getenv("CAMERA_DEPTH_ZENOH_KEY", "cev/sensors/camera/depth_image")
RATE_HZ = 10

_WIDTH = 4
_HEIGHT = 3
_METERS = (
    1.0, 1.5, 2.0, 2.5,
    3.0, 3.5, 4.0, 4.5,
    5.0, 5.5, 6.0, 8.0,
)


def payload(frame, now_ns):
    return struct.pack("<II", _WIDTH, _HEIGHT) + struct.pack("<12f", *_METERS)
