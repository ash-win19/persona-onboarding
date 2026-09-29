import { test, expect, type Page } from "@playwright/test";

type Turn = {
  id: string;
  submissionId: string;
  role: "user" | "assistant";
  content: string;
};
const snapshot = (
  turns: Turn[],
  operation: { id: string; status: string } | null,
) => ({ conversationId: "streamed", revision: turns.length, turns, operation });
const sse = (events: [string, unknown][]) =>
  events
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");

async function mock(
  page: Page,
  turns: (request: { submissionId: string; content: string }) => string,
  session: () => object,
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ready"))
      return route.fulfill({ json: { ready: true } });
    if (path.endsWith("/auth/fresh-start"))
      return route.fulfill({ json: { conversationId: "streamed" } });
    if (path.endsWith("/turns")) {
      expect(route.request().headers()["accept"]).toBe("text/event-stream");
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: turns(route.request().postDataJSON()),
      });
    }
    return route.fulfill({ json: session() });
  });
}

test("a streamed Markdown reply keeps its formatting when saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (String(input) !== "/api/turns") return response;
      const body = await response.text();
      const done = body.indexOf("event: done");
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(body.slice(0, done)));
            window.addEventListener(
              "finish-test-stream",
              () => {
                controller.enqueue(encoder.encode(body.slice(done)));
                controller.close();
              },
              { once: true },
            );
          },
        }),
        { headers: response.headers },
      );
    };
  });
  await mock(
    page,
    ({ submissionId, content }) => {
      const user: Turn = { id: "u", submissionId, role: "user", content };
      return sse([
        [
          "snapshot",
          snapshot([user], { id: submissionId, status: "generating" }),
        ],
        ["delta", { text: "Here is **a " }],
        ["delta", { text: "plan**.\n\n- First step\n- Second step" }],
        [
          "done",
          snapshot(
            [
              user,
              {
                id: "a",
                submissionId,
                role: "assistant",
                content: "Here is **a plan**.\n\n- First step\n- Second step",
              },
            ],
            { id: submissionId, status: "completed" },
          ),
        ],
      ]);
    },
    () => snapshot([], null),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Plan my week.");
  await page.getByRole("button", { name: "Send message" }).click();
  const reply = page.locator(".assistant-markdown");
  await expect(page.getByRole("log", { name: "Messages" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(reply.locator("strong")).toHaveText("a plan");
  await expect(reply.locator("li")).toHaveText(["First step", "Second step"]);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("finish-test-stream")),
  );
  await expect(page.getByText("Here is a plan.")).toHaveCount(1);
  await expect(reply.locator("strong")).toHaveText("a plan");
  await expect(reply.locator("li")).toHaveText(["First step", "Second step"]);
  await expect(page.getByText("Plan my week.")).toBeVisible();
  await expect(page.getByText("Not yet confirmed")).toHaveCount(0);
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(page.getByRole("log", { name: "Messages" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("button", { name: "Retry message" })).toHaveCount(
    0,
  );
});

test("a stream cut off after saving recovers the saved reply", async ({
  page,
}) => {
  let saved: Turn[] = [];
  await mock(
    page,
    ({ submissionId, content }) => {
      const user: Turn = { id: "u", submissionId, role: "user", content };
      saved = [
        user,
        {
          id: "a",
          submissionId,
          role: "assistant",
          content: "The full reply was saved.",
        },
      ];
      return sse([
        [
          "snapshot",
          snapshot([user], { id: submissionId, status: "generating" }),
        ],
        ["delta", { text: "The full" }],
      ]);
    },
    () =>
      snapshot(
        saved,
        saved.length
          ? { id: saved[0].submissionId, status: "completed" }
          : null,
      ),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Keep going.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("The full reply was saved.")).toBeVisible();
  await expect(page.getByText(/^The full$/)).toHaveCount(0);
  await expect(
    page.getByText("Connection interrupted", { exact: false }),
  ).toHaveCount(0);
});
