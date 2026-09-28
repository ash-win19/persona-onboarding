import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { apiFetch } from "../src/lib/api.ts";

afterEach(() => {
  mock.restoreAll();
});

test("requests the same-origin API proxy and reads its text response", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api");
    return new Response("Hello World!");
  });

  const response = await apiFetch("/");

  assert.equal(await response.text(), "Hello World!");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("forwards the path and request options", async () => {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello" }),
    signal: new AbortController().signal,
  };
  mock.method(globalThis, "fetch", async (url, requestOptions) => {
    assert.equal(url, "/api/messages");
    assert.equal(requestOptions, options);
    return new Response(null, { status: 204 });
  });

  assert.equal((await apiFetch("messages", options)).status, 204);
});

test("surfaces unsuccessful HTTP responses", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response("Unavailable", { status: 503 });
  });

  await assert.rejects(apiFetch("/"), /Backend request failed: 503/);
});
