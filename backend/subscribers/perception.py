"""ROS camera subscriber and Zenoh lidar point-cloud subscriber."""

import threading, struct
import numpy as np
import zenoh
import cv2
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile
from sensor_msgs.msg import Image

class CameraSubscriber(Node):
    def __init__(self, topic: str, node_name: str):
        super().__init__(node_name)
        self.get_logger().info(f'subscribing to camera topic: {topic}')

        self._latest_jpeg: bytes | None = None
        self._lock = threading.Lock()
        self._frame_count = 0

        qos = QoSProfile(depth=1)
        self.subscription = self.create_subscription(Image, topic, self._callback, qos)

    def _callback(self, msg: Image):
        try:
            arr = np.frombuffer(msg.data, dtype=np.uint8).reshape(msg.height, msg.width, 3)
            # zed publishes as bgr8, turn it into a jpg directly
            ok, buf = cv2.imencode('.jpg', arr, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok:
                return
            jpeg = buf.tobytes()
        except Exception as e:
            self.get_logger().error(f'camera encode error: {e}')
            return

        with self._lock:
            self._latest_jpeg = jpeg
            self._frame_count += 1

        if self._frame_count == 1:
            self.get_logger().info(
                f'received first camera frame: {msg.width}x{msg.height}, encoding={msg.encoding}, bytes={len(msg.data)}'
            )
        elif self._frame_count % 60 == 0:
            self.get_logger().info(
                f'received {self._frame_count} camera frames'
            )

    def get_latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def destroy_node(self):
        super().destroy_node()


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

