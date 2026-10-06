"""Checks for the Zenoh camera path: ZenohClient -> CameraSubscriber -> JPEG.

Frames are encoded like tools/mock_vehicle.py (CDR sensor_msgs/Image, as
zenoh-bridge-ros2dds forwards the ZED topics) and published on an isolated
session, so the tests never touch the LAN and need no camera:

    python tests/test_camera_zenoh.py

Needs opencv-python-headless (backend/requirements.txt) for real JPEG output.
"""

from pathlib import Path
import struct
import sys
import time
import unittest

import numpy as np

from test_lidar_zenoh import ZenohSubscriberTestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from mock_vehicle import encode_image_cdr  # noqa: E402


def decode_jpeg(jpeg):
    import cv2
    return cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_UNCHANGED)


class CameraSubscriberTests(ZenohSubscriberTestCase):
    def setUp(self):
        super().setUp()
        import zenoh_client
        self.left_key = zenoh_client.CAMERA_LEFT_KEY
        self.right_key = zenoh_client.CAMERA_RIGHT_KEY

    def publish_and_wait(self, payload, key=None, camera=None):
        camera = camera or self.client.camera_left
        before = camera.get_latest_jpeg()
        self.client.session.put(key or self.left_key, payload)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            latest = camera.get_latest_jpeg()
            if latest is not before:
                return latest
            time.sleep(0.01)
        return camera.get_latest_jpeg()

    def assert_solid_bgr(self, jpeg, bgr, shape):
        self.assertTrue(jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9"))
        image = decode_jpeg(jpeg)
        self.assertEqual(image.shape, shape)
        np.testing.assert_allclose(image.reshape(-1, 3).mean(axis=0), bgr, atol=3)

    def test_bgr8_frame_becomes_jpeg(self):
        frame = np.full((4, 6, 3), (200, 50, 10), np.uint8)
        jpeg = self.publish_and_wait(encode_image_cdr(4, 6, "bgr8", frame.tobytes()))
        self.assert_solid_bgr(jpeg, (200, 50, 10), (4, 6, 3))

    def test_other_encodings_are_converted_to_bgr(self):
        rgb = np.full((4, 4, 3), (10, 50, 200), np.uint8)              # same color as BGR (200, 50, 10)
        bgra = np.full((4, 4, 4), (200, 50, 10, 255), np.uint8)
        rgba = np.full((4, 4, 4), (10, 50, 200, 255), np.uint8)
        for encoding, frame in (("rgb8", rgb), ("bgra8", bgra), ("rgba8", rgba)):
            with self.subTest(encoding=encoding):
                jpeg = self.publish_and_wait(encode_image_cdr(4, 4, encoding, frame.tobytes()))
                self.assert_solid_bgr(jpeg, (200, 50, 10), (4, 4, 3))

        mono = self.publish_and_wait(encode_image_cdr(4, 4, "mono8", bytes([128]) * 16))
        image = decode_jpeg(mono)
        self.assertEqual(image.shape, (4, 4))
        self.assertAlmostEqual(float(image.mean()), 128, delta=3)

    def test_padded_rows_are_cropped_by_step(self):
        # 3 px wide bgr8 = 9 bytes per row, padded to step 12 with junk.
        row = bytes((200, 50, 10) * 3) + b"\xff\xff\xff"
        jpeg = self.publish_and_wait(encode_image_cdr(2, 3, "bgr8", row * 2, step=12))
        self.assert_solid_bgr(jpeg, (200, 50, 10), (2, 3, 3))

    def test_jpeg_payload_is_passed_through(self):
        import cv2
        ok, buf = cv2.imencode(".jpg", np.zeros((2, 2, 3), np.uint8))
        self.assertTrue(ok)
        self.assertEqual(self.publish_and_wait(buf.tobytes()), buf.tobytes())

    def test_left_and_right_are_independent(self):
        frame = np.zeros((2, 2, 3), np.uint8).tobytes()
        self.publish_and_wait(encode_image_cdr(2, 2, "bgr8", frame),
                              key=self.right_key, camera=self.client.camera_right)
        self.assertIsNotNone(self.client.camera_right.get_latest_jpeg())
        self.assertIsNone(self.client.camera_left.get_latest_jpeg())

    def test_bad_frames_keep_previous_jpeg(self):
        good = self.publish_and_wait(encode_image_cdr(2, 2, "bgr8", bytes(12)))
        self.assertIsNotNone(good)

        truncated = encode_image_cdr(2, 2, "bgr8", bytes(12))[:-1]
        short_data = encode_image_cdr(2, 2, "bgr8", bytes(12), step=12)    # claims 24 bytes
        unsupported = encode_image_cdr(2, 2, "16UC1", bytes(8))
        for payload in (b"", b"junk", struct.pack("<I", 1), truncated, short_data, unsupported):
            with self.subTest(payload=payload[:12]):
                self.assertIs(self.publish_and_wait(payload), good)


if __name__ == "__main__":
    unittest.main()
