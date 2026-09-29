import { test, expect } from "@playwright/test";

test("a delayed Gmail status cannot restore account details after a server-side conversation reset", async ({
  page,
}) => {
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let conversationId = "old-conversation",
    reads = 0;
  let releaseOld!: () => void;
  const oldStatus = {
    available: true,
    status: "connected",
    email: "old@example.test",
    unavailable: false,
    attempt: null,
  };
  const newStatus = {
    available: true,
    status: "not_connected",
    email: null,
    unavailable: false,
    attempt: null,
  };
  const snapshot = () => ({
    conversationId,
    revision: 0,
    turns: [],
    operation: null,
    control,
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = {
        tabId: route.request().postDataJSON().tabId,
        epoch: control.epoch || 1,
      };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call: null, control } });
    if (path === "/api/gmail/status") {
      reads++;
      if (reads === 2) {
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
        await route.fulfill({ json: oldStatus }).catch(() => undefined);
        return;
      }
      return route.fulfill({
        json: conversationId === "old-conversation" ? oldStatus : newStatus,
      });
    }
    return route.fulfill({ json: snapshot() });
  });
  await page.goto("/");
  await page.getByText("Gmail connected", { exact: true }).click();
  await expect(
    page.getByText("Gmail connected: old@example.test"),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(2);
  conversationId = "new-conversation";
  control = { ...control, epoch: 2 };
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeVisible();
  releaseOld();
  await expect(page.getByText("Gmail connected: old@example.test")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeVisible();
});

test("reset during Gmail polling cannot publish an old error into the fresh conversation", async ({
  page,
}) => {
  let control = { tabId: "", epoch: 1 };
  let conversationId = "before-reset";
  let started = false;
  let held = false;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .context()
    .route("**/oauth-check", (route) =>
      route.fulfill({ contentType: "text/html", body: "Local consent test" }),
    );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { ...control, tabId: route.request().postDataJSON().tabId };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { control, call: null } });
    if (path === "/api/gmail/start") {
      started = true;
      return route.fulfill({
        json: {
          attemptId: "pending-google",
          url: "http://localhost:3000/oauth-check",
        },
      });
    }
    if (path === "/api/gmail/status") {
      if (started && conversationId === "before-reset") {
        held = true;
        await waiting;
        await route.abort("failed").catch(() => undefined);
        return;
      }
      return route.fulfill({
        json: {
          available: true,
          status: "not_connected",
          email: null,
          unavailable: false,
          attempt: null,
        },
      });
    }
    return route.fulfill({
      json: {
        conversationId,
        control,
        revision: 0,
        turns: [],
        operation: null,
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect Gmail", exact: true })
    .click();
  await expect.poll(() => held).toBe(true);
  conversationId = "after-reset";
  control = { ...control, epoch: 2 };
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Could not check Gmail yet/)).toHaveCount(0);
});
