"""Dummy classified objects on cev/classification/objects.

Little-endian u32 count, then one record per object: i32 id and four f32s,
left, top, right, bottom, in image pixels.
"""

import os
import struct

NAME = "objects"
KEY = os.getenv("CLASSIFICATION_OBJECTS_ZENOH_KEY", "cev/classification/objects")
RATE_HZ = 10

# id, left, top, right, bottom
_OBJECTS = (
    (1, 4.0, 6.0, 12.0, 18.0),
    (2, 20.0, 5.0, 28.0, 16.0),
)


def payload(frame, now_ns):
    body = b"".join(struct.pack("<iffff", *item) for item in _OBJECTS)
    return struct.pack("<I", len(_OBJECTS)) + body
