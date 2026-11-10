"""Dummy local costmap on cev/mapping/costmap.

Little-endian 32-byte header, then one unsigned byte per cell, row-major
(x varies fastest). Header: i32 seconds, u32 nanoseconds, u32 width, u32 height,
f32 resolution (m/cell), f32 origin x, f32 origin y, u32 reserved.
Cells: 0 free, 1-252 inflation, 253 inscribed, 254 lethal, 255 unknown.
"""

import os
import struct

NAME = "costmap"
KEY = os.getenv("COSTMAP_ZENOH_KEY", "cev/mapping/costmap")
RATE_HZ = 10

# 4 wide by 3 tall. One cell of each special cost, plus a low inflation value.
_COSTS = bytes([
    0, 10, 253, 254,
    255, 0, 0, 0,
    0, 0, 0, 0,
])


def payload(frame, now_ns):
    sec, nsec = divmod(int(now_ns), 1_000_000_000)
    header = struct.pack("<iIIIfffI", sec, nsec, 4, 3, 0.5, -1.0, -0.75, 0)
    return header + _COSTS
