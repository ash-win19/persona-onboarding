export async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  // Keep this a direct access so Next.js can inline it into the browser bundle.
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configuredUrl && process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL must be set before building the frontend.");
  }

  const baseUrl = new URL(configuredUrl || "http://localhost:3001");

  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("NEXT_PUBLIC_API_URL must be an HTTP(S) base URL.");
  }

  const url = `${baseUrl.href.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response;
}
