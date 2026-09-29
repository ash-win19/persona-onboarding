import { test, expect } from "@playwright/test";

test("a delayed Gmail status cannot restore account details after Start over", async ({
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
    if (path === "/api/reset") {
      conversationId = "new-conversation";
      control = { ...control, epoch: 2 };
    }
    return route.fulfill({ json: snapshot() });
  });
  await page.goto("/");
  await expect(
    page.getByText("Gmail connected: old@example.test"),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(2);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.getByRole("button", { name: "Delete saved conversation" }).click();
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
