import { test, expect, type Page } from "@playwright/test";

type Turn = {
  id: string;
  submissionId: string;
  role: "user" | "assistant";
  content: string;
  channel?: string;
  kind?: string;
};

async function chat(page: Page, turns: Turn[] = [], progress = false) {
  let control = { tabId: "", epoch: 1 };
  const state = {
    conversationId: "presentation",
    turns,
    reply: "Here is your answer.",
    waitForReply: Promise.resolve(),
    gmail: "not_connected",
  };
  const snapshot = () => ({
    conversationId: state.conversationId,
    turns: state.turns,
    revision: state.turns.length,
    operation: null,
    onboarding: progress
      ? {
          facts: {
            agentName: { value: "Persona", status: "known" },
            userName: { value: "Sam", status: "known" },
            helpRequest: { value: null, status: "missing" },
          },
          gmail: "not_connected",
          graduated: false,
          onboardingComplete: false,
        }
      : undefined,
    control,
  });
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
          status: state.gmail,
          email: "sam@example.com",
          attempt: null,
        },
      });
    if (path === "/api/turns") {
      const { submissionId, content } = route.request().postDataJSON();
      await state.waitForReply;
      state.turns.push(
        { id: submissionId, submissionId, role: "user", content },
        {
          id: `reply-${submissionId}`,
          submissionId,
          role: "assistant",
          content: state.reply,
        },
      );
      return route.fulfill({
        json: {
          ...snapshot(),
          operation: { id: submissionId, status: "completed" },
        },
      });
    }
    return route.fulfill({ json: snapshot() });
  });
  return state;
}

for (const width of [1000, 375]) {
  test(`assistant Markdown uses compact paragraphs and contains wide content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await chat(page, [
      {
        id: "formatted",
        submissionId: "formatted",
        role: "assistant",
        content: [
          "Hey!",
          "Would you like to talk this through on a call?",
          "## A clear plan",
          "Read **the brief** and *take notes*. Try `git status` or [the guide](https://example.com/guide).",
          "- First step\n- Second step",
          "1. Review\n2. Send",
          "> Keep it simple.",
          "- [x] Ready\n- [ ] Next",
          "~~Old plan~~",
          "| Task | Owner |\n| --- | --- |\n| Review | Sam |",
          "```text\n" + "long-code-".repeat(60) + "\n```",
          "<script>window.unwanted = true</script>",
          "[Unsafe](javascript:alert(1))",
        ].join("\n\n"),
      },
    ]);
    await page.goto("/onboarding");
    const message = page.locator(".assistant-markdown");
    await expect(
      message.getByRole("heading", { name: "A clear plan" }),
    ).toBeVisible();
    await expect(message.locator("strong")).toHaveText("the brief");
    await expect(message.locator("em")).toHaveText("take notes");
    await expect(message.locator("ol > li")).toHaveCount(2);
    await expect(message.getByRole("checkbox")).toHaveCount(2);
    await expect(message.getByRole("checkbox").first()).toBeChecked();
    await expect(message.locator("del")).toHaveText("Old plan");
    await expect(
      message.getByRole("table").getByRole("cell", { name: "Sam" }),
    ).toBeVisible();
    await expect(
      message.getByRole("link", { name: "the guide" }),
    ).toHaveAttribute("href", "https://example.com/guide");
    await expect(message.locator("script")).toHaveCount(0);
    expect(
      await message.getByText("Unsafe", { exact: true }).getAttribute("href"),
    ).not.toMatch(/^javascript:/i);
    const gap = await message.evaluate((node) => {
      const [first, second] = node.querySelectorAll("p");
      return (
        second.getBoundingClientRect().top -
        first.getBoundingClientRect().bottom
      );
    });
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(15);
    await expect(message.locator("pre")).toHaveCSS("overflow-x", "auto");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`markdown-${width}.png`),
      fullPage: true,
    });
  });
}

test("pending messages contain only user text and the hint stays cleared after send and refresh", async ({
  page,
}) => {
  const state = await chat(page, [
    {
      id: "opening",
      submissionId: "opening",
      role: "assistant",
      kind: "opening",
      content: "Hi, I'm Persona.",
    },
  ]);
  let release!: () => void;
  state.waitForReply = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Message Persona" });
    await expect(input).toHaveAttribute("placeholder", "What's on your mind?");
    await input.fill("Hello **literally**\nSecond line");
    await page.getByRole("button", { name: "Send message" }).click();
    const pending = page.locator(".turn.user.pending");
    await expect(pending).toHaveText("Hello **literally**\nSecond line");
    await expect(pending).toHaveCSS("opacity", "1");
    await expect(pending.locator("strong")).toHaveCount(0);
    await expect(input).toHaveAttribute("placeholder", "");
    release();
    await expect(page.getByText("Here is your answer.")).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "");
    await page.reload();
    await expect(page.getByText("Here is your answer.")).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "");
    state.conversationId = "fresh";
    state.turns = [];
    await page.reload();
    await expect(input).toHaveAttribute("placeholder", "What's on your mind?");
  } finally {
    release();
  }
});

test("a saved spoken user message clears the input hint", async ({ page }) => {
  const state = await chat(page);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "Message Persona" });
  await expect(input).toHaveAttribute("placeholder", "What's on your mind?");
  state.turns.push({
    id: "spoken",
    submissionId: "spoken",
    role: "user",
    channel: "voice",
    content: "Let's talk about my week.",
  });
  await expect(page.getByText("Let's talk about my week.")).toBeVisible({
    timeout: 7000,
  });
  await expect(input).toHaveAttribute("placeholder", "");
});

for (const [width, height] of [
  [1440, 900],
  [375, 740],
  [375, 350],
]) {
  test(`one branded Gmail card stays above the composer across replies at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await chat(
      page,
      [
        {
          id: "gmail",
          submissionId: "gmail",
          role: "assistant",
          content: "You can connect Gmail when you're ready.",
        },
      ],
      true,
    );
    await page.goto("/onboarding");
    const card = page.getByRole("region", { name: "Gmail connection" });
    const connect = card.getByRole("button", {
      name: "Connect Gmail",
      exact: true,
    });
    await expect(connect).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Gmail", exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .getByRole("region", { name: "Conversation", exact: true })
        .getByRole("region", { name: "Gmail connection" }),
    ).toHaveCount(0);
    await expect(card.locator("img")).toHaveAttribute("src", "/gmail.svg");
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const instance = await card.elementHandle();
    const input = page.getByRole("textbox", { name: "Message Persona" });
    for (const text of ["First message", "Second message"]) {
      state.reply = `Reply to ${text}`;
      await input.fill(text);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(state.reply)).toBeVisible();
      await expect(page.locator(".gmail-card")).toHaveCount(1);
      expect(await instance!.evaluate((el) => el.isConnected)).toBe(true);
    }
    const cardBounds = await card.boundingBox();
    const formBounds = await page.locator(".composer").boundingBox();
    expect(cardBounds!.x).toBeGreaterThanOrEqual(0);
    expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(width);
    expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(
      formBounds!.y,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`gmail-${width}x${height}.png`),
      fullPage: true,
    });
    state.gmail = "connected";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card.getByText("Connected as sam@example.com")).toBeVisible();
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  });
}
