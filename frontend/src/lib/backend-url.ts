// Server-only: read by next.config.ts to proxy /api/* to the backend.
export function getBackendUrl(): string {
  const configuredUrl = process.env.BACKEND_URL?.trim();

  if (!configuredUrl && process.env.NODE_ENV === "production") {
    throw new Error("BACKEND_URL must be set before building the frontend.");
  }

  const backendUrl = new URL(configuredUrl || "http://localhost:3001");

  if (
    !["http:", "https:"].includes(backendUrl.protocol) ||
    backendUrl.username ||
    backendUrl.password ||
    backendUrl.search ||
    backendUrl.hash
  ) {
    throw new Error("BACKEND_URL must be an HTTP(S) base URL.");
  }

  return backendUrl.href.replace(/\/+$/, "");
}
