"""Regression checks for the backend layout and retained ROS behavior.

State tests run with the standard library alone. Set DASHBOARD_TEST_ROS=1 in an
isolated ROS environment to also exercise the real subscribers and lifecycle.
"""

import asyncio
import importlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from state import DashboardState


class StateTests(unittest.TestCase):
    def test_streams_keep_independent_values_and_timestamps(self):
        state = DashboardState()
        self.assertEqual(state.get_latest("imu"), (None, None))
        state.update_latest("imu", {"x": 1}, 100)
        state.update_latest("gnss1", {"lat": 42}, 200)
        self.assertEqual(state.get_latest("imu"), ({"x": 1}, 100))
        self.assertEqual(state.get_latest("gnss1"), ({"lat": 42}, 200))

    def test_snapshot_dictionaries_do_not_expose_storage_containers(self):
        state = DashboardState()
        state.update_latest("imu", {"x": 1}, 100)
        values, timestamps = state.get_latest_all()
        values.clear()
        timestamps.clear()
        self.assertEqual(state.get_latest("imu"), ({"x": 1}, 100))

    def test_invalid_sample_keeps_existing_timestamp_behavior(self):
        state = DashboardState()
        state.update_latest("spi_data", {"speed": 1}, 100)
        state.invalidate_latest("spi_data")
        self.assertEqual(state.get_latest("spi_data"), (None, 100))

    def test_history_is_bounded_and_notifies_broadcaster(self):
        state = DashboardState(history_size=2)
        self.assertIsNone(state.get_latest_snapshot())
        for index in range(3):
            state.append_snapshot({"speed": index}, index)
        self.assertTrue(state.data_ready.is_set())
        self.assertEqual(state.get_history(), [({"speed": 1}, 1), ({"speed": 2}, 2)])
        self.assertEqual(state.get_latest_snapshot(), ({"speed": 2}, 2))
        history = state.get_history()
        history.clear()
        self.assertEqual(len(state.get_history()), 2)


RUN_ROS = os.environ.get("DASHBOARD_TEST_ROS") == "1"


@unittest.skipUnless(RUN_ROS, "set DASHBOARD_TEST_ROS=1 inside the ROS container")
class EntrypointTests(unittest.TestCase):
    def test_container_entrypoint_serves_relocated_mock_camera(self):
        from websockets.asyncio.client import connect

        async def read_camera():
            async with connect("ws://127.0.0.1:8000/ws/camera/left") as socket:
                return await asyncio.wait_for(socket.recv(), timeout=10)

        environment = {
            **os.environ,
            "RUN_MOCK_CAMERA": "true",
            "ROS_LOCALHOST_ONLY": "1",
            "ROS_DOMAIN_ID": "213",
        }
        with tempfile.TemporaryFile() as logs:
            process = subprocess.Popen(
                ["/app/entrypoint.sh"],
                env=environment,
                stdout=logs,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        with urlopen("http://127.0.0.1:8000/healthz", timeout=1) as response:
                            self.assertEqual(json.load(response)["local"], "ok")
                        break
                    except URLError:
                        time.sleep(0.1)
                else:
                    logs.seek(0)
                    self.fail(logs.read().decode(errors="replace"))

                jpeg = asyncio.run(read_camera())
                self.assertTrue(jpeg.startswith(b"\xff\xd8"))
                self.assertTrue(jpeg.endswith(b"\xff\xd9"))
            finally:
                # Stop both the Uvicorn process and its mock-publisher child.
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


@unittest.skipUnless(RUN_ROS, "set DASHBOARD_TEST_ROS=1 inside the ROS container")
class RosMappingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Tests must never connect to the vehicle's ROS domain or LAN.
        os.environ["ROS_LOCALHOST_ONLY"] = "1"
        os.environ["ROS_DOMAIN_ID"] = "213"
        self.main = importlib.import_module("main")
        self.lifespan = self.main.lifespan(self.main.app)
        await self.lifespan.__aenter__()

    async def asyncTearDown(self):
        await self.lifespan.__aexit__(None, None, None)
        self.assertFalse(importlib.import_module("rclpy").ok())

    async def test_telemetry_reaches_broadcaster_with_original_envelope(self):
        received = asyncio.Queue()

        class Socket:
            async def send_json(self, payload):
                received.put_nowait(payload)

        self.main.app.state.clients.add(Socket())
        node = self.main.app.state.client.telemetry
        node.handle_payload(json.dumps({"speed": 2.5, "missing": float("nan")}).encode())

        payload = await asyncio.wait_for(received.get(), timeout=3)
        self.assertEqual(set(payload), {"seq", "data", "stamp_ns"})
        self.assertEqual(payload["seq"], 0)
        self.assertEqual(payload["data"], {"speed": 2.5, "missing": None})
        self.assertGreater(payload["stamp_ns"], 0)

        node.handle_payload(b"invalid JSON")
        self.assertIsNone(node.get_latest()[0])

    async def test_camera_callbacks_and_binary_routes(self):
        from fastapi import WebSocketDisconnect
        from mock_vehicle import encode_image_cdr

        class Socket:
            accepted = False
            closed_code = None
            frame = None

            async def accept(self):
                self.accepted = True

            async def close(self, code):
                self.closed_code = code

            async def send_bytes(self, data):
                self.frame = data
                raise WebSocketDisconnect()

        message = encode_image_cdr(2, 2, "bgr8", bytes([0, 100, 200]) * 4)
        for side in ("left", "right"):
            node = getattr(self.main.app.state.client, f"camera_{side}")
            node.handle_payload(message)
            socket = Socket()
            await self.main.websocket_camera(socket, side)
            self.assertTrue(socket.accepted)
            self.assertTrue(socket.frame.startswith(b"\xff\xd8"))
            self.assertTrue(socket.frame.endswith(b"\xff\xd9"))

        socket = Socket()
        await self.main.websocket_camera(socket, "unknown")
        self.assertEqual(socket.closed_code, 1008)
        self.assertFalse(socket.accepted)

    async def test_control_routes_keep_existing_status_contract(self):
        self.assertEqual((await self.main.autonomy_start())["value"], 1)
        self.assertTrue((await self.main.autonomy_status())["running"])
        self.assertEqual((await self.main.bag_start())["value"], 1)
        self.assertTrue((await self.main.bag_status())["recording"])
        status = await self.main.control_status()
        self.assertEqual(status["autonomy"]["topic"], "dashboard_control/autonomy_run")
        self.assertEqual(status["bag"]["topic"], "dashboard_control/bag_recording")
        self.assertEqual((await self.main.autonomy_stop())["value"], 0)
        self.assertEqual((await self.main.bag_stop())["value"], 0)
        self.assertEqual((await self.main.healthz())["local"], "ok")
        self.assertNotIn("/replay/rosbag", self.main.app.openapi()["paths"])

    async def test_standalone_localization_still_groups_imu_and_gnss(self):
        from std_msgs.msg import String
        from subscribers.localization import MultiTopicSubscriber

        node = MultiTopicSubscriber()
        try:
            for topic in ("imu", "gnss1", "gnss2"):
                message = String()
                message.data = json.dumps({"source": topic})
                node.make_callback(topic)(message)
            values, timestamps = node.get_latest_all()
            self.assertEqual(set(values), {"imu", "gnss1", "gnss2"})
            self.assertTrue(all(stamp > 0 for stamp in timestamps.values()))
            # The prototype is not silently activated in the application.
            self.assertNotIn("imu", self.main.app.state.dashboard.get_latest_all()[0])
        finally:
            node.destroy_node()


@unittest.skipUnless(RUN_ROS, "set DASHBOARD_TEST_ROS=1 inside the ROS container")
class LifecycleTests(unittest.TestCase):
    def test_partial_startup_releases_already_created_ros_resources(self):
        os.environ["ROS_LOCALHOST_ONLY"] = "1"
        os.environ["ROS_DOMAIN_ID"] = "213"
        import rclpy
        from zenoh_client import LegacyRosClient

        client = LegacyRosClient(DashboardState())
        with patch("zenoh_client.CameraSubscriber", side_effect=RuntimeError("camera failed")):
            with self.assertRaisesRegex(RuntimeError, "camera failed"):
                client.start()
        self.assertFalse(rclpy.ok())
        self.assertEqual(client._nodes, [])
        client.stop()  # Shutdown is also safe after failed startup.


if __name__ == "__main__":
    unittest.main()
