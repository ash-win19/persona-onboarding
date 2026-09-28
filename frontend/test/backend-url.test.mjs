import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { getBackendUrl } from "../src/lib/backend-url.ts";

const originalUrl = process.env.BACKEND_URL;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.BACKEND_URL;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    BACKEND_URL: originalUrl,
    NODE_ENV: originalNodeEnv,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("uses the local backend when developing without an environment variable", () => {
  assert.equal(getBackendUrl(), "http://localhost:3001");
});

test("requires the backend URL in production", () => {
  process.env.NODE_ENV = "production";

  assert.throws(getBackendUrl, /BACKEND_URL must be set/);
});

test("strips trailing slashes and preserves an API path prefix", () => {
  process.env.BACKEND_URL = "https://backend.example.com/api/";

  assert.equal(getBackendUrl(), "https://backend.example.com/api");
});

test("rejects invalid backend configuration", () => {
  for (const value of [
    "not a URL",
    "file:///tmp/backend",
    "https://user:password@backend.example.com",
    "https://backend.example.com?token=value",
  ]) {
    process.env.BACKEND_URL = value;
    assert.throws(getBackendUrl);
  }
});
