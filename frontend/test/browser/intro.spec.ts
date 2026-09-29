import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, returning = false) {
  let opened = returning;
  let control = { tabId: "", epoch: 1 };
  const turns = [
    {
      id: "opening",
      submissionId: "opening",
      role: "assistant",
      kind: "opening",
      content: "Hi, I'm Persona. What would you like to call me?",
    },
  ];
  if (returning)
    turns.push({
      id: "reply",
      submissionId: "reply",
      role: "assistant",
      kind: "message",
      content: "Let's continue preparing for your interview.",
    });
  let release: (() => void) | undefined;
  let hold = false;
  const sent: string[] = [];
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
          attempt: null,
        },
      });
    if (path === "/api/turns") {
      const body = route.request().postDataJSON();
      sent.push(body.content);
      turns.push({
        id: body.submissionId,
        submissionId: body.submissionId,
        role: "user",
        kind: "message",
        content: body.content,
      });
    }
    let introduction = false;
    if (path === "/api/session" && route.request().method() === "POST") {
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      introduction = !opened;
      opened = true;
    }
    return route.fulfill({
      json: {
        conversationId: "intro",
        turns,
        revision: turns.length,
        operation: null,
        control,
        introduction,
      },
    });
  });
  return {
    sent,
    turns,
    hold: () => {
      hold = true;
    },
    release: async () => {
      await expect.poll(() => !!release).toBe(true);
      release!();
    },
  };
}

test("Persona opens once and refreshing restores the greeting without replaying the hero", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() => {
    (window as unknown as { sawIntro: boolean }).sawIntro = false;
    new MutationObserver(() => {
      if (document.querySelector(".is-introducing"))
        (window as unknown as { sawIntro: boolean }).sawIntro = true;
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto("/");
  await expect(
    page.getByText("Hi, I'm Persona. What would you like to call me?", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".welcome")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { sawIntro: boolean }).sawIntro,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("Hi, I'm Persona. What would you like to call me?", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Start a call" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { sawIntro: boolean }).sawIntro,
    ),
  ).toBe(false);
});

test("typing during the entrance cancels it without replacing the composer or its selection", async ({
  page,
}) => {
  const saved = await setup(page);
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (!document.querySelector(".is-introducing")) return;
      const input = document.querySelector<HTMLTextAreaElement>("#message")!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "Help me with my interview");
      input.focus();
      input.setSelectionRange(7, 7);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (
        window as unknown as { originalComposer: HTMLTextAreaElement }
      ).originalComposer = input;
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Persona" });
  await expect(input).toHaveValue("Help me with my interview");
  await expect(page.locator(".welcome")).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(
    await input.evaluate(
      (el) =>
        el ===
          (window as unknown as { originalComposer: HTMLTextAreaElement })
            .originalComposer &&
        (el as HTMLTextAreaElement).selectionStart === 7,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => saved.sent).toEqual(["Help me with my interview"]);
});

test("loading preserves a draft and returning history never flashes the new-user hero", async ({
  page,
}) => {
  const saved = await setup(page, true);
  saved.hold();
  await page.goto("/");
  await expect(page.getByText("Opening your conversation…")).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Persona" });
  await input.fill("Keep this draft");
  await expect(page.locator(".welcome")).toHaveCount(0);
  await saved.release();
  await expect(
    page.getByText("Let's continue preparing for your interview."),
  ).toBeVisible();
  await expect(input).toHaveValue("Keep this draft");
  await expect(page.locator(".welcome")).toHaveCount(0);
});

test("reduced motion presents the saved opening immediately and Gmail appears only in context", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const saved = await setup(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start a call" }),
  ).toBeEnabled();
  await expect(page.locator(".welcome, .opening-arriving")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toHaveCount(0);
  saved.turns.push({
    id: "gmail-invitation",
    submissionId: "gmail-invitation",
    role: "assistant",
    kind: "message",
    content: "Would you like to connect Gmail, or keep going here for now?",
  });
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByRole("button", { name: "Connect Gmail", exact: true }),
  ).toBeVisible();
});
