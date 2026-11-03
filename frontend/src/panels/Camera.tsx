import { useCallback, useEffect, useRef, useState } from "react";
import { getHttpUrl } from "../data";

const RETRY_MS = 3000;
const WATCHDOG_MS = 1000;

export function CameraFeed({ side }: { side: "left" | "right" }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  const [hasFrame, setHasFrame] = useState(false);
  // Bumped to retry: a new src makes the <img> open a fresh MJPEG request.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  // src is set here rather than as a prop so cleanup can clear it: that makes the
  // browser drop the never-ending MJPEG request, and a remount sets it again.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    img.src = `${getHttpUrl(`/camera/${side}`)}?attempt=${attempt}`;
    return () => img.removeAttribute("src");
  }, [side, attempt]);

  const handleError = useCallback(() => {
    setHasFrame(false);
    if (!imgRef.current?.getAttribute("src")) return; // src cleared on purpose
    if (unmounted.current || retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setAttempt((n) => n + 1);
    }, RETRY_MS);
  }, []);

  // Chrome fires no error when an MJPEG stream drops mid-way (e.g. backend
  // restart); the image just goes blank, so watch for that while a feed shows.
  useEffect(() => {
    if (!hasFrame) return;
    const id = setInterval(() => {
      if (imgRef.current?.naturalWidth === 0) handleError();
    }, WATCHDOG_MS);
    return () => clearInterval(id);
  }, [hasFrame, handleError]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      <img
        ref={imgRef}
        onLoad={() => setHasFrame(true)}
        onError={handleError}
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

export default CameraFeed;
