import threading

from rclpy.node import Node
from std_msgs.msg import Int32


class DashboardControlPublisher(Node):
    def __init__(self, topic_namespace: str, publish_hz: float):
        super().__init__("dashboard_control_publisher")

        self._topic_namespace = topic_namespace.strip("/") or "dashboard_control"
        self._states = {
            "autonomy_run": False,
            "bag_recording": False,
        }
        self._lock = threading.Lock()
        self._topics = {
            key: f"{self._topic_namespace}/{key}" for key in self._states
        }
        self._publishers = {
            key: self.create_publisher(Int32, topic, 10)
            for key, topic in self._topics.items()
        }
        self._timer = self.create_timer(
            1.0 / max(publish_hz, 0.1),
            self._publish_current_states,
        )

        self.get_logger().info(
            f"Publishing dashboard control states under ROS topic namespace: {self._topic_namespace}"
        )

    def start_autonomy_run(self):
        self._set_state("autonomy_run", True)

    def stop_autonomy_run(self):
        self._set_state("autonomy_run", False)

    def start_bag_recording(self):
        self._set_state("bag_recording", True)

    def stop_bag_recording(self):
        self._set_state("bag_recording", False)

    def get_autonomy_status(self):
        return self._get_control_status("autonomy_run", "running")

    def get_bag_status(self):
        return self._get_control_status("bag_recording", "recording")

    def get_status(self):
        return {
            "autonomy": self.get_autonomy_status(),
            "bag": self.get_bag_status(),
        }

    def _get_control_status(self, key: str, status_name: str):
        with self._lock:
            enabled = self._states[key]

        return {
            status_name: enabled,
            "topic": self._topics[key],
            "value": 1 if enabled else 0,
        }

    def _set_state(self, key: str, enabled: bool):
        with self._lock:
            self._states[key] = enabled
            value = 1 if enabled else 0

        self._publish_value(key, value)

    def _publish_current_states(self):
        with self._lock:
            states = self._states.copy()

        for key, enabled in states.items():
            self._publish_value(key, 1 if enabled else 0)

    def _publish_value(self, key: str, value: int):
        message = Int32()
        message.data = value
        self._publishers[key].publish(message)
