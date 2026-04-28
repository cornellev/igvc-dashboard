# Backend

FastAPI service that subscribes to the ROS 2 `spi_data` topic and streams snapshots to the frontend over WebSocket. It also publishes dashboard control signals for rosbag recording and autonomy runs.

## Running the backend

### Local development

Run from the `backend/` directory:

```bash
pip install -r requirements.txt
source /opt/ros/humble/setup.bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

The backend needs access to the ROS 2 `spi_data` topic and the correct discovery configuration.

### Docker

From the project root:

```bash
docker compose up --build
```

The backend uses host networking so ROS 2/DDS traffic can use the laptop's LAN interface.
It is exposed on port `8000` on the laptop.

## Main endpoints

- `GET /` basic health response
- `WS /ws/stream` live telemetry stream for the frontend
- `POST /bag/start`, `POST /bag/stop`, and `GET /bag/status` publish rosbag recording state
- `POST /autonomy/start`, `POST /autonomy/stop`, and `GET /autonomy/status` publish autonomy run state
- `GET /control/status` returns both dashboard control states
- `GET /healthz` reports backend health and current control states

## Environment

- `ROS_DOMAIN_ID` must match the publisher's DDS domain
- `ROS_LOCALHOST_ONLY` controls whether ROS discovery is localhost-only
- `JETSON_LAN_IP` is the Jetson's LAN address on the router network
- `DISCOVERY_SERVER_IP` optionally overrides `JETSON_LAN_IP` for Fast DDS discovery
- `DASHBOARD_CONTROL_TOPIC` sets the shared ROS topic namespace for `std_msgs/msg/Int32` control commands, defaulting to `dashboard_control`
- `DASHBOARD_CONTROL_PUBLISH_HZ` sets how often the backend republishes `1` while started and `0` while stopped for each control, defaulting to `10`

By default, autonomy state is published on `dashboard_control/autonomy_run` and rosbag recording state is published on `dashboard_control/bag_recording`.
