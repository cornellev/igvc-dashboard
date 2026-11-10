"""Dummy global lidar occupancy grid on cev/sensors/lidar/occupancy_grid/global.

Same 32-byte header as the costmap: i32 seconds, u32 nanoseconds, u32 width,
u32 height, f32 resolution (m/cell), f32 origin x, f32 origin y, u32 reserved.
Body is one unsigned byte per cell, row-major. That order is the stand-in
until the draft's serialization order is confirmed.
Cells used here: 0 free, 254 lethal, 255 unknown.
"""

import os
import struct

NAME = "occupancy_grid_global"
KEY = os.getenv("OCCUPANCY_GLOBAL_ZENOH_KEY", "cev/sensors/lidar/occupancy_grid/global")
RATE_HZ = 10

_CELLS = bytes([
    0, 0, 254, 255,
    0, 254, 0, 0,
    255, 0, 0, 0,
])


def payload(frame, now_ns):
    sec, nsec = divmod(int(now_ns), 1_000_000_000)
    header = struct.pack("<iIIIfffI", sec, nsec, 4, 3, 0.5, -1.0, -0.75, 0)
    return header + _CELLS
