#!/usr/bin/env bash
set -e

source /opt/ros/humble/setup.bash

if [ "${RUN_MOCK_CAMERA:-}" = "true" ]; then
	echo "Starting mock camera..."
	python3 /app/mock_camera.py &
else
	DISCOVERY_SERVER_HOST="${DISCOVERY_SERVER_IP:-${JETSON_LAN_IP:-}}"

	if [ -n "$DISCOVERY_SERVER_HOST" ]; then
		# Generate the CLIENT profile from template
		TEMPLATE="/app/super_client.example.xml"
		PROFILE="/tmp/client.xml"
		sed "s/DISCOVERY_SERVER_IP/${DISCOVERY_SERVER_HOST}/" "$TEMPLATE" > "$PROFILE"
		export FASTRTPS_DEFAULT_PROFILES_FILE="$PROFILE"
		export ROS_DISCOVERY_SERVER="${DISCOVERY_SERVER_HOST}:11811"
		echo "Using discovery server at ${DISCOVERY_SERVER_HOST}:11811"
	else
		echo "No discovery server configured, using default DDS discovery"
	fi
fi

exec uvicorn main:app --host 0.0.0.0 --port 8000
