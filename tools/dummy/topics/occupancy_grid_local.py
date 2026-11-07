"""Dummy local lidar occupancy grid on cev/sensors/lidar/occupancy_grid/local.

Same 32-byte header and row-major bytes as the global occupancy grid.
The window is in the lidar frame, centered on the sensor.
Cells: 0 free, 254 lethal, 255 unknown.
"""

import os
import struct

NAME = "occupancy_grid_local"
KEY = os.getenv("OCCUPANCY_LOCAL_ZENOH_KEY", "cev/sensors/lidar/occupancy_grid/local")
RATE_HZ = 10

_CELLS = bytes([
    0, 0, 0, 255,
    0, 254, 0, 0,
    0, 0, 0, 255,
])


def payload(frame, now_ns):
    sec, nsec = divmod(int(now_ns), 1_000_000_000)
    header = struct.pack("<iIIIfffI", sec, nsec, 4, 3, 0.5, -1.0, -0.75, 0)
    return header + _CELLS
