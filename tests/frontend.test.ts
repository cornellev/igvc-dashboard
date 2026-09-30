import { describe, expect, test } from "bun:test";
import {
  normalizeSocketData,
  calculatePowerKilowatts,
  calculateEfficiency,
  calculateEnergyKilowattHoursBetween,
  calculateLocalTangentDistanceMeters,
  formatElapsed,
  formatRunTimer,
  formatDuty,
  roundTo,
  canStartRunTracking,
  parseCsv,
  parseReplayCsv,
  mapRosbagRowToSocketData,
  getSpeedMetersPerSecond,
  getNullableNumber,
} from "../frontend/src/data";

import type { SocketData } from "../frontend/src/types";

const data: SocketData[] = [
  {
    seq: 12658,
    global_ts: 7090040504,
    power: {
      ts: 752597983,
      current: 0.03689999878406525,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 752687197,
      brake_pressure: 392.0,
      turn_angle: 1256.0,
    },
    rpm_front: {
      ts: 752606451,
      rpm_left: 70.19580078125,
      rpm_right: 70.19580078125,
    },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 752764523, rpm: 0.0, duty_cycle: 0.0 },
    filtered: { speed: 0.0 },
    latency_ms: null,
  },
  {
    seq: 103830,
    global_ts: 7908503105,
    power: {
      ts: 1571065114,
      current: 0.01844999939,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 1605670467,
      brake_pressure: 393.0,
      turn_angle: 1262.0,
    },
    rpm_front: { ts: 1605495112, rpm_left: 0.0, rpm_right: 0.0 },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 1605639937, rpm: 0.0, duty_cycle: 0.0 },
    filtered: { speed: 0.0 },
    latency_ms: null,
  },
  {
    seq: 103830,
    global_ts: 8008503105,
    power: {
      ts: 1571065114,
      current: 30.01844999939,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 1605670467,
      brake_pressure: 393.0,
      turn_angle: 1262.0,
    },
    rpm_front: { ts: 1605495112, rpm_left: 0.0, rpm_right: 0.0 },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 1605639937, rpm: 0.0, duty_cycle: 0.0 },
    filtered: { speed: 5.0 },
    latency_ms: null,
  },
  {
    seq: 103830,
    global_ts: 8018503105,
    power: {
      ts: 1571065114,
      current: 60.01844999939,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 1605670467,
      brake_pressure: 393.0,
      turn_angle: 1262.0,
    },
    rpm_front: { ts: 1605495112, rpm_left: 500.0, rpm_right: 0.0 },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 1605639937, rpm: 0.0, duty_cycle: 0.0 },
    filtered: { speed: 4.0 },
    latency_ms: null,
  },
  {
    seq: 103830,
    global_ts: 8019503105,
    power: {
      ts: 1571065114,
      current: 15.01844999939,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 1605670467,
      brake_pressure: 393.0,
      turn_angle: 1262.0,
    },
    rpm_front: { ts: 1605495112, rpm_left: 0.0, rpm_right: 500.0 },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 1605639937, rpm: 0.0, duty_cycle: 0.0 },
    filtered: { speed: 5.0 },
    latency_ms: null,
  },
  {
    seq: 103830,
    global_ts: 8020503105,
    power: {
      ts: 1571065114,
      current: 15.01844999939,
      voltage: 31.083904266357422,
    },
    steering: {
      ts: 1605670467,
      brake_pressure: 393.0,
      turn_angle: 1262.0,
    },
    rpm_front: { ts: 1605495112, rpm_left: 0.0, rpm_right: 500.0 },
    rpm_back: { ts: 0, rpm_left: NaN, rpm_right: NaN },
    gps: {
      ts: 0,
      lat: NaN,
      long: NaN,
      heading: NaN,
      speed: NaN,
    },
    motor: { ts: 1605639937, rpm: 0.0, duty_cycle: 10.0 },
    filtered: { speed: 5.0 },
    latency_ms: null,
  },
];

describe("preserved legacy telemetry", () => {
  test("retained import adapters handle quoted CSV, aliases, defaults and conversions", () => {
    expect(parseCsv('name,note\r\n"a,b","line 1\nline ""2"""')).toEqual([
      { name: "a,b", note: 'line 1\nline "2"' },
    ]);
    const parsed = parseReplayCsv(
      "timestamp,gps.lat,longitude,power.current,voltage,filtered.speed\n20,42,-76,10,24,3\n10,43,-75,5,12,2",
    );
    expect(parsed.rows.map((row) => row.global_ts)).toEqual([10, 20]);
    expect(parsed.rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(parsed.rows[1].power.current).toBe(10);
    expect(parsed.rows[1].filtered.speed).toBe(3);
    expect(parsed.warnings).toEqual([]);
    expect(parseReplayCsv("speed\n3").warnings.length).toBe(1);
    expect(
      mapRosbagRowToSocketData({ "power.voltage": 24, speed: 2 }, 0).power
        .voltage,
    ).toBe(24);
    expect(getSpeedMetersPerSecond({ speedmph: "2.23694" }, ["speedmph"])).toBe(
      1,
    );
    expect(getNullableNumber({ value: "bad" }, ["value"])).toBeNull();
    expect(getNullableNumber({ value: "0" }, ["value"])).toBe(0);
  });
  test("the optional run-start guard still accepts existing telemetry", () => {
    const warnings: string[] = [];
    expect(canStartRunTracking(1, (message) => warnings.push(message))).toBe(
      true,
    );
    expect(warnings).toEqual([]);
  });
  test("the original sample data remains usable through the same normalizer", () => {
    for (const sample of data) {
      const result = normalizeSocketData(sample);
      expect(result.seq).toBe(sample.seq);
      expect(result.power.current).toBe(sample.power.current);
      expect(result.power.voltage).toBe(sample.power.voltage);
      expect(result.steering.brake_pressure).toBe(
        sample.steering.brake_pressure,
      );
      expect(result.motor.duty_cycle).toBe(sample.motor.duty_cycle);
      expect(Number.isFinite(result.gps.lat)).toBe(true);
      expect(Number.isFinite(result.gps.long)).toBe(true);
    }
  });
  test("envelopes, aliases, legacy defaults and timestamp handling survive extraction", () => {
    const result = normalizeSocketData(
      {
        location: { lat: "42.5", long: "-76.4" },
        steering: { brake: 0, angle: "-2" },
        motor: { velocity: "3.5", throttle: 0.25 },
        _t_publish_ns: 1_000_000_000,
      },
      { seq: 7, stamp_ns: 2_000_000_000_000_000 },
      1050,
    );
    expect(result.seq).toBe(7);
    expect(result.global_ts).toBe(2_000_000_000);
    expect(result.gps.lat).toBe(42.5);
    expect(result.gps.long).toBe(-76.4);
    expect(result.steering.brake_pressure).toBe(0);
    expect(result.steering.turn_angle).toBe(-2);
    expect(result.filtered.speed).toBe(3.5);
    expect(result.motor.duty_cycle).toBe(0.25);
    expect(result.latency_ms).toBe(50);
    expect(normalizeSocketData({}).power.voltage).toBe(0);
    expect(normalizeSocketData({}).gps.lat).toBe(42.44666485723302);
  });
  test("generic power, energy and efficiency calculations remain available", () => {
    const sample = normalizeSocketData({
      power: { current: 10, voltage: 100 },
      filtered: { speed: 2 },
    });
    expect(calculatePowerKilowatts(sample)).toBe(1);
    expect(calculateEfficiency(sample)).toBeCloseTo(4.47388);
    expect(calculateEnergyKilowattHoursBetween(1, 3, 0, 3_600_000_000)).toBe(2);
    expect(calculateEnergyKilowattHoursBetween(1, 3, 10, 0)).toBe(0);
    expect(calculateEfficiency(normalizeSocketData({}))).toBeNull();
  });
  test("geodetic distance and formatting helpers retain their original units", () => {
    expect(calculateLocalTangentDistanceMeters(42, -76, 42, -76)).toBe(0);
    const distance = calculateLocalTangentDistanceMeters(
      42,
      -76,
      42.00001,
      -76,
    );
    expect(distance).toBeGreaterThan(1.1);
    expect(distance).toBeLessThan(1.12);
    expect(formatElapsed(0, 65_000_000)).toBe("1:05");
    expect(formatRunTimer(0, 65_500_000)).toBe("1:05.5");
    expect(formatDuty(0.25)).toBe("25");
    expect(roundTo(1.234, 2)).toBe(1.23);
  });
});
