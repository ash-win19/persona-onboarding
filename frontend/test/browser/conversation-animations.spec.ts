import { test, expect } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`the orb animates immediately after Send and respects ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    let control: { tabId: string | null; epoch: number } = {
      tabId: null,
      epoch: 0,
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshot = () => ({
      conversationId: "pending-animation",
      control,
      revision: 0,
      turns: [],
      operation: null,
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
      if (path === "/api/control") {
        control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
        return route.fulfill({ json: { control } });
      }
      if (path === "/api/calls/status")
        return route.fulfill({ json: { call: null, control } });
      if (path === "/api/turns") {
        const { submissionId, content } = route.request().postDataJSON();
        await held;
        return route.fulfill({
          json: {
            ...snapshot(),
            revision: 1,
            operation: { id: submissionId, status: "completed" },
            turns: [
              { id: submissionId, submissionId, role: "user", content },
              {
                id: "reply",
                submissionId,
                role: "assistant",
                content: "Here is your answer.",
              },
            ],
          },
        });
      }
      // No generating snapshot arrives before the POST completes.
      return route.fulfill({ json: snapshot() });
    });
    try {
      await page.goto("/");
      await page
        .getByRole("textbox", { name: "Message Persona" })
        .fill("What should I focus on today?");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("Sending your message…")).toBeVisible();
      const canvas = page.locator(".thinking-orb canvas");
      await expect(canvas).toBeVisible();
      const distinctFrames = await canvas.evaluate(async (element) => {
        const frame = () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        // Allow the initial canvas paint and visibility observer to settle.
        await frame();
        await frame();
        const images = new Set<string>();
        for (let i = 0; i < 24; i++) {
          await frame();
          images.add((element as HTMLCanvasElement).toDataURL());
        }
        return images.size;
      });
      if (reducedMotion === "reduce") {
        expect(distinctFrames).toBe(1);
      } else {
        expect(distinctFrames).toBeGreaterThan(4);
      }
      release();
      await expect(page.getByText("Here is your answer.")).toBeVisible();
      await expect(page.locator(".thinking")).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("a timed-out request keeps its confirmed thinking orb until completion or failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => timeout(ms === 15000 ? 300 : ms);
  });
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let status: "generating" | "completed" | "failed" | null = null;
  let pending = { submissionId: "", content: "" };
  let offline = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const snapshot = () => ({
    conversationId: "slow-animation",
    control,
    revision: status === "completed" ? 2 : 1,
    turns: status
      ? [
          {
            id: pending.submissionId,
            submissionId: pending.submissionId,
            role: "user",
            content: pending.content,
          },
          ...(status === "completed"
            ? [
                {
                  id: "reply",
                  submissionId: pending.submissionId,
                  role: "assistant",
                  content: "The delayed reply is here.",
                },
              ]
            : []),
        ]
      : [],
    operation: status ? { id: pending.submissionId, status } : null,
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call: null, control } });
    if (path === "/api/turns") {
      pending = route.request().postDataJSON();
      status = "generating";
      await held;
      return route.fulfill({ json: snapshot() }).catch(() => undefined);
    }
    if (offline && path === "/api/session")
      return route.abort("connectionreset");
    return route.fulfill({ json: snapshot() });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Please take your time.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Reconnecting to check your reply…"),
  ).toBeVisible();
  await expect(
    page.getByText("Persona is thinking", { exact: true }),
  ).toBeVisible({ timeout: 7000 });
  await expect(page.locator(".thinking-orb canvas")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("thinking-orb.png") });
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".thinking-orb")).toHaveAttribute(
    "data-paused",
    "true",
  );
  offline = true;
  await expect(page.getByText("Reconnecting to check your reply…")).toBeVisible(
    { timeout: 7000 },
  );
  await expect(
    page.getByText("Persona is thinking", { exact: true }),
  ).toHaveCount(0);
  offline = false;
  status = "failed";
  await expect(
    page.getByText(
      "Your message is saved. The reply could not finish. You can try again.",
    ),
  ).toBeVisible({ timeout: 7000 });
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  status = "completed";
  release();
  await expect(page.getByText("The delayed reply is here.")).toBeVisible({
    timeout: 7000,
  });
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
});
