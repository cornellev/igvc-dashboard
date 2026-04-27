import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from rclpy.qos import QoSProfile
import json
import threading


class MultiTopicSubscriber(Node):
    def __init__(self):
        super().__init__("multi_topic_subscriber")

        self.get_logger().info("Starting multi-topic subscriber")

        # Thread-safe storage for all topics
        self._lock = threading.Lock()
        self.latest = {}  # {topic_name: data}
        self.timestamps = {}  # {topic_name: nanoseconds}

        qos = QoSProfile(depth=1)

       #IMU
        self.create_subscription(
            String,
            "/fixposition/fpa/rawimu",
            self.make_callback("imu"),
            qos
        )

     #GPS 1
        self.create_subscription(
            String,
            "/fixposition/gnss1",
            self.make_callback("gnss1"),
            qos
        )
     #GPS2
        self.create_subscription(
            String,
            "/fixposition/gnss2",
            self.make_callback("gnss2"),
            qos 
        )


    def make_callback(self, topic_name):
        def callback(msg: String):
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError as e:
                self.get_logger().error(
                    f"[{topic_name}] JSON decode error: {msg.data} | {e}"
                )
                return
            except Exception as e:
                self.get_logger().error(f"[{topic_name}] Unexpected error: {e}")
                return

            with self._lock:
                self.latest[topic_name] = data
                self.timestamps[topic_name] = self.get_clock().now().nanoseconds

            self.get_logger().info(f"[{topic_name}] received: {data}")

        return callback

    def get_latest_all(self):
        with self._lock:
            return dict(self.latest), dict(self.timestamps)


def main(args=None):

    rclpy.init(args=args)
    node = MultiTopicSubscriber()

    try:
        while rclpy.ok():
            rclpy.spin_once(node, timeout_sec=0.1)

            latest, stamps = node.get_latest_all()
            # Example debug print
            # print(latest)

    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
