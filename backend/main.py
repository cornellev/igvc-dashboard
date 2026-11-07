"""Existing browser API, reorganized around extracted state and ROS filler."""

import asyncio
import base64
import contextlib
from contextlib import asynccontextmanager
import math

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.middleware.cors import CORSMiddleware

from state import DashboardState
from zenoh_client import ZenohClient

# Lidar/costmap frames arrive at ~10 Hz; poll faster so a new frame goes out promptly.
LIDAR_POLL_HZ = 20

# Cameras publish at up to ~30 fps; check for a new frame at that rate.
CAMERA_POLL_HZ = 30
MJPEG_BOUNDARY = "frame"

# Payloads buffered per SSE client; a client that falls behind loses its oldest ones.
SSE_QUEUE_SIZE = 10

def sanitize_json(x):
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    if isinstance(x, dict):
        return {k: sanitize_json(v) for k, v in x.items()}
    if isinstance(x, list):
        return [sanitize_json(v) for v in x]
    if isinstance(x, tuple):
        return [sanitize_json(v) for v in x]
    return x

"""
Broadcasts new messages to all clients without re-collecting ROS message per client.
Uses a single producer to wait for next snapshot and then put it on every SSE client queue
"""
async def broadcaster(app: FastAPI):
    seq = 0
    last_stamp = None
    state = app.state.dashboard

    while True:
        await asyncio.to_thread(state.data_ready.wait, 1.0)
        state.data_ready.clear()
        # TODO: only the newest snapshot is sent per wake-up; snapshots arriving between
        # wake-ups are skipped. Fine at 40 Hz, recheck for faster series (e.g. IMU).
        snapshot = state.get_latest_snapshot()
        if snapshot is None:
            continue
        data, stamp = snapshot

        # only send new data
        if last_stamp is not None and stamp <= last_stamp:
            continue
        last_stamp = stamp
        
        # also send ROS timestamp for debugging purposes
        payload = {"seq": seq, "data": data, "stamp_ns": stamp}
        payload = sanitize_json(payload)
        seq += 1

        for queue in list(app.state.sse_clients):
            if queue.full():
                queue.get_nowait()   # slow client: drop its oldest payload
            queue.put_nowait(payload)

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.dashboard = DashboardState()
    app.state.client = ZenohClient(state=app.state.dashboard)
    app.state.sse_clients = set()
    app.state.client.start()
    broadcaster_task = asyncio.create_task(broadcaster(app)) # This sends all data out to all clients
    try:
        yield
    finally:
        broadcaster_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await broadcaster_task
        app.state.client.stop()

app = FastAPI(lifespan=lifespan)

# Add CORS middleware to allow frontend connections
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    """Health check endpoint."""
    return {"message": "Race Telemetry API", "status": "running"}

@app.post("/bag/start")
async def bag_start():
    app.state.client.controls.start_bag_recording()
    return app.state.client.controls.get_bag_status()

@app.post("/bag/stop")
async def bag_stop():
    app.state.client.controls.stop_bag_recording()
    return app.state.client.controls.get_bag_status()

@app.get("/bag/status")
async def bag_status():
    return app.state.client.controls.get_bag_status()

@app.post("/autonomy/start")
async def autonomy_start():
    app.state.client.controls.start_autonomy_run()
    return app.state.client.controls.get_autonomy_status()

@app.post("/autonomy/stop")
async def autonomy_stop():
    app.state.client.controls.stop_autonomy_run()
    return app.state.client.controls.get_autonomy_status()

@app.get("/autonomy/status")
async def autonomy_status():
    return app.state.client.controls.get_autonomy_status()

@app.get("/control/status")
async def control_status():
    return app.state.client.controls.get_status()

@app.get("/healthz")
async def healthz():
    return {
        "local": "ok",
        "controls": app.state.client.controls.get_status(),
    }

@app.get("/stream", response_class=EventSourceResponse)
async def sse_stream():
    """Telemetry as Server-Sent Events: one {seq, data, stamp_ns} payload per new snapshot."""
    queue = asyncio.Queue(maxsize=SSE_QUEUE_SIZE)
    app.state.sse_clients.add(queue)
    try:
        while True:
            yield await queue.get()
    finally:
        app.state.sse_clients.discard(queue)

"""
Yield each new JPEG from get_latest_jpeg() once, as one part of a multipart/x-mixed-replace
(MJPEG) body. Browsers show that body in a plain <img> and swap in each part as it arrives.
"""
async def mjpeg_frames(get_latest_jpeg, side: str):
    print(f"[CAM] mjpeg client connected for {side}", flush=True)
    last_sent = None
    warned_no_frame = False

    try:
        while True:
            jpeg = get_latest_jpeg()
            if jpeg is None:
                if not warned_no_frame:
                    print(f"[CAM] waiting for first {side} frame", flush=True)
                    warned_no_frame = True
            elif jpeg is not last_sent:   # each frame is a new bytes object
                yield (
                    f"--{MJPEG_BOUNDARY}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n"
                ).encode() + jpeg + b"\r\n"
                last_sent = jpeg
            await asyncio.sleep(1 / CAMERA_POLL_HZ)
    finally:
        print(f"[CAM] mjpeg client disconnected for {side}", flush=True)

@app.get("/camera/{side}")
async def camera_stream(side: str):
    """Camera video as MJPEG, viewable directly in a browser tab or <img>."""
    if side not in ("left", "right"):
        raise HTTPException(status_code=404, detail=f"unknown camera side: {side}")
    client = app.state.client
    node = client.camera_left if side == "left" else client.camera_right
    return StreamingResponse(
        mjpeg_frames(node.get_latest_jpeg, side),
        media_type=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
        headers={"Cache-Control": "no-store"},
    )

@app.get("/perception", response_class=EventSourceResponse)
async def perception_stream():
    """Perception frames as Server-Sent Events, one named event per source, so new
    sources share this one connection. Each event's data is the payload as published
    (see encode_points / encode_costmap in virtual-rgbd-sensor's rslidar_sdk_node.rs),
    base64-encoded since SSE carries text only. Unchanged frames are never resent.

    raw: 16-byte header (i32 sec, u32 nanosec, u32 width, u32 point_step), then width
        records of x, y, z, intensity (f32) [+ cluster_id (i32) when point_step is 20].
    costmap: 32-byte header (i32 sec, u32 nanosec, u32 size_x, u32 size_y, f32 resolution,
        f32 origin_x, f32 origin_y, u32 reserved), then size_x * size_y row-major u8 costs.
    """
    client = app.state.client
    sources = {
        "raw": client.lidar.get_latest_raw,
        "costmap": client.costmap.get_latest_raw,
    }
    last_sent = dict.fromkeys(sources)
    print("[PERCEPTION] sse client connected", flush=True)

    try:
        while True:
            for event, get_latest_raw in sources.items():
                raw = get_latest_raw()
                if raw is not None and raw is not last_sent[event]:   # each frame is a new bytes object
                    yield ServerSentEvent(event=event, raw_data=base64.b64encode(raw).decode("ascii"))
                    last_sent[event] = raw
            await asyncio.sleep(1 / LIDAR_POLL_HZ)
    finally:
        print("[PERCEPTION] sse client disconnected", flush=True)

if __name__ == "__main__":
    import uvicorn
    # Open SSE streams never finish on their own; without a timeout, shutdown waits on them forever.
    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_graceful_shutdown=2)
