# Autonomy Dashboard

## Team Members

Adi, Julia

---

![Live Dashboard Image](frontend/public/LiveRED.png)

---

## Summary

The backend and frontend now follow the approved condensed repository layout.
The existing implementations are retained as filler; Zenoh integration and new
autonomy input contracts have not been implemented. See **Backend layout and
current behavior** below for the mapping and intentionally deferred pieces.

Live telemetry and analysis for the car: sensor streams (with filtering) and derived run metrics. The existing live view is retained; the empty sidebar and replay navigation are no longer mounted.

**Sensor views**

- **Speed** time series, live, and max value
- **Power** time series (calculated from current and voltage data)
- **GPS** location display with Google Maps
- Live **Steering** angle, **Brake** pressure, **Throttle**, and **RPM** on all wheels
- Timestamps and stopwatch for recording duration

**Retained import helpers**

- CSV parsing and telemetry-row adapters remain available in `frontend/src/data.ts` for fixtures and debugging; the replay page is not mounted.

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

   Refer to the **Frontend development reference** below for more information.\
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
   set the variables below in the root `.env` (the existing Vite `envDir` points to
   the repository root). The frontend `.env.example` also documents their names.

   ```env
   VITE_GOOGLE_MAPS_API_KEY=<Your Google Maps API Key here>
   VITE_GOOGLE_MAP_ID=<Your Google Maps Map ID from Google Cloud console>
   ```

   Instructions for getting your own `API_KEY` and `MAP_ID` are in the **Frontend development reference** below.

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

## Retained telemetry import adapters

The replay page, upload controls and playback scheduler are excluded from this
migration. Its reusable parsing and row-mapping code remains in
`frontend/src/data.ts`, without making upload requests or affecting live data.

### CSV expectations

The retained CSV parser runs entirely in the frontend and is flexible about
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

The retained speed helper can convert mph aliases to meters per second; the
existing row mapper's alias lists are unchanged. Missing GPS coordinates retain
the original defaults and parser warnings.

### ROSBag upload on this branch

The backend converter and `POST /replay/rosbag` route remain removed as approved.
The frontend upload request is also excluded. Pure row adapters are retained,
but there is no active replay/upload page. The original replay demonstration
below is historical, not a claim of current functionality.

<video src="frontend/public/ReplayRED.mp4" loop muted autoplay></video>

---

## System Overview

```
ROS2 Sensors → Backend (Python + ROS2) → WebSocket Stream → Frontend (React + TypeScript + Bun)

```

---

## ROSbag + Remote Data Handling

- The frontend can trigger ROSbag recording via `/bag` endpoints
- The backend publishes rosbag recording state on `dashboard_control/bag_recording`
- ROSbag recording consumers should subscribe to that control topic and start on `1`, stop on `0`
- CSV telemetry import adapters remain available as unconnected starter code

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
the relocated mock publisher can be copied into the image. The frontend build
context remains `frontend/`. Backend documentation is consolidated here.

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

## Frontend development reference

### Getting Started

This project uses **Bun** as a package manager and runtime.
Run the following command in the frontend directory to start a dev environment.

```
bun run dev
```

This should start a dev environment at `port 5173` on your machine.

Make sure to specify a `VITE_GOOGLE_MAPS_API_KEY` and a
`VITE_GOOGLE_MAP_ID` in the root `.env` file (Vite uses `envDir: ".."`). Follow the
format in `frontend/.env.example`. It's also listed here for reference.

```env
VITE_GOOGLE_MAPS_API_KEY=Your_Google_Maps_API_Key
VITE_GOOGLE_MAP_ID=Your_Google_Map_ID
```

To get your own **Google Maps API** keys and map ID,\
Head to the [Google Cloud Console](https://console.cloud.google.com/google/maps-hosted/overview),
create a new project, and go to `Keys and Credentials` to get your Google Maps `API_KEY`or
generate your own. Then, navigate to the `Map Management` tab, and create a new map to generate your own `MAP_ID`.\
Refer to the [Google Maps API](https://developers.google.com/maps/documentation/javascript/get-api-key) getting
started guide for more information.

The same root `.env` is used for Compose and isolated frontend development.

### Design

#### React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

**TailwindCSS + MUICharts + DaisyUI**\
This project utilizes these libraries for reusable components and style classes in React.
These are especially important for the Line Charts, buttons, menus and dashboard tile components.

#### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

#### Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from "eslint-plugin-react-x";
import reactDom from "eslint-plugin-react-dom";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs["recommended-typescript"],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```
