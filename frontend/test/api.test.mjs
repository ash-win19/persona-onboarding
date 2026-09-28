import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { apiFetch } from "../src/lib/api.ts";

const originalUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_API_URL: originalUrl,
    NODE_ENV: originalNodeEnv,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("requests the configured backend and reads its text response", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://backend.example.com/";
  const fetchMock = mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "https://backend.example.com/");
    return new Response("Hello World!");
  });

  const response = await apiFetch("/");

  assert.equal(await response.text(), "Hello World!");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("uses the local backend when developing without an environment variable", async () => {
  mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "http://localhost:3001/");
    return new Response("Hello World!");
  });

  await apiFetch("/");
});

test("requires the backend URL in production before making a request", async () => {
  process.env.NODE_ENV = "production";
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Should not make a request");
  });

  await assert.rejects(apiFetch("/"), /NEXT_PUBLIC_API_URL must be set/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("preserves an API path prefix and forwards request options", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://backend.example.com/api/";
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello" }),
    signal: new AbortController().signal,
  };
  mock.method(globalThis, "fetch", async (url, requestOptions) => {
    assert.equal(url, "https://backend.example.com/api/messages");
    assert.equal(requestOptions, options);
    return new Response(null, { status: 204 });
  });

  assert.equal((await apiFetch("/messages", options)).status, 204);
});

test("surfaces unsuccessful HTTP responses", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response("Unavailable", { status: 503 });
  });

  await assert.rejects(apiFetch("/"), /Backend request failed: 503/);
});

test("rejects invalid backend configuration before making a request", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Should not make a request");
  });

  for (const value of [
    "not a URL",
    "file:///tmp/backend",
    "https://user:password@backend.example.com",
    "https://backend.example.com?token=value",
  ]) {
    process.env.NEXT_PUBLIC_API_URL = value;
    await assert.rejects(apiFetch("/"));
  }

  assert.equal(fetchMock.mock.callCount(), 0);
});
