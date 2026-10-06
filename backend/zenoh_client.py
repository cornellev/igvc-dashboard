"""Shared Zenoh client, plus the ROS filler that still runs alongside it.

ZenohClient owns the one Zenoh session and the subscribers declared on it
(spi_data telemetry, ZED cameras, lidar point cloud, costmap). LegacyRosClient
is the lifecycle code extracted from main.py. It still owns the ROS control
publisher, and starts/stops a ZenohClient too.
"""

import os
import threading

import rclpy
import zenoh
from rclpy.executors import SingleThreadedExecutor

from controls import DashboardControlPublisher
from state import DashboardState
from subscribers.perception import CameraSubscriber, LidarSubscriber, CostmapSubscriber
from subscribers.status import DataSubscriber

SAMPLE_RATE_HZ = 40
TELEMETRY_KEY = os.getenv("TELEMETRY_ZENOH_KEY", "spi_data")
LIDAR_KEY = os.getenv("LIDAR_ZENOH_KEY", "rslidar/points/segmented")
COSTMAP_KEY = os.getenv("COSTMAP_ZENOH_KEY", "rslidar/costmap")
CAMERA_LEFT_KEY = os.getenv("CAMERA_LEFT_ZENOH_KEY", "zed/left/image_raw")
CAMERA_RIGHT_KEY = os.getenv("CAMERA_RIGHT_ZENOH_KEY", "zed/right/image_raw")

class ZenohClient:
    """Own the shared Zenoh session and the subscribers declared on it."""

    def __init__(self, config: zenoh.Config | None = None, state: DashboardState | None = None):
        self._config = config
        self.state = state if state is not None else DashboardState()
        self.session = None
        self._subscribers = []

    def start(self):
        try:
            # ZENOH_CONFIG may point at a json5 file, e.g. to connect to a
            # router when multicast discovery can't reach the publisher.
            config = self._config
            if config is None:
                config = zenoh.Config.from_env() if os.getenv("ZENOH_CONFIG") else zenoh.Config()
            self.session = zenoh.open(config)
            
            print("[ZENOH] session opened", flush=True)

            # All subscribers go here
            self.telemetry = DataSubscriber(self.session, TELEMETRY_KEY, self.state, SAMPLE_RATE_HZ)
            self._subscribers.append(self.telemetry)
            self.camera_left = CameraSubscriber(self.session, CAMERA_LEFT_KEY, "camera_left")
            self._subscribers.append(self.camera_left)
            self.camera_right = CameraSubscriber(self.session, CAMERA_RIGHT_KEY, "camera_right")
            self._subscribers.append(self.camera_right)
            self.lidar = LidarSubscriber(self.session, LIDAR_KEY)
            self._subscribers.append(self.lidar)
            self.costmap = CostmapSubscriber(self.session, COSTMAP_KEY)
            self._subscribers.append(self.costmap)

            print(f"[ZENOH] subscribed to {TELEMETRY_KEY}, {LIDAR_KEY}, {COSTMAP_KEY}", flush=True)

        except Exception:
            self.stop()
            raise

    def stop(self):
        for subscriber in self._subscribers:
            subscriber.close()
        self._subscribers.clear()

        if self.session is not None:
            self.session.close()
            self.session = None


def auxiliary_spin_loop(nodes: list, stop_evt: threading.Event):
    ex = SingleThreadedExecutor()
    for node in nodes:
        ex.add_node(node)
    try:
        while rclpy.ok() and not stop_evt.is_set():
            try:
                ex.spin_once(timeout_sec=0.05)
            except Exception as e:
                print(f"[ROS] ERROR: exception during auxiliary spin: {e}", flush=True)
    finally:
        for node in nodes:
            ex.remove_node(node)
        print("[ROS] auxiliary spin loop exited", flush=True)


""" Previous ROS Client (was slightly adjusted for Zenoh migration during refactoring)"""

class LegacyRosClient:
    """Own the existing ROS resources while their future module takes shape."""

    def __init__(self, state: DashboardState):
        self.state = state
        self.stop_evt = threading.Event()
        self._initialized = False
        self._nodes = []
        self._threads = []
        self.zenoh = ZenohClient(state=state)

    def start(self):
        try:
            self.zenoh.start()
            self.telemetry = self.zenoh.telemetry
            self.camera_left = self.zenoh.camera_left
            self.camera_right = self.zenoh.camera_right
            self.lidar = self.zenoh.lidar
            self.costmap = self.zenoh.costmap

            rclpy.init()
            self._initialized = True
            print("[ROS] rclpy initialized", flush=True)

            self.controls = DashboardControlPublisher(
                os.getenv("DASHBOARD_CONTROL_TOPIC", "dashboard_control"),
                float(os.getenv("DASHBOARD_CONTROL_PUBLISH_HZ", "10")),
            )
            self._nodes.append(self.controls)

            # Localization remains a standalone prototype, as in the old app.
            controls_thread = threading.Thread(
                target=auxiliary_spin_loop,
                args=([self.controls], self.stop_evt),
                daemon=True,
            )
            controls_thread.start()
            self._threads.append(controls_thread)
        except Exception:
            self.stop()
            raise

    def stop(self):
        self.stop_evt.set()
        for thread in self._threads:
            thread.join(timeout=5.0)
        self._threads.clear()

        for node in self._nodes:
            node.destroy_node()
        self._nodes.clear()

        if self._initialized:
            rclpy.shutdown()
            self._initialized = False

        self.zenoh.stop()
