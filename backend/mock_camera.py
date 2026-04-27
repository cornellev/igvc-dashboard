import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
import numpy as np

class MockCamera(Node):
    def __init__(self):
        super().__init__('mock_camera')
        
        self.pub_left = self.create_publisher(Image, 'zed/left/image_raw', 10)
        self.pub_right = self.create_publisher(Image, 'zed/right/image_raw', 10)
        
        self.create_timer(1 / 30, self.publish)
        
        self.frame = 0

    def publish(self):
        h, w = 720, 1280
        arr = np.zeros((h, w, 3), dtype=np.uint8)
        # scrolling bar of blue (bgr)
        x = (self.frame * 4) % w
        arr[:, x:x + 100] = [255, 0, 0]
        self.frame += 1

        msg = Image()
        msg.height, msg.width = h, w
        msg.encoding = 'bgr8'
        msg.step = w * 3
        msg.data = arr.tobytes()
        msg.header.stamp = self.get_clock().now().to_msg()

        self.pub_left.publish(msg)
        self.pub_right.publish(msg)
        self.get_logger().info(f'published frame {self.frame}', throttle_duration_sec=1.0)

def main():
    rclpy.init()
    rclpy.spin(MockCamera())
    rclpy.shutdown()

if __name__ == '__main__':
    main()
