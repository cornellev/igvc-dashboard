import { useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const RUN_CONTROL_BUTTON_CLASS =
  "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition focus:outline-0 disabled:cursor-not-allowed disabled:opacity-50";

type ToggleControlButtonProps = {
  isRunning: boolean;
  isPending?: boolean;
  startLabel: string;
  stopLabel: string;
  pendingLabel?: string;
  onClick: () => void;
  disabled?: boolean;
};

type EndpointControlButtonProps = {
  onStart?: () => void;
  onStop?: () => void;
  onError?: (message: string) => void;
  canStart?: () => boolean;
};

type EndpointStartStopButtonProps = EndpointControlButtonProps & {
  startPath: string;
  stopPath: string;
  startLabel: string;
  stopLabel: string;
  failureLabel: string;
};

export function ToggleControlButton({
  isRunning,
  isPending = false,
  startLabel,
  stopLabel,
  pendingLabel = "Working",
  onClick,
  disabled = false,
}: ToggleControlButtonProps) {
  return (
    <button
      type="button"
      className={RUN_CONTROL_BUTTON_CLASS}
      onClick={onClick}
      disabled={disabled || isPending}
      aria-pressed={isRunning}
    >
      {isPending ? pendingLabel : isRunning ? stopLabel : startLabel}
    </button>
  );
}

export function RosbagControlButton(props: EndpointControlButtonProps) {
  return (
    <EndpointStartStopButton
      {...props}
      startPath="/bag/start"
      stopPath="/bag/stop"
      startLabel="Start Bag"
      stopLabel="Stop Bag"
      failureLabel="ROS bag request failed"
    />
  );
}

export function AutonomyControlButton(props: EndpointControlButtonProps) {
  return (
    <EndpointStartStopButton
      {...props}
      startPath="/autonomy/start"
      stopPath="/autonomy/stop"
      startLabel="Start Auto"
      stopLabel="Stop Auto"
      failureLabel="Autonomy request failed"
    />
  );
}

function EndpointStartStopButton({
  startPath,
  stopPath,
  startLabel,
  stopLabel,
  failureLabel,
  onStart,
  onStop,
  onError,
  canStart,
}: EndpointStartStopButtonProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleToggle = async () => {
    if (isPending) return;

    const shouldStart = !isRunning;

    if (shouldStart && canStart && !canStart()) {
      return;
    }

    setIsPending(true);

    try {
      await postControlRequest(shouldStart ? startPath : stopPath, failureLabel);
      setIsRunning(shouldStart);

      if (shouldStart) {
        onStart?.();
      } else {
        onStop?.();
      }
    } catch (error) {
      onError?.(getErrorMessage(error, failureLabel));
      console.error(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ToggleControlButton
      isRunning={isRunning}
      isPending={isPending}
      startLabel={startLabel}
      stopLabel={stopLabel}
      pendingLabel="..."
      onClick={handleToggle}
    />
  );
}

async function postControlRequest(path: string, fallbackMessage: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }
}

async function readErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const payload = (await response.json()) as { detail?: unknown };

    if (typeof payload.detail === "string" && payload.detail.length > 0) {
      return payload.detail;
    }
  } catch {
    return `${fallbackMessage} (${response.status})`;
  }

  return `${fallbackMessage} (${response.status})`;
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}
