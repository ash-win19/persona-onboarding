import { test, expect } from "@playwright/test";

test("a visitor sends a message and sees the committed reply", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (route.request().url().endsWith("/session"))
      return route.fulfill({
        json: {
          conversationId: "conversation-1",
          revision: 0,
          turns: [],
          operation: null,
        },
      });
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        conversationId: "conversation-1",
        revision: 2,
        turns: [
          {
            id: "user-1",
            submissionId: body.submissionId,
            role: "user",
            content: body.content,
          },
          {
            id: "assistant-1",
            submissionId: body.submissionId,
            role: "assistant",
            content: "Let us practice your introduction.",
          },
        ],
        operation: {
          id: body.submissionId,
          status: "completed",
          errorCode: null,
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Help me prepare for an interview.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Let us practice your introduction."),
  ).toBeVisible();
  await expect(
    page.getByText("Help me prepare for an interview.", { exact: true }),
  ).toHaveCount(1);
});

test("retry keeps the same submission identifier after losing a committed response", async ({
  page,
}) => {
  const submissions: string[] = [];
  let turns: {
    id: string;
    submissionId: string;
    role: string;
    content: string;
  }[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          conversationId: "one",
          revision: turns.length,
          turns,
          operation: turns.length
            ? { id: turns[0].submissionId, status: "completed" }
            : null,
        },
      });
    const body = route.request().postDataJSON();
    submissions.push(body.submissionId);
    turns = [
      {
        id: "u",
        submissionId: body.submissionId,
        role: "user",
        content: body.content,
      },
      {
        id: "a",
        submissionId: body.submissionId,
        role: "assistant",
        content: "Your reply was saved.",
      },
    ];
    if (submissions.length === 1) return route.abort("connectionreset");
    return route.fulfill({
      json: {
        conversationId: "one",
        revision: 2,
        turns,
        operation: { id: body.submissionId, status: "completed" },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Keep this message.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Not yet confirmed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(page.getByText("Your reply was saved.")).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toBe(submissions[0]);
  await expect(
    page.getByText("Keep this message.", { exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.getByText("Your reply was saved.")).toBeVisible();
});

test("readiness retries are bounded and a deliberate retry recovers", async ({
  page,
}) => {
  let ready = false;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/ready"))
      return route.fulfill({ status: ready ? 200 : 503, json: { ready } });
    return route.fulfill({
      json: { conversationId: "one", revision: 0, turns: [], operation: null },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Connecting to your conversation. This may take a moment."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Do not lose my draft.");
  await expect(
    page.getByRole("button", { name: "Try connecting again" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  ready = true;
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await expect(page.getByRole("textbox")).toHaveValue("Do not lose my draft.");
});

test("database failure preserves both committed history and pending input", async ({
  page,
}) => {
  const history = [
    {
      id: "old",
      submissionId: "old",
      role: "assistant",
      content: "This earlier reply is saved.",
    },
  ];
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (route.request().url().endsWith("/session"))
      return route.fulfill({
        json: {
          conversationId: "one",
          revision: 1,
          turns: history,
          operation: null,
        },
      });
    return route.fulfill({
      status: 503,
      json: { code: "SERVICE_UNAVAILABLE" },
    });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("My pending message.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(page.getByText("This earlier reply is saved.")).toBeVisible();
  await expect(page.getByText("My pending message.")).toBeVisible();
  await expect(
    page.getByText("Not yet confirmed", { exact: true }),
  ).toBeVisible();
});
