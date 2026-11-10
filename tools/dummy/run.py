"""Publish dummy Zenoh topics on their real keys.

One process, one session. DUMMY_TOPICS is a comma-separated list of topic
names (segmented_points, ...). When it is unset, every registered topic is
published. A name left off the list is not published, which leaves that key
free for the real publisher.

The session listens on DUMMY_ZENOH_LISTEN (default tcp/0.0.0.0:7449). All
interfaces, not just 127.0.0.1, so the dev backend inside Docker can dial
host.docker.internal:7449. Multicast discovery stays on for a backend running
on the host. Port 7447 is the real lidar publisher and 7448 is the camera mock.
"""

import os
import sys
import time
from pathlib import Path

import zenoh

sys.path.insert(0, str(Path(__file__).resolve().parent))

from topics import TOPICS

LISTEN = os.getenv("DUMMY_ZENOH_LISTEN", "tcp/0.0.0.0:7449")


def selected_topics():
    raw = os.getenv("DUMMY_TOPICS")
    if raw is None or not raw.strip():
        return list(TOPICS)
    wanted = [part.strip() for part in raw.split(",") if part.strip()]
    known = {topic.NAME: topic for topic in TOPICS}
    unknown = [name for name in wanted if name not in known]
    if unknown:
        names = ", ".join(topic.NAME for topic in TOPICS)
        raise SystemExit(f"unknown DUMMY_TOPICS {unknown}; known topics: {names}")
    return [known[name] for name in wanted]


def main():
    topics = selected_topics()
    config = zenoh.Config()
    config.insert_json5("listen/endpoints", f'["{LISTEN}"]')
    session = zenoh.open(config)
    publishers = [(topic, session.declare_publisher(topic.KEY)) for topic in topics]
    print(f"dummy publisher listening on {LISTEN}", flush=True)
    if not publishers:
        print("DUMMY_TOPICS selected nothing; no keys will be published", flush=True)
    for topic, _publisher in publishers:
        print(f"publishing {topic.NAME} on {topic.KEY} at {topic.RATE_HZ:g} Hz", flush=True)

    next_due = {topic.NAME: time.monotonic() for topic in topics}
    frame = {topic.NAME: 0 for topic in topics}
    try:
        while True:
            if not publishers:
                time.sleep(1)
                continue
            now = time.monotonic()
            soonest = None
            for topic, publisher in publishers:
                if now + 1e-4 >= next_due[topic.NAME]:
                    publisher.put(topic.payload(frame[topic.NAME], time.time_ns()))
                    frame[topic.NAME] += 1
                    interval = 1.0 / topic.RATE_HZ
                    next_due[topic.NAME] += interval
                    if next_due[topic.NAME] < now:
                        next_due[topic.NAME] = now + interval
                    if frame[topic.NAME] % 50 == 0:
                        print(f"published {frame[topic.NAME]} {topic.NAME} frames", flush=True)
                wait = next_due[topic.NAME] - time.monotonic()
                soonest = wait if soonest is None else min(soonest, wait)
            time.sleep(max(0.0, soonest if soonest is not None else 0.1))
    except KeyboardInterrupt:
        pass
    finally:
        for _topic, publisher in publishers:
            publisher.undeclare()
        session.close()


if __name__ == "__main__":
    main()
