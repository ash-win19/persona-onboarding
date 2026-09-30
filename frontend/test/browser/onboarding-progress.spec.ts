import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let freshStarts = 0;
  const plan = {
    id: "58d992af-404f-4624-9212-a1cde4da3602",
    steps: ["Make a grocery list.", "Sketch a gym session."],
    presented: true,
    accepted: false,
  };
  const intake = {
    tasks: [] as string[],
    noTasks: false,
    questionsAsked: 0,
    clarification: null,
    ready: false,
    plan: null as typeof plan | null,
  };
  const journey = {
    ready: false,
    prepared: false,
    entered: false,
    message: "Your plan is saved. Let's get started.",
    delivery: "text",
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
    conversationId: "progress-fixture",
    revision: turns.length + Number(journey.entered),
    turns,
    control,
    journey,
    operation: null,
    onboarding: {
      facts: {
        agentName: { value: "Atom", status: "known" },
        userName: { value: "Ashwin", status: "known" },
        helpRequest: {
          value: intake.tasks[0] ?? null,
          status: intake.tasks.length ? "known" : "missing",
        },
      },
      gmail: "connected",
      graduated: journey.entered,
      onboardingComplete: journey.entered,
      intake,
    },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/workspace"))
      return route.fulfill({ json: { priorities: [], threads: [] } });
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (path.endsWith("/auth/fresh-start")) {
      freshStarts++;
      return route.fulfill({ json: snapshot() });
    }
    if (path.endsWith("/control")) {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path.endsWith("/calls/status"))
      return route.fulfill({ json: { call: null, control } });
    if (path.endsWith("/gmail/status"))
      return route.fulfill({
        json: {
          available: true,
          status: "connected",
          email: "ashwin@example.test",
          unavailable: false,
          attempt: null,
        },
      });
    if (path.endsWith("/turns")) {
      const body = route.request().postDataJSON();
      intake.tasks = ["Buy groceries", "Go to the gym"];
      intake.ready = true;
      intake.plan = plan;
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
          id: "plan",
          submissionId: body.submissionId,
          role: "assistant",
          content:
            "Here's the plan:\n\n1. Make a grocery list.\n2. Sketch a gym session.\n\nDoes this plan work for you?",
          delivery: "text",
          kind: "message",
        },
      );
    }
    if (path.endsWith("/onboarding/plan")) {
      expect(route.request().postDataJSON()).toEqual({
        action: "accept",
        id: plan.id,
      });
      plan.accepted = true;
      journey.entered = true;
      journey.prepared = true;
      journey.ready = true;
    }
    return route.fulfill({ json: snapshot() });
  });
  return { freshStarts: () => freshStarts };
}

for (const width of [1440, 390, 320])
  test(`progress and immediate plan approval at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto("/onboarding");
    const rail = page.getByRole("complementary", {
      name: "Onboarding progress",
    });
    await expect(rail).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Save and exit", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(rail.locator(".setup-detail:visible")).toHaveCount(0);
    await expect(rail.locator(".setup-trigger")).toHaveCount(5);
    await page.screenshot({
      path: test.info().outputPath("collapsed.png"),
      fullPage: true,
    });
    const assistant = rail.getByRole("button", { name: "Assistant: complete" });
    await assistant.click();
    await expect(rail.getByText("Atom", { exact: true })).toBeVisible();
    await expect(assistant.locator(".setup-mark")).toHaveCSS(
      "color",
      "rgb(35, 133, 83)",
    );
    await assistant.press("Escape");
    await expect(assistant).toBeFocused();
    await expect(assistant).toHaveAttribute("aria-expanded", "false");
    await rail.getByRole("button", { name: "You: complete" }).click();
    await expect(rail.getByText("Ashwin", { exact: true })).toBeVisible();
    await expect(rail.getByText("Atom", { exact: true })).toBeHidden();
    await rail.getByRole("button", { name: "Your tasks: current" }).click();
    await expect(rail.getByText("A place to start")).toBeVisible();
    await expect(rail.locator(".setup-detail:visible")).toHaveCount(1);
    await expect(
      rail.getByRole("button", { name: "Nothing yet" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/persona-progress-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: test.info().outputPath("expanded.png"),
      fullPage: true,
    });
    await rail.getByRole("button", { name: "Your tasks: current" }).click();
    await page
      .getByRole("textbox", { name: "Message Persona" })
      .fill("I want to buy groceries and go to the gym.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("button", { name: "Looks good" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Looks good" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Your plan", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Your saved plan" })
        .getByText("Make a grocery list.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Go to dashboard", exact: true }),
    ).toHaveCount(0);
  });

test("Save and exit returns to the landing page and resumes saved progress", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("link", { name: "Continue setup", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Assistant: complete" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Onboarding progress" })
      .getByText("Atom", { exact: true }),
  ).toBeVisible();
  expect(data.freshStarts()).toBe(1);
});
