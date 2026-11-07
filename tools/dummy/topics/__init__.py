"""Topics the dummy publisher can send. Add a module here to register the next one."""

from topics import imu, segmented_points

TOPICS = [segmented_points, imu]
