"use client";
import { useState, type ReactNode } from "react";
import type { Snapshot } from "./chat";
import { ChatIcon } from "./chat-icons";

export function OnboardingProgress({
  snapshot,
  gmail,
  enabled,
  onSave,
}: {
  snapshot: Snapshot;
  gmail: ReactNode;
  enabled: boolean;
  onSave: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const state = snapshot.onboarding!;
  const intake = state.intake;
  const rows = [
    {
      id: "agentName",
      label: "Assistant",
      done: state.facts.agentName.status === "known",
      value: state.facts.agentName.value,
      pending: "Choose a name",
    },
    {
      id: "userName",
      label: "You",
      done: state.facts.userName.status === "known",
      value: state.facts.userName.value,
      pending: "Your preferred name",
    },
    {
      id: "gmail",
      label: "Gmail",
      done: state.gmail === "connected",
      value: state.gmail === "connected" ? "Connected" : null,
      pending: "Connection required",
    },
    {
      id: "tasks",
      label: "Your tasks",
      done: !!intake?.tasks.length || !!intake?.noTasks,
      value: intake?.noTasks ? "Nothing yet" : intake?.tasks.join("\n"),
      pending: "A place to start",
    },
    {
      id: "plan",
      label: "Plan",
      done: !!intake?.plan?.accepted,
      value: intake?.plan?.accepted ? "Accepted" : null,
      pending: intake?.ready ? "Ready to review" : "Up next",
    },
  ];
  const first = rows.find((r) => !r.done)?.id;
  const saved = rows.filter((r) => r.done).length;
  function edit(id: string, initial: string | null | undefined) {
    setEditing(id);
    setValue(initial ?? "");
    setExpanded(true);
  }
  return (
    <aside
      className="setup-rail"
      aria-label="Onboarding progress"
      data-expanded={expanded}
    >
      <h2>Your setup</h2>
      <button
        className="setup-summary"
        aria-expanded={expanded}
        aria-controls="setup-steps"
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          Your setup <span className="setup-count">{saved} of 5</span>
        </span>
        <ChatIcon name={expanded ? "arrowUp" : "arrowDown"} />
      </button>
      <p className="sr-only" role="status">
        {saved} of 5 setup items saved.
      </p>
      <ol id="setup-steps" className="setup-steps">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`setup-step ${row.done ? "is-saved" : row.id === first ? "is-current" : "is-pending"}`}
          >
            <span className="setup-mark" aria-hidden="true">
              {row.done ? <ChatIcon name="check" /> : <span />}
            </span>
            <div className="setup-detail">
              <div className="setup-label">
                <span>{row.label}</span>
                <span className="sr-only">
                  {row.done ? " saved" : " pending"}
                </span>
                {["agentName", "userName", "tasks"].includes(row.id) && (
                  <button
                    disabled={!enabled}
                    aria-label={`Edit ${row.label.toLowerCase()}`}
                    onClick={() => edit(row.id, row.value)}
                  >
                    {row.done ? "Edit" : "Add"}
                  </button>
                )}
              </div>
              {editing === row.id ? (
                <form
                  className="setup-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!value.trim()) return;
                    onSave(
                      row.id === "agentName"
                        ? `Call yourself ${value.trim()}.`
                        : row.id === "userName"
                          ? `Call me ${value.trim()}.`
                          : `Replace my tasks with: ${value.trim()}`,
                    );
                    setEditing(null);
                  }}
                >
                  <label className="sr-only" htmlFor={`edit-${row.id}`}>
                    {row.label}
                  </label>
                  <textarea
                    id={`edit-${row.id}`}
                    autoFocus
                    value={value}
                    rows={row.id === "tasks" ? 3 : 1}
                    maxLength={row.id === "tasks" ? 2000 : 100}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <div>
                    <button disabled={!enabled || !value.trim()} type="submit">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p className="setup-value">{row.value || row.pending}</p>
              )}
              {row.id === "tasks" && !row.done && (
                <button
                  className="setup-later"
                  disabled={!enabled}
                  onClick={() => onSave("I don't have any tasks yet.")}
                >
                  Nothing yet
                </button>
              )}
              {row.id === "gmail" && gmail}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
