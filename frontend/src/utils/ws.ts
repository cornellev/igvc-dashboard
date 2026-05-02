const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getDefaultWebSocketBase = () => {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:8000";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:8000`;
};

export const getWebSocketUrl = (path: string) => {
  const configuredBase = import.meta.env.VITE_BACKEND_WS_URL?.trim();
  const baseUrl = configuredBase
    ? trimTrailingSlash(configuredBase)
    : getDefaultWebSocketBase();

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
};
