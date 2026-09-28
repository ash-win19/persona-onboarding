// Requests go to this app's /api route, which next.config.ts proxies to the backend.
export async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  // Next.js redirects trailing slashes, so "/" becomes "/api" rather than "/api/".
  const url = `/api/${path.replace(/^\/+/, "")}`.replace(/\/+$/, "");
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response;
}
