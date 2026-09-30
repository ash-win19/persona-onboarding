import { test, expect, type Page } from "@playwright/test";
import { appFixture } from "./app-fixture";

test.setTimeout(60000);
async function workspaceFixture(page: Page) {
  await appFixture(page, { entered: true });
  const priorities: { id: string; title: string; completed: boolean }[] = [];
  const threads: {
    id: string;
    title: string;
    entries: {
      id: string;
      content: string;
      reply: string | null;
      status: string;
    }[];
  }[] = [];
  let fail = false;
  await page.route("**/api/workspace**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = method === "GET" ? null : route.request().postDataJSON();
    if (path === "/api/workspace/priorities" && method === "POST")
      priorities.push({ ...body, completed: false });
    if (path.startsWith("/api/workspace/priorities/") && method === "PATCH")
      priorities.find((p) => p.id === path.split("/").at(-1))!.completed =
        body.completed;
    if (path.startsWith("/api/workspace/threads/")) {
      const id = path.split("/").at(-1)!;
      let thread = threads.find((item) => item.id === id);
      if (method === "POST") {
        if (!thread) {
          thread = { id, title: body.content, entries: [] };
          threads.push(thread);
        }
        let entry = thread.entries.find(
          (item) => item.id === body.submissionId,
        );
        if (!entry) {
          entry = {
            id: body.submissionId,
            content: body.content,
            reply: null,
            status: "generating",
          };
          thread.entries.push(entry);
        }
        entry.status = fail ? "failed" : "completed";
        entry.reply = fail
          ? null
          : "Let's start with a short outline for your proposal.";
        fail = false;
      }
      return route.fulfill({ status: thread ? 200 : 404, json: thread || {} });
    }
    return route.fulfill({
      json: {
        priorities,
        threads: threads.map(({ id, title }) => ({ id, title })),
      },
    });
  });
  return {
    threads,
    failOnce: () => {
      fail = true;
    },
  };
}
for (const width of [1440, 390, 320]) {
  test.describe(`personal intelligence at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("priorities, fresh daily chats, history and settings", async ({
      page,
    }, info) => {
      const fixture = await workspaceFixture(page);
      await page.goto("/dashboard");
      await expect(
        page.getByText("Personal to you", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByLabel("Add a priority", { exact: true })
        .fill("Prepare the proposal");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const priority = page.getByRole("checkbox", {
        name: "Prepare the proposal",
        exact: true,
      });
      await expect(priority).toBeVisible();
      await priority.click();
      await page.locator(".completed-priorities summary").click();
      await expect(priority).toBeChecked();
      await priority.click();
      await page.reload();
      await expect(priority).not.toBeChecked();
      await page.screenshot({
        path: info.outputPath("dashboard.png"),
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "Work on Prepare the proposal" })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Message Persona", exact: true }),
      ).toHaveValue("Help me work on this priority: Prepare the proposal");
      await expect(
        page.getByText("What would you like to call me?", { exact: true }),
      ).toBeHidden();
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(
        page.getByText("Let's start with a short outline for your proposal."),
      ).toBeVisible();
      const previous = fixture.threads[0].id;
      await page
        .getByRole("navigation", { name: "Dashboard navigation" })
        .getByRole("link", { name: "Conversation", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Message Persona", exact: true }),
      ).toHaveValue("");
      await expect(
        page.getByRole("heading", { name: "What can we take off your mind?" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath("daily-chat.png"),
        fullPage: true,
      });
      await page.getByLabel("Conversation history").selectOption(previous);
      await expect(
        page.getByText("Let's start with a short outline for your proposal."),
      ).toBeVisible();
      await page.getByLabel("Conversation history").selectOption("onboarding");
      await expect(page.locator(".onboarding-label")).toContainText(
        "Onboarding",
      );
      await expect(
        page.getByText("What would you like to call me?", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "Settings navigation" })
        .getByRole("link", { name: "Settings", exact: true })
        .click();
      await page
        .getByRole("main")
        .getByRole("link", { name: /Integrations/ })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/settings\/integrations$/);
      await expect(
        page.getByRole("heading", { name: "Integrations." }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reconnect Gmail" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1440) {
        const settings = await page
          .getByRole("link", { name: "Settings", exact: true })
          .first()
          .boundingBox();
        const account = await page
          .getByRole("button", { name: "Account menu", exact: true })
          .boundingBox();
        expect(settings!.y).toBeGreaterThan(650);
        expect(settings!.y).toBeLessThan(account!.y);
      }
    });
  });
}
test("failed daily replies retry without creating another conversation or message", async ({
  page,
}) => {
  const fixture = await workspaceFixture(page);
  fixture.failOnce();
  await page.goto("/dashboard/conversation");
  await page
    .getByRole("textbox", { name: "Message Persona", exact: true })
    .fill("Plan my day");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Retry reply" }).click();
  await expect(
    page.getByText("Let's start with a short outline for your proposal."),
  ).toBeVisible();
  expect(fixture.threads).toHaveLength(1);
  expect(fixture.threads[0].entries).toHaveLength(1);
  await page.goto("/dashboard/connections");
  await expect(page).toHaveURL(/\/dashboard\/settings\/integrations$/);
});
