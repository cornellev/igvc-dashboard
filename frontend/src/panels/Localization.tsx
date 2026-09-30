/** Full legacy map and chart implementations, grouped under localization. */
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
} from "@vis.gl/react-google-maps";
import { LineChart } from "@mui/x-charts";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import mapImage from "../assets/map.jpg";
import type { SocketData } from "../types";
import {
  calculatePowerKilowatts,
  formatElapsed,
  formatValue,
  roundTo,
  TIMESTAMP_UNITS_PER_SECOND,
} from "../data";

interface Location {
  lat: number;
  lng: number;
}

/**
 * Location Options
 * @key "B-Lot"
 * @key "Indianapolis Motor Speedway"
 */
const locations: Record<string, Location> = {
  "B-Lot": { lat: 42.44656683714592, lng: -76.4630167437453 },
  "Indianapolis Motor Speedway": {
    lat: 39.79511968382295,
    lng: -86.23477335003211,
  },
};

const IMS_TURN_MARKERS = [
  { id: 1, lat: 39.79979, lng: -86.2385 },
  { id: 2, lat: 39.799889, lng: -86.237867 },
  { id: 3, lat: 39.80037913540656, lng: -86.23760192842447 },
  { id: 4, lat: 39.801163421941126, lng: -86.23585301585724 },
  { id: 5, lat: 39.799488293418236, lng: -86.23539460045293 },
  { id: 6, lat: 39.79902455557395, lng: -86.23514440526584 },
  { id: 7, lat: 39.79236342353246, lng: -86.23463847050992 },
  { id: 8, lat: 39.792192922155095, lng: -86.23324845441954 },
  { id: 9, lat: 39.791596164009725, lng: -86.2326769568461 },
  { id: 10, lat: 39.791533431721575, lng: -86.23125135300353 },
  { id: 11, lat: 39.788861077810736, lng: -86.23156241589633 },
  { id: 12, lat: 39.78827959633701, lng: -86.23528251099486 },
  { id: 13, lat: 39.789553967953125, lng: -86.23556880408972 },
  { id: 14, lat: 39.789262796749206, lng: -86.2375730529455 },
] as const;

const IMS_FLAG_MARKERS = [
  {
    id: "green-flag1",
    lat: 39.793509866527366,
    lng: -86.2388742590957,
    label: "Start",
    variant: "green" as const,
  },
  {
    id: "green-flag2",
    lat: 39.793599,
    lng: -86.234911,
    label: "Halfway",
    variant: "green" as const,
  },
  {
    id: "checkered-flag",
    lat: 39.793164176215356,
    lng: -86.23886986975018,
    label: "Finish",
    variant: "checkered" as const,
  },
] as const;

const locationOptions = ["B-Lot", "Indianapolis Motor Speedway"] as const;
type TrackLocation = (typeof locationOptions)[number];

function isValidCoordinate(value: number | null, min: number, max: number) {
  return (
    value !== null && Number.isFinite(value) && value >= min && value <= max
  );
}

function isValidLatLng(latitude: number | null, longitude: number | null) {
  return (
    isValidCoordinate(latitude, -90, 90) &&
    isValidCoordinate(longitude, -180, 180)
  );
}

export const MapComponent = ({
  latitude,
  longitude,
  className = "",
}: {
  latitude: number | null;
  longitude: number | null;
  interactive?: boolean;
  className?: string;
}) => {
  const [selectedLocation, setSelectedLocation] = useState<TrackLocation>(
    "Indianapolis Motor Speedway",
  );
  const mapCenter = locations[selectedLocation];
  const hasLivePosition = isValidLatLng(latitude, longitude);
  const position = {
    lat: hasLivePosition ? (latitude as number) : mapCenter.lat,
    lng: hasLivePosition ? (longitude as number) : mapCenter.lng,
  };
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID";

  const [heading, setHeading] = useState(180);
  const [isDragging, setIsDragging] = useState(false);
  const lastX = useRef<number | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  const [zoom, setZoom] = useState(16);
  const minZoom = 14;
  const maxZoom = 20;
  const showImsMarkers = selectedLocation === "Indianapolis Motor Speedway";

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    setZoom((prev) => {
      let delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newZoom = prev + delta;
      if (newZoom < minZoom) newZoom = minZoom;
      if (newZoom > maxZoom) newZoom = maxZoom;
      return newZoom;
    });
  };

  useEffect(() => {
    const container = document.getElementById("map-container");
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((prev) => {
        let delta = e.deltaY < 0 ? 0.1 : -0.1;
        let newZoom = prev + delta;
        if (newZoom < minZoom) newZoom = minZoom;
        if (newZoom > maxZoom) newZoom = maxZoom;
        return newZoom;
      });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    if (hasLivePosition) {
      setIsPulsing(true);

      const timeout = setTimeout(() => {
        setIsPulsing(false);
      }, 800); // duration of pulse

      return () => clearTimeout(timeout);
    }
  }, [hasLivePosition, latitude, longitude]);

  if (!apiKey) {
    return (
      <div
        className={`relative h-full w-full overflow-hidden rounded-[1.1rem] ${className}`}
      >
        <img
          src={mapImage}
          alt="Track map fallback"
          className="h-full w-full object-cover opacity-80"
        />
        <div className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div
        id="map-container"
        className={`relative h-full w-full overflow-hidden rounded-[1.1rem] cursor-grab hover:cursor-grabbing ${className}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
          lastX.current = e.clientX;
          if (e.button === 2) {
            e.preventDefault();
            setSelectedLocation((prev) =>
              prev === "B-Lot" ? "Indianapolis Motor Speedway" : "B-Lot",
            );
          }
        }}
        onMouseUp={() => {
          setIsDragging(false);
          lastX.current = null;
        }}
        onMouseLeave={() => setIsDragging(false)}
        onMouseMove={(e) => {
          if (!isDragging || lastX.current === null) return;

          const deltaX = e.clientX - lastX.current;
          lastX.current = e.clientX;

          setHeading((h) => (h + deltaX * 0.5) % 360); // sensitivity tweak
        }}
        onWheel={handleWheel}
      >
        <GoogleMap
          center={mapCenter}
          defaultZoom={16}
          zoom={zoom}
          gestureHandling="none"
          disableDefaultUI
          keyboardShortcuts={false}
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
          defaultHeading={180}
          heading={heading}
          tilt={25}
          mapId={mapId}
          options={{
            clickableIcons: false,
          }}
        >
          {showImsMarkers
            ? IMS_TURN_MARKERS.map((marker) => (
                <AdvancedMarker
                  key={`turn-${marker.id}`}
                  position={{ lat: marker.lat, lng: marker.lng }}
                  anchorLeft="-50%"
                  anchorTop="-50%"
                >
                  <TurnMarkerLabel turn={marker.id} zoom={zoom} />
                </AdvancedMarker>
              ))
            : null}
          {showImsMarkers
            ? IMS_FLAG_MARKERS.map((marker) => (
                <AdvancedMarker
                  key={marker.id}
                  position={{ lat: marker.lat, lng: marker.lng }}
                  anchorLeft="-50%"
                  anchorTop="-85%"
                >
                  <FlagMarker
                    label={marker.label}
                    variant={marker.variant}
                    zoom={zoom}
                  />
                </AdvancedMarker>
              ))
            : null}
          <AdvancedMarker
            position={position}
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <div className="relative">
              {/* glow */}
              <div
                className={`
                  absolute h-6 w-6 rounded-full
                  bg-blue-400 blur-md transition-all duration-300
                  ${isPulsing ? "opacity-90 scale-105" : "opacity-40 scale-100"}
                `}
              />
              {/* core dot */}
              <div
                className={`
                  ${zoom >= 16 ? "h-3 w-3" : "h-2 w-2"} rounded-full
                  bg-blue-500 border-2 border-white
                  transition-transform duration-300
                  ${isPulsing ? "scale-105" : "scale-100"}
                `}
              />
              {/* ripple effect */}
              {isPulsing && (
                <div className="absolute h-7 w-7 top-1/2 left-1/2 translate-x-[-50%] translate-y-[-50%] rounded-full bg-blue-400 opacity-50 animate-ping" />
              )}
            </div>
          </AdvancedMarker>
        </GoogleMap>
      </div>
    </APIProvider>
  );
};

function TurnMarkerLabel({ turn, zoom }: { turn: number; zoom: number }) {
  const isClose = zoom >= 14;

  return (
    <div
      className={`flex items-center justify-center rounded-full border border-white/80 bg-slate-950/88 font-semibold text-white shadow-[0_4px_14px_rgba(0,0,0,0.32)] backdrop-blur-sm ${
        isClose
          ? "h-3 min-w-3 px-px text-[8px]"
          : "h-3 min-w-3 px-px text-[8px]"
      }`}
      aria-label={`Turn ${turn}`}
      title={`Turn ${turn}`}
    >
      {turn}
    </div>
  );
}

function FlagMarker({
  label,
  variant,
  zoom,
}: {
  label: string;
  variant: "green" | "checkered";
  zoom: number;
}) {
  const isClose = zoom >= 14;
  const badgeClass = isClose ? "h-2.5 w-2.5" : "h-2.5 w-2.5";

  return (
    <div
      className="flex flex-col items-center"
      aria-label={label}
      title={label}
    >
      <div className="relative">
        <div
          className={`relative ml-1 rounded-[3px] border border-white/75 shadow-[0_4px_12px_rgba(0,0,0,0.28)] ${badgeClass} ${
            variant === "green"
              ? "bg-emerald-500"
              : "bg-[conic-gradient(from_90deg,#ffffff_0_25%,#111827_25%_50%,#ffffff_50%_75%,#111827_75%_100%)]"
          }`}
        />
      </div>
    </div>
  );
}

const chartSx = {
  ".MuiChartsAxis-root .MuiChartsAxis-line": {
    stroke: "rgba(255,255,255,0.2)",
  },
  ".MuiChartsAxis-root text": {
    fill: "rgba(255,255,255,0.78)",
  },
  ".MuiChartsAxis-tickLabel": {
    fill: "rgba(255,255,255,0.72)",
    fontSize: 11,
  },
  ".MuiChartsAxis-label": {
    fill: "rgba(255,255,255,0.82)",
  },
  ".MuiChartsGrid-line": {
    stroke: "rgba(255,255,255,0.08)",
  },
};

type SecondarySeries = {
  data: number[];
  currentValue: string;
  unit: string;
  accentColor: string;
  yMax?: number;
};

export function CompactChart({
  data,
  rawTimestamps,
  labels,
  timestamps,
  currentValue,
  unit,
  accentColor,
  yMax,
  secondarySeries,
  isPaused,
  onTogglePause,
}: {
  data: number[];
  rawTimestamps: number[];
  labels: string[];
  timestamps: string[];
  currentValue: string;
  unit: string;
  accentColor: string;
  yMax?: number;
  secondarySeries?: SecondarySeries;
  isPaused: boolean;
  onTogglePause: () => void;
}) {
  const latestPointOnly = data.map((value, index) =>
    index === data.length - 1 ? value : null,
  );
  const secondaryLatestPointOnly = secondarySeries?.data.map((value, index) =>
    index === secondarySeries.data.length - 1 ? value : null,
  );

  const [selectedTimestamps, setSelectedTimestamps] = useState<number[]>([]);

  const sparseTickValues = getSparseTickValues(labels);
  const pauseButtonLabel = isPaused ? "Resume" : "Pause";
  const PauseButtonIcon = isPaused ? PlayArrowRoundedIcon : PauseRoundedIcon;

  const formatTimestampLabel = (value: string) => {
    const index = Number.parseInt(value, 10);
    return Number.isNaN(index) ? value : (timestamps[index] ?? "");
  };

  const orderedSelectedIndexes = getOrderedSelectedIndexes(
    selectedTimestamps,
    rawTimestamps,
  );

  const selectedPointSeries = data.map((value, index) =>
    orderedSelectedIndexes.includes(index) ? value : null,
  );

  const selectedSlopeSeries =
    orderedSelectedIndexes.length === 2
      ? data.map((value, index) =>
          orderedSelectedIndexes.includes(index) ? value : null,
        )
      : [];

  const secondarySelectedSlopeSeries =
    orderedSelectedIndexes.length === 2 && secondarySeries
      ? secondarySeries.data.map((value, index) =>
          orderedSelectedIndexes.includes(index) ? value : null,
        )
      : [];

  const secondarySelectedPointSeries = secondarySeries
    ? secondarySeries.data.map((value, index) =>
        orderedSelectedIndexes.includes(index) ? value : null,
      )
    : [];

  const primarySlopeMeasurement =
    orderedSelectedIndexes.length === 2
      ? calculateSlopeMeasurement(
          orderedSelectedIndexes[0],
          orderedSelectedIndexes[1],
          data,
          rawTimestamps,
          unit,
        )
      : null;

  const secondarySlopeMeasurement =
    orderedSelectedIndexes.length === 2 && secondarySeries
      ? calculateSlopeMeasurement(
          orderedSelectedIndexes[0],
          orderedSelectedIndexes[1],
          secondarySeries.data,
          rawTimestamps,
          secondarySeries.unit,
        )
      : null;

  useEffect(() => {
    setSelectedTimestamps((previous) => {
      if (previous.length === 0) {
        return previous;
      }

      if (rawTimestamps.length === 0) {
        return [];
      }

      const minTimestamp = rawTimestamps[0];
      const maxTimestamp = rawTimestamps[rawTimestamps.length - 1];
      const availableTimestamps = new Set(rawTimestamps);
      const next = previous.filter(
        (timestamp) =>
          Number.isFinite(timestamp) &&
          timestamp >= minTimestamp &&
          timestamp <= maxTimestamp &&
          availableTimestamps.has(timestamp),
      );

      return next.length === previous.length ? previous : next;
    });
  }, [rawTimestamps]);

  useEffect(() => {
    if (!isPaused) {
      setSelectedTimestamps([]);
    }
  }, [isPaused, unit]);

  const handleAxisClick = (
    _event: MouseEvent,
    axisData: { dataIndex: number } | null,
  ) => {
    if (!axisData || !Number.isInteger(axisData.dataIndex)) {
      return;
    }

    const clickedIndex = axisData.dataIndex;

    if (clickedIndex < 0 || clickedIndex >= data.length) {
      return;
    }

    const clickedTimestamp = rawTimestamps[clickedIndex];

    if (!Number.isFinite(clickedTimestamp)) {
      return;
    }

    setSelectedTimestamps((previous) => {
      if (previous.length === 2) {
        return [];
      }

      if (previous.includes(clickedTimestamp)) {
        return [];
      }

      return [...previous, clickedTimestamp];
    });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      <div className="pointer-events-none absolute inset-x-3 top-1 z-10 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className={`rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs ${primarySlopeMeasurement ? "opacity-100" : "opacity-0 pointer-events-none"} font-medium text-white/88`}
          >
            {primarySlopeMeasurement?.label ?? "+0.00 mph/s"}
          </div>
          <div
            className={`rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs ${secondarySlopeMeasurement ? "opacity-100" : "opacity-0 pointer-events-none"} font-medium text-white/88`}
          >
            {secondarySlopeMeasurement?.label ?? "+0.00 kW/s"}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium text-white/88">
            {currentValue}
          </div>

          {secondarySeries && (
            <div className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium text-white/88">
              {secondarySeries.currentValue}
            </div>
          )}
          <button
            type="button"
            aria-label={pauseButtonLabel}
            title={pauseButtonLabel}
            className="play-button rounded-fullp-0 text-xs font-medium text-white focus:outline-none hover:outline-none hover:border-0"
            onClick={onTogglePause}
          >
            <PauseButtonIcon sx={{ fontSize: 18 }} />
          </button>
        </div>
      </div>

      <LineChart
        margin={{
          top: 40,
          right: secondarySeries ? 20 : 8,
          bottom: 10,
          left: 10,
        }}
        height={220}
        grid={{ horizontal: true }}
        xAxis={[
          {
            scaleType: "point",
            data: labels,
            height: 28,
            valueFormatter: (value) => formatTimestampLabel(value),
            tickInterval: sparseTickValues,
            disableLine: true,
            disableTicks: true,
          },
        ]}
        yAxis={[
          {
            id: "primary",
            min: 0,
            max: yMax,
            width: 36,
            disableTicks: true,
            valueFormatter: (value: number) => (value === 0 ? "" : `${value}`),
          },
          ...(secondarySeries
            ? [
                {
                  id: "secondary",
                  min: 0,
                  max: secondarySeries.yMax,
                  position: "right" as const,
                  width: 36,
                  disableTicks: true,
                  valueFormatter: (value: number) =>
                    value === 0 ? "" : `${value}`,
                },
              ]
            : []),
        ]}
        series={[
          {
            id: "primary-series",
            data,
            color: accentColor,
            showMark: false,
            area: true,
            yAxisId: "primary",
            valueFormatter: (value) =>
              value === null ? null : `${value} ${unit}`,
          },
          {
            id: "primary-latest",
            data: latestPointOnly,
            color: accentColor,
            showMark: true,
            curve: "linear",
            yAxisId: "primary",
            valueFormatter: () => null,
          },
          ...(orderedSelectedIndexes.length === 2
            ? [
                {
                  id: "primary-slope-line",
                  data: selectedSlopeSeries,
                  color: accentColor + "99",
                  showMark: false,
                  curve: "linear" as const,
                  connectNulls: true,
                  yAxisId: "primary",
                  valueFormatter: () => null,
                },
              ]
            : []),
          ...(orderedSelectedIndexes.length > 0
            ? [
                {
                  id: "primary-selection-points",
                  data: selectedPointSeries,
                  color: accentColor + "99",
                  showMark: true,
                  curve: "linear" as const,
                  yAxisId: "primary",
                  valueFormatter: () => null,
                },
              ]
            : []),
          ...(secondarySeries
            ? [
                {
                  id: "secondary-series",
                  data: secondarySeries.data,
                  color: secondarySeries.accentColor,
                  showMark: false,
                  curve: "linear" as const,
                  yAxisId: "secondary",
                  valueFormatter: (value: number | null) =>
                    value === null ? null : `${value} ${secondarySeries.unit}`,
                },
                {
                  id: "secondary-latest",
                  data: secondaryLatestPointOnly ?? [],
                  color: secondarySeries.accentColor,
                  showMark: true,
                  curve: "linear" as const,
                  yAxisId: "secondary",
                  valueFormatter: () => null,
                },
                ...(orderedSelectedIndexes.length === 2
                  ? [
                      {
                        id: "secondary-slope-line",
                        data: secondarySelectedSlopeSeries,
                        color: secondarySeries.accentColor,
                        showMark: false,
                        curve: "linear" as const,
                        connectNulls: true,
                        yAxisId: "secondary",
                        valueFormatter: () => null,
                      },
                    ]
                  : []),
                ...(orderedSelectedIndexes.length > 0
                  ? [
                      {
                        id: "secondary-selection-points",
                        data: secondarySelectedPointSeries,
                        color: secondarySeries.accentColor,
                        showMark: true,
                        curve: "linear" as const,
                        yAxisId: "secondary",
                        valueFormatter: () => null,
                      },
                    ]
                  : []),
              ]
            : []),
        ]}
        sx={{
          ...chartSx,
          "& .MuiLineElement-series-secondary-series": {
            strokeDasharray: "6 4",
          },
          "& .MuiLineElement-series-primary-slope-line": {
            strokeWidth: 2.5,
            opacity: 0.95,
          },
          "& .MuiLineElement-series-secondary-slope-line": {
            strokeWidth: 2.5,
            opacity: 0.95,
          },
          "& .MuiMarkElement-root": {
            strokeWidth: 2,
            r: 4,
          },
          "& .MuiMarkElement-series-primary-latest": {
            fill: "#ffffff",
            stroke: accentColor,
          },
          "& .MuiMarkElement-series-primary-selection-points": {
            fill: accentColor,
            stroke: accentColor,
            strokeWidth: 0,
            r: 5,
          },
          ...(secondarySeries
            ? {
                "& .MuiMarkElement-series-secondary-latest": {
                  fill: "#ffffff",
                  stroke: secondarySeries.accentColor,
                },
                "& .MuiMarkElement-series-secondary-selection-points": {
                  fill: secondarySeries.accentColor,
                  stroke: secondarySeries.accentColor,
                  strokeWidth: 0,
                  r: 5,
                },
              }
            : {}),
          "& .MuiAreaElement-root": {
            fillOpacity: 0.2,
          },
        }}
        slotProps={{
          tooltip: {
            sx: {
              "& .MuiChartsTooltip-table": {
                backgroundColor: "#1e1e1e",
              },
            },
          },
        }}
        onAxisClick={handleAxisClick}
        skipAnimation
      />
    </div>
  );
}

function getOrderedSelectedIndexes(
  selectedTimestamps: number[],
  rawTimestamps: number[],
) {
  if (selectedTimestamps.length === 0 || rawTimestamps.length === 0) {
    return [];
  }

  const timestampToIndex = new Map<number, number>();

  rawTimestamps.forEach((timestamp, index) => {
    if (Number.isFinite(timestamp) && !timestampToIndex.has(timestamp)) {
      timestampToIndex.set(timestamp, index);
    }
  });

  const selectedIndexes = selectedTimestamps
    .map((timestamp) => timestampToIndex.get(timestamp))
    .filter((index): index is number => index !== undefined);

  return selectedIndexes.length === 2
    ? selectedIndexes.sort((left, right) => left - right)
    : selectedIndexes;
}

function getSparseTickValues(labels: string[], maxTicks = 5) {
  if (labels.length <= maxTicks) {
    return labels;
  }

  const step = Math.ceil((labels.length - 1) / (maxTicks - 1));
  const selectedIndexes = new Set<number>([0, labels.length - 1]);

  for (let index = step; index < labels.length - 1; index += step) {
    selectedIndexes.add(index);
  }

  return labels.filter((_, index) => selectedIndexes.has(index));
}

function calculateSlopeMeasurement(
  startIndex: number,
  endIndex: number,
  data: number[],
  rawTimestamps: number[],
  unit: string,
) {
  const startValue = data[startIndex];
  const endValue = data[endIndex];
  const startTimestamp = rawTimestamps[startIndex];
  const endTimestamp = rawTimestamps[endIndex];
  const elapsedSeconds =
    (endTimestamp - startTimestamp) / TIMESTAMP_UNITS_PER_SECOND;

  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(endTimestamp) ||
    elapsedSeconds <= 0
  ) {
    return null;
  }

  const slope = (endValue - startValue) / elapsedSeconds;

  if (!Number.isFinite(slope)) {
    return null;
  }

  return {
    value: slope,
    label: `${slope >= 0 ? "+" : ""}${roundTo(slope, 2)} ${unit}/s`,
  };
}

export function EmptyTelemetryState({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={`flex h-full items-center justify-center rounded-2xl border border-dashed border-white/12 bg-black/14 px-4 text-center text-sm text-white/52 ${compact ? "min-h-35" : "min-h-55"}`}
    >
      Waiting for live ROS telemetry from the backend websocket.
    </div>
  );
}

const SPEEDOMETER_MAX_MPH = 40;

export default function Localization({
  history,
  isChartPaused,
  onTogglePause,
  children,
}: {
  history: SocketData[];
  isChartPaused: boolean;
  onTogglePause: () => void;
  children: (views: { map: ReactNode; chart: ReactNode }) => ReactNode;
}) {
  const latest = history[history.length - 1] ?? null;
  const latestSpeed = (latest?.filtered.speed ?? 0) * 2.23694;
  const latestPowerKw = latest ? calculatePowerKilowatts(latest) : 0;
  const speedHistory = history.map((sample) =>
    roundTo(sample.filtered.speed, 1),
  );
  const powerHistory = history.map((sample) =>
    roundTo(calculatePowerKilowatts(sample), 2),
  );
  const xAxisLabels = history.map((_, index) => index.toString());
  const xAxisTimestamps = history.map((sample) =>
    formatElapsed(
      sample.global_ts,
      history[history.length - 1]?.global_ts ?? sample.global_ts,
    ),
  );
  return children({
    map: (
      <MapComponent
        latitude={latest?.gps.lat ?? null}
        longitude={latest?.gps.long ?? null}
        className="min-h-0"
      />
    ),
    chart:
      history.length > 0 ? (
        <CompactChart
          accentColor="#fb923c"
          currentValue={`${formatValue((speedHistory.reduce((accumulator, currentValue) => accumulator + currentValue) / (speedHistory.length > 0 ? speedHistory.length : 1)) * 2.23694, 1)} mph`}
          unit="mph"
          data={speedHistory.map((speed) => roundTo(speed * 2.23694, 1))}
          rawTimestamps={history.map((sample) => sample.global_ts)}
          timestamps={xAxisTimestamps}
          labels={xAxisLabels}
          isPaused={isChartPaused}
          onTogglePause={onTogglePause}
          yMax={Math.max(SPEEDOMETER_MAX_MPH, Math.ceil(latestSpeed / 10) * 10)}
          secondarySeries={{
            data: powerHistory,
            currentValue: `${formatValue(latestPowerKw, 2)} kW`,
            unit: "kW",
            accentColor: "#c41e3a99",
            yMax: Math.max(
              4.5,
              Math.ceil(Math.max(...powerHistory, latestPowerKw ?? 0)),
            ),
          }}
        />
      ) : (
        <EmptyTelemetryState compact />
      ),
  });
}
