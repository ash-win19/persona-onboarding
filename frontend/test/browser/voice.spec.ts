import { test, expect, type Page } from "@playwright/test";

async function voicePage(page: Page) {
  await page.addInitScript(() => {
    const events: Array<(event: Record<string, unknown>) => void> = [];
    Object.defineProperty(window, "voiceEvents", { value: events });
    class CallAudio {
      autoplay = false;
      srcObject: MediaStream | null = null;
      onplaying?: () => void;
      onpause?: () => void;
      async play() {
        if ((window as unknown as { blockCallAudio?: boolean }).blockCallAudio)
          throw new DOMException("Blocked", "NotAllowedError");
        this.onplaying?.();
      }
      pause() {
        this.onpause?.();
      }
    }
    Object.defineProperty(window, "Audio", { value: CallAudio });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => new MediaStream(),
    });
    class Peer {
      iceGatheringState = "complete";
      connectionState = "new";
      localDescription = { sdp: "v=0" };
      onconnectionstatechange?: () => void;
      ontrack?: (event: { streams: MediaStream[] }) => void;
      createDataChannel() {
        const channel: {
          onmessage?: ((event: { data: string }) => void) | null;
          close: () => void;
        } = { close() {} };
        events.push((event) =>
          channel.onmessage?.({ data: JSON.stringify(event) }),
        );
        return channel;
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected";
        (window as unknown as { voiceConnected: boolean }).voiceConnected =
          true;
        this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [new MediaStream()] });
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
  const turns: {
    id: string;
    role: string;
    content: string;
    submissionId: string;
  }[] = [];
  let conversationId = "voice-race";
  const ended: string[] = [];
  const started: string[] = [];
  const ready: string[] = [];
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
    if (path === "/api/calls/ready") {
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { voiceConnected: boolean }).voiceConnected,
        ),
      ).toBe(true);
      ready.push(route.request().postDataJSON().id);
      return route.fulfill({ json: { ready: true } });
    }
    if (path === "/api/calls/turns") {
      const body = route.request().postDataJSON();
      if (!turns.some((t) => t.submissionId === body.submissionId))
        turns.push({
          id: body.submissionId,
          role: "user",
          content: body.content,
          submissionId: body.submissionId,
        });
      return route.fulfill({ json: { accepted: true, generation: 1 } });
    }
    if (path === "/api/calls/status")
      return route.fulfill({ json: { call, control } });
    return route.fulfill({
      json: {
        conversationId,
        revision: turns.length,
        turns,
        operation: turns.length
          ? { id: turns.at(-1)!.submissionId, status: "completed" }
          : null,
        control,
      },
    });
  });
  return {
    started,
    ready,
    ended,
    reset: () => {
      turns.length = 0;
      conversationId = "fresh-voice-race";
      control = { ...control, epoch: 2 };
      call = null;
    },
    hold: (fn: () => Promise<void>) => {
      holdFirst = fn;
    },
  };
}

test("requests Persona's opening after the peer connects without waiting for user input", async ({
  page,
}) => {
  const voice = await voicePage(page);
  await page.goto("/");
  expect(voice.ready).toHaveLength(0);
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect.poll(() => voice.ready).toEqual(voice.started);
  expect(voice.ready).toHaveLength(1);
  await page.getByRole("button", { name: "End call" }).click();
});

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
  await expect(page.getByText("Listening", { exact: false })).toBeVisible();
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
  await expect(page.getByText("Listening", { exact: false })).toBeVisible();
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

test("typing interrupts an active call and a server reset clears the conversation", async ({
  page,
}) => {
  const voice = await voicePage(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.getByText("Listening", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("Actually, use the shorter example.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Actually, use the shorter example.", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  voice.reset();
  await expect(
    page.getByText("Actually, use the shorter example.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start a call" }),
  ).toBeVisible();
});

async function providerEvent(
  page: Page,
  event: Record<string, unknown>,
  attempt = 0,
) {
  await page.evaluate(
    ({ event, attempt }) => {
      (
        window as unknown as {
          voiceEvents: Array<(event: Record<string, unknown>) => void>;
        }
      ).voiceEvents[attempt](event);
    },
    { event, attempt },
  );
}

test("voice visuals follow speech, generation, playback and interruption without changing the composer", async ({
  page,
}) => {
  await voicePage(page);
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Start a call" }).click();
  const banner = page.locator(".call-banner");
  await expect(banner).toContainText("Listening");
  await providerEvent(page, { type: "input_audio_buffer.speech_started" });
  await expect(banner).toContainText("Listening");
  await providerEvent(page, { type: "input_audio_buffer.committed" });
  await expect(banner).toContainText("Persona is thinking");
  await expect(banner.locator("[data-processing]")).toBeAttached();
  await expect
    .poll(() =>
      banner.locator("[data-voice-beam]").evaluate((element) => {
        const id = element.getAttribute("data-voice-beam");
        return parseFloat(
          (element as HTMLElement).style.getPropertyValue(`--vb-glow-${id}`),
        );
      }),
    )
    .toBeGreaterThan(0.1);
  await expect
    .poll(() =>
      banner.locator("[data-voice-beam]").evaluate((element) => {
        const id = element.getAttribute("data-voice-beam");
        return parseFloat(
          getComputedStyle(element).getPropertyValue(`--vb-opacity-${id}`),
        );
      }),
    )
    .toBeGreaterThan(0.99);
  await page.screenshot({ path: test.info().outputPath("voice-thinking.png") });
  await providerEvent(page, {
    type: "response.created",
    response: { id: "old" },
  });
  await providerEvent(page, {
    type: "output_audio_buffer.started",
    response_id: "old",
  });
  await expect(banner).toContainText("Persona is speaking");
  await providerEvent(page, {
    type: "response.done",
    response: {
      id: "old",
      status: "completed",
      output: [{ type: "message", content: [{ type: "audio" }] }],
    },
  });
  await expect(banner).toContainText("Persona is speaking");
  await providerEvent(page, { type: "input_audio_buffer.speech_started" });
  await expect(banner).toContainText("Listening");
  await providerEvent(page, { type: "input_audio_buffer.committed" });
  await providerEvent(page, {
    type: "response.created",
    response: { id: "new" },
  });
  await providerEvent(page, {
    type: "output_audio_buffer.cleared",
    response_id: "old",
  });
  await expect(banner).toContainText("Persona is thinking");
  await providerEvent(page, {
    type: "output_audio_buffer.started",
    response_id: "new",
  });
  await expect(banner).toContainText("Persona is speaking");
  await page
    .getByRole("textbox", { name: "Message Persona" })
    .fill("A shorter answer please.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(banner).toContainText("Persona is thinking");
  await providerEvent(page, {
    type: "output_audio_buffer.started",
    response_id: "new",
  });
  await expect(banner).toContainText("Persona is thinking");
  await page.getByRole("button", { name: "End call" }).click();
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("blocked playback never shows speaking, and a successful retry clears the notice", async ({
  page,
}) => {
  await voicePage(page);
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { blockCallAudio: boolean }).blockCallAudio = true;
  });
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(
    page.getByRole("button", { name: "Play call audio" }),
  ).toBeVisible();
  await providerEvent(page, {
    type: "response.created",
    response: { id: "reply" },
  });
  await providerEvent(page, {
    type: "output_audio_buffer.started",
    response_id: "reply",
  });
  await expect(page.locator(".call-banner")).toContainText(
    "Call audio is paused",
  );
  await expect(page.locator("[data-voice-beam]")).toHaveCount(0);
  await page.getByRole("button", { name: "Play call audio" }).click();
  await expect(
    page.getByRole("button", { name: "Play call audio" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { blockCallAudio: boolean }).blockCallAudio = false;
  });
  await page.getByRole("button", { name: "Play call audio" }).click();
  await expect(page.locator(".call-banner")).toContainText(
    "Persona is speaking",
  );
  await expect(
    page.getByRole("button", { name: "Play call audio" }),
  ).toHaveCount(0);
  await providerEvent(page, {
    type: "output_audio_buffer.stopped",
    response_id: "reply",
  });
  await expect(page.locator(".call-banner")).toContainText("Listening");
});

test("reduced motion stays static while voice status updates and old attempts stay detached", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 600 });
  await voicePage(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.locator(".call-animation-static")).toBeVisible();
  await expect(page.locator(".call-banner")).toContainText("Listening");
  await page.screenshot({
    path: test.info().outputPath("voice-mobile-reduced-motion.png"),
  });
  await providerEvent(page, {
    type: "response.created",
    response: { id: "old" },
  });
  await expect(page.locator(".call-banner")).toContainText(
    "Persona is thinking",
  );
  await expect(page.locator("[data-voice-beam]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End call" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "End call" }).click();
  await page.getByRole("button", { name: "Start a call" }).click();
  await expect(page.locator(".call-banner")).toContainText("Listening");
  await providerEvent(page, {
    type: "output_audio_buffer.started",
    response_id: "old",
  });
  await expect(page.locator(".call-banner")).toContainText("Listening");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("[data-voice-beam]")).toBeAttached();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-voice-beam]")).toHaveCount(0);
  await providerEvent(
    page,
    { type: "response.created", response: { id: "background" } },
    1,
  );
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".call-banner")).toContainText(
    "Persona is thinking",
  );
  await expect(page.locator("[data-processing]")).toBeAttached();
});
