import type { SocketData } from "./types";

/** Existing live latency suffix; broader diagnostics await their input contracts. */
export function formatLatencySuffix(latest: SocketData | null): string {
  return latest?.latency_ms
    ? ` | Latency [${Math.round(Math.abs(latest.latency_ms))}ms]`
    : "";
}
