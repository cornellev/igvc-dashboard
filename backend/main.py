import asyncio
import threading
import contextlib
import collections
import time
import os
import tempfile
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
import rclpy
from rclpy.executors import SingleThreadedExecutor
from subscriber import DataSubscriber
from camera_subscriber import CameraSubscriber
from autonomy_control import DashboardControlPublisher
from contextlib import asynccontextmanager
import math

from rosbag_replay import parse_rosbag_to_csv_rows

DEQUE_SIZE = 1000 # for snapshot
SAMPLE_RATE_HZ = 40  # rate at which we send data to frontend

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

def ros_spin_loop(node: DataSubscriber, stop_evt: threading.Event, history: collections.deque, data_ready: threading.Event):
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

            # Rate limit: only append/broadcast at SAMPLE_RATE_HZ
            now = time.monotonic()
            if now - last_append_time < sample_interval:
                continue
            last_append_time = now

            history.append((data, stamp))
            data_ready.set()
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

# broadcasts new messages to all clients without re-collecting ROS message per client
# use a single producer to wait for next snapshot and then broadcast to all active sockets
async def broadcaster(app: FastAPI):
    seq = 0
    last_stamp = None

    while True:
        await asyncio.to_thread(app.state.data_ready.wait, 1.0)
        app.state.data_ready.clear()
        if not app.state.history:
            continue
        data, stamp = app.state.history[-1]

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

# need to run ROS and FastAPI concurrently; ROS doesn't block FastAPI's event loop               
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        rclpy.init()
        print("[ROS] rclpy initialized", flush=True)
    except Exception as e:
        print(f"[ROS] ERROR: failed to initialize rclpy: {e}", flush=True)
        raise

    topic = "spi_data"
    try:
        app.state.node = DataSubscriber(topic)
    except Exception as e:
        print(f"[ROS] ERROR: failed to create subscriber for '{topic}': {e}", flush=True)
        raise

    try:
        app.state.camera_left = CameraSubscriber('zed/left/image_raw', 'camera_left')
        app.state.camera_right = CameraSubscriber('zed/right/image_raw', 'camera_right')
    except Exception as e:
        print(f"[CAM] ERROR: failed to create camera subscribers: {e}", flush=True)
        raise

    try:
        control_topic_namespace = os.getenv(
            "DASHBOARD_CONTROL_TOPIC",
            "dashboard_control",
        )
        control_publish_hz = float(os.getenv("DASHBOARD_CONTROL_PUBLISH_HZ", "10"))
        app.state.dashboard_control = DashboardControlPublisher(
            control_topic_namespace,
            control_publish_hz,
        )
    except Exception as e:
        print(f"[ROS] ERROR: failed to create dashboard control publisher: {e}", flush=True)
        raise

    # create stop signal before starting ROS thread
    app.state.stop_evt = threading.Event()

    app.state.clients = set()

    # deque: history for snapshot; [-1] is latest for frontend
    app.state.history = collections.deque(maxlen=DEQUE_SIZE)
    app.state.data_ready = threading.Event()

    app.state.ros_thread = threading.Thread(
        target=ros_spin_loop,
        args=(app.state.node, app.state.stop_evt, app.state.history, app.state.data_ready),
        daemon=True
    )
    # start ROS thread
    app.state.ros_thread.start()

    app.state.camera_thread = threading.Thread(
        target=auxiliary_spin_loop,
        args=(
            [
                app.state.camera_left,
                app.state.camera_right,
                app.state.dashboard_control,
            ],
            app.state.stop_evt,
        ),
        daemon=True
    )
    app.state.camera_thread.start()

    app.state.broadcaster_task = asyncio.create_task(broadcaster(app))
    try:
        yield
    finally:
        app.state.stop_evt.set()
        app.state.ros_thread.join(timeout=5.0)
        app.state.camera_thread.join(timeout=5.0)

        app.state.broadcaster_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.broadcaster_task

        app.state.node.destroy_node()
        app.state.camera_left.destroy_node()
        app.state.camera_right.destroy_node()
        app.state.dashboard_control.destroy_node()
        rclpy.shutdown()

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
    app.state.dashboard_control.start_bag_recording()
    return app.state.dashboard_control.get_bag_status()

@app.post("/bag/stop")
async def bag_stop():
    app.state.dashboard_control.stop_bag_recording()
    return app.state.dashboard_control.get_bag_status()

@app.get("/bag/status")
async def bag_status():
    return app.state.dashboard_control.get_bag_status()

@app.post("/autonomy/start")
async def autonomy_start():
    app.state.dashboard_control.start_autonomy_run()
    return app.state.dashboard_control.get_autonomy_status()

@app.post("/autonomy/stop")
async def autonomy_stop():
    app.state.dashboard_control.stop_autonomy_run()
    return app.state.dashboard_control.get_autonomy_status()

@app.get("/autonomy/status")
async def autonomy_status():
    return app.state.dashboard_control.get_autonomy_status()

@app.get("/control/status")
async def control_status():
    return app.state.dashboard_control.get_status()

@app.get("/healthz")
async def healthz():
    return {
        "local": "ok",
        "controls": app.state.dashboard_control.get_status(),
    }

@app.post("/replay/rosbag")
async def replay_rosbag(
    payload: bytes = Body(..., media_type="application/octet-stream"),
    x_file_name: str | None = Header(default=None),
):
    lower_name = (x_file_name or "").lower()

    if not lower_name.endswith(".db3"):
        raise HTTPException(
            status_code=400,
            detail="Replay currently supports ROS bag SQLite files with a .db3 extension.",
        )

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db3") as temp_file:
            temp_file.write(payload)
            temp_path = temp_file.name

        rows, warnings = parse_rosbag_to_csv_rows(Path(temp_path))

        return {
            "rows": sanitize_json(rows),
            "warnings": warnings,
            "message_count": len(rows),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="That .db3 file could not be parsed with the rosbag replay converter.",
        ) from exc
    finally:
        if temp_path is not None:
            with contextlib.suppress(OSError):
                os.remove(temp_path)

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
    node = app.state.camera_left if side == "left" else app.state.camera_right
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
