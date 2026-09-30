"use client";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./chat";
import { ChatIcon } from "./chat-icons";

export function OnboardingProgress({
  snapshot,
  enabled,
  onSave,
}: {
  snapshot: Snapshot;
  enabled: boolean;
  onSave: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rail = useRef<HTMLElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
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
      pending: "Use Connect Gmail below the chat",
    },
    ...(state.calendarAvailable
      ? [
          {
            id: "calendar",
            label: "Calendar",
            done: state.calendar === "connected",
            value: state.calendar === "connected" ? "Connected" : null,
            pending: "Use Connect Google Calendar below the chat",
          },
        ]
      : []),
    {
      id: "tasks",
      label: "Your tasks",
      done: !!intake?.tasks.length || !!intake?.noTasks,
      value: intake?.noTasks ? "Nothing yet" : intake?.tasks.join("\n"),
      pending: "A place to start",
    },
  ];
  const first = rows.find((r) => !r.done)?.id;
  const saved = rows.filter((r) => r.done).length;
  // Steps already saved when the rail appeared don't animate; a step saved
  // while it is on screen gets a brief pop, then settles.
  const doneKey = rows
    .filter((r) => r.done)
    .map((r) => r.id)
    .join(" ");
  const [settled, setSettled] = useState(doneKey);
  useEffect(() => {
    if (doneKey === settled) return;
    const timer = setTimeout(() => setSettled(doneKey), 900);
    return () => clearTimeout(timer);
  }, [doneKey, settled]);
  const justSaved = (id: string) => !settled.split(" ").includes(id);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) setExpanded(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);
  function close() {
    if (expanded) triggers.current[expanded]?.focus();
    setExpanded(null);
  }
  function edit(id: string, initial: string | null | undefined) {
    setEditing(id);
    setValue(initial ?? "");
    setExpanded(id);
  }
  return (
    <aside
      ref={rail}
      className="setup-rail"
      aria-label="Onboarding progress"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <h2 className="sr-only">Your setup</h2>
      <p className="sr-only" role="status">
        {saved} of {rows.length} setup items saved.
      </p>
      <ol id="setup-steps" className="setup-steps">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`setup-step ${row.done ? "is-saved" : row.id === first ? "is-current" : "is-pending"}${row.done && justSaved(row.id) ? " is-just-saved" : ""}`}
          >
            <button
              className="setup-trigger"
              ref={(node) => {
                triggers.current[row.id] = node;
              }}
              aria-label={`${row.label}: ${row.done ? "complete" : row.id === first ? "current" : "up next"}`}
              title={row.label}
              aria-expanded={expanded === row.id}
              aria-controls={`setup-detail-${row.id}`}
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}
            >
              <span className="setup-mark" aria-hidden="true">
                <ChatIcon name="check" />
                <span className="setup-dot" />
              </span>
            </button>
            <section
              id={`setup-detail-${row.id}`}
              className="setup-detail"
              aria-label={`${row.label} details`}
              hidden={expanded !== row.id}
            >
              <div className="setup-label">
                <h3>{row.label}</h3>
                <span className="sr-only">
                  {row.done ? " saved" : " pending"}
                </span>
                <button
                  type="button"
                  onClick={close}
                  aria-label={`Close ${row.label.toLowerCase()} details`}
                >
                  <ChatIcon name="close" />
                </button>
              </div>
              <p className="setup-phase-status">
                {row.done
                  ? "Complete"
                  : row.id === first
                    ? "In progress"
                    : "Up next"}
              </p>
              {["agentName", "userName", "tasks"].includes(row.id) &&
                editing !== row.id && (
                  <button
                    className="setup-edit-toggle"
                    disabled={!enabled}
                    aria-label={`Edit ${row.label.toLowerCase()}`}
                    onClick={() => edit(row.id, row.value)}
                  >
                    {row.done ? "Edit" : "Add"}
                  </button>
                )}
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
            </section>
          </li>
        ))}
      </ol>
    </aside>
  );
}
