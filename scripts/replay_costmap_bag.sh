#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/replay_costmap_bag.sh [bag_directory]

Publishes the recorded costmap bag topics used by the dashboard widget:
  /costmap
  /costmap_updates

Defaults:
  bag_directory: ../costmap
  ROS_DOMAIN_ID: 14
  ROS_LOCALHOST_ONLY: 0

Environment overrides:
  COSTMAP_BAG_DIR       Bag directory to replay when no positional arg is given.
  START_DELAY_SEC       Seconds to wait before playing the bag. Default: 2.
  ROS_DISTRO            ROS distro to source from /opt/ros. Default: humble.
  DISCOVERY_SERVER_IP   Fast DDS discovery server IP, if used by docker compose.
  JETSON_LAN_IP         Fallback discovery server IP, matching dashboard .env.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$(cd -- "$DASHBOARD_DIR/.." && pwd)"

if [[ -f "$DASHBOARD_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$DASHBOARD_DIR/.env"
  set +a
fi

ROS_DISTRO="${ROS_DISTRO:-humble}"
ROS_SETUP="/opt/ros/${ROS_DISTRO}/setup.bash"
if [[ -f "$ROS_SETUP" ]]; then
  # shellcheck disable=SC1090
  source "$ROS_SETUP"
fi

if ! command -v ros2 >/dev/null 2>&1; then
  echo "ros2 was not found. Source ROS first, for example:" >&2
  echo "  source /opt/ros/${ROS_DISTRO}/setup.bash" >&2
  exit 1
fi

DEFAULT_BAG_DIR="$WORKSPACE_DIR/costmap"
BAG_DIR="${1:-${COSTMAP_BAG_DIR:-$DEFAULT_BAG_DIR}}"
if [[ ! -f "$BAG_DIR/metadata.yaml" ]]; then
  echo "No rosbag metadata found at: $BAG_DIR/metadata.yaml" >&2
  echo "Pass the bag directory explicitly if it lives somewhere else." >&2
  exit 1
fi

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-14}"
export ROS_LOCALHOST_ONLY="${ROS_LOCALHOST_ONLY:-0}"

DISCOVERY_SERVER_HOST="${DISCOVERY_SERVER_IP:-${JETSON_LAN_IP:-}}"
if [[ -n "$DISCOVERY_SERVER_HOST" ]]; then
  PROFILE="/tmp/igvc_costmap_replay_super_client.xml"
  sed "s/DISCOVERY_SERVER_IP/${DISCOVERY_SERVER_HOST}/" \
    "$DASHBOARD_DIR/backend/super_client.example.xml" > "$PROFILE"
  export FASTRTPS_DEFAULT_PROFILES_FILE="$PROFILE"
  export ROS_DISCOVERY_SERVER="${DISCOVERY_SERVER_HOST}:11811"
fi

START_DELAY_SEC="${START_DELAY_SEC:-2}"

echo "Costmap rosbag replay"
echo "  bag: $BAG_DIR"
echo "  topics: /costmap /costmap_updates"
echo "  ROS_DOMAIN_ID: $ROS_DOMAIN_ID"
echo "  ROS_LOCALHOST_ONLY: $ROS_LOCALHOST_ONLY"
if [[ -n "$DISCOVERY_SERVER_HOST" ]]; then
  echo "  discovery server: ${DISCOVERY_SERVER_HOST}:11811"
else
  echo "  discovery server: none"
fi
echo "  start delay: ${START_DELAY_SEC}s"
echo
echo "Start docker compose first, then leave this running until ros2 bag play exits."

sleep "$START_DELAY_SEC"

exec ros2 bag play "$BAG_DIR" --topics /costmap /costmap_updates
