import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, entered = false) {
  let control = { tabId: null as string | null, epoch: 0 };
  let connected = false;
  let requested = false;
  let executions = 0;
  let freshStarts = 0;
  const meeting = {
    id: "saved-meeting",
    revision: 1,
    status: "connection_required",
    step: "draft",
    organizer: null as string | null,
    input: {
      title: "Persona demo",
      attendees: ["guest@example.test"],
      start: "2099-12-20T23:00:00Z",
      localStart: "2099-12-20T15:00",
      timeZone: "America/Los_Angeles",
      durationMinutes: 30,
    },
    eventUrl: null as string | null,
    meetUrl: null as string | null,
    errorCode: null,
  };
  const turns = [
    {
      id: "opening",
      submissionId: "opening",
      role: "assistant",
      content: "What would you like help with?",
      delivery: "text",
      kind: "opening",
    },
  ];
  const snapshot = () => ({
    conversationId: "calendar-onboarding",
    revision: turns.length,
    turns,
    operation: null,
    control,
    journey: {
      entered,
      ready: entered,
      prepared: entered,
      delivery: "text",
      message: "Your plan is saved. Let's get started.",
    },
    onboarding: {
      facts: {
        userName: { value: null, status: "missing" },
        agentName: { value: null, status: "missing" },
        helpRequest: {
          value: requested ? "Schedule a meeting" : null,
          status: requested ? "known" : "missing",
        },
      },
      gmail: "not_connected",
      graduated: entered,
      onboardingComplete: false,
      intake: {
        tasks: requested ? ["Schedule a meeting"] : [],
        noTasks: false,
        questionsAsked: 0,
        clarification: null,
        ready: false,
        plan: null,
      },
    },
  });
  await page.context().route("**/fake-calendar-consent", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<button onclick=\"location.href='/onboarding?calendar=connected'\">Approve Calendar access</button>",
    }),
  );
  await page
    .context()
    .route("**/onboarding?calendar=connected", async (route) => {
      connected = true;
      await route.continue();
    });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/calendar/status")
      return route.fulfill({
        json: {
          calendar: {
            available: true,
            enabled: true,
            status: connected ? "connected" : "not_connected",
            email: connected ? "organizer@example.test" : null,
            attempt: {
              id: "consent",
              status: connected ? "connected" : "pending",
            },
          },
          meetings: requested ? [meeting] : [],
        },
      });
    if (path === "/api/calendar/start")
      return route.fulfill({
        json: { attemptId: "consent", url: "/fake-calendar-consent" },
      });
    if (path === "/api/meetings/saved-meeting/execute") {
      expect(connected).toBe(true);
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 1 });
      executions++;
      meeting.status = "completed";
      meeting.step = "completed";
      meeting.organizer = "organizer@example.test";
      meeting.eventUrl = "https://calendar.google.com/calendar/event?eid=test";
      meeting.meetUrl = "https://meet.google.com/abc-defg-hij";
      return route.fulfill({ json: { code: "accepted" } });
    }
    if (path === "/api/control") {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { control, call: null } });
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/workspace")
      return route.fulfill({ json: { priorities: [], threads: [] } });
    if (path === "/api/gmail/status")
      return route.fulfill({
        json: {
          available: true,
          status: "not_connected",
          email: null,
          attempt: null,
        },
      });
    if (path === "/api/auth/fresh-start") freshStarts++;
    if (path === "/api/turns") {
      requested = true;
      const body = route.request().postDataJSON();
      turns.push(
        {
          id: body.submissionId,
          submissionId: body.submissionId,
          role: "user",
          content: body.content,
          delivery: "text",
          kind: "message",
        },
        {
          id: "saved",
          submissionId: body.submissionId,
          role: "assistant",
          content:
            "Your meeting details are saved. Use Connect Google Calendar below; I'll continue this request once it is connected.",
          delivery: "text",
          kind: "message",
        },
      );
    }
    return route.fulfill({ json: snapshot() });
  });
  return { executions: () => executions, freshStarts: () => freshStarts };
}

for (const width of [1440, 390, 320]) {
  test(`first meeting task and consent return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    // Exercise the full-page fallback used when a popup is blocked.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto("/onboarding");
    const panel = page.getByRole("region", {
      name: "Google Calendar and meetings",
    });
    await expect(panel.locator('img[src="/calendar.svg"]')).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeEnabled();
    await page
      .getByRole("textbox")
      .fill(
        "Schedule a 30-minute Google Meet with guest@example.test on December 20, 2099 at 3 PM Pacific, titled Persona demo, and email the invitation.",
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      panel.getByText("Connect Calendar to continue your saved request."),
    ).toBeVisible({ timeout: 10000 });
    const starts = state.freshStarts();
    await panel
      .getByRole("button", { name: "Connect Google Calendar" })
      .click();
    await page.getByRole("button", { name: "Approve Calendar access" }).click();
    await expect(panel.getByText("Scheduled", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      panel.getByRole("link", { name: "Join Google Meet" }),
    ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await expect(page).toHaveURL(/onboarding\?calendar=connected/);
    expect(state.freshStarts()).toBe(starts);
    expect(state.executions()).toBe(1);
    await page.reload();
    await expect(panel.getByText("Scheduled", { exact: true })).toBeVisible();
    expect(state.executions()).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`onboarding-${width}.png`),
      fullPage: true,
    });
  });
  test(`paired integration cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, true);
    await page.goto("/dashboard/settings/integrations");
    const cards = page.getByRole("region", { name: "Your integrations" });
    await expect(
      cards.getByRole("heading", { name: "Gmail", exact: true }),
    ).toBeVisible();
    await expect(
      cards.getByRole("heading", { name: "Google Calendar", exact: true }),
    ).toBeVisible();
    await expect(
      cards.locator('.integration-icon img[src="/gmail.svg"]'),
    ).toBeVisible();
    await expect(cards.locator('img[src="/calendar.svg"]')).toBeVisible();
    const boxes = await cards
      .locator(":scope > .integration-card")
      .evaluateAll((items) =>
        items.map((el) => ({
          x: el.getBoundingClientRect().x,
          y: el.getBoundingClientRect().y,
        })),
      );
    if (width > 1050) {
      expect(boxes[0].y).toBe(boxes[1].y);
      expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    } else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`integrations-${width}.png`),
      fullPage: true,
    });
  });
}
