import { test, expect } from "@playwright/test";

test("a concurrent reply finishing during reconciliation keeps the waiting message retryable", async ({
  page,
}) => {
  let conflicted = false;
  let waitingId = "";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (path.endsWith("/auth/fresh-start"))
      return route.fulfill({ json: { conversationId: "one" } });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          conversationId: "one",
          revision: conflicted ? 2 : 0,
          turns: conflicted
            ? [
                {
                  id: "previous",
                  submissionId: "previous",
                  role: "assistant",
                  content: "The concurrent reply finished.",
                },
              ]
            : [],
          operation: conflicted
            ? { id: "previous", status: "completed" }
            : null,
        },
      });
    const body = route.request().postDataJSON();
    if (!conflicted) {
      conflicted = true;
      waitingId = body.submissionId;
      return route.fulfill({ status: 409, json: {} });
    }
    expect(body.submissionId).toBe(waitingId);
    return route.fulfill({
      json: {
        conversationId: "one",
        revision: 4,
        turns: [
          {
            id: "waiting",
            submissionId: waitingId,
            role: "user",
            content: body.content,
          },
          {
            id: "reply",
            submissionId: waitingId,
            role: "assistant",
            content: "Now your reply is saved.",
          },
        ],
        operation: { id: waitingId, status: "completed" },
      },
    });
  });
  await page.goto("/onboarding");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Keep my concurrent request.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("The concurrent reply finished.")).toBeVisible();
  await page
    .getByRole("button", { name: "Retry message" })
    .click({ timeout: 5000 });
  await expect(page.getByText("Now your reply is saved.")).toBeVisible();
});

test("a stale tab recovers the saved operation without losing its waiting message", async ({
  page,
}) => {
  let phase = "empty";
  let waitingId = "";
  const turns = [
    {
      id: "earlier",
      submissionId: "earlier",
      role: "user",
      content: "The earlier request.",
    },
  ];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (path.endsWith("/auth/fresh-start"))
      return route.fulfill({ json: { conversationId: "one" } });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          conversationId: "one",
          revision: phase === "empty" ? 0 : 1,
          turns: phase === "empty" ? [] : turns,
          operation:
            phase === "empty" ? null : { id: "earlier", status: "failed" },
        },
      });
    const body = route.request().postDataJSON();
    if (phase === "empty") {
      waitingId = body.submissionId;
      phase = "blocked";
      return route.fulfill({ status: 409, json: { code: "REQUEST_REJECTED" } });
    }
    if (phase === "blocked") {
      if (body.submissionId !== "earlier")
        return route.fulfill({
          status: 409,
          json: { code: "REQUEST_REJECTED" },
        });
      phase = "recovered";
      turns.push({
        id: "reply",
        submissionId: "earlier",
        role: "assistant",
        content: "The earlier reply.",
      });
    } else {
      expect(body.submissionId).toBe(waitingId);
      turns.push({
        id: "waiting",
        submissionId: waitingId,
        role: "user",
        content: body.content,
      });
      turns.push({
        id: "new-reply",
        submissionId: waitingId,
        role: "assistant",
        content: "The waiting reply.",
      });
    }
    return route.fulfill({
      json: {
        conversationId: "one",
        revision: turns.length,
        turns,
        operation: { id: body.submissionId, status: "completed" },
      },
    });
  });
  await page.goto("/onboarding");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("My waiting request.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("The earlier request.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("My waiting request.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(
    page.getByText("The earlier reply.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(
    page.getByText("The waiting reply.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("My waiting request.", { exact: true }),
  ).toHaveCount(1);
});

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
  await page.goto("/onboarding");
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
    if (path.endsWith("/auth/fresh-start"))
      return route.fulfill({ json: { conversationId: "one" } });
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
  await page.goto("/onboarding");
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
  await page.goto("/onboarding");
  await expect(page.getByText("Opening your conversation…")).toBeVisible();
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
  await page.goto("/onboarding");
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

test("onboarding invites a name and restores corrected facts without a form", async ({
  page,
}) => {
  let saved = false;
  let submissionId = "s";
  const opening = {
    id: "opening",
    submissionId: "opening",
    role: "assistant",
    kind: "opening",
    content: "Hi, I'm Persona. What would you like to call me?",
  };
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (route.request().url().endsWith("/turns")) {
      saved = true;
      submissionId = route.request().postDataJSON().submissionId;
    }
    return route.fulfill({
      json: {
        conversationId: "one",
        revision: saved ? 3 : 0,
        turns: saved
          ? [
              opening,
              {
                id: "u",
                submissionId,
                role: "user",
                content:
                  "Call yourself Nova. Actually, call me Sam. Help me prepare for an interview.",
              },
              {
                id: "a",
                submissionId,
                role: "assistant",
                content: "Sam, start with a short introduction.",
              },
            ]
          : [opening],
        operation: saved ? { id: submissionId, status: "completed" } : null,
        onboarding: {
          graduated: saved,
          onboardingComplete: false,
          gmail: "not_connected",
          facts: {
            agentName: {
              value: saved ? "Nova" : null,
              status: saved ? "known" : "missing",
            },
            userName: {
              value: saved ? "Sam" : null,
              status: saved ? "known" : "missing",
            },
            helpRequest: {
              value: saved ? "prepare for an interview" : null,
              status: saved ? "known" : "missing",
            },
          },
        },
      },
    });
  });
  await page.goto("/onboarding");
  await expect(page.getByText(/what would you like to call me/i)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill(
      "Call yourself Nova. Actually, call me Sam. Help me prepare for an interview.",
    );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Sam, start with a short introduction."),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Nova", exact: true })
      .filter({ hasText: "Sam, start with a short introduction." }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByText("Sam, start with a short introduction."),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Nova", exact: true })
      .filter({ hasText: "Sam, start with a short introduction." }),
  ).toHaveCount(1);
});
test("declined microphone permission leaves the saved text conversation usable", async ({
  page,
}) => {
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let attemptedCalls = 0;
  const snapshot = {
    conversationId: "voice-permission-check",
    revision: 0,
    turns: [] as {
      id: string;
      submissionId: string;
      role: string;
      content: string;
    }[],
    operation: null as null | { id: string; status: string },
  };
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Declined", "NotAllowedError")),
    });
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
    if (path === "/api/calls/start") {
      attemptedCalls++;
      return route.fulfill({ status: 503, json: {} });
    }
    if (path === "/api/turns") {
      const body = route.request().postDataJSON();
      snapshot.turns = [
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
          content: "We can keep typing.",
        },
      ];
      snapshot.operation = { id: body.submissionId, status: "completed" };
    }
    return route.fulfill({ json: { ...snapshot, control } });
  });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(
    page.getByText("Microphone access was declined.", { exact: false }),
  ).toBeVisible();
  expect(attemptedCalls).toBe(0);
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Let's type instead.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("We can keep typing.", { exact: true }),
  ).toBeVisible();
});
