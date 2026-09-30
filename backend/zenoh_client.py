"""Shared Zenoh client, plus the ROS filler that still runs alongside it.

ZenohClient owns the one Zenoh session and the subscribers declared on it
(currently just the lidar point cloud). LegacyRosClient is the lifecycle code
extracted from main.py. It deliberately uses the existing ROS subscribers,
executors, topics, and control publisher, and starts/stops a ZenohClient too.
"""

import os
import threading
import time

import rclpy
import zenoh
from rclpy.executors import SingleThreadedExecutor

from controls import DashboardControlPublisher
from state import DashboardState
from subscribers.perception import CameraSubscriber, LidarSubscriber
from subscribers.status import DataSubscriber

SAMPLE_RATE_HZ = 40
LIDAR_KEY = os.getenv("LIDAR_ZENOH_KEY", "rslidar/points/segmented")

class ZenohClient:
    """Own the shared Zenoh session and the subscribers declared on it."""

    def __init__(self, config: zenoh.Config | None = None):
        self._config = config
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
            self.lidar = LidarSubscriber(self.session, LIDAR_KEY)
            self._subscribers.append(self.lidar)
            print(f"[ZENOH] subscribed to {LIDAR_KEY}", flush=True)
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


def ros_spin_loop(node: DataSubscriber, stop_evt: threading.Event, state: DashboardState):
    ex = SingleThreadedExecutor()
    ex.add_node(node)
    last_stamp = None
    last_data_time = time.monotonic()
    last_append_time = 0.0
    sample_interval = 1.0 / SAMPLE_RATE_HZ
    DATA_TIMEOUT_SEC = 5.0
    warned = False
    try:
        i = 0
        while rclpy.ok() and not stop_evt.is_set():
            try:
                ex.spin_once(timeout_sec=0.1)
            except Exception as e:
                print(f"[ROS] ERROR: exception during spin: {e}", flush=True)
            i += 1
            if i % 50 == 0:
                print("[ROS] spinning...")

            data, stamp = node.get_latest()
            if data is None or stamp is None:
                if not warned and time.monotonic() - last_data_time > DATA_TIMEOUT_SEC:
                    print(f"[ROS] WARN: no data received for >{DATA_TIMEOUT_SEC}s", flush=True)
                    warned = True
                continue

            last_data_time = time.monotonic()
            warned = False

            if last_stamp is not None and stamp <= last_stamp:
                continue
            last_stamp = stamp

            # Preserve the existing sampling behavior during the layout change.
            now = time.monotonic()
            if now - last_append_time < sample_interval:
                continue
            last_append_time = now

            state.append_snapshot(data, stamp)
    except Exception as e:
        print(f"[ROS] ERROR: exception in spin loop: {e}", flush=True)
    finally:
        ex.remove_node(node)
        print("[ROS] spin loop exited", flush=True)


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


class LegacyRosClient:
    """Own the existing ROS resources while their future module takes shape."""

    def __init__(self, state: DashboardState):
        self.state = state
        self.stop_evt = threading.Event()
        self._initialized = False
        self._nodes = []
        self._threads = []
        self.zenoh = ZenohClient()

    def start(self):
        try:
            self.zenoh.start()
            self.lidar = self.zenoh.lidar

            rclpy.init()
            self._initialized = True
            print("[ROS] rclpy initialized", flush=True)

            self.node = DataSubscriber("spi_data", self.state)
            self._nodes.append(self.node)

            self.camera_left = CameraSubscriber("zed/left/image_raw", "camera_left")
            self._nodes.append(self.camera_left)
            self.camera_right = CameraSubscriber("zed/right/image_raw", "camera_right")
            self._nodes.append(self.camera_right)

            self.controls = DashboardControlPublisher(
                os.getenv("DASHBOARD_CONTROL_TOPIC", "dashboard_control"),
                float(os.getenv("DASHBOARD_CONTROL_PUBLISH_HZ", "10")),
            )
            self._nodes.append(self.controls)

            # Localization remains a standalone prototype, as in the old app.
            ros_thread = threading.Thread(
                target=ros_spin_loop,
                args=(self.node, self.stop_evt, self.state),
                daemon=True,
            )
            ros_thread.start()
            self._threads.append(ros_thread)

            camera_thread = threading.Thread(
                target=auxiliary_spin_loop,
                args=([self.camera_left, self.camera_right, self.controls], self.stop_evt),
                daemon=True,
            )
            camera_thread.start()
            self._threads.append(camera_thread)
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
