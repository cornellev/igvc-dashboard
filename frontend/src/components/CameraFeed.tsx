import { useEffect, useRef, useState } from "react";

export default function CameraFeed({ side }: { side: "left" | "right" }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`ws://127.0.0.1:8000/ws/camera/${side}`);
      ws.binaryType = "blob";

      ws.onclose = () => {
        setHasFrame(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (e: MessageEvent<Blob>) => {
        const url = URL.createObjectURL(e.data);
        if (imgRef.current) {
          const prev = imgRef.current.src;
          imgRef.current.src = url;
          if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        }
        setHasFrame(true);
      };

      return ws;
    };

    const ws = connect();

    const img = imgRef.current;
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      if (img?.src.startsWith("blob:")) {
        URL.revokeObjectURL(img.src);
      }
    };
  }, [side]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      <img
        ref={imgRef}
        className="h-full w-full object-contain"
        alt={`ZED ${side} camera`}
        style={{ display: hasFrame ? "block" : "none" }}
      />
      {!hasFrame && (
        <span className="text-xs uppercase tracking-[0.2em] text-white/30">
          no feed
        </span>
      )}
    </div>
  );
}
