import { test, expect, type Page } from "@playwright/test";

type Fact = { value: string | null; status: string };
const known = (value: string): Fact => ({ value, status: "known" });
const missing = (): Fact => ({ value: null, status: "missing" });

// One onboarding conversation whose saved details advance with each message:
// first the assistant name, then everything else, which finishes onboarding.
async function fixture(page: Page, options: { holdSession?: boolean } = {}) {
  let control = { tabId: null as string | null, epoch: 0 };
  let step = 0;
  let lastSubmission: string | null = null;
  let releaseSession!: () => void;
  const sessionHeld = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const turns: Record<string, string>[] = [
    {
      id: "opening",
      submissionId: "opening",
      role: "assistant",
      content: "What would you like to call me?",
      delivery: "text",
      kind: "opening",
    },
  ];
  const snapshot = () => {
    const done = step >= 2;
    return {
      conversationId: "motion",
      revision: turns.length,
      turns,
      operation: lastSubmission
        ? { id: lastSubmission, status: "completed" }
        : null,
      control,
      journey: {
        ready: done,
        prepared: done,
        entered: done,
        delivery: "text",
        message: "You're all set, Ashwin!",
      },
      onboarding: {
        facts: {
          agentName: step >= 1 ? known("Atom") : missing(),
          userName: done ? known("Ashwin") : missing(),
          helpRequest: done ? known("Plan my week") : missing(),
        },
        gmail: done ? "connected" : "not_connected",
        graduated: done,
        onboardingComplete: done,
        intake: {
          tasks: done ? ["Plan my week"] : [],
          noTasks: false,
          questionsAsked: 0,
          clarification: null,
          ready: done,
          plan: done
            ? {
                id: "plan",
                steps: ["Start with: Plan my week"],
                presented: true,
                accepted: true,
              }
            : null,
        },
      },
    };
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session" && options.holdSession) await sessionHeld;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call: null, control } });
    if (path === "/api/gmail/status")
      return route.fulfill({
        json: {
          available: true,
          status: step >= 2 ? "connected" : "not_connected",
          email: step >= 2 ? "ashwin@example.test" : null,
          attempt: null,
        },
      });
    if (path === "/api/workspace")
      return route.fulfill({ json: { priorities: [], threads: [] } });
    if (path === "/api/turns") {
      const body = route.request().postDataJSON();
      lastSubmission = body.submissionId;
      step++;
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
          id: `reply-${step}`,
          submissionId: body.submissionId,
          role: "assistant",
          content:
            step >= 2
              ? "You're all set, Ashwin! I'll get started on your week in the app."
              : "Atom. I like it. What should I call you?",
          delivery: "text",
          kind: "message",
          createdAt: new Date().toISOString(),
        },
      );
    }
    return route.fulfill({ json: snapshot() });
  });
  return { releaseSession };
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message Persona" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("a saved step checks, fills its connector and hands off to the next step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await page.goto("/onboarding");
  const rail = page.getByRole("complementary", { name: "Onboarding progress" });
  const assistant = rail.locator(".setup-step").first();
  const you = rail.locator(".setup-step").nth(1);
  await expect(assistant).toHaveClass(/is-current/);
  // Already-current steps on load do not replay their entrance.
  await expect(assistant).not.toHaveClass(/is-just-saved/);
  await send(page, "Call yourself Atom.");
  await expect(assistant).toHaveClass(/is-saved/);
  await expect(assistant).toHaveClass(/is-just-saved/);
  await expect(you).toHaveClass(/is-current/);
  await page.screenshot({
    path: "/private/tmp/persona-rail-mid.png",
    clip: { x: 1330, y: 300, width: 90, height: 300 },
  });
  // The check draws in, the connector fills and the next dot grows in.
  await expect
    .poll(() =>
      assistant
        .locator(".setup-mark path")
        .evaluate((el) => getComputedStyle(el).strokeDashoffset),
    )
    .toBe("0px");
  await expect
    .poll(() =>
      assistant
        .locator(".setup-trigger")
        .evaluate((el) => getComputedStyle(el, "::after").backgroundSize),
    )
    .toMatch(/^100% 100%/);
  await expect
    .poll(() =>
      you
        .locator(".setup-dot")
        .evaluate((el) => getComputedStyle(el).transform),
    )
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await expect(assistant).not.toHaveClass(/is-just-saved/, { timeout: 3000 });
  await page.screenshot({
    path: "/private/tmp/persona-rail-settled.png",
    clip: { x: 1330, y: 300, width: 90, height: 300 },
  });
});

test("graduation keeps the checked rail, fades out, then opens the dashboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await page.goto("/onboarding");
  await send(page, "Call yourself Atom.");
  await expect(page.getByText("What should I call you?")).toBeVisible();
  await send(page, "I'm Ashwin and I want to plan my week.");
  const rail = page.getByRole("complementary", { name: "Onboarding progress" });
  // The closing line shows with every step checked, in the same layout.
  await expect(page.getByText("You're all set, Ashwin!")).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button", { name: /: complete$/ })).toHaveCount(
    4,
  );
  await expect(page.locator(".chat-shell.with-setup")).toHaveCount(1);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator(".chat-shell.is-leaving")).toHaveCount(1, {
    timeout: 6000,
  });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 3000 });
  await expect(page.locator(".dashboard-page.page-enter")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your day, Ashwin." }),
  ).toBeVisible();
});

for (const [path, placeholder] of [
  ["/onboarding", ".chat-shell.page-skeleton"],
  ["/dashboard", ".dashboard-shell.page-skeleton"],
] as const)
  test(`${path} shows a shaped placeholder while it opens`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await fixture(page, { holdSession: true });
    await page.goto(path);
    await expect(page.locator(placeholder)).toBeVisible();
    await expect(page.getByText("Opening your Persona…")).toBeAttached();
    await expect(page.locator(".skeleton").first()).toBeVisible();
    await page.screenshot({
      path: `/private/tmp/persona-skeleton${path.replace("/", "-")}.png`,
    });
    state.releaseSession();
    await expect(page.locator(".page-skeleton")).toHaveCount(0, {
      timeout: 10000,
    });
  });
