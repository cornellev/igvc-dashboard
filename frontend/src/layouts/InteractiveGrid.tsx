import { useEffect, useMemo, useState } from "react";
import { GaugeContainer, GaugeReferenceArc } from "@mui/x-charts/Gauge";
import MapComponent from "../components/MapComponent";
import DashboardCard from "../components/DashboardCard";
import MetricPanel from "../components/MetricPanel";
import SignalTile from "../components/SignalTile";
import EmptyTelemetryState from "../components/EmptyTelemetryState";
import CompactChart from "../components/CompactChart";
import GaugePointer from "../components/GaugePointer";
import CameraFeed from "../components/CameraFeed";
import {
  AutonomyControlButton,
  RosbagControlButton,
  ToggleControlButton,
} from "../components/RunControlButtons";
import CostmapView from "../components/CostmapView";
import type { SocketData } from "../utils/Socket";
import { LinearProgress } from "@mui/material";
import {
  calculateEfficiency,
  calculateEnergyKilowattHoursBetween,
  calculateLapTimes,
  calculateLocalTangentDistanceMeters,
  calculatePowerKilowatts,
  formatDistanceMiles,
  formatEfficiency,
  formatElapsed,
  formatEnergyWattHours,
  formatRunTimer,
  formatDuty,
  formatValue,
  isValidGpsCoordinate,
  metersToMiles,
  roundTo,
} from "../utils/telemetry";

const HISTORY_LIMIT = 1200;
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
  lapTimes: number[];
};

type RunSessionState = RunAverageState &
  RunSummaryState & {
    startTimestamp: number | null;
    isRunning: boolean;
  };

export default function InteractiveGrid({
  data,
  mode = "live",
}: {
  data: SocketData[];
  mode?: "live" | "replay";
}) {
  const [isChartPaused, setIsChartPaused] = useState(false);
  const [pausedHistory, setPausedHistory] = useState<SocketData[]>([]);

  const history = useMemo(() => {
    if (isChartPaused) return pausedHistory;
    return data.slice(-HISTORY_LIMIT);
  }, [data, isChartPaused, pausedHistory]);

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
    lapTimes: [],
  });

  const runTimerTimestamp = runSession.isRunning
    ? latestTimestamp
    : runSession.lastProcessedTimestamp;
  const lapTimerTimestamp = runSession.isRunning
    ? (runSession.lastProcessedTimestamp ?? latestTimestamp)
    : (runSession.lastProcessedTimestamp ??
      runSession.lapTimes[runSession.lapTimes.length - 1] ??
      latestTimestamp);

  const runTimerLabel =
    runSession.startTimestamp !== null && runTimerTimestamp !== null
      ? formatRunTimer(runSession.startTimestamp, runTimerTimestamp)
      : "0:00.0";

  const runDistanceMiles = metersToMiles(runSession.distanceMeters);
  const runEfficiencyRatio =
    runSession.energyKilowattHours > 0
      ? runDistanceMiles / runSession.energyKilowattHours
      : null;

  const handlePauseChart = () => {
    setPausedHistory(data.slice(-HISTORY_LIMIT));
    setIsChartPaused(true);
  };

  const handleResumeChart = () => {
    setIsChartPaused(false);
  };

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

  const canStartRunTracking = () => {
    if (latestTimestamp === null) {
      console.warn("Cannot start run tracking without any telemetry data");
      showWarning("No data to record");
      return false;
    }

    return true;
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
      lapTimes: [],
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

  const toggleReplayRunTracking = () => {
    if (runSession.isRunning) {
      stopRunTracking();
      return;
    }

    if (canStartRunTracking()) {
      startRunTracking();
    }
  };

  const handleLap = () => {
    setRunSession((previous) => {
      if (previous.lastProcessedTimestamp === null) {
        return previous;
      }

      const lapTimes = [...previous.lapTimes, previous.lastProcessedTimestamp];

      return {
        ...previous,
        lapTimes,
      };
    });
  };

  return (
    <div className="grid min-h-full w-full grid-cols-1 gap-3 px-3 pt-2 pb-3.5 text-white sm:px-4 lg:grid-cols-12 lg:grid-rows-[minmax(100,1fr)_minmax(100,1fr)] lg:px-5">
      <DashboardCard
        className="min-h-42.5 auto-rows-fr lg:col-span-3 lg:row-start-1 lg:min-h-100"
        title="Speed"
      >
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
      </DashboardCard>

      <DashboardCard
        className="min-h-42.5 lg:col-span-5 lg:row-start-1 lg:min-h-100"
        title={`Run Summary${
          mode === "live" && latest?.latency_ms
            ? ` | Latency [${Math.round(Math.abs(latest.latency_ms))}ms]`
            : ""
        }`}
      >
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

          {runSession.lapTimes.length >= 1 ? (
            <div className="flex w-full justify-start px-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.26em] text-white/78">
                Laps
              </h2>

              <div className="flex flex-row-reverse justify-start overflow-x-scroll [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {calculateLapTimes(
                  runSession.lapTimes,
                  runSession.startTimestamp ?? 0,
                  lapTimerTimestamp ?? 0,
                ).map((lapTime) => {
                  return (
                    <p
                      key={`${lapTime.value}-${lapTime.color}`}
                      className={`ml-3 text-sm font-semibold uppercase tracking-[0.26em] ${lapTime.color}`}
                    >
                      {formatRunTimer(0, lapTime.value).slice(0, -2)}{" "}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : null}

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
              {runSession.isRunning ? (
                <button
                  className="rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition focus:outline-0"
                  onClick={handleLap}
                >
                  Lap
                </button>
              ) : null}

              {mode === "replay" ? (
                <ToggleControlButton
                  isRunning={runSession.isRunning}
                  startLabel="Start"
                  stopLabel="Stop"
                  onClick={toggleReplayRunTracking}
                />
              ) : (
                <>
                  <RosbagControlButton
                    onStart={startRunTracking}
                    onStop={stopRunTracking}
                    onError={showWarning}
                  />
                  <AutonomyControlButton onError={showWarning} />
                </>
              )}
            </div>
          </div>
        </div>
      </DashboardCard>

      <DashboardCard className="min-h-200 lg:col-span-4 lg:row-start-1 lg:row-span-2 lg:min-h-100">
        <MapComponent
          latitude={latest?.gps.lat ?? null}
          longitude={latest?.gps.long ?? null}
          className="min-h-0"
        />
      </DashboardCard>

      <DashboardCard
        className="min-h-100 lg:col-span-4 lg:row-start-2 lg:min-h-55 2xl:col-span-5"
        title="Power & Speed"
      >
        {history.length > 0 ? (
          <CompactChart
            accentColor="#fb923c"
            currentValue={`${formatValue((speedHistory.reduce((accumulator, currentValue) => accumulator + currentValue) / (speedHistory.length > 0 ? speedHistory.length : 1)) * 2.23694, 1)} mph`}
            unit="mph"
            data={speedHistory.map((speed) => roundTo(speed * 2.23694, 1))}
            rawTimestamps={history.map((sample) => sample.global_ts)}
            timestamps={xAxisTimestamps}
            labels={xAxisLabels}
            isPaused={isChartPaused}
            onTogglePause={isChartPaused ? handleResumeChart : handlePauseChart}
            yMax={Math.max(
              SPEEDOMETER_MAX_MPH,
              Math.ceil(latestSpeed / 10) * 10,
            )}
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
        )}
      </DashboardCard>

      <DashboardCard
        className="min-h-100 lg:col-span-4 lg:row-start-2 lg:min-h-55 2xl:col-span-3"
        title="Signals"
      >
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
      </DashboardCard>

      <DashboardCard
        className="min-h-60 lg:col-span-6 lg:min-h-72"
        title="Camera (Left)"
      >
        <CameraFeed side="left" />
      </DashboardCard>

      <DashboardCard
        className="min-h-60 lg:col-span-6 lg:min-h-72"
        title="Camera (Right)"
      >
        <CameraFeed side="right" />
      </DashboardCard>

      <DashboardCard
        className="min-h-110 lg:col-span-12 lg:min-h-120"
        title="Occupancy Grid"
      >
        <CostmapView />
      </DashboardCard>
    </div>
  );
}
