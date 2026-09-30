import { test, expect, type Page } from "@playwright/test";
import { appFixture } from "./app-fixture";

async function taskFixture(page: Page, empty = false) {
  await appFixture(page, { entered: true });
  const tasks = empty
    ? []
    : [
        {
          id: "a".repeat(64),
          title: "Prepare for an interview",
          source: "request",
          completed: false,
        },
        {
          id: "b".repeat(64),
          title: "Draft answers to three practice questions",
          source: "plan",
          completed: false,
        },
        {
          id: "c".repeat(64),
          title: "Research the company and write down questions for the team",
          source: "plan",
          completed: true,
        },
      ];
  let failSave = false;
  let failLoad = false;
  await page.route("**/api/workspace**", async (route) => {
    if (route.request().method() === "PATCH") {
      if (failSave) return route.fulfill({ status: 503, json: {} });
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      tasks.find((task) => task.id === id)!.completed = route
        .request()
        .postDataJSON().completed;
    } else if (failLoad) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: { priorities: [], threads: [], onboardingTasks: tasks },
    });
  });
  return {
    failSave: (value: boolean) => {
      failSave = value;
    },
    failLoad: (value: boolean) => {
      failLoad = value;
    },
  };
}

for (const width of [1440, 390, 320]) {
  test(`saved onboarding tasks can be checked, restored and reopened at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await taskFixture(page);
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Dashboard navigation" })
      .getByRole("link", { name: "Your Tasks" })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/tasks$/);
    await expect(
      page.getByRole("heading", { name: "Your Tasks." }),
    ).toBeVisible();
    await expect(page.getByText("1 of 3 complete")).toBeVisible();
    const checkbox = page.getByRole("checkbox", {
      name: /^Mark Prepare for an interview/,
    });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByText("2 of 3 complete")).toBeVisible();
    await page.reload();
    await expect(checkbox).toBeChecked();
    fixture.failSave(true);
    await checkbox.click();
    await expect(
      page
        .getByRole("region", { name: "Tasks from onboarding" })
        .getByRole("alert"),
    ).toContainText("We couldn't save that");
    await expect(checkbox).toBeChecked();
    fixture.failSave(false);
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    await page.getByText("Your onboarding details", { exact: true }).click();
    await expect(
      page.locator(".task-setup-details").getByText("Nova", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("your-tasks.png"),
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Work on Prepare for an interview" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message Persona" }),
    ).toHaveValue("Help me with this task: Prepare for an interview");
  });
}

test("empty tasks and workspace recovery stay actionable", async ({ page }) => {
  const fixture = await taskFixture(page, true);
  fixture.failLoad(true);
  await page.goto("/dashboard/tasks");
  await expect(
    page
      .getByRole("region", { name: "Tasks from onboarding" })
      .getByRole("alert"),
  ).toContainText("couldn't load your workspace");
  fixture.failLoad(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "No tasks yet" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Start a conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/conversation$/);
});
