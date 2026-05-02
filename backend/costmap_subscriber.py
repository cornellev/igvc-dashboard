import threading

from map_msgs.msg import OccupancyGridUpdate
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
)


class CostmapSubscriber(Node):
    def __init__(self):
        super().__init__("costmap_subscriber")
        self.get_logger().info("subscribing to costmap topics: /costmap, /costmap_updates")

        self._lock = threading.Lock()
        self._grid: dict | None = None
        self._data: list[int] = []
        self._latest_stamp_ns: int | None = None
        self._update_count = 0

        qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )

        self.costmap_subscription = self.create_subscription(
            OccupancyGrid,
            "/costmap",
            self._costmap_callback,
            qos,
        )
        self.update_subscription = self.create_subscription(
            OccupancyGridUpdate,
            "/costmap_updates",
            self._update_callback,
            qos,
        )

    def _stamp_to_ns(self, msg) -> int:
        header = getattr(msg, "header", None)
        stamp = getattr(header, "stamp", None)
        if stamp is None or (stamp.sec == 0 and stamp.nanosec == 0):
            return self.get_clock().now().nanoseconds
        return int(stamp.sec) * 1_000_000_000 + int(stamp.nanosec)

    def _costmap_callback(self, msg: OccupancyGrid):
        width = int(msg.info.width)
        height = int(msg.info.height)
        expected_len = width * height
        data = list(msg.data[:expected_len])

        if len(data) < expected_len:
            data.extend([-1] * (expected_len - len(data)))

        with self._lock:
            self._data = data
            self._grid = {
                "width": width,
                "height": height,
                "resolution": float(msg.info.resolution),
                "origin": {
                    "x": float(msg.info.origin.position.x),
                    "y": float(msg.info.origin.position.y),
                    "z": float(msg.info.origin.position.z),
                },
                "frame_id": msg.header.frame_id,
                "data": self._data.copy(),
                "update_count": self._update_count,
            }
            self._latest_stamp_ns = self._stamp_to_ns(msg)

        self.get_logger().info(f"received full costmap: {width}x{height}")

    def _update_callback(self, msg: OccupancyGridUpdate):
        with self._lock:
            if self._grid is None:
                self.get_logger().warning("received costmap update before full /costmap; ignoring")
                return

            map_width = int(self._grid["width"])
            map_height = int(self._grid["height"])
            update_width = int(msg.width)
            update_height = int(msg.height)
            start_x = int(msg.x)
            start_y = int(msg.y)
            update_data = msg.data

            for row in range(update_height):
                target_y = start_y + row
                if target_y < 0 or target_y >= map_height:
                    continue

                for col in range(update_width):
                    target_x = start_x + col
                    if target_x < 0 or target_x >= map_width:
                        continue

                    source_index = row * update_width + col
                    if source_index >= len(update_data):
                        continue

                    self._data[target_y * map_width + target_x] = int(update_data[source_index])

            self._update_count += 1
            self._grid["data"] = self._data.copy()
            self._grid["update_count"] = self._update_count
            self._latest_stamp_ns = self._stamp_to_ns(msg)

    def get_latest(self):
        with self._lock:
            if self._grid is None or self._latest_stamp_ns is None:
                return None, None

            return dict(self._grid), self._latest_stamp_ns

    def destroy_node(self):
        super().destroy_node()
