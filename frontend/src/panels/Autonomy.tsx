/** Existing signals and recording-linked metrics consolidated from InteractiveGrid. */
import { useEffect, useState, type ReactNode } from "react";
import { GaugeContainer } from "@mui/x-charts/Gauge";
import { LinearProgress } from "@mui/material";
import Controls from "../Controls";
import type { SocketData } from "../types";
import {
  calculateEfficiency,
  calculateEnergyKilowattHoursBetween,
  calculateLocalTangentDistanceMeters,
  calculatePowerKilowatts,
  formatDistanceMiles,
  formatEfficiency,
  formatEnergyWattHours,
  formatRunTimer,
  formatDuty,
  formatValue,
  isValidGpsCoordinate,
  metersToMiles,
} from "../data";

const SPEEDOMETER_MAX_MPH = 40;

type RunAverageState = {
  average: number | null;
  sampleCount: number;
  lastProcessedTimestamp: number | null;
};

type RunSummaryState = {
  distanceMeters: number;
  energyKilowattHours: number;
  lastGpsLatitude: number | null;
  lastGpsLongitude: number | null;
  lastPowerKilowatts: number | null;
  lastSpeed: number | null;
};

type RunSessionState = RunAverageState &
  RunSummaryState & {
    startTimestamp: number | null;
    isRunning: boolean;
  };

export default function Autonomy({
  data,
  history,
  children,
}: {
  data: SocketData[];
  history: SocketData[];
  children: (views: {
    speed: ReactNode;
    summary: ReactNode;
    signals: ReactNode;
  }) => ReactNode;
}) {
  const latest = history[history.length - 1] ?? null;
  const latestTimestamp = latest?.global_ts ?? null;
  const latestSpeed = (latest?.filtered.speed ?? 0) * 2.23694;
  const latestPowerKw = latest ? calculatePowerKilowatts(latest) : 0;
  const instantEfficiency = latest ? calculateEfficiency(latest) : null;

  const [warn, setWarn] = useState<{
    value: boolean;
    message: string;
    timerId: number | null;
  }>({
    value: false,
    message: "",
    timerId: null,
  });

  const [runSession, setRunSession] = useState<RunSessionState>({
    startTimestamp: null,
    isRunning: false,
    average: null,
    sampleCount: 0,
    lastProcessedTimestamp: null,
    distanceMeters: 0,
    energyKilowattHours: 0,
    lastGpsLatitude: null,
    lastGpsLongitude: null,
    lastPowerKilowatts: null,
    lastSpeed: null,
  });

  const runTimerTimestamp = runSession.isRunning
    ? latestTimestamp
    : runSession.lastProcessedTimestamp;
  const runTimerLabel =
    runSession.startTimestamp !== null && runTimerTimestamp !== null
      ? formatRunTimer(runSession.startTimestamp, runTimerTimestamp)
      : "0:00.0";

  const runDistanceMiles = metersToMiles(runSession.distanceMeters);
  const runEfficiencyRatio =
    runSession.energyKilowattHours > 0
      ? runDistanceMiles / runSession.energyKilowattHours
      : null;

  useEffect(() => {
    if (!runSession.isRunning || runSession.lastProcessedTimestamp === null) {
      return;
    }

    const lastProcessedTimestamp = runSession.lastProcessedTimestamp;
    const incomingSamples = data.filter(
      (sample) => sample.global_ts > lastProcessedTimestamp,
    );

    if (incomingSamples.length === 0) {
      return;
    }

    setRunSession((previous) => {
      if (!previous.isRunning || previous.lastProcessedTimestamp === null) {
        return previous;
      }

      const previousLastProcessedTimestamp = previous.lastProcessedTimestamp;
      const pendingSamples = incomingSamples.filter(
        (sample) => sample.global_ts > previousLastProcessedTimestamp,
      );

      if (pendingSamples.length === 0) {
        return previous;
      }

      let average = previous.average;
      let sampleCount = previous.sampleCount;
      let lastProcessedTimestamp = previous.lastProcessedTimestamp;
      let distanceMeters = previous.distanceMeters;
      let energyKilowattHours = previous.energyKilowattHours;
      let lastGpsLatitude = previous.lastGpsLatitude;
      let lastGpsLongitude = previous.lastGpsLongitude;
      let lastPowerKilowatts = previous.lastPowerKilowatts;
      let lastSpeed = previous.lastSpeed;

      for (const sample of pendingSamples) {
        const currentTimestamp = sample.global_ts;
        const currentPowerKilowatts = calculatePowerKilowatts(sample);

        if (lastPowerKilowatts !== null) {
          energyKilowattHours += calculateEnergyKilowattHoursBetween(
            lastPowerKilowatts,
            currentPowerKilowatts,
            lastProcessedTimestamp,
            currentTimestamp,
          );
        }

        lastSpeed = Math.max(sample.filtered.speed, lastSpeed ?? 0);
        lastPowerKilowatts = currentPowerKilowatts;

        const currentLatitude = sample.gps.lat;
        const currentLongitude = sample.gps.long;

        if (isValidGpsCoordinate(currentLatitude, currentLongitude)) {
          if (lastGpsLatitude !== null && lastGpsLongitude !== null) {
            distanceMeters += calculateLocalTangentDistanceMeters(
              lastGpsLatitude,
              lastGpsLongitude,
              currentLatitude,
              currentLongitude,
            );
          }

          lastGpsLatitude = currentLatitude;
          lastGpsLongitude = currentLongitude;
        }

        lastProcessedTimestamp = currentTimestamp;

        const efficiency = calculateEfficiency(sample);

        if (efficiency === null) {
          continue;
        }

        sampleCount += 1;
        average =
          average === null
            ? efficiency
            : average + (efficiency - average) / sampleCount;
      }

      return {
        ...previous,
        average,
        sampleCount,
        lastProcessedTimestamp,
        distanceMeters,
        energyKilowattHours,
        lastGpsLatitude,
        lastGpsLongitude,
        lastPowerKilowatts,
        lastSpeed,
      };
    });
  }, [data, runSession.isRunning, runSession.lastProcessedTimestamp]);

  const showWarning = (message: string) => {
    if (warn.timerId) clearTimeout(warn.timerId);

    setWarn({
      value: true,
      message,
      timerId: window.setTimeout(() => {
        setWarn((prev) => {
          return { ...prev, value: false, timerId: null };
        });
      }, 1500),
    });
  };

  const startRunTracking = () => {
    if (latestTimestamp === null) {
      return;
    }

    const startingAverage = instantEfficiency;
    const startingLatitude = latest?.gps.lat ?? null;
    const startingLongitude = latest?.gps.long ?? null;

    const hasValidStartingGps =
      startingLatitude !== null &&
      startingLongitude !== null &&
      isValidGpsCoordinate(startingLatitude, startingLongitude);

    setRunSession({
      startTimestamp: latestTimestamp,
      isRunning: true,
      average: startingAverage,
      sampleCount: startingAverage === null ? 0 : 1,
      lastProcessedTimestamp: latestTimestamp,
      distanceMeters: 0,
      energyKilowattHours: 0,
      lastGpsLatitude: hasValidStartingGps ? startingLatitude : null,
      lastGpsLongitude: hasValidStartingGps ? startingLongitude : null,
      lastPowerKilowatts: latestPowerKw,
      lastSpeed: 0,
    });
  };

  const stopRunTracking = () => {
    setRunSession((previous) => {
      return {
        ...previous,
        isRunning: false,
      };
    });
  };

  return children({
    speed: (
      <div className="flex h-full max-h-full flex-col justify-end gap-0 xl:gap-3">
        <div className="flex flex-wrap items-center justify-center xl:flex-nowrap">
          <GaugeContainer
            width={180}
            height={180}
            startAngle={-110}
            endAngle={110}
            value={
              Math.max(0, Math.min(latestSpeed, SPEEDOMETER_MAX_MPH)) *
              (100 / SPEEDOMETER_MAX_MPH)
            }
            sx={{ flexWrap: "wrap" }}
          >
            <GaugePointer />
          </GaugeContainer>

          <div className="mb-3 flex flex-1 flex-col items-center text-right xl:items-end">
            <strong className="text-5xl leading-none font-semibold tabular-nums text-white lg:text-4xl 2xl:text-6xl">
              {formatValue(latestSpeed, 1)}
            </strong>
            <span className="mt-1 text-sm uppercase tracking-[0.2em] text-white/55">
              MPH
            </span>
          </div>
        </div>

        <div className="h-1/3">
          <MetricPanel
            label="Max"
            value={
              runSession.lastSpeed
                ? `${formatValue(runSession.lastSpeed * 2.23694, 1)} mph`
                : "--"
            }
            helper={
              runSession.isRunning
                ? "Recorder Active"
                : "start recording to track"
            }
          />
        </div>
      </div>
    ),
    summary: (
      <div className="flex h-full flex-col justify-between gap-4 lg:gap-2">
        <div className="grid grid-cols-2 gap-3">
          <MetricPanel
            label="Instant Efficiency"
            value={
              instantEfficiency
                ? instantEfficiency >= 100
                  ? "MAX"
                  : `${formatEfficiency(instantEfficiency)}`
                : "--"
            }
            helper={
              instantEfficiency
                ? instantEfficiency >= 100
                  ? `${formatEfficiency(instantEfficiency)}`
                  : "speed / power"
                : "no data to display"
            }
          />

          <MetricPanel
            label="Average Efficiency"
            value={
              runSession.energyKilowattHours > 0
                ? formatEfficiency(runEfficiencyRatio)
                : "--"
            }
            helper={
              runSession.energyKilowattHours > 0
                ? runSession.isRunning
                  ? "distance / energy"
                  : "distance / energy (last run)"
                : runSession.isRunning
                  ? "waiting for distance + energy"
                  : "start recording to track"
            }
          />

          <MetricPanel
            label="Distance"
            value={
              runSession.startTimestamp
                ? formatDistanceMiles(runDistanceMiles)
                : "--"
            }
            helper={
              runSession.startTimestamp !== null
                ? runSession.isRunning
                  ? "local tangent plane"
                  : "last recorded run"
                : "start recording to track"
            }
          />

          <MetricPanel
            label="Energy Used"
            value={
              runSession.startTimestamp
                ? formatEnergyWattHours(runSession.energyKilowattHours * 1000)
                : "--"
            }
            helper={
              runSession.startTimestamp !== null
                ? runSession.isRunning
                  ? "trapezoid estimate"
                  : "last recorded run"
                : "start recording to track"
            }
          />
        </div>

        <div className="flex items-center justify-between gap-0 rounded-[0.95rem] border border-white/8 bg-white/4 px-3 py-2.5 sm:gap-2">
          <strong className="text-3xl leading-none font-semibold tabular-nums text-white sm:5xl 2xl:text-6xl">
            {runTimerLabel}
          </strong>

          <p
            className={`wrap hidden overflow-x-scroll text-center text-sm text-white/55 opacity-0 transition-opacity duration-1000 ease-in-out [scrollbar-width:none] [-ms-overflow-style:none] sm:block lg:hidden xl:block [&::-webkit-scrollbar]:hidden ${warn.value ? "opacity-100" : "opacity-0"}`}
          >
            {warn.message}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <Controls
              recording={{
                onStart: startRunTracking,
                onStop: stopRunTracking,
                onError: showWarning,
              }}
              autonomy={{ onError: showWarning }}
            />
          </div>
        </div>
      </div>
    ),
    signals: (
      <div className="grid h-full grid-cols-2 gap-3 rows-auto-fr">
        <SignalTile
          label="Duty Cycle"
          value={`${formatDuty(latest?.motor.duty_cycle ?? 0)}%`}
        >
          <LinearProgress
            variant="determinate"
            value={Math.min(
              latest?.motor.duty_cycle
                ? Math.abs(latest.motor.duty_cycle * 100)
                : 0,
              100,
            )}
            sx={{
              height: 10,
              borderRadius: 2,
            }}
          />
        </SignalTile>

        <SignalTile
          label="Brake"
          value={`${Math.round(latest?.steering.brake_pressure ?? 0)} PSI`}
        >
          <LinearProgress
            variant="determinate"
            value={Math.min(
              latest?.steering.brake_pressure
                ? latest.steering.brake_pressure / 6
                : 0,
              100,
            )}
            sx={{
              height: 10,
              borderRadius: 2,
            }}
          />
        </SignalTile>

        <SignalTile label="Power">
          <div className="grid h-full grid-rows-2 gap-3 rows-auto-fr">
            <SignalTile
              label="Current"
              value={`${formatValue(latest?.power.current ?? 0, 1)} A`}
            />
            <SignalTile
              label="Voltage"
              value={`${formatValue(latest?.power.voltage ?? 0, 1)} V`}
            />
          </div>
        </SignalTile>

        <SignalTile label="RPM">
          <div className="grid h-full grid-rows-2 gap-3 rows-auto-fr">
            <SignalTile
              label="Left"
              value={`${formatValue(latest?.rpm_back.rpm_left ?? 0, 0)}`}
            />
            <SignalTile
              label="Right"
              value={`${formatValue(latest?.rpm_back.rpm_right ?? 0, 0)}`}
            />
          </div>
        </SignalTile>
      </div>
    ),
  });
}

export function SignalTile({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col justify-between rounded-[0.95rem] border border-white/8 bg-white/4 px-3 py-2.5 text-left gap-1">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
        {label}
      </div>
      {children}
      {value ? (
        <div className="mt-2 text-lg font-semibold leading-tight text-white xl:text-xl tabular-nums">
          {value}
        </div>
      ) : null}
    </div>
  );
}

export function MetricPanel({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[0.95rem] border border-white/8 bg-black/18 px-3 py-2.5 text-left">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/42">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none text-white xl:text-3xl tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-white/55">{helper}</div>
    </div>
  );
}

// The original inactive pointer implementation is preserved below.

export function GaugePointer() {
  return null;
  /** 
  const { valueAngle, outerRadius, cx, cy } = useGaugeState();

  if (valueAngle === null) {
    return null;
  }

  const target = {
    x: cx + outerRadius * Math.sin(valueAngle),
    y: cy - outerRadius * Math.cos(valueAngle),
  };

  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#c41e3a" />
      <path
        d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
        stroke="#c41e3a"
        strokeWidth={3}
      />
    </g>
  );

  */
}
