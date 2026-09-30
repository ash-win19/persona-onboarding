import type { Page } from "@playwright/test";

export async function appFixture(
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
    if (path === "/api/workspace")
      return route.fulfill({ json: { priorities: [], threads: [] } });
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
