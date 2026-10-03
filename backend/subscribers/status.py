"""Existing spi_data ROS subscriber; FSM and health inputs are not defined yet.
Contains all the Telemetry Data from sensors (previously old subscriber from old RED)"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import json
from rclpy.qos import QoSProfile
from state import DashboardState

class DataSubscriber(Node):
    def __init__(self, topic, state: DashboardState | None = None):
        super().__init__('data_subscriber')
        
        self.get_logger().info(f'Subscribing to ROS topic: {topic}')

        self._topic = topic
        self._state = state if state is not None else DashboardState()
        self._latest_raw = None          # latest raw JSON string
        self.running = True

        qos = QoSProfile(depth=1)  # keep only the newest message
        
        self.subscription = self.create_subscription(
            String,
            topic,
            self.listener_callback,
            qos
        )
        self.subscription  # prevent unused variable warning

    def listener_callback(self, msg: String):
        
        try:
            print(msg)
            data = json.loads(msg.data)
        except json.JSONDecodeError as e:
            self._state.invalidate_latest(self._topic)
            self.get_logger().error(f"Failed to decode message: {msg.data}, error: {e}")
            return
        except Exception as e:
            self._state.invalidate_latest(self._topic)
            self.get_logger().error(f"Unexpected error in callback: {e}")
            return

        self._latest_raw = msg.data
        self._state.update_latest(self._topic, data, self.get_clock().now().nanoseconds)

        self.get_logger().info(f"Received data: {data}")

    # Returns (data_dict_or_None, recv_time_ns_or_None)
    def get_latest(self):
        return self._state.get_latest(self._topic)
    
    def destroy_node(self):
        super().destroy_node()

# use to test
def main(args=None):
    rclpy.init(args=args)
    node = DataSubscriber("spi_data")
    try:
        while rclpy.ok(): 
            rclpy.spin_once(node, timeout_sec=0.075) #time between ros2 spin calls; adjust
            data, stamp = node.get_latest()
            # if data is not None:
            #     print("Latest:", data, "stamp_ns:", stamp)
            #     break
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
