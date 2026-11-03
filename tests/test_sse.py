"""Checks for the Server-Sent Events routes that replace the WebSocket ones.

The broadcaster runs against a bare DashboardState, so no ROS or Zenoh traffic
is needed; ROS is stubbed out when it isn't installed:

    python tests/test_sse.py
"""

import asyncio
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_lidar_zenoh import stub_missing_ros_modules


class TelemetryStreamTests(unittest.IsolatedAsyncioTestCase):
    """/stream yields the same envelope the broadcaster sends to /ws/stream."""

    async def asyncSetUp(self):
        stub_missing_ros_modules()
        import main
        from state import DashboardState

        self.main = main
        self.state = DashboardState()
        main.app.state.dashboard = self.state
        main.app.state.clients = set()
        main.app.state.sse_clients = set()
        self.broadcaster = asyncio.create_task(main.broadcaster(main.app))

    async def asyncTearDown(self):
        self.broadcaster.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.broadcaster

    async def test_payload_reaches_sse_client_with_original_envelope(self):
        stream = self.main.sse_stream()
        first = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)   # let the route register its queue
        self.assertEqual(len(self.main.app.state.sse_clients), 1)

        self.state.append_snapshot({"speed": 2.5, "missing": float("nan")}, 100)
        payload = await asyncio.wait_for(first, timeout=3)
        self.assertEqual(payload, {"seq": 0, "data": {"speed": 2.5, "missing": None}, "stamp_ns": 100})

        self.state.append_snapshot({"speed": 3.0}, 200)
        payload = await asyncio.wait_for(anext(stream), timeout=3)
        self.assertEqual(payload["seq"], 1)

        await stream.aclose()
        self.assertEqual(self.main.app.state.sse_clients, set())

    async def test_slow_client_keeps_only_newest_payloads(self):
        queue = asyncio.Queue(maxsize=self.main.SSE_QUEUE_SIZE)
        self.main.app.state.sse_clients.add(queue)
        for stamp in range(1, self.main.SSE_QUEUE_SIZE + 4):
            self.state.append_snapshot({"speed": stamp}, stamp)
            await asyncio.sleep(0.05)   # one broadcaster pass per snapshot

        stamps = [queue.get_nowait()["stamp_ns"] for _ in range(queue.qsize())]
        self.assertEqual(stamps, list(range(4, self.main.SSE_QUEUE_SIZE + 4)))


class CameraStreamTests(unittest.IsolatedAsyncioTestCase):
    """/camera/{side} sends each new JPEG once as an MJPEG part."""

    async def asyncSetUp(self):
        stub_missing_ros_modules()
        import main

        self.main = main

        class Camera:
            jpeg = None

            def get_latest_jpeg(self):
                return self.jpeg

        class Client:
            camera_left = Camera()
            camera_right = Camera()

        main.app.state.client = Client()
        self.camera = Client.camera_left

    async def test_new_frames_are_sent_once_as_multipart_parts(self):
        response = await self.main.camera_stream("left")
        self.assertEqual(response.media_type, "multipart/x-mixed-replace; boundary=frame")
        body = response.body_iterator

        self.camera.jpeg = b"\xff\xd8first\xff\xd9"
        part = await asyncio.wait_for(anext(body), timeout=3)
        self.assertEqual(
            part,
            b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(self.camera.jpeg)
            + self.camera.jpeg + b"\r\n",
        )

        # The same frame object is not resent; the next part is the next frame.
        next_part = asyncio.create_task(anext(body))
        await asyncio.sleep(0.15)
        self.assertFalse(next_part.done())
        self.camera.jpeg = b"\xff\xd8second\xff\xd9"
        self.assertIn(b"second", await asyncio.wait_for(next_part, timeout=3))
        await body.aclose()

    async def test_unknown_side_is_404(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as caught:
            await self.main.camera_stream("bogus")
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
