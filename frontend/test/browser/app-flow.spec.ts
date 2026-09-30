import { test, expect } from "@playwright/test";

import { appFixture } from "./app-fixture";

test.setTimeout(60000);

for (const width of [1440, 390, 320]) {
  test.describe(`app at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("landing, sign-in, existing graduation, dashboard and account form a complete journey", async ({
      page,
    }, testInfo) => {
      const fixture = await appFixture(page, { signedIn: false });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "A little less to do.A little more you.",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("landing.png"),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("ash@example.test");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/onboarding$/);
      fixture.journey.ready = true;
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Go to dashboard", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Pause countdown" }).click();
      await page.screenshot({
        path: testInfo.outputPath("handoff.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Go to dashboard", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(
        page.getByRole("heading", { name: "Your day, Ashwin." }),
      ).toBeVisible();
      if (width === 1440) {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        await expect(
          page.getByRole("link", { name: "Overview", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Expand sidebar" }).click();
      }
      const profile = page.getByRole("button", {
        name: "Account menu",
        exact: true,
      });
      expect((await profile.boundingBox())!.y).toBeGreaterThan(700);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("dashboard.png"),
        fullPage: true,
      });
      await page
        .getByRole("navigation", { name: "Settings navigation" })
        .getByRole("link", { name: "Settings", exact: true })
        .click();
      await page
        .getByRole("main")
        .getByRole("link", { name: /Integrations/ })
        .click();
      await expect(
        page.getByRole("button", { name: "Reconnect Gmail" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Dashboard navigation" })
          .getByRole("link", { name: "Account" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Account menu", exact: true })
        .click();
      await expect(
        page.getByRole("navigation", { name: "Account navigation" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("navigation", { name: "Account navigation" }),
      ).toBeHidden();
      await expect(profile).toBeFocused();
      await page.keyboard.press("Space");
      await page.screenshot({
        path: testInfo.outputPath("account-menu.png"),
        fullPage: true,
      });
      await page
        .getByRole("navigation", { name: "Account navigation" })
        .getByRole("link", { name: "My Account", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "My Account." }),
      ).toBeVisible();
      await page
        .getByRole("main")
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await expect(page).toHaveURL(/\/sign-in$/);
      expect(fixture.enterAttempts()).toBe(1);
    });
  });
}

test("a five-second countdown navigates once and failed entry can be retried", async ({
  page,
}) => {
  const fixture = await appFixture(page, { ready: true });
  fixture.setFailure(true);
  await page.goto("/onboarding");
  await expect(page.getByText("Opening in 5s", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "couldn't open" }),
  ).toBeVisible({ timeout: 10000 });
  expect(fixture.enterAttempts()).toBe(1);
  await expect(page).toHaveURL(/\/onboarding$/);
  fixture.setFailure(false);
  await page
    .getByRole("button", { name: "Go to dashboard", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(fixture.enterAttempts()).toBe(2);
});

test("return visits and Gmail callbacks keep dashboard access without fresh-start requests", async ({
  page,
}) => {
  const fixture = await appFixture(page, { entered: true });
  await page.goto("/dashboard/connections");
  await expect(
    page.getByRole("heading", { name: "Integrations." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Integrations." }),
  ).toBeVisible();
  expect(fixture.freshStarts()).toBe(0);
  await page.goto("/onboarding?gmail=connected");
  await expect(page).toHaveURL(/\/dashboard\?gmail=connected$/);
  expect(fixture.freshStarts()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Go to dashboard", exact: true }),
  ).toHaveCount(0);
});

test("the dashboard heading takes focus on reload without a focus ring", async ({
  page,
}) => {
  await appFixture(page, { entered: true });
  await page.goto("/dashboard");
  await page.reload();
  const heading = page.getByRole("heading", { level: 1 });
  // Focus still moves to the heading so screen readers announce the page.
  await expect(heading).toBeFocused();
  expect(
    await heading.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
});

test("deep links require a session and onboarding cannot be bypassed", async ({
  page,
}) => {
  await appFixture(page, { signedIn: false });
  await page.goto("/dashboard/account");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email", { exact: true }).fill("ash@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("voice countdown waits for playback and navigation preserves the peer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => new MediaStream(),
    });
    class AudioStub {
      srcObject: unknown;
      onplaying?: () => void;
      onpause?: () => void;
      autoplay = false;
      async play() {
        this.onplaying?.();
      }
      pause() {
        this.onpause?.();
      }
    }
    class Peer {
      iceGatheringState = "complete";
      connectionState = "new";
      localDescription = { sdp: "v=0" };
      onconnectionstatechange?: () => void;
      ontrack?: (e: { streams: MediaStream[] }) => void;
      createDataChannel() {
        return { close() {}, onmessage: null };
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [new MediaStream()] });
      }
      close() {
        (window as unknown as { peerClosed: boolean }).peerClosed = true;
      }
    }
    Object.defineProperty(window, "Audio", { value: AudioStub });
    Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
  });
  const fixture = await appFixture(page);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  fixture.journey.ready = true;
  await expect(
    page.getByRole("button", { name: "Go to dashboard", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByText("Your Persona is finishing up.", { exact: true }),
  ).toBeVisible();
  // Generation/transcript readiness is insufficient. Only the server's matching
  // uninterrupted playback receipt permits the timer to begin.
  await page.waitForTimeout(5200);
  expect(fixture.enterAttempts()).toBe(0);
  fixture.journey.delivery = "played";
  await expect(page.getByText("Opening in 5s", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 });
  await expect(
    page.getByText("Your call continues", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { peerClosed?: boolean }).peerClosed,
    ),
  ).not.toBe(true);
  expect(fixture.callEnds()).toBe(0);
  await page
    .getByRole("link", { name: "Open conversation", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  expect(fixture.callEnds()).toBe(0);
});
