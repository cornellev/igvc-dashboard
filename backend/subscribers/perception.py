"""Zenoh camera, lidar point-cloud, and costmap subscribers."""

import threading, struct
import numpy as np
import zenoh
import cv2

JPEG_QUALITY = 75

# sensor_msgs/Image encodings we can turn into a JPEG: channels per pixel, and
# the cv2 conversion to BGR (None if already BGR or single-channel).
IMAGE_ENCODINGS = {
    "bgr8": (3, None),
    "rgb8": (3, cv2.COLOR_RGB2BGR),
    "bgra8": (4, cv2.COLOR_BGRA2BGR),
    "rgba8": (4, cv2.COLOR_RGBA2BGR),
    "mono8": (1, None),
}


def decode_image_cdr(b: bytes):
    """Parse a CDR-serialized sensor_msgs/Image, as zenoh-bridge-ros2dds forwards it.

    Layout after the 4-byte encapsulation header (0x00, 0x00 big- or 0x01
    little-endian, 2 option bytes), with every u32 aligned to 4 bytes counted
    from the end of that header: header.stamp (i32 sec, u32 nanosec),
    header.frame_id (string), height, width, encoding (string), is_bigendian
    (u8), step, data (u32 length + bytes). Strings are a u32 length that counts
    the trailing NUL, then the bytes.

    Returns (height, width, encoding, step, data). Raises ValueError if malformed.
    """
    if len(b) < 4 or b[0] != 0 or b[1] not in (0, 1):
        raise ValueError("not a CDR payload")
    u32 = struct.Struct("<I" if b[1] == 1 else ">I")
    pos = 4

    def read_u32():
        nonlocal pos
        pos += -(pos - 4) % 4
        if pos + 4 > len(b):
            raise ValueError("truncated image header")
        (value,) = u32.unpack_from(b, pos)
        pos += 4
        return value

    def read_bytes(n):
        nonlocal pos
        if pos + n > len(b):
            raise ValueError("truncated image payload")
        out = b[pos:pos + n]
        pos += n
        return out

    def read_string():
        return read_bytes(read_u32()).rstrip(b"\0").decode("ascii", "replace")

    read_u32(); read_u32()                     # header.stamp (unused: frames are shown as they arrive)
    read_string()                              # header.frame_id
    height, width = read_u32(), read_u32()
    encoding = read_string()
    read_bytes(1)                              # is_bigendian (irrelevant for 8-bit encodings)
    step = read_u32()
    data = read_bytes(read_u32())
    return height, width, encoding, step, data


def image_to_jpeg(height, width, encoding, step, data) -> bytes:
    if encoding not in IMAGE_ENCODINGS:
        raise ValueError(f"unsupported image encoding {encoding!r}")
    channels, conversion = IMAGE_ENCODINGS[encoding]
    if step < width * channels or len(data) < height * step:
        raise ValueError(f"image data too short for {width}x{height} {encoding} (step {step})")
    # Rows may be padded past width * channels, so slice each row by step.
    rows = np.frombuffer(data, np.uint8, count=height * step).reshape(height, step)
    arr = rows[:, :width * channels].reshape(height, width, channels)
    if conversion is not None:
        arr = cv2.cvtColor(arr, conversion)
    ok, buf = cv2.imencode('.jpg', arr, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise ValueError("cv2.imencode failed")
    return buf.tobytes()


class CameraSubscriber:
    """Keep the latest camera frame as a JPEG for /ws/camera/{side}.

    Accepts a CDR sensor_msgs/Image (what zenoh-bridge-ros2dds forwards from the
    ZED topics) or an already-encoded JPEG (a native Zenoh publisher), which is
    passed through without re-encoding.
    """

    def __init__(self, session: zenoh.Session, key: str, name: str):
        self._name = name
        self._latest_jpeg: bytes | None = None
        self._lock = threading.Lock()
        self._frame_count = 0
        self._sub = session.declare_subscriber(key, self._callback)
        print(f'[CAM] {name}: subscribing to camera key {key}', flush=True)

    def _callback(self, sample):
        self.handle_payload(sample.payload.to_bytes())

    def handle_payload(self, b: bytes):
        try:
            if b[:2] == b"\xff\xd8":
                jpeg, description = b, f"jpeg, bytes={len(b)}"
            else:
                height, width, encoding, step, data = decode_image_cdr(b)
                jpeg = image_to_jpeg(height, width, encoding, step, data)
                description = f"{width}x{height}, encoding={encoding}, bytes={len(data)}"
        except Exception as e:
            print(f'[CAM] {self._name}: camera decode error: {e}', flush=True)
            return

        with self._lock:
            self._latest_jpeg = jpeg
            self._frame_count += 1
            frame_count = self._frame_count

        if frame_count == 1:
            print(f'[CAM] {self._name}: received first camera frame: {description}', flush=True)
        elif frame_count % 60 == 0:
            print(f'[CAM] {self._name}: received {frame_count} camera frames', flush=True)

    def get_latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def close(self):
        self._sub.undeclare()


class LidarSubscriber:
    def __init__(self, session: zenoh.Session, key: str = "rslidar/points/segmented"):
        self._lock = threading.Lock()
        self._latest = None          # (stamp, points ndarray)
        self._frame_count = 0
        self._sub = session.declare_subscriber(key, self._callback)

    def _callback(self, sample):
        b = sample.payload.to_bytes()
        if len(b) < 16:
            return
        sec, nsec, width, step = struct.unpack_from("<iIII", b, 0)
        if step not in (16, 20) or len(b) - 16 < width * step:
            return
        pts = np.frombuffer(b, "<f4", count=width * step // 4, offset=16).reshape(width, step // 4)
        pts = pts[~np.isnan(pts[:, :3]).any(axis=1)]
        with self._lock:
            self._latest = (sec + nsec * 1e-9, pts)
            self._frame_count += 1

    def get_latest(self):
        with self._lock:
            return self._latest

    def close(self):
        self._sub.undeclare()


"""Zenoh costmap subscriber; path and waypoint inputs are not defined yet."""

class CostmapSubscriber:
    def __init__(self, session: zenoh.Session, key: str = "rslidar/costmap"):
        self._lock = threading.Lock()
        self._latest = None          # (stamp, info dict, costs ndarray[size_y, size_x])
        self._frame_count = 0
        self._sub = session.declare_subscriber(key, self._callback)

    def _callback(self, sample):
        b = sample.payload.to_bytes()
        if len(b) < 32:
            return
        sec, nsec, size_x, size_y, resolution, origin_x, origin_y, _ = struct.unpack_from("<iIIIfffI", b, 0)
        if size_x == 0 or size_y == 0 or len(b) - 32 < size_x * size_y:
            return
        costs = np.frombuffer(b, np.uint8, count=size_x * size_y, offset=32).reshape(size_y, size_x)
        info = {"resolution": resolution, "origin_x": origin_x, "origin_y": origin_y}
        with self._lock:
            self._latest = (sec + nsec * 1e-9, info, costs)
            self._frame_count += 1

    def get_latest(self):
        with self._lock:
            return self._latest

    def close(self):
        self._sub.undeclare()
