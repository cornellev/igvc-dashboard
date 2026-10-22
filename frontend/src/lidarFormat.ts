/** Decoders for the lidar WebSocket streams (/ws/lidar/raw, /ws/lidar/costmap). */

// Wire formats, as written by encode_points / encode_costmap in
// virtual-rgbd-sensor's rslidar_sdk_node.rs and forwarded unchanged by the backend.
// Everything is little-endian.

export type PointCloudFrame = {
  stamp: number; // seconds
  count: number; // valid (non-NaN) points
  positions: Float32Array; // x, y, z per point, meters, lidar frame (x forward, y left, z up)
  intensity: Float32Array; // 0-255
  cluster: Int32Array | null; // segmented cloud only; -1 = unclustered
};

export type CostmapFrame = {
  stamp: number; // seconds
  sizeX: number;
  sizeY: number;
  resolution: number; // meters per cell
  originX: number; // meters, world position of cell (0, 0)
  originY: number;
  costs: Uint8Array; // row-major, sizeX * sizeY: 0 free .. 253 inscribed, 254 lethal, 255 unknown
};

/** 16-byte header (i32 sec, u32 nanosec, u32 width, u32 point_step), then
 * `width` records of x, y, z, intensity (f32) [+ cluster_id (i32) when point_step is 20]. */
export function decodePointCloud(buffer: ArrayBuffer): PointCloudFrame | null {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  const sec = view.getInt32(0, true);
  const nsec = view.getUint32(4, true);
  const width = view.getUint32(8, true);
  const step = view.getUint32(12, true);
  if ((step !== 16 && step !== 20) || buffer.byteLength - 16 < width * step) {
    return null;
  }

  const positions = new Float32Array(width * 3);
  const intensity = new Float32Array(width);
  const cluster = step === 20 ? new Int32Array(width) : null;
  let count = 0;
  for (let i = 0; i < width; i++) {
    const offset = 16 + i * step;
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue; // no-return placeholder
    positions[count * 3] = x;
    positions[count * 3 + 1] = y;
    positions[count * 3 + 2] = z;
    intensity[count] = view.getFloat32(offset + 12, true);
    if (cluster) cluster[count] = view.getInt32(offset + 16, true);
    count++;
  }

  return {
    stamp: sec + nsec * 1e-9,
    count,
    positions: positions.subarray(0, count * 3),
    intensity: intensity.subarray(0, count),
    cluster: cluster ? cluster.subarray(0, count) : null,
  };
}

/** 32-byte header (i32 sec, u32 nanosec, u32 size_x, u32 size_y, f32 resolution,
 * f32 origin_x, f32 origin_y, u32 reserved), then size_x * size_y u8 costs. */
export function decodeCostmap(buffer: ArrayBuffer): CostmapFrame | null {
  if (buffer.byteLength < 32) return null;
  const view = new DataView(buffer);
  const sizeX = view.getUint32(8, true);
  const sizeY = view.getUint32(12, true);
  if (sizeX === 0 || sizeY === 0 || buffer.byteLength - 32 < sizeX * sizeY) {
    return null;
  }
  return {
    stamp: view.getInt32(0, true) + view.getUint32(4, true) * 1e-9,
    sizeX,
    sizeY,
    resolution: view.getFloat32(16, true),
    originX: view.getFloat32(20, true),
    originY: view.getFloat32(24, true),
    costs: new Uint8Array(buffer, 32, sizeX * sizeY),
  };
}
