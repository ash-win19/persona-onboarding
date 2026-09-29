import { test, expect, type Page } from "@playwright/test";

async function conversation(page: Page, longHistory = false) {
  let control = { tabId: "", epoch: 1 };
  let reads = 0;
  const turns = longHistory
    ? Array.from({ length: 30 }, (_, index) => ({
        id: `turn-${index}`,
        submissionId: `submission-${index}`,
        role: index % 2 ? "assistant" : "user",
        content: `Message ${index + 1}. Let's work through the interview together. Start with the project you enjoyed most and the problem it solved.`,
      }))
    : [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { ...control, tabId: route.request().postDataJSON().tabId };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { control, call: null } });
    if (path === "/api/gmail/status")
      return route.fulfill({
        json: {
          available: true,
          status: "not_connected",
          email: null,
          unavailable: false,
          attempt: null,
        },
      });
    reads++;
    return route.fulfill({
      json: {
        conversationId: "one-continuous-conversation",
        revision: turns.length,
        turns,
        operation: null,
        control,
        onboarding: {
          gmail: "not_connected",
          graduated: longHistory,
          onboardingComplete: false,
          facts: {
            agentName: { value: "Nova", status: "known" },
            userName: { value: "Sam", status: "known" },
            helpRequest: { value: "Prepare for an interview", status: "known" },
          },
        },
      },
    });
  });
  return { turns, reads: () => reads };
}

test("reading earlier messages survives polling and new replies until jumping to latest", async ({
  page,
}) => {
  const saved = await conversation(page, true);
  await page.goto("/");
  const history = page.getByRole("region", {
    name: "Conversation",
    exact: true,
  });
  await expect(page.getByRole("log").locator("article")).toHaveCount(30);
  await expect
    .poll(() => history.evaluate((area) => area.scrollTop))
    .toBeGreaterThan(0);
  await history.evaluate((area) => {
    area.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "Back to latest" }),
  ).toBeVisible();
  const before = saved.reads();
  saved.turns.push({
    id: "new-reply",
    submissionId: "new",
    role: "assistant",
    content: "Here is your next practice question.",
  });
  await expect.poll(saved.reads, { timeout: 6000 }).toBeGreaterThan(before);
  await expect(
    page.getByText("Here is your next practice question."),
  ).toHaveCount(1);
  expect(await history.evaluate((area) => area.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(
    page.getByText("Here is your next practice question."),
  ).toBeInViewport();
});

test("mobile has one usable composer and details close without losing a draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await conversation(page);
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Persona" });
  await page.getByRole("button", { name: "Prepare for an interview" }).click();
  await expect(input).toHaveValue("Prepare for an interview");
  await expect(input).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Start a call" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "What I remember" }).click();
  await expect(
    page.getByRole("dialog", { name: "Your conversation" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Saved details" })
      .getByText("Sam", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "What I remember" }),
  ).toBeFocused();
  await expect(input).toHaveValue("Prepare for an interview");
  await expect(page.getByRole("textbox")).toHaveCount(1);
});
