#!/usr/bin/env bash
set -e

source /opt/ros/humble/setup.bash

DISCOVERY_SERVER_HOST="${DISCOVERY_SERVER_IP:-${JETSON_LAN_IP:-}}"

if [ -z "$DISCOVERY_SERVER_HOST" ]; then
    echo "DISCOVERY_SERVER_IP or JETSON_LAN_IP must be set for ROS discovery" >&2
    exit 1
fi

# Generate CLIENT profile from template
TEMPLATE="/app/super_client.example.xml"
PROFILE="/tmp/client.xml"
sed "s/DISCOVERY_SERVER_IP/${DISCOVERY_SERVER_HOST}/" "$TEMPLATE" > "$PROFILE"
export FASTRTPS_DEFAULT_PROFILES_FILE="$PROFILE"
export ROS_DISCOVERY_SERVER="${DISCOVERY_SERVER_HOST}:11811"

echo "Using discovery server at ${DISCOVERY_SERVER_HOST}:11811"

exec uvicorn main:app --host 0.0.0.0 --port 8000
