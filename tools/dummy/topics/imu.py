"""Dummy IMU on cev/sensors/imu.

Six little-endian f32s and nothing else: accelerometer x, y, z (m/s^2,
forward, left, up), then gyroscope roll, pitch, yaw (rad/s about those axes).
At rest the accelerometer reads gravity along up.
"""

import os
import struct

NAME = "imu"
KEY = os.getenv("IMU_ZENOH_KEY", "cev/sensors/imu")
RATE_HZ = 50


def payload(frame, now_ns):
    return struct.pack("<ffffff", 0.0, 0.0, 9.81, 0.0, 0.0, 0.0)
