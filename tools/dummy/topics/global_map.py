"""Dummy global map on cev/mapping/global_map.

The draft describes the same prior-map-plus-local-changes grid as the global
lidar occupancy topic, so this publishes that payload unchanged.
"""

import os

from .occupancy_grid_global import payload as _occupancy_payload

NAME = "global_map"
KEY = os.getenv("GLOBAL_MAP_ZENOH_KEY", "cev/mapping/global_map")
RATE_HZ = 10


def payload(frame, now_ns):
    return _occupancy_payload(frame, now_ns)
