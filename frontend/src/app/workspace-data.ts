export type Priority = { id: string; title: string; completed: boolean };
export type OnboardingTask = Priority & { source: "request" | "plan" };
export type WorkspaceData = {
  onboardingTasks?: OnboardingTask[];
  priorities: Priority[];
  threads: { id: string; title: string }[];
};
export type DailyEntry = {
  id: string;
  content: string;
  reply: string | null;
  status: "generating" | "completed" | "failed";
};
export type DailyThread = { id: string; title: string; entries: DailyEntry[] };

export async function workspaceRequest<T>(
  path = "",
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/workspace${path}`, {
    cache: "no-store",
    ...options,
    signal: AbortSignal.timeout(70000),
  });
  if (response.status === 401)
    window.dispatchEvent(new Event("persona:unauthorized"));
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "This tab needs control. Open Onboarding to take control, then try again."
        : "We couldn't save that. Please try again.",
    );
  return response.json();
}
