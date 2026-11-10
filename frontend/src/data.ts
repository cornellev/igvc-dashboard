/** Existing browser transport, normalization and telemetry helpers consolidated here. */
import type { SocketData } from "./types";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getDefaultWebSocketBase = () => {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:8000";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:8000`;
};

export const getWebSocketUrl = (path: string) => {
  const configuredBase = import.meta.env.VITE_BACKEND_WS_URL?.trim();
  const baseUrl = configuredBase
    ? trimTrailingSlash(configuredBase)
    : getDefaultWebSocketBase();

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
};

type MessageHandler = (data: SocketData) => void;

type LooseRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is LooseRecord =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): LooseRecord =>
  (isRecord(value) ? value : {}) as LooseRecord;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const toTimestampMs = (value: unknown): number | null => {
  const numericValue = toNumber(value, Number.NaN);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  if (numericValue > 10e12) {
    return numericValue / 1e6;
  }

  if (numericValue > 1e12) {
    return numericValue / 1e3;
  }

  return numericValue;
};

export const normalizeSocketData = (
  payload: unknown,
  envelope?: LooseRecord,
  recvMs?: number,
): SocketData => {
  const root = asRecord(payload);
  const power = asRecord(root.power);
  const steering = asRecord(root.steering);
  const gps = asRecord(root.gps);
  const location = asRecord(root.location);
  const motor = asRecord(root.motor);
  const filtered = asRecord(root.filtered);
  const rpmFront = asRecord(root.rpm_front);
  const rpmBack = asRecord(root.rpm_back);

  const speedValue =
    gps.speed ?? motor.velocity ?? motor.speed ?? filtered.speed ?? root.speed;

  const timestampCandidates = [
    root.global_ts,
    root.ts,
    gps.ts,
    location.ts,
    power.ts,
    motor.ts,
    steering.ts,
    filtered.ts,
    envelope?.stamp_ns,
  ];

  const globalTimestamp =
    timestampCandidates
      .map((candidate) => toTimestampMs(candidate))
      .find((candidate) => candidate !== null) ?? Date.now();

  const tPublishNs = toNumber(root._t_publish_ns, Number.NaN);
  const latency_ms =
    recvMs != null && Number.isFinite(tPublishNs) && tPublishNs > 0
      ? recvMs - tPublishNs / 1e6
      : null;

  return {
    seq: toNumber(root.seq ?? envelope?.seq, 0),
    global_ts: globalTimestamp,
    power: {
      ts: toTimestampMs(power.ts) ?? globalTimestamp,
      current: toNumber(power.current),
      voltage: toNumber(power.voltage),
    },
    steering: {
      ts: toTimestampMs(steering.ts) ?? globalTimestamp,
      brake_pressure: toNumber(
        steering.brake_pressure ?? steering.brake ?? steering.pressure,
      ),
      turn_angle: toNumber(
        steering.turn_angle ?? steering.angle ?? steering.steering_angle,
      ),
    },
    rpm_front: {
      ts: toTimestampMs(rpmFront.ts) ?? globalTimestamp,
      rpm_left: toNumber(rpmFront.rpm_left),
      rpm_right: toNumber(rpmFront.rpm_right),
    },
    rpm_back: {
      ts: toTimestampMs(rpmBack.ts) ?? globalTimestamp,
      rpm_left: toNumber(rpmBack.rpm_left),
      rpm_right: toNumber(rpmBack.rpm_right),
    },
    gps: {
      ts: toTimestampMs(gps.ts ?? location.ts) ?? globalTimestamp,
      lat: toNumber(gps.lat ?? location.lat, 42.44666485723302),
      long: toNumber(gps.long ?? location.long, -76.4608710371343),
      heading: toNumber(gps.heading),
      speed: toNumber(speedValue),
    },
    motor: {
      ts: toTimestampMs(motor.ts) ?? globalTimestamp,
      rpm: toNumber(motor.rpm),
      duty_cycle: toNumber(motor.duty_cycle ?? motor.throttle),
    },
    filtered: {
      speed: toNumber(filtered.speed ?? speedValue),
    },
    latency_ms,
  };
};

class SocketService {
  private static instance: SocketService;
  private socket: WebSocket | null = null;
  private url: string = getWebSocketUrl("/ws/stream");
  private handlers: Set<MessageHandler> = new Set();
  private reconnectInterval: number = 5000;
  private data: SocketData[] = [];
  private dataTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly DATA_TIMEOUT_MS = 5000;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log("WebSocket Connected");
    };

    this.socket.onmessage = (event: MessageEvent) => {
      const recvMs = Date.now();
      const envelope = JSON.parse(event.data);
      const data = normalizeSocketData(
        envelope.data ?? envelope,
        asRecord(envelope),
        recvMs,
      );
      this.data = [...this.data.slice(-1200), data];
      this.handlers.forEach((handler) => handler(data));
      this.resetDataTimeout();
    };

    this.socket.onclose = () => {
      console.log("WebSocket Disconnected. Reconnecting...");
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket Error:", error);
      this.socket?.close();
    };
  }

  private resetDataTimeout(): void {
    if (this.dataTimeoutHandle) clearTimeout(this.dataTimeoutHandle);
    this.dataTimeoutHandle = setTimeout(() => {
      console.warn(
        `[ROS] Error: no data received for >${this.DATA_TIMEOUT_MS / 1000}s. possible reasons:` +
          `\n- ros publisher is not publishing` +
          `\n- laptop and publisher are not on the same LAN` +
          `\n- you are not using the correct Fast DDS discovery server LAN IP address`,
      );
    }, this.DATA_TIMEOUT_MS);
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    // Return unsubscribe function
    return () => this.handlers.delete(handler);
  }

  public getData(): SocketData[] {
    return this.data;
  }

  public getLatestData(): SocketData | null {
    return this.data.length > 0 ? this.data[this.data.length - 1] : null;
  }

  public send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.error("Socket not connected");
    }
  }

  public disconnect(): void {
    this.socket?.close();
  }
}

const socketService = SocketService.getInstance();

export default socketService;

/** Optional telemetry guard retained from the old run-tracking controls. */
export function canStartRunTracking(
  latestTimestamp: number | null,
  showWarning: (message: string) => void,
) {
  if (latestTimestamp === null) {
    console.warn("Cannot start run tracking without any telemetry data");
    showWarning("No data to record");
    return false;
  }

  return true;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function postControlRequest(
  path: string,
  fallbackMessage: string,
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }
}

async function readErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const payload = (await response.json()) as { detail?: unknown };

    if (typeof payload.detail === "string" && payload.detail.length > 0) {
      return payload.detail;
    }
  } catch {
    return `${fallbackMessage} (${response.status})`;
  }

  return `${fallbackMessage} (${response.status})`;
}

export const TIMESTAMP_UNITS_PER_SECOND = 1e6;
const HOURS_PER_SECOND = 1 / 3600;
const METERS_PER_MILE = 1609.344;
const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING);

export function calculatePowerKilowatts(sample: SocketData): number {
  return Math.max(0, (sample.power.current * sample.power.voltage) / 1000);
}

export function calculateEfficiency(sample: SocketData): number | null {
  const powerKw = calculatePowerKilowatts(sample);

  if (powerKw <= 0) {
    return null;
  }

  return (sample.filtered.speed * 2.23694) / powerKw;
}

export function calculateEnergyKilowattHoursBetween(
  previousPowerKilowatts: number,
  currentPowerKilowatts: number,
  previousTimestamp: number,
  currentTimestamp: number,
): number {
  const elapsedHours =
    (Math.max(0, currentTimestamp - previousTimestamp) /
      TIMESTAMP_UNITS_PER_SECOND) *
    HOURS_PER_SECOND;

  if (elapsedHours <= 0) {
    return 0;
  }

  return ((previousPowerKilowatts + currentPowerKilowatts) / 2) * elapsedHours;
}

export function calculateLocalTangentDistanceMeters(
  originLatitude: number,
  originLongitude: number,
  targetLatitude: number,
  targetLongitude: number,
): number {
  const origin = geodeticToEcef(originLatitude, originLongitude);
  const target = geodeticToEcef(targetLatitude, targetLongitude);
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const deltaZ = target.z - origin.z;
  const originLatitudeRadians = degreesToRadians(originLatitude);
  const originLongitudeRadians = degreesToRadians(originLongitude);
  const east =
    -Math.sin(originLongitudeRadians) * deltaX +
    Math.cos(originLongitudeRadians) * deltaY;
  const north =
    -Math.sin(originLatitudeRadians) *
      Math.cos(originLongitudeRadians) *
      deltaX -
    Math.sin(originLatitudeRadians) *
      Math.sin(originLongitudeRadians) *
      deltaY +
    Math.cos(originLatitudeRadians) * deltaZ;

  return Math.hypot(east, north);
}

function geodeticToEcef(latitude: number, longitude: number) {
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);
  const sinLatitude = Math.sin(latitudeRadians);
  const cosLatitude = Math.cos(latitudeRadians);
  const sinLongitude = Math.sin(longitudeRadians);
  const cosLongitude = Math.cos(longitudeRadians);
  const radiusOfCurvature =
    WGS84_SEMI_MAJOR_AXIS /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude ** 2);

  return {
    x: radiusOfCurvature * cosLatitude * cosLongitude,
    y: radiusOfCurvature * cosLatitude * sinLongitude,
    z: radiusOfCurvature * (1 - WGS84_ECCENTRICITY_SQUARED) * sinLatitude,
  };
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function isValidGpsCoordinate(
  latitude: number,
  longitude: number,
): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0
  );
}

export function metersToMiles(value: number): number {
  return value / METERS_PER_MILE;
}

export function formatElapsed(startTs: number, currentTs: number): string {
  const elapsedSeconds = Math.max(
    0,
    (currentTs - startTs) / TIMESTAMP_UNITS_PER_SECOND,
  );

  if (elapsedSeconds < 60) {
    return `${Math.round(elapsedSeconds)}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = Math.floor(elapsedSeconds % 60);

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatRunTimer(startTs: number, currentTs: number): string {
  const elapsedSeconds = Math.max(
    0,
    (currentTs - startTs) / TIMESTAMP_UNITS_PER_SECOND,
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds - minutes * 60;

  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatDistanceMiles(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)} mi` : "--";
}

export function formatEnergyWattHours(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)} Wh` : "--";
}

export function formatValue(value: number, decimals: number): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

export function formatEfficiency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0.00 mi/kWh";
  }

  return `${value.toFixed(2)} mi/kWh`;
}

export function formatDuty(value: number): string {
  const normalized = value * 100;
  return formatValue(normalized, 0);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Retained import adapters for fixtures/debugging; no replay UI or upload request. */
const DEFAULT_LATITUDE = 42.44666485723302;
const DEFAULT_LONGITUDE = -76.4608710371343;
const MPH_PER_MPS = 2.23694;

type ParsedReplayResult = { rows: SocketData[]; warnings: string[] };
type CsvRow = Record<string, string>;

export function parseReplayCsv(source: string): ParsedReplayResult {
  const rows = parseCsv(source);

  if (rows.length === 0) {
    return { rows: [], warnings: [] };
  }

  const normalizedRows = rows
    .map((row, index) => mapCsvRowToSocketData(row, index))
    .filter((row) => Number.isFinite(row.global_ts))
    .sort((left, right) => left.global_ts - right.global_ts)
    .map((row, index) => ({ ...row, seq: index + 1 }));

  const warnings: string[] = [];

  if (normalizedRows.some((row) => row.gps.lat === DEFAULT_LATITUDE)) {
    warnings.push(
      "Some GPS fields were missing, so default coordinates were used.",
    );
  }

  return {
    rows: normalizedRows,
    warnings,
  };
}

export function parseCsv(source: string): CsvRow[] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...valueRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return valueRows
    .filter((row) => row.some((value) => value.trim().length > 0))
    .map((row) =>
      headers.reduce<CsvRow>((record, header, index) => {
        record[header] = row[index]?.trim() ?? "";
        return record;
      }, {}),
    );
}

export function mapCsvRowToSocketData(row: CsvRow, index: number): SocketData {
  const normalizedRow = Object.entries(row).reduce<Record<string, string>>(
    (record, [key, value]) => {
      record[normalizeHeader(key)] = value;
      return record;
    },
    {},
  );

  const globalTs = getTimestamp(normalizedRow, index);
  const gpsSpeed = getSpeedMetersPerSecond(normalizedRow, [
    "gpsspeedmps",
    "gpsspeed",
    "speedmps",
    "speed",
    "velocity",
  ]);
  const filteredSpeed = getSpeedMetersPerSecond(
    normalizedRow,
    ["filteredspeedmps", "filteredspeed", "speedfilteredmps", "speedfiltered"],
    gpsSpeed,
  );

  return {
    seq: getNumber(normalizedRow, ["seq", "index", "row"], index + 1),
    global_ts: globalTs,
    power: {
      ts: getTimestamp(normalizedRow, index, ["powerts"], globalTs),
      current: getNumber(normalizedRow, [
        "powercurrent",
        "current",
        "batterycurrent",
        "packcurrent",
      ]),
      voltage: getNumber(normalizedRow, [
        "powervoltage",
        "voltage",
        "batteryvoltage",
        "packvoltage",
      ]),
    },
    steering: {
      ts: getTimestamp(normalizedRow, index, ["steeringts"], globalTs),
      brake_pressure: getNumber(normalizedRow, [
        "steeringbrakepressure",
        "brakepressure",
        "brake",
      ]),
      turn_angle: getNumber(normalizedRow, [
        "steeringturnangle",
        "turnangle",
        "steeringangle",
        "angle",
      ]),
    },
    rpm_front: {
      ts: getTimestamp(normalizedRow, index, ["rpmfrontts"], globalTs),
      rpm_left: getNumber(normalizedRow, [
        "rpmfrontrpmleft",
        "rpmfrontleft",
        "frontleftrpm",
      ]),
      rpm_right: getNumber(normalizedRow, [
        "rpmfrontrpmright",
        "rpmfrontright",
        "frontrightrpm",
      ]),
    },
    rpm_back: {
      ts: getTimestamp(normalizedRow, index, ["rpmbackts"], globalTs),
      rpm_left: getNumber(normalizedRow, [
        "rpmbackrpmleft",
        "rpmbackleft",
        "rearleftrpm",
        "backleftrpm",
      ]),
      rpm_right: getNumber(normalizedRow, [
        "rpmbackrpmright",
        "rpmbackright",
        "rearrightrpm",
        "backrightrpm",
      ]),
    },
    gps: {
      ts: getTimestamp(normalizedRow, index, ["gpsts", "locationts"], globalTs),
      lat: getNumber(
        normalizedRow,
        ["gpslat", "lat", "latitude"],
        DEFAULT_LATITUDE,
      ),
      long: getNumber(
        normalizedRow,
        ["gpslong", "long", "lng", "lon", "longitude"],
        DEFAULT_LONGITUDE,
      ),
      heading: getNumber(normalizedRow, ["gpsheading", "heading"]),
      speed: gpsSpeed,
    },
    motor: {
      ts: getTimestamp(normalizedRow, index, ["motorts"], globalTs),
      rpm: getNumber(normalizedRow, ["motorrpm", "rpm"]),
      duty_cycle: getNumber(normalizedRow, [
        "motordutycycle",
        "motorthrottle",
        "dutycycle",
        "duty",
      ]),
    },
    filtered: {
      speed: filteredSpeed,
    },
    latency_ms: getNullableNumber(normalizedRow, ["latencyms", "latency"]),
  };
}

export function mapRosbagRowToSocketData(
  row: Record<string, unknown>,
  index: number,
): SocketData {
  const csvLikeRow = Object.entries(row).reduce<CsvRow>(
    (record, [key, value]) => {
      record[key] = value == null ? "" : String(value);
      return record;
    },
    {},
  );

  return mapCsvRowToSocketData(csvLikeRow, index);
}

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getNumber(
  row: Record<string, string>,
  aliases: string[],
  fallback = 0,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function getNullableNumber(
  row: Record<string, string>,
  aliases: string[],
): number | null {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function getSpeedMetersPerSecond(
  row: Record<string, string>,
  aliases: string[],
  fallback = 0,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    if (alias.includes("mph")) {
      return parsed / MPH_PER_MPS;
    }

    return parsed;
  }

  return fallback;
}

export function getTimestamp(
  row: Record<string, string>,
  index: number,
  aliases = [
    "globalts",
    "timestamp",
    "ts",
    "time",
    "stamp",
    "stampns",
    "stampus",
    "timems",
    "timeus",
  ],
  fallback?: number,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    return parsed;
  }

  return fallback ?? (index + 1) * 100000;
}
