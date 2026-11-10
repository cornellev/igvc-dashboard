"""Mock ZED camera publisher over Zenoh; additional mock inputs are deferred.

Frames are CDR-serialized sensor_msgs/Image, the same bytes zenoh-bridge-ros2dds
forwards from the real ZED topics, so the backend's decode path is exercised.

The session listens on MOCK_ZENOH_LISTEN (default tcp/127.0.0.1:7448) and keeps
multicast scouting on. A backend with multicast disabled (zenoh-dev.json5)
reaches it by listing that endpoint under connect/endpoints.
"""

import os
import struct
import time

import numpy as np
import zenoh

LEFT_KEY = os.getenv("CAMERA_LEFT_ZENOH_KEY", "zed/left/image_raw")
RIGHT_KEY = os.getenv("CAMERA_RIGHT_ZENOH_KEY", "zed/right/image_raw")
LISTEN = os.getenv("MOCK_ZENOH_LISTEN", "tcp/127.0.0.1:7448")


def encode_image_cdr(height, width, encoding, data, stamp_ns=0, frame_id="", step=None):
    """sensor_msgs/Image as little-endian CDR; inverse of decode_image_cdr in perception.py."""
    step = width * (len(data) // (height * width)) if step is None else step
    out = bytearray(b"\x00\x01\x00\x00")

    def align4():
        out.extend(b"\0" * (-(len(out) - 4) % 4))

    def u32(value):
        align4()
        out.extend(struct.pack("<I", value))

    def string(text):
        raw = text.encode() + b"\0"
        u32(len(raw))
        out.extend(raw)

    align4()
    out.extend(struct.pack("<iI", stamp_ns // 1_000_000_000, stamp_ns % 1_000_000_000))
    string(frame_id)
    u32(height)
    u32(width)
    string(encoding)
    out.append(0)                    # is_bigendian
    u32(step)
    u32(len(data))
    out.extend(data)
    return bytes(out)


def main():
    config = zenoh.Config()
    config.insert_json5("listen/endpoints", f'["{LISTEN}"]')
    session = zenoh.open(config)
    pub_left = session.declare_publisher(LEFT_KEY)
    pub_right = session.declare_publisher(RIGHT_KEY)
    print(f"mock camera publishing {LEFT_KEY} and {RIGHT_KEY}, listening on {LISTEN}", flush=True)

    h, w = 720, 1280
    frame = 0
    try:
        while True:
            arr = np.zeros((h, w, 3), dtype=np.uint8)
            # scrolling bar of blue (bgr)
            x = (frame * 4) % w
            arr[:, x:x + 100] = [255, 0, 0]
            frame += 1

            payload = encode_image_cdr(h, w, "bgr8", arr.tobytes(), time.time_ns(), "zed_left_camera_frame")
            pub_left.put(payload)
            pub_right.put(payload)
            if frame % 30 == 0:
                print(f"published frame {frame}", flush=True)
            time.sleep(1 / 30)
    except KeyboardInterrupt:
        pass
    finally:
        pub_left.undeclare()
        pub_right.undeclare()
        session.close()

if __name__ == '__main__':
    main()
