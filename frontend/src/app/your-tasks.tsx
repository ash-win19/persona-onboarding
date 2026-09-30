"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Snapshot } from "./chat";
import { ChatIcon } from "./chat-icons";
import {
  workspaceRequest,
  type OnboardingTask,
  type WorkspaceData,
} from "./workspace-data";

export function YourTasks({
  snapshot,
  data,
  error,
  reload,
  onChanged,
  headers,
  enabled,
}: {
  snapshot: Snapshot | null;
  data: WorkspaceData | null;
  error: string;
  reload: () => void;
  onChanged: (data: WorkspaceData) => void;
  headers: () => Record<string, string>;
  enabled: boolean;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const tasks = data?.onboardingTasks ?? [];
  const completed = tasks.filter((task) => task.completed).length;
  const state = snapshot?.onboarding;
  async function toggle(task: OnboardingTask) {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setSaving(task.id);
    setNotice("");
    try {
      onChanged(
        await workspaceRequest<WorkspaceData>(`/onboarding-tasks/${task.id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ completed: !task.completed }),
        }),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We couldn't update this task. Try again.",
      );
    } finally {
      setSaving(null);
      inFlight.current = false;
    }
  }
  return (
    <div className="your-tasks">
      <section
        className="onboarding-checklist"
        aria-label="Tasks from onboarding"
      >
        <header className="task-list-heading">
          <div>
            <h2>From your conversation</h2>
            <p>Your requests and the next steps you agreed on.</p>
          </div>
          {data && tasks.length > 0 && (
            <span className="task-count" role="status">
              {completed} of {tasks.length} complete
            </span>
          )}
        </header>
        {error ? (
          <div className="workspace-error" role="alert">
            <p>{error}</p>
            <button className="secondary-button" onClick={reload}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <p role="status">Loading your tasks…</p>
        ) : data.onboardingTasks === undefined ? (
          <div className="workspace-error" role="alert">
            <p>Your task list is unavailable. Please try again.</p>
            <button className="secondary-button" onClick={reload}>
              Try again
            </button>
          </div>
        ) : tasks.length ? (
          <>
            <progress
              className="task-progress"
              aria-label="Tasks completed"
              max={tasks.length}
              value={completed}
            />
            <ul className="onboarding-task-list">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={
                    task.completed
                      ? "onboarding-task is-complete"
                      : "onboarding-task"
                  }
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={task.completed}
                      disabled={!enabled || saving !== null}
                      onChange={() => void toggle(task)}
                      aria-label={`Mark ${task.title} ${task.completed ? "incomplete" : "complete"}`}
                    />
                    <span className="task-copy">
                      <span className="task-title">{task.title}</span>
                      <span className="task-source">
                        {saving === task.id
                          ? "Saving…"
                          : task.source === "plan"
                            ? "Plan step"
                            : "Your request"}
                      </span>
                    </span>
                  </label>
                  {!task.completed && (
                    <Link
                      className="task-work-link"
                      href={`/dashboard/conversation?prompt=${encodeURIComponent(`Help me with this task: ${task.title}`)}`}
                      aria-label={`Work on ${task.title}`}
                      title="Work on this with Persona"
                    >
                      <ChatIcon name="arrowRight" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {completed === tasks.length && (
              <p className="tasks-finished">
                Everything checked off. Your next task can start with a
                conversation.
              </p>
            )}
            {!enabled && (
              <p className="workspace-error">
                This tab is viewing only.{" "}
                <Link href="/dashboard/onboarding">Take control</Link> to update
                your tasks.
              </p>
            )}
          </>
        ) : (
          <div className="tasks-empty">
            <ChatIcon name="checklist" />
            <h3>No tasks yet</h3>
            <p>
              When you have something in mind, your Persona is ready to help.
            </p>
            <Link className="brand-button" href="/dashboard/conversation">
              Start a conversation <ChatIcon name="arrowRight" />
            </Link>
          </div>
        )}
        {notice && (
          <p className="workspace-error" role="alert">
            {notice}
          </p>
        )}
      </section>
      <details className="task-setup-details">
        <summary>
          <ChatIcon name="info" />
          <span>Your onboarding details</span>
          <ChatIcon name="arrowDown" />
        </summary>
        <dl>
          <div>
            <dt>Your assistant</dt>
            <dd>{state?.facts.agentName.value || "Not named yet"}</dd>
          </div>
          <div>
            <dt>Your name</dt>
            <dd>{state?.facts.userName.value || "Not shared yet"}</dd>
          </div>
          <div>
            <dt>Gmail</dt>
            <dd>
              {state?.gmail === "connected" ? "Connected" : "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Your plan</dt>
            <dd>
              {state?.intake?.plan?.accepted ? "Accepted" : "Not accepted yet"}
            </dd>
          </div>
        </dl>
        <Link className="text-link" href="/dashboard/onboarding">
          View onboarding conversation <ChatIcon name="arrowRight" />
        </Link>
      </details>
    </div>
  );
}
