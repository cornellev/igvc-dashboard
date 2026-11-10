import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { getWebSocketUrl } from "../data";
import {
  decodeCostmap,
  decodePointCloud,
  type CostmapFrame,
  type PointCloudFrame,
} from "../lidarFormat";

/** Which backend stream to show: `raw` = /ws/lidar/raw (point cloud), `costmap` = /ws/lidar/costmap. */
export type LidarType = "raw" | "costmap";

// ---------------------------------------------------------------------------
// Colors

const CLUSTER_COLORS = [
  [0.95, 0.42, 0.36],
  [0.36, 0.72, 0.95],
  [0.55, 0.9, 0.45],
  [0.98, 0.8, 0.3],
  [0.78, 0.5, 0.95],
  [0.3, 0.9, 0.85],
  [0.98, 0.6, 0.85],
  [0.95, 0.62, 0.25],
];
const UNCLUSTERED_COLOR = [0.45, 0.45, 0.45];

function pointColors(frame: PointCloudFrame): Float32Array {
  const colors = new Float32Array(frame.count * 3);
  for (let i = 0; i < frame.count; i++) {
    let rgb: number[];
    const id = frame.cluster ? frame.cluster[i] : -1;
    if (id >= 0) {
      rgb = CLUSTER_COLORS[id % CLUSTER_COLORS.length];
    } else {
      // No cluster (or raw cloud): grey, brighter for more reflective returns.
      const k = 0.35 + 0.65 * Math.min(frame.intensity[i] / 255, 1);
      rgb = UNCLUSTERED_COLOR.map((c) => c * k * 1.6);
    }
    colors.set(rgb, i * 3);
  }
  return colors;
}

/** RGBA per cost value, nav2 conventions. */
const COST_LUT = (() => {
  const lut = new Uint8Array(256 * 4);
  for (let cost = 0; cost < 256; cost++) {
    let rgba: [number, number, number, number];
    if (cost === 0) rgba = [30, 34, 40, 255]; // free
    else if (cost === 255) rgba = [0, 0, 0, 0]; // unknown: transparent
    else if (cost === 254) rgba = [235, 64, 52, 255]; // lethal
    else if (cost === 253) rgba = [245, 150, 50, 255]; // inscribed
    else {
      // inflation 1..252: dark blue → yellow as cost rises
      const t = cost / 252;
      rgba = [40 + 200 * t, 70 + 150 * t, 140 - 100 * t, 255];
    }
    lut.set(rgba, cost * 4);
  }
  return lut;
})();

// ---------------------------------------------------------------------------
// Scene objects, updated in place on each frame instead of re-rendering React.

function usePointCloudObject() {
  return useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      size: 0.06,
      sizeAttenuation: true,
      vertexColors: true,
    });
    return new THREE.Points(geometry, material);
  }, []);
}

function updatePointCloud(points: THREE.Points, frame: PointCloudFrame) {
  const geometry = points.geometry as THREE.BufferGeometry;
  geometry.setAttribute("position", new THREE.BufferAttribute(frame.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(pointColors(frame), 3));
  geometry.computeBoundingSphere();
}

function useCostmapObject() {
  return useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  }, []);
}

function updateCostmap(mesh: THREE.Mesh, frame: CostmapFrame) {
  const material = mesh.material as THREE.MeshBasicMaterial;
  const rgba = new Uint8Array(frame.sizeX * frame.sizeY * 4);
  for (let i = 0; i < frame.costs.length; i++) {
    rgba.set(COST_LUT.subarray(frame.costs[i] * 4, frame.costs[i] * 4 + 4), i * 4);
  }

  // Texture row 0 = bottom of the plane = cell row 0 at originY; column → +x.
  const previous = material.map;
  const texture = new THREE.DataTexture(rgba, frame.sizeX, frame.sizeY, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter; // crisp cells instead of blurred
  texture.needsUpdate = true;
  material.map = texture;
  material.needsUpdate = true;
  previous?.dispose();

  const widthM = frame.sizeX * frame.resolution;
  const heightM = frame.sizeY * frame.resolution;
  mesh.scale.set(widthM, heightM, 1);
  mesh.position.set(frame.originX + widthM / 2, frame.originY + heightM / 2, 0);
}

// ---------------------------------------------------------------------------

export function Lidar({
  type,
  cameraPosition = [-12, 10, 0],
}: {
  type: LidarType;
  /** Initial view in three.js coords (y up). Default: behind and above the car, looking forward. */
  cameraPosition?: [number, number, number];
}) {
  const [hasFrame, setHasFrame] = useState(false);
  const points = usePointCloudObject();
  const costmap = useCostmapObject();

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(getWebSocketUrl(`/ws/lidar/${type}`));
      ws.binaryType = "arraybuffer"; // we read the bytes ourselves (the camera uses "blob" for <img>)

      ws.onclose = () => {
        setHasFrame(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws?.close();

      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (type === "raw") {
          const frame = decodePointCloud(e.data);
          if (!frame) return;
          updatePointCloud(points, frame);
        } else {
          const frame = decodeCostmap(e.data);
          if (!frame) return;
          updateCostmap(costmap, frame);
        }
        setHasFrame(true);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [type, points, costmap]);

  useEffect(
    () => () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
      const material = costmap.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      costmap.geometry.dispose();
    },
    [points, costmap],
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-black">
      <Canvas camera={{ position: cameraPosition, fov: 50, near: 0.1, far: 500 }}>
        <gridHelper args={[40, 40, "#444", "#222"]} />
        {/* Lidar/ROS frame is z-up; three.js is y-up. Rotating the group lets
            everything inside use lidar coordinates directly. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <axesHelper args={[1]} />
          {type === "raw" ? <primitive object={points} /> : <primitive object={costmap} />}
        </group>
        <OrbitControls target={[0, 0, 0]} />
      </Canvas>
      {!hasFrame && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs uppercase tracking-[0.2em] text-white/30">
          no {type === "raw" ? "lidar" : "costmap"} feed
        </span>
      )}
    </div>
  );
}

export default Lidar;
