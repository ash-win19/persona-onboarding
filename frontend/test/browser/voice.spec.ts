import { test, expect, type Page } from "@playwright/test";

async function voicePage(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => new MediaStream(),
    });
    class Peer {
      iceGatheringState = "complete";
      connectionState = "new";
      localDescription = { sdp: "v=0" };
      onconnectionstatechange?: () => void;
      createDataChannel() {
        return { close() {} };
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
      }
      close() {
        this.connectionState = "closed";
        this.onconnectionstatechange?.();
      }
    }
    Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
  });
  let control: { tabId: string | null; epoch: number } = {
    tabId: null,
    epoch: 0,
  };
  let call: null | Record<string, unknown> = null;
  const ended: string[] = [];
  const started: string[] = [];
  let holdFirst: (() => Promise<void>) | undefined;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/ready") return route.fulfill({ json: { ready: true } });
    if (path === "/api/control") {
      control = { tabId: route.request().postDataJSON().tabId, epoch: 1 };
      return route.fulfill({ json: { control } });
    }
    if (path === "/api/calls/start") {
      const { id } = route.request().postDataJSON();
      started.push(id);
      call = {
        id,
        status: "active",
        controlReady: true,
        deadline: new Date(Date.now() + 600000).toISOString(),
        warningAt: new Date(Date.now() + 540000).toISOString(),
      };
      if (started.length === 1 && holdFirst) {
        await holdFirst();
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: { call, sdp: "v=0" } });
    }
    if (path === "/api/calls/end") {
      const { id } = route.request().postDataJSON();
      ended.push(id);
      if (call?.id === id)
        call = { ...call, status: "ended", controlReady: false };
      return route.fulfill({ json: { call, control } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call, control } });
    return route.fulfill({
      json: {
        conversationId: "voice-race",
        revision: 0,
        turns: [],
        operation: null,
        control,
      },
    });
  });
  return {
    started,
    ended,
    hold: (fn: () => Promise<void>) => {
      holdFirst = fn;
    },
  };
}

test("a lost setup response cancels the reserved attempt and permits another call", async ({
  page,
}) => {
  const voice = await voicePage(page);
  voice.hold(async () => {});
  await page.goto("/");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(
    page.getByText("The call could not connect.", { exact: false }),
  ).toBeVisible();
  expect(voice.ended).toContain(voice.started[0]);
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.getByText("Call active", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "End call" }).click();
});

test("a cancelled setup failing late cannot end the newer call", async ({
  page,
}) => {
  const voice = await voicePage(page);
  let failOld!: () => void;
  voice.hold(
    () =>
      new Promise<void>((resolve) => {
        failOld = resolve;
      }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect.poll(() => voice.started.length).toBe(1);
  await page.getByRole("button", { name: "End call" }).click();
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.getByText("Call active", { exact: false })).toBeVisible();
  failOld();
  await expect.poll(() => voice.ended.includes(voice.started[0])).toBe(true);
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  expect(voice.ended).not.toContain(voice.started[1]);
  await page.getByRole("button", { name: "End call" }).click();
});

test("successful ownership polling preserves retry after the first message fails", async ({
  page,
}) => {
  await voicePage(page);
  await page.route("**/api/turns", (route) => route.abort("connectionreset"));
  let polled = false;
  page.on("response", (response) => {
    if (response.url().endsWith("/api/calls/status")) polled = true;
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Please keep my first message.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect.poll(() => polled, { timeout: 7000 }).toBe(true);
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(
    page.getByText("Please keep my first message.", { exact: true }),
  ).toBeVisible();
});
