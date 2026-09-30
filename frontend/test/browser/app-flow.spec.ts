import { test, expect, type Page } from "@playwright/test";

test.setTimeout(60000);

async function appFixture(
  page: Page,
  { signedIn = true, entered = false, ready = false } = {},
) {
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let call: Record<string, unknown> | null = null;
  let enterAttempts = 0;
  let failEnter = false;
  let freshStarts = 0;
  let callEnds = 0;
  const journey = {
    ready,
    entered,
    prepared: entered,
    delivery: "text",
    message:
      "I've got enough to get you started. Let's head to your dashboard.",
  };
  const turns = [
    {
      id: "opening",
      submissionId: "opening",
      role: "assistant",
      content: "What would you like to call me?",
      delivery: "text",
      kind: "opening",
    },
  ];
  const snapshot = () => ({
    conversationId: "app-flow",
    revision: turns.length,
    turns,
    operation: null,
    control,
    journey,
    onboarding: {
      facts: {
        userName: { value: "Ashwin", status: "known" },
        agentName: { value: "Nova", status: "known" },
        helpRequest: { value: "Prepare for an interview", status: "known" },
      },
      gmail: "not_connected",
      graduated: true,
      onboardingComplete: false,
      policy: { goals: { gmail: { introduced: true } } },
    },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/login") {
      signedIn = true;
      return route.fulfill({ json: snapshot() });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (!signedIn) return route.fulfill({ status: 401, json: {} });
    if (path === "/api/auth/fresh-start") {
      freshStarts++;
      return route.fulfill({ json: snapshot() });
    }
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/start") {
      call = {
        id: route.request().postDataJSON().id,
        status: "active",
        controlReady: true,
        toolAcknowledged: true,
        deadline: new Date(Date.now() + 600000).toISOString(),
        warningAt: new Date(Date.now() + 540000).toISOString(),
      };
      return route.fulfill({ json: { call, sdp: "v=0" } });
    }
    if (path === "/api/calls/end") {
      callEnds++;
      call = null;
      return route.fulfill({ json: { call, control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call, control } });
    if (path === "/api/calls/ready")
      return route.fulfill({ json: { ready: true } });
    if (path === "/api/gmail/status")
      return route.fulfill({
        json: {
          available: true,
          status: "reconnect_needed",
          email: null,
          unavailable: false,
          attempt: null,
        },
      });
    if (path === "/api/journey") {
      const action = route.request().postDataJSON().action;
      if (action === "enter") {
        enterAttempts++;
        if (failEnter) return route.fulfill({ status: 503, json: {} });
        journey.entered = true;
      } else {
        journey.ready = true;
        journey.prepared = true;
        journey.delivery = call ? "waiting" : "text";
      }
      return route.fulfill({ json: snapshot() });
    }
    return route.fulfill({ json: snapshot() });
  });
  return {
    journey,
    setFailure: (v: boolean) => {
      failEnter = v;
    },
    enterAttempts: () => enterAttempts,
    freshStarts: () => freshStarts,
    callEnds: () => callEnds,
  };
}

for (const width of [1440, 390, 320]) {
  test.describe(`app at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("landing, sign-in, skip, dashboard and account form a complete journey", async ({
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
      await page.getByRole("button", { name: "Skip for now" }).click();
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
        page.getByRole("heading", { name: "Welcome, Ashwin." }),
      ).toBeVisible();
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
        .getByRole("navigation", { name: "Dashboard navigation" })
        .getByRole("link", { name: "Connections" })
        .click();
      await expect(
        page.getByRole("button", { name: "Reconnect Gmail" }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "Dashboard navigation" })
        .getByRole("link", { name: "Account" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Account." }),
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
    page.getByRole("heading", { name: "Connections." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connections." }),
  ).toBeVisible();
  expect(fixture.freshStarts()).toBe(0);
  await page.goto("/onboarding?gmail=connected");
  await expect(page).toHaveURL(/\/dashboard\?gmail=connected$/);
  expect(fixture.freshStarts()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Go to dashboard", exact: true }),
  ).toHaveCount(0);
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
