# Intelligent Ground Vehicle Competition (IGVC) Dashboard

## Team Members

Ajay, Donte, Eric, Shreyaa

---

![Live Dashboard Image](frontend/public/LiveRED.png)

---

## Summary

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

   Refer to `backend/README.md`.

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

### Local Costmap Bag Replay

To test the occupancy grid widget with the local `../costmap` rosbag, start the
dashboard first:

```sh
docker compose up --build
```

Then, in a ROS 2 sourced shell, replay the costmap topics:

```sh
./scripts/replay_costmap_bag.sh
```

The script publishes `/costmap` and `/costmap_updates` from start to end. If the
bag lives somewhere else, pass the bag directory as the first argument.

## Replay Mode

The frontend includes a dedicated **Replay** page alongside the live **Data** view.
Use it to inspect telemetry exports without needing a live ROS2 stream.

### Current capabilities

- Upload a `.csv` telemetry file from the Replay page
- Upload a rosbag2 SQLite `.db3` file from the Replay page
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

### ROSBag expectations

ROS bag replay currently supports rosbag2 SQLite `.db3` files and converts them
through the backend into flattened CSV-style telemetry rows before rendering.
Replayable messages should contain JSON payloads, like the example bag files
under `frontend/data`. Messages that cannot be converted into telemetry rows are
skipped during import.

<video src="frontend/public/ReplayRED.mp4" loop muted autoplay></video>

---

## System Overview

```
ROS2 Sensors → Backend (Python + ROS2) → WebSocket Stream → Frontend (React + TypeScript + Bun)

Uploaded CSV → Frontend Replay Parser → Replay Timeline → Shared Dashboard Widgets
Uploaded ROS bag `.db3` → Backend Bag Parser → Replay Timeline → Shared Dashboard Widgets
```

---

## ROSbag + Remote Data Handling

- The frontend can trigger ROSbag recording via `/bag` endpoints
- The backend publishes rosbag recording state on `dashboard_control/bag_recording`
- ROSbag recording consumers should subscribe to that control topic and start on `1`, stop on `0`
- Local dashboard replay supports uploaded CSV telemetry exports and rosbag2 SQLite `.db3` files
