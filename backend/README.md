# Backend

FastAPI service that subscribes to the ROS 2 `spi_data` topic and streams snapshots to the frontend over WebSocket. It also proxies rosbag control requests.

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
- `POST /bag/start`, `POST /bag/stop`, and `GET /bag/status` proxy rosbag controls
- `POST /autonomy/start`, `POST /autonomy/stop`, and `GET /autonomy/status` publish autonomy run state
- `GET /healthz` reports backend and remote bag-service health

## Environment

- `ROS_DOMAIN_ID` must match the publisher's DDS domain
- `ROS_LOCALHOST_ONLY` controls whether ROS discovery is localhost-only
- `JETSON_LAN_IP` is the Jetson's LAN address on the router network
- `DISCOVERY_SERVER_IP` optionally overrides `JETSON_LAN_IP` for Fast DDS discovery
- `ROSBAG_API_URL` optionally sets the full rosbag API base URL
- `ROSBAG_API_HOST` optionally overrides `JETSON_LAN_IP` for remote rosbag API requests
- `ROSBAG_API_PORT` is the rosbag API port
- `AUTONOMY_RUN_TOPIC` sets the `std_msgs/msg/Int32` topic for autonomy run commands, defaulting to `autonomy_run`
- `AUTONOMY_RUN_PUBLISH_HZ` sets how often the backend republishes `1` while started and `0` while stopped, defaulting to `10`
