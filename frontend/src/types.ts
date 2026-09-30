/** Existing telemetry shape, preserved as the current adapter contract. */
export interface SocketData {
  seq: number;
  global_ts: number;
  power: {
    ts: number;
    current: number;
    voltage: number;
  };
  steering: {
    ts: number;
    brake_pressure: number;
    turn_angle: number;
  };
  rpm_front: {
    ts: number;
    rpm_left: number;
    rpm_right: number;
  };
  rpm_back: {
    ts: number;
    rpm_left: number;
    rpm_right: number;
  };
  gps: {
    ts: number;
    lat: number;
    long: number;
    heading: number;
    speed: number;
  };
  motor: {
    ts: number;
    rpm: number;
    duty_cycle: number;
  };
  filtered: {
    speed: number;
  };
  latency_ms: number | null;
}
