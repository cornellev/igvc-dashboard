"""Existing browser API, reorganized around extracted state and ROS filler."""

import asyncio
import contextlib
from contextlib import asynccontextmanager
import math

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from state import DashboardState
from zenoh_client import LegacyRosClient

# Lidar/costmap frames arrive at ~10 Hz; poll faster so a new frame goes out promptly.
LIDAR_POLL_HZ = 20

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
Uses a single producer to wait for next snapshot and then broadcast to all active sockets
"""
async def broadcaster(app: FastAPI):
    seq = 0
    last_stamp = None
    state = app.state.dashboard

    while True:
        await asyncio.to_thread(state.data_ready.wait, 1.0)
        state.data_ready.clear()
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

        dead = []
        for ws in list(app.state.clients):
            try:
                # print(payload)
                await ws.send_json(payload)
            except WebSocketDisconnect:
                dead.append(ws)
            # treat all send failures as dead (optional)
            except Exception:
                dead.append(ws)
            
        for ws in dead:
            app.state.clients.discard(ws)

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.dashboard = DashboardState()
    app.state.client = LegacyRosClient(app.state.dashboard)
    app.state.clients = set()
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

@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    app.state.clients.add(websocket)

    try:
        # keep socket alive; data is pushed from broadcaster
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
    finally:
        app.state.clients.discard(websocket)

@app.websocket("/ws/camera/{side}")
async def websocket_camera(websocket: WebSocket, side: str):
    if side not in ("left", "right"):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    print(f"[CAM] websocket connected for {side}", flush=True)
    client = app.state.client
    node = client.camera_left if side == "left" else client.camera_right
    warned_no_frame = False

    try:
        while True:
            jpeg = node.get_latest_jpeg()
            if jpeg is not None:
                warned_no_frame = False
                await websocket.send_bytes(jpeg)
            elif not warned_no_frame:
                print(f"[CAM] waiting for first {side} frame", flush=True)
                warned_no_frame = True
            await asyncio.sleep(1 / 30)
    except WebSocketDisconnect:
        print(f"[CAM] websocket disconnected for {side}", flush=True)


"""
Send each new payload from get_latest_raw() once, unmodified, as a binary message.

Frames are large, so unchanged frames are never resent. The browser decodes the same 
wire format the Rust publisher writes (see encode_points / encode_costmap in 
virtual-rgbd-sensor's rslidar_sdk_node.rs).
"""
async def stream_latest_bytes(websocket: WebSocket, name: str, get_latest_raw):
    await websocket.accept()
    print(f"[LIDAR] websocket connected for {name}", flush=True)
    last_sent = None
    warned_no_frame = False

    try:
        while True:
            raw = get_latest_raw()
            if raw is None:
                if not warned_no_frame:
                    print(f"[LIDAR] waiting for first {name} frame", flush=True)
                    warned_no_frame = True
            elif raw is not last_sent:   # each frame is a new bytes object
                await websocket.send_bytes(raw)
                last_sent = raw
            await asyncio.sleep(1 / LIDAR_POLL_HZ)
    except WebSocketDisconnect:
        print(f"[LIDAR] websocket disconnected for {name}", flush=True)

@app.websocket("/ws/lidar/raw")
async def websocket_lidar_raw(websocket: WebSocket):
    """Point cloud: 16-byte header (i32 sec, u32 nanosec, u32 width, u32 point_step),
    then width records of x, y, z, intensity (f32) [+ cluster_id (i32) when point_step is 20]."""
    await stream_latest_bytes(websocket, "points", app.state.client.lidar.get_latest_raw)

@app.websocket("/ws/lidar/costmap")
async def websocket_lidar_costmap(websocket: WebSocket):
    """Costmap: 32-byte header (i32 sec, u32 nanosec, u32 size_x, u32 size_y, f32 resolution,
    f32 origin_x, f32 origin_y, u32 reserved), then size_x * size_y row-major u8 costs."""
    await stream_latest_bytes(websocket, "costmap", app.state.client.costmap.get_latest_raw)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
