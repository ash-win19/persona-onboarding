export type Journey = {
  ready: boolean;
  prepared: boolean;
  entered: boolean;
  message: string;
  delivery: "text" | "waiting" | "played";
};

export const dashboardPaths = [
  "/dashboard",
  "/dashboard/tasks",
  "/dashboard/conversation",
  "/dashboard/connections",
  "/dashboard/account",
  "/dashboard/onboarding",
  "/dashboard/settings",
  "/dashboard/settings/integrations",
] as const;

export function destination(journey?: Journey, requested?: string | null) {
  if (!journey?.entered) return "/onboarding";
  return dashboardPaths.some((path) => path === requested) ||
    /^\/dashboard\/conversation\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requested || "",
    )
    ? requested!
    : "/dashboard";
}

// One request per document load, shared by sign-in and the persistent app layout.
// Only the onboarding entry asks to reset flagged demo accounts. Internal app
// navigation and Gmail returns never create another conversation.
let freshStart: Promise<unknown> | undefined;
export function startFresh() {
  if (sessionStorage.getItem("persona:resume-onboarding") === "true") return;
  if (
    ["gmail", "calendar"].some((key) =>
      new URLSearchParams(window.location.search).has(key),
    )
  )
    return;
  freshStart ??= fetch("/api/auth/fresh-start", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Persona-Client": "web" },
    body: "{}",
    signal: AbortSignal.timeout(65000),
  }).catch(() => undefined);
  return freshStart;
}
