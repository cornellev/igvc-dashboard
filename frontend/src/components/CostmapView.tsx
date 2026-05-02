import { useEffect, useMemo, useRef, useState } from "react";

type CostmapPayload = {
  seq: number;
  stamp_ns: number;
  data: CostmapGrid;
};

type CostmapGrid = {
  width: number;
  height: number;
  resolution: number;
  origin: {
    x: number;
    y: number;
    z: number;
  };
  frame_id: string;
  data: number[];
  update_count: number;
};

type CostmapStats = {
  occupied: number;
  free: number;
  unknown: number;
};

const COSTMAP_WS_URL = "ws://127.0.0.1:8000/ws/costmap";

const calculateStats = (grid: CostmapGrid | null): CostmapStats => {
  if (!grid) return { occupied: 0, free: 0, unknown: 0 };

  return grid.data.reduce(
    (stats, value) => {
      if (value < 0) {
        stats.unknown += 1;
      } else if (value >= 65) {
        stats.occupied += 1;
      } else {
        stats.free += 1;
      }

      return stats;
    },
    { occupied: 0, free: 0, unknown: 0 },
  );
};

export default function CostmapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState<CostmapGrid | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastReceivedMs, setLastReceivedMs] = useState<number | null>(null);

  const stats = useMemo(() => calculateStats(grid), [grid]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return undefined;

      const ws = new WebSocket(COSTMAP_WS_URL);

      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => {
        setIsConnected(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event: MessageEvent<string>) => {
        const payload = JSON.parse(event.data) as CostmapPayload;
        setGrid(payload.data);
        setLastReceivedMs(Date.now());
      };

      return ws;
    };

    const ws = connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const parentRect = canvas.parentElement?.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.floor(parentRect?.width ?? 1));
    const displayHeight = Math.max(1, Math.floor(parentRect?.height ?? 1));

    canvas.width = displayWidth * pixelRatio;
    canvas.height = displayHeight * pixelRatio;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, displayWidth, displayHeight);

    const imageData = context.createImageData(grid.width, grid.height);
    const totalCells = grid.width * grid.height;

    for (let index = 0; index < totalCells; index += 1) {
      const value = grid.data[index] ?? -1;
      const sourceY = Math.floor(index / grid.width);
      const sourceX = index % grid.width;
      const targetIndex = ((grid.height - 1 - sourceY) * grid.width + sourceX) * 4;

      if (value < 0) {
        imageData.data[targetIndex] = 42;
        imageData.data[targetIndex + 1] = 45;
        imageData.data[targetIndex + 2] = 52;
      } else if (value >= 65) {
        imageData.data[targetIndex] = 196;
        imageData.data[targetIndex + 1] = 30;
        imageData.data[targetIndex + 2] = 58;
      } else {
        const intensity = 34 + Math.round((100 - Math.min(value, 100)) * 1.45);
        imageData.data[targetIndex] = intensity;
        imageData.data[targetIndex + 1] = Math.min(210, intensity + 22);
        imageData.data[targetIndex + 2] = Math.min(230, intensity + 32);
      }

      imageData.data[targetIndex + 3] = 255;
    }

    const bitmapCanvas = document.createElement("canvas");
    bitmapCanvas.width = grid.width;
    bitmapCanvas.height = grid.height;
    const bitmapContext = bitmapCanvas.getContext("2d");
    if (!bitmapContext) return;

    bitmapContext.putImageData(imageData, 0, 0);

    const scale = Math.min(displayWidth / grid.width, displayHeight / grid.height);
    const drawWidth = grid.width * scale;
    const drawHeight = grid.height * scale;
    const drawX = (displayWidth - drawWidth) / 2;
    const drawY = (displayHeight - drawHeight) / 2;

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#111317";
    context.fillRect(0, 0, displayWidth, displayHeight);
    context.drawImage(bitmapCanvas, drawX, drawY, drawWidth, drawHeight);
  }, [grid]);

  const freshnessLabel =
    lastReceivedMs === null
      ? "--"
      : `${Math.max(0, Math.round((Date.now() - lastReceivedMs) / 1000))}s`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-4 gap-2 text-xs text-white/70">
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
          <div className="font-semibold text-white/90">{isConnected ? "live" : "offline"}</div>
          <div className="uppercase tracking-[0.18em] text-white/35">socket</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
          <div className="font-semibold text-white/90">
            {grid ? `${grid.width}x${grid.height}` : "--"}
          </div>
          <div className="uppercase tracking-[0.18em] text-white/35">cells</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
          <div className="font-semibold text-white/90">{stats.occupied}</div>
          <div className="uppercase tracking-[0.18em] text-white/35">occupied</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
          <div className="font-semibold text-white/90">{freshnessLabel}</div>
          <div className="uppercase tracking-[0.18em] text-white/35">age</div>
        </div>
      </div>

      <div className="relative min-h-80 flex-1 overflow-hidden rounded-xl border border-white/8 bg-[#111317]">
        <canvas ref={canvasRef} className="h-full w-full" />
        {!grid ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-[0.2em] text-white/30">
            no costmap
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/50">
        <span>{grid ? `${grid.resolution.toFixed(3)} m/cell` : "-- m/cell"}</span>
        <span>{grid?.frame_id || "unknown frame"}</span>
        <span>{stats.free} free</span>
        <span>{stats.unknown} unknown</span>
      </div>
    </div>
  );
}
