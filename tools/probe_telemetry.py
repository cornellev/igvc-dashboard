"""Check what the real spi_data publisher sends over Zenoh before trusting it.

The migration can change both where telemetry appears and what it looks like:
zenoh-bridge-ros2dds publishes ROS /spi_data on key `spi_data` as a CDR
std_msgs/String, rmw_zenoh uses keys like
`<domain>/spi_data/std_msgs::msg::dds_::String_/<hash>`, and a native publisher
may send anything. The frontend (normalizeSocketData in frontend/src/data.ts)
silently turns missing or non-numeric fields into 0, so a format mismatch shows
up as a dashboard full of zeros rather than as an error.

1. Find the key and wire format (lists every key seen, with a format guess):

    python tools/probe_telemetry.py --discover [--key '**'] [--seconds 10]

2. Validate the payloads on that key against what the frontend reads:

    python tools/probe_telemetry.py [--key spi_data] [--seconds 10]

Uses ZENOH_CONFIG like the backend does; otherwise the default peer config.
Exits non-zero if nothing decodable arrived.
"""

import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time

import zenoh

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from subscribers.status import decode_json_payload  # noqa: E402  (the backend's own decoder)

# Mirrors normalizeSocketData: each displayed value and the paths it accepts, in
# the order the frontend tries them. Anything not found is shown as a default.
EXPECTED = [
    ("timestamp", ["global_ts", "ts", "gps.ts", "location.ts", "power.ts",
                   "motor.ts", "steering.ts", "filtered.ts"]),
    ("power.current", ["power.current"]),
    ("power.voltage", ["power.voltage"]),
    ("steering.brake_pressure", ["steering.brake_pressure", "steering.brake", "steering.pressure"]),
    ("steering.turn_angle", ["steering.turn_angle", "steering.angle", "steering.steering_angle"]),
    ("rpm_front.rpm_left", ["rpm_front.rpm_left"]),
    ("rpm_front.rpm_right", ["rpm_front.rpm_right"]),
    ("rpm_back.rpm_left", ["rpm_back.rpm_left"]),
    ("rpm_back.rpm_right", ["rpm_back.rpm_right"]),
    ("gps.lat", ["gps.lat", "location.lat"]),
    ("gps.long", ["gps.long", "location.long"]),
    ("gps.heading", ["gps.heading"]),
    ("speed", ["gps.speed", "motor.velocity", "motor.speed", "filtered.speed", "speed"]),
    ("motor.rpm", ["motor.rpm"]),
    ("motor.duty_cycle", ["motor.duty_cycle", "motor.throttle"]),
]
READ_PATHS = {p for _, paths in EXPECTED for p in paths} | {"seq", "_t_publish_ns"}


def is_cdr_string(b: bytes):
    """Structurally a CDR std_msgs/String: header, length that fits, NUL-terminated."""
    if len(b) < 9 or b[0] != 0 or b[1] not in (0, 1):
        return False
    n = int.from_bytes(b[4:8], "little" if b[1] == 1 else "big")
    return 1 <= n <= len(b) - 8 and b[8 + n - 1] == 0


def classify(b: bytes):
    """Return (format description, parsed JSON or None)."""
    if not b:
        return "empty", None
    is_cdr = is_cdr_string(b)
    if not is_cdr and b[0] == 0:
        return "binary", None
    try:
        text = decode_json_payload(b)
    except UnicodeDecodeError:
        return "binary", None
    prefix = "CDR std_msgs/String" if is_cdr else "UTF-8"
    try:
        data = json.loads(text)
    except ValueError:
        return f"{prefix}, not JSON", None
    return f"{prefix} JSON {type(data).__name__}", data


def lookup(data, path):
    for part in path.split("."):
        if not isinstance(data, dict) or part not in data:
            return False, None
        data = data[part]
    return True, data


def is_frontend_number(value):
    """Same acceptance as toNumber() in data.ts: finite number or numeric string."""
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return value == value and value not in (float("inf"), float("-inf"))
    if isinstance(value, str) and value.strip():
        try:
            float(value)
            return True
        except ValueError:
            return False
    return False


def frontend_timestamp_ms(value):
    """Same scaling as toTimestampMs() in data.ts."""
    v = float(value)
    if v > 10e12:
        return v / 1e6
    if v > 1e12:
        return v / 1e3
    return v


def leaf_paths(data, prefix=""):
    if isinstance(data, dict):
        for key, value in data.items():
            yield from leaf_paths(value, f"{prefix}{key}.")
    else:
        yield prefix[:-1]


def open_session():
    config = zenoh.Config.from_env() if os.getenv("ZENOH_CONFIG") else zenoh.Config()
    return zenoh.open(config)


def collect(key, seconds):
    samples = []   # (key, encoding, payload bytes, monotonic time)
    lock = threading.Lock()

    def callback(sample):
        with lock:
            samples.append((str(sample.key_expr), str(sample.encoding),
                            sample.payload.to_bytes(), time.monotonic()))

    session = open_session()
    sub = session.declare_subscriber(key, callback)
    print(f"listening on '{key}' for {seconds:.0f}s...", flush=True)
    try:
        time.sleep(seconds)
    finally:
        sub.undeclare()
        session.close()
    with lock:
        return list(samples)


def discover(key, seconds):
    samples = collect(key, seconds)
    by_key = {}
    for k, encoding, b, _ in samples:
        entry = by_key.setdefault(k, {"count": 0, "sizes": [], "encodings": set(), "formats": set()})
        entry["count"] += 1
        entry["sizes"].append(len(b))
        entry["encodings"].add(encoding)
        entry["formats"].add(classify(b)[0])

    if not by_key:
        print("no messages received -- is the publisher (or bridge) running and reachable?")
        return 1
    for k, e in sorted(by_key.items()):
        print(f"\n{k}\n  messages: {e['count']} ({e['count'] / seconds:.1f}/s)"
              f"  size: {min(e['sizes'])}-{max(e['sizes'])} bytes"
              f"\n  zenoh encoding: {', '.join(sorted(e['encodings']))}"
              f"\n  format guess:   {', '.join(sorted(e['formats']))}")
    print("\nSet TELEMETRY_ZENOH_KEY to the telemetry key (wildcards like '*/spi_data/**' work).")
    return 0


def validate(key, seconds):
    samples = collect(key, seconds)
    if not samples:
        print("no messages received -- check the key with --discover")
        return 1

    formats, keys = {}, set()
    decoded = []
    for k, _, b, _ in samples:
        keys.add(k)
        fmt, data = classify(b)
        formats[fmt] = formats.get(fmt, 0) + 1
        if isinstance(data, dict):
            decoded.append(data)

    span = samples[-1][3] - samples[0][3]
    rate = (len(samples) - 1) / span if span > 0 else 0.0
    print(f"\nreceived {len(samples)} messages (~{rate:.1f}/s) on {', '.join(sorted(keys))}")
    for fmt, n in sorted(formats.items()):
        print(f"  {n:5} x {fmt}")

    if not decoded:
        print("\nFAIL: no message decoded to a JSON object; the backend would invalidate every one")
        return 1
    if len(decoded) < len(samples):
        print(f"\nWARN: {len(samples) - len(decoded)} messages were not JSON objects and would be dropped")

    print("\nfields the frontend displays (numeric = usable, missing/non-numeric = shown as default):")
    for label, paths in EXPECTED:
        numeric = non_numeric = 0
        used = set()
        for data in decoded:
            for path in paths:   # first present path wins, like `??` in data.ts
                found, value = lookup(data, path)
                if found and value is not None:
                    used.add(path)
                    if is_frontend_number(value) and (label != "timestamp" or float(value) > 0):
                        numeric += 1
                    else:
                        non_numeric += 1
                    break
        missing = len(decoded) - numeric - non_numeric
        status = "OK  " if numeric == len(decoded) else ("MISS" if numeric == 0 else "PART")
        source = f" from {', '.join(sorted(used))}" if used else ""
        print(f"  {status} {label:24} numeric {numeric}/{len(decoded)}"
              f"{f', non-numeric {non_numeric}' if non_numeric else ''}"
              f"{f', missing {missing}' if missing else ''}{source}")

    for path in EXPECTED[0][1]:
        found, value = lookup(decoded[-1], path)
        if found and value is not None and is_frontend_number(value):
            shown = time.strftime("%Y-%m-%d %H:%M:%S UTC",
                                  time.gmtime(frontend_timestamp_ms(value) / 1e3))
            print(f"\ntimestamp {path}={value} is displayed by the frontend as {shown}"
                  f" (check this is today; a wrong unit lands in 1970 or the far future)")
            break

    seen = set()
    for data in decoded:
        seen.update(leaf_paths(data))
    ignored = sorted(seen - READ_PATHS)
    if ignored:
        print("\nfields present but not read by the frontend (renamed? new?):")
        for path in ignored:
            print(f"  {path}")

    print("\nlatest message:")
    print(json.dumps(decoded[-1], indent=2)[:2000])
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--discover", action="store_true", help="list every key seen and guess its format")
    parser.add_argument("--key", help="key expression (default: '**' with --discover, else TELEMETRY_ZENOH_KEY or spi_data)")
    parser.add_argument("--seconds", type=float, default=10)
    args = parser.parse_args()

    if args.discover:
        sys.exit(discover(args.key or "**", args.seconds))
    sys.exit(validate(args.key or os.getenv("TELEMETRY_ZENOH_KEY", "spi_data"), args.seconds))
