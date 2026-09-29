# Intelligent Ground Vehicle Competition (IGVC) Dashboard

## Team Members

Ajay, Donte, Eric, Shreyaa

---

![Live Dashboard Image](frontend/public/LiveRED.png)

---

## Summary

The backend now follows the approved condensed autonomy-dashboard layout. Its
existing ROS implementation is retained as filler; Zenoh integration and new
autonomy input contracts have not been implemented. See **Backend layout and
current behavior** below for the mapping and intentionally deferred pieces.

Live telemetry and analysis for the car: sensor streams (with filtering), derived run metrics, a telemetry sidebar, and a browser-based replay mode for uploaded telemetry exports.

**Sensor views**

- **Speed** time series, live, and max value
- **Power** time series (calculated from current and voltage data)
- **GPS** location display with Google Maps
- Live **Steering** angle, **Brake** pressure, **Throttle**, and **RPM** on all wheels
- Timestamps and stopwatch for lap and race timing

**Replay tools**

- Upload a telemetry **CSV** export and replay it directly in the dashboard UI
- Scrub through samples with a timeline slider or play/pause the run at multiple playback speeds
- Reuse the same dashboard widgets in **Replay** mode to inspect historical data sample-by-sample

**Derived metrics**

- **Distance** calculated from aggregating GPS data
- **Energy Use** calculated from power
- **Efficiency** instantaneous and average over a run

## Getting Started

1. **Running the Project**

   Create a `.env` file in the the root directory (not under `/backend` or `/frontend`).
   See `.env.example` for more info.

   Make sure Docker containers and volumes for this project are not running already.
   Then, run `docker compose up --build` to get all containers running.

   Compose variants:
   - `docker compose -f docker-compose.dev.yml up --build` for local development and mock camera testing
   - `RUN_MOCK_CAMERA=true docker compose -f docker-compose.dev.yml up --build` to enable the mock camera
   - `docker compose -f docker-compose.prod.yml up --build` for the real ROS LAN setup

   The frontend client UI should be running on `port 3000`.  
   The backend healthcheck endpoint is on the root of `port 8000`.

2. **Frontend Testing**

   Refer to `frontend/README.md` for more information.  
   **[Bun Installation](https://bun.com/docs/installation)**: The frontend uses **Bun** instead of **NodeJS** as a package manager
   and runtime. The installation is linked [here](https://bun.com/docs/installation). Then, run the following commands in the
   terminal to test/run the frontend in isolation.  
   This will start the frontend development environment with HMR and Vite at `port 5173`.

   ```bash
   cd frontend
   bun dev
   ```

   **Google Maps**: To get location data and Google Maps properly displaying while
   running only the frontend with `bun dev`,
   create a `.env` file in the `/frontend` directory. Follow the `.env.example` in the
   `/frontend` and create the environment variables below.

   ```env
   VITE_GOOGLE_MAPS_API_KEY=<Your Google Maps API Key here>
   VITE_GOOGLE_MAP_ID=<Your Google Maps Map ID from Google Cloud console>
   ```

   Instructions for getting your own `API_KEY` and `MAP_ID` are in `frontend/README.md`.

3. **Backend Troubleshooting**

   Refer to **Backend layout and current behavior** below.

<video src="frontend/public/LiveRED.mp4" loop muted autoplay></video>

---

## ROS Subscriber Data

For the ROS 2 subscriber over LAN, connect the laptop and Jetson to the same router
network and set the Jetson's LAN IP in `.env`:

```sh
JETSON_LAN_IP=192.168.1.2
```

Use `DISCOVERY_SERVER_IP` only if the Fast DDS discovery server is on a different
LAN address than `JETSON_LAN_IP`.

## Replay Mode

The frontend includes a dedicated **Replay** page alongside the live **Data** view.
Use it to inspect telemetry exports without needing a live ROS2 stream.

### Current capabilities

- Upload a `.csv` telemetry file from the Replay page
- Play, pause, reset, and scrub through the uploaded run
- Change playback speed from `0.5x` up to `100x`
- Render replayed samples through the same dashboard layout used for live telemetry

### CSV expectations

CSV replay is parsed entirely in the frontend and is intentionally flexible about
column names. Headers are normalized by lowercasing and removing punctuation, so
both flat and dotted names are accepted.

Examples of supported fields include:

- `speed`, `speed_mps`, `gps.speed`, `velocity`
- `filtered.speed`
- `gps.lat`, `gps.long`, `latitude`, `longitude`
- `power.current`, `power.voltage`
- `steering.turn_angle`, `steering.brake_pressure`
- `motor.rpm`, `motor.duty_cycle`
- `rpm_front.left`, `rpm_front.right`, `rpm_back.left`, `rpm_back.right`
- `global_ts`, `timestamp`, `time`, or a row index fallback when timestamps are missing

If a speed column name includes `mph`, the replay parser converts it to meters per
second before rendering. If GPS coordinates are missing, the dashboard falls back
to default coordinates and shows a warning after upload.

### ROSBag upload on this branch

The backend rosbag replay converter and `POST /replay/rosbag` route were removed
because replay is outside the backend redesign. The existing frontend is
unchanged and still offers `.db3` upload, but those uploads no longer work on
this branch. Browser-only CSV replay is unaffected. The removed implementation
remains recoverable in Git history.

<video src="frontend/public/ReplayRED.mp4" loop muted autoplay></video>

---

## System Overview

```
ROS2 Sensors → Backend (Python + ROS2) → WebSocket Stream → Frontend (React + TypeScript + Bun)

Uploaded CSV → Frontend Replay Parser → Replay Timeline → Shared Dashboard Widgets
```

---

## ROSbag + Remote Data Handling

- The frontend can trigger ROSbag recording via `/bag` endpoints
- The backend publishes rosbag recording state on `dashboard_control/bag_recording`
- ROSbag recording consumers should subscribe to that control topic and start on `1`, stop on `0`
- Local dashboard replay supports uploaded CSV telemetry exports

---

## Backend layout and current behavior

This is a structural reorganization of the previous backend. ROS topics, payloads,
sampling rates, camera encoding, and control signals remain the existing filler
implementation. In particular, `zenoh_client.py` contains `LegacyRosClient`, not
a Zenoh client. Its original timeout and broadcasting policies are also retained;
this change does not introduce the planned diagnostics or per-client queues.
One private control-publisher field was renamed to avoid overwriting ROS Node's
internal publisher list, which otherwise prevents clean shutdown. Extracted
lifecycle code also releases already-created resources if startup fails.

| File | Source and responsibility |
| --- | --- |
| `backend/main.py` | Existing FastAPI endpoints, WebSocket handlers, and broadcaster. |
| `backend/zenoh_client.py` | ROS startup, executor threads, and shutdown extracted from the old `main.py`. |
| `backend/state.py` | Latest values, per-topic timestamps, and bounded history extracted from the old subscribers and `main.py`. |
| `backend/controls.py` | Moved from `autonomy_control.py`; still publishes ROS `Int32` values. |
| `backend/subscribers/perception.py` | Moved from `camera_subscriber.py`; camera handling only. |
| `backend/subscribers/localization.py` | Moved from `igvcsubscriber.py`; standalone IMU/GNSS prototype, still not enabled at application startup. |
| `backend/subscribers/status.py` | Moved from `subscriber.py`; the existing `spi_data` JSON subscriber. |
| `backend/models.py` | Documentation-only placeholder until message contracts are defined. |
| `backend/subscribers/planning.py` | Documentation-only placeholder; there is no previous planning implementation. |
| `tools/mock_vehicle.py` | Moved from `backend/mock_camera.py`; still publishes the original mock camera images over ROS. |

`requirements.txt` remains the dependency source used by Docker. The new
`pyproject.toml` reads that same list instead of duplicating it. `uv.lock` is
deferred until the uv dependency workflow is adopted; no placeholder lockfile is
created. The removed `rosbags` dependency served only the removed converter;
`asyncio` is provided by Python itself.

The ROS Docker base, `backend/entrypoint.sh`, and
`backend/super_client.example.xml` are retained because the current code requires
them. All three Compose files now build the backend from the repository root so
the relocated mock publisher can be copied into the image. The frontend and its
build context are unchanged. Backend documentation is consolidated here.

### Running the backend

Existing Compose commands above continue to apply. For the backend alone, run
from `backend/` in an environment with ROS 2 Humble installed:

```bash
pip install -r requirements.txt
source /opt/ros/humble/setup.bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

The relocated standalone subscriber examples should be run as modules from
`backend/`, for example `python -m subscribers.localization`.

The API keeps `GET /`, `GET /healthz`, `WS /ws/stream`, and
`WS /ws/camera/{left|right}`. Control routes remain `POST /bag/start`,
`POST /bag/stop`, `GET /bag/status`, `POST /autonomy/start`,
`POST /autonomy/stop`, `GET /autonomy/status`, and `GET /control/status`.
Control status describes the requested state, not confirmation from the vehicle.

`ROS_DOMAIN_ID`, `ROS_LOCALHOST_ONLY`, `JETSON_LAN_IP`, and
`DISCOVERY_SERVER_IP` retain their existing meaning. `DASHBOARD_CONTROL_TOPIC`
defaults to `dashboard_control`; `DASHBOARD_CONTROL_PUBLISH_HZ` defaults to `10`.
No Zenoh configuration or new input keys are introduced yet.

### Checking the backend reorganization

From the repository root, run `python3 -m unittest discover -s tests -v` for
the state tests. ROS-dependent tests are explicitly skipped without the opt-in
environment variable. To exercise the real ROS classes and browser handlers in
an isolated container:

```bash
docker build -f backend/Dockerfile -t autonomy-dashboard-backend:layout-review .
docker run --rm --network none -e DASHBOARD_TEST_ROS=1 \
  --mount "type=bind,source=$PWD/tests,target=/app/tests,readonly" \
  --entrypoint /bin/bash autonomy-dashboard-backend:layout-review \
  -c 'source /opt/ros/humble/setup.bash && python3 -m unittest discover -s tests -v'
```

These tests cover state extraction, telemetry broadcast envelopes, camera JPEGs,
control responses, the standalone localization prototype, startup cleanup, and
the actual container entrypoint serving images from the relocated mock publisher.
They use localhost-only ROS in a separate domain and do not connect to the vehicle.
