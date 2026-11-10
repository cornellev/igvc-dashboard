"""Dummy GPS position on cev/sensors/gps/position.

Two little-endian f32s: latitude, then longitude, in degrees.
The sample is the B-lot point already used by the dashboard map.
"""

import os
import struct

NAME = "gps_position"
KEY = os.getenv("GPS_POSITION_ZENOH_KEY", "cev/sensors/gps/position")
RATE_HZ = 10

_LAT = 42.446567
_LON = -76.463017


def payload(frame, now_ns):
    return struct.pack("<ff", _LAT, _LON)
