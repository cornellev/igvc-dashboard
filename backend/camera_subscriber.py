import threading
import numpy as np
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

    def get_latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def destroy_node(self):
        super().destroy_node()
