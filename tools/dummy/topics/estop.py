"""Dummy software e-stop on cev/commands/estop.

One unsigned byte: 0 is false, 1 is true. The sample is not stopped.
"""

import os
import struct

NAME = "estop"
KEY = os.getenv("ESTOP_ZENOH_KEY", "cev/commands/estop")
RATE_HZ = 10


def payload(frame, now_ns):
    return struct.pack("<B", 0)
