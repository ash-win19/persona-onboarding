import { test, expect } from "@playwright/test";

test("a delayed anonymous focus check cannot undo a successful sign-in", async ({
  page,
}) => {
  let signedIn = false;
  let loginStarted = false;
  let staleStarted = false;
  let staleFinished = false;
  let releaseLogin!: () => void;
  let releaseStale!: () => void;
  const loginGate = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const snapshot = {
    conversationId: "saved",
    revision: 0,
    turns: [],
    operation: null,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/login") {
      loginStarted = true;
      await loginGate;
      signedIn = true;
      return route.fulfill({ json: snapshot });
    }
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (!signedIn && loginStarted) {
      staleStarted = true;
      await staleGate;
      // Navigating away from sign-in aborts this obsolete session check.
      await route.fulfill({ status: 401, json: {} }).catch(() => undefined);
      staleFinished = true;
      return;
    }
    return route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? snapshot : {},
    });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("tanay@example.test");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => loginStarted).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => staleStarted).toBe(true);
  releaseLogin();
  const composer = page.getByRole("textbox", { name: "Message Persona" });
  await composer.fill("Keep this draft");
  releaseStale();
  await expect.poll(() => staleFinished).toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(composer).toHaveValue("Keep this draft");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("invited users sign in, resume after refresh, and sign out", async ({
  page,
}) => {
  let signedIn = false;
  const snapshot = {
    conversationId: "private-conversation",
    revision: 0,
    turns: [],
    operation: null,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/login") {
      const body = route.request().postDataJSON();
      if (body.password !== "demo-password")
        return route.fulfill({ status: 401, json: {} });
      signedIn = true;
      return route.fulfill({ json: snapshot });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    return route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? snapshot : {},
    });
  });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Persona" }),
  ).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("tanay@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "don't match" }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Persona" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Persona" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Persona" }),
  ).toHaveCount(0);
});

test("each page load asks for a fresh start, but a Gmail consent return does not", async ({
  page,
}) => {
  let freshStarts = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/fresh-start") {
      freshStarts++;
      return route.fulfill({ json: { conversationId: "test-conversation" } });
    }
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    return route.fulfill({
      json: {
        conversationId: "test-conversation",
        revision: 0,
        turns: [],
        operation: null,
      },
    });
  });
  const composer = page.getByRole("textbox", { name: "Message Persona" });
  await page.goto("/sign-in");
  await expect(composer).toBeVisible();
  expect(freshStarts).toBe(1);
  await page.reload();
  await expect(composer).toBeVisible();
  expect(freshStarts).toBe(2);
  await page.goto("/onboarding?gmail=connected");
  await expect(composer).toBeVisible();
  expect(freshStarts).toBe(2);
});

test("a revoked session clears the conversation and returns to sign-in", async ({
  page,
}) => {
  let expired = false;
  await page.route("**/api/**", async (route) => {
    if (expired) return route.fulfill({ status: 401, json: {} });
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    return route.fulfill({
      json: { conversationId: "one", revision: 0, turns: [], operation: null },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("A private message");
  expired = true;
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
  await expect(page.getByText("A private message")).toHaveCount(0);
});
