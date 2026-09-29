import { test, expect } from "@playwright/test";

test("a delayed anonymous focus check cannot undo a successful sign-in", async ({
  page,
}) => {
  let signedIn = false;
  let loginStarted = false;
  let staleStarted = false;
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
      return route.fulfill({ status: 401, json: {} });
    }
    return route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? snapshot : {},
    });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("tanay@example.test");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => loginStarted).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => staleStarted).toBe(true);
  releaseLogin();
  const composer = page.getByRole("textbox", { name: "Message Persona" });
  await composer.fill("Keep this draft");
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/session") && response.status() === 401,
  );
  releaseStale();
  await (await staleResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(composer).toHaveValue("Keep this draft");
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
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Persona" }),
  ).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("tanay@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
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
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("A private message");
  expired = true;
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
  await expect(page.getByText("A private message")).toHaveCount(0);
});
