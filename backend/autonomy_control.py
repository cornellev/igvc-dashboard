import threading

from rclpy.node import Node
from std_msgs.msg import Int32


class AutonomyControlPublisher(Node):
    def __init__(self, topic: str, publish_hz: float):
        super().__init__("autonomy_control_publisher")

        self._topic = topic
        self._enabled = False
        self._lock = threading.Lock()
        self._publisher = self.create_publisher(Int32, topic, 10)
        self._timer = self.create_timer(
            1.0 / max(publish_hz, 0.1),
            self._publish_current_state,
        )

        self.get_logger().info(
            f"Publishing autonomy run state to ROS topic: {topic}"
        )

    def start_run(self):
        self._set_enabled(True)

    def stop_run(self):
        self._set_enabled(False)

    def get_status(self):
        with self._lock:
            enabled = self._enabled

        return {
            "running": enabled,
            "topic": self._topic,
            "value": 1 if enabled else 0,
        }

    def _set_enabled(self, enabled: bool):
        with self._lock:
            self._enabled = enabled
            value = 1 if enabled else 0

        self._publish_value(value)

    def _publish_current_state(self):
        with self._lock:
            value = 1 if self._enabled else 0

        self._publish_value(value)

    def _publish_value(self, value: int):
        message = Int32()
        message.data = value
        self._publisher.publish(message)
