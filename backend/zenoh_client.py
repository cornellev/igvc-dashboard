"""Shared Zenoh client.

ZenohClient owns the one Zenoh session and everything declared on it: the
subscribers (spi_data telemetry, ZED cameras, lidar point cloud, costmap) and
the dashboard control publisher.
"""

import os

import zenoh

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
CONTROL_NAMESPACE = os.getenv("DASHBOARD_CONTROL_TOPIC", "dashboard_control")
CONTROL_PUBLISH_HZ = float(os.getenv("DASHBOARD_CONTROL_PUBLISH_HZ", "10"))

class ZenohClient:
    """Own the shared Zenoh session and the subscribers declared on it."""

    def __init__(self, config: zenoh.Config | None = None, state: DashboardState | None = None):
        self._config = config
        self.state = state if state is not None else DashboardState()
        self.session = None
        self.controls = None
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

            self.controls = DashboardControlPublisher(self.session, CONTROL_NAMESPACE, CONTROL_PUBLISH_HZ)

        except Exception:
            self.stop()
            raise

    def stop(self):
        if self.controls is not None:
            self.controls.close()
            self.controls = None

        for subscriber in self._subscribers:
            subscriber.close()
        self._subscribers.clear()

        if self.session is not None:
            self.session.close()
            self.session = None

