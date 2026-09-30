"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { PersonaMark } from "./persona-logo";
import { ChatIcon } from "./chat-icons";
import { starters } from "./daily-chat";
import {
  workspaceRequest,
  type Priority,
  type WorkspaceData,
} from "./workspace-data";

export function IntelligenceDashboard({
  data,
  error,
  reload,
  onChanged,
  headers,
  enabled,
  task,
  agent,
}: {
  data: WorkspaceData | null;
  error: string;
  reload: () => void;
  onChanged: (data: WorkspaceData) => void;
  headers: () => Record<string, string>;
  enabled: boolean;
  task?: string | null;
  agent: string;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<{ id: string; title: string } | null>(null);
  const priorities = data?.priorities || [];
  const open = priorities.filter((item) => !item.completed);
  const done = priorities.filter((item) => item.completed);
  async function add(value: string) {
    if (!enabled || saving || !value.trim()) return;
    if (request.current?.title !== value.trim())
      request.current = { id: crypto.randomUUID(), title: value.trim() };
    setSaving(true);
    setNotice("");
    try {
      onChanged(
        await workspaceRequest<WorkspaceData>("/priorities", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(request.current),
        }),
      );
      setTitle("");
      request.current = null;
    } catch {
      setNotice("We couldn't save your priority. Try again.");
    } finally {
      setSaving(false);
    }
  }
  async function toggle(item: Priority) {
    setSaving(true);
    setNotice("");
    try {
      onChanged(
        await workspaceRequest<WorkspaceData>(`/priorities/${item.id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ completed: !item.completed }),
        }),
      );
    } catch {
      setNotice("We couldn't update that priority. Try again.");
    } finally {
      setSaving(false);
    }
  }
  const row = (item: Priority) => (
    <li
      key={item.id}
      className={item.completed ? "priority-row is-done" : "priority-row"}
    >
      <label>
        <input
          type="checkbox"
          checked={item.completed}
          disabled={!enabled || saving}
          onChange={() => void toggle(item)}
        />
        <span>{item.title}</span>
      </label>
      {!item.completed && (
        <Link
          href={`/dashboard/conversation?prompt=${encodeURIComponent(`Help me work on this priority: ${item.title}`)}`}
          aria-label={`Work on ${item.title}`}
          title="Work on this with Persona"
        >
          <ChatIcon name="arrowRight" />
        </Link>
      )}
    </li>
  );
  return (
    <>
      <section className="daily-brief">
        <div>
          <p className="eyebrow">A LITTLE LESS TO DO. A LITTLE MORE YOU.</p>
          <h2>
            Make space for
            <br />
            what matters.
          </h2>
          <p>
            Get the small things out of your head.
            <br />
            Give the important things your attention.
          </p>
          <a href="#priorities" className="brand-button">
            Set your focus <ChatIcon name="arrowDown" />
          </a>
        </div>
        <div className="brief-art" aria-hidden="true">
          <div className="brief-orbit orbit-one" />
          <div className="brief-orbit orbit-two" />
          <div className="brief-orbit orbit-three" />
          <div className="brief-core">
            <PersonaMark />
          </div>
        </div>
      </section>
      <div className="intelligence-grid">
        <section
          className="priorities-card"
          id="priorities"
          aria-labelledby="priorities-heading"
        >
          <header>
            <div>
              <p className="eyebrow">TURN INTENT INTO ACTION</p>
              <h2 id="priorities-heading">Your priorities</h2>
            </div>
            {data && <span className="count-badge">{open.length} open</span>}
          </header>
          <p className="section-description">
            One place for the things you want to get done.
          </p>
          {error ? (
            <div role="alert" className="workspace-error">
              <p>{error}</p>
              <button className="secondary-button" onClick={reload}>
                Try again
              </button>
            </div>
          ) : !data ? (
            <p role="status">Loading your priorities…</p>
          ) : (
            <>
              <form
                className="priority-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add(title);
                }}
              >
                <label className="sr-only" htmlFor="priority-input">
                  Add a priority
                </label>
                <ChatIcon name="plus" />
                <input
                  id="priority-input"
                  placeholder="What would you like to get done?"
                  value={title}
                  maxLength={500}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <button
                  className="brand-button"
                  disabled={!enabled || saving || !title.trim()}
                >
                  {saving ? "Saving…" : "Add"}
                </button>
              </form>
              {open.length ? (
                <ul className="priority-list">{open.map(row)}</ul>
              ) : (
                <div className="priority-empty">
                  <ChatIcon name="check" />
                  <h3>
                    {done.length
                      ? "A little more room to breathe."
                      : "Start with one thing."}
                  </h3>
                  <p>
                    {done.length
                      ? "Your saved priorities are complete. Add your next one whenever you're ready."
                      : "A task, an idea, a loose end. Add it above, then work through it with Persona."}
                  </p>
                </div>
              )}
              {task &&
                task.length <= 500 &&
                !priorities.some((item) => item.title === task) && (
                  <div className="first-priority">
                    <span className="type-badge">From onboarding</span>
                    <p>{task}</p>
                    <button
                      className="text-link"
                      disabled={!enabled || saving}
                      onClick={() => void add(task)}
                    >
                      Add to priorities <ChatIcon name="plus" />
                    </button>
                  </div>
                )}
              {!!done.length && (
                <details className="completed-priorities">
                  <summary>
                    Completed <span>{done.length}</span>
                  </summary>
                  <ul className="priority-list">{done.map(row)}</ul>
                </details>
              )}
              {!enabled && (
                <p className="workspace-error">
                  This tab is viewing only.{" "}
                  <Link href="/dashboard/onboarding">Take control</Link> to
                  manage priorities.
                </p>
              )}
            </>
          )}
          {notice && (
            <p role="alert" className="workspace-error">
              {notice}
            </p>
          )}
        </section>
        <aside className="intelligence-aside">
          <section className="band-card">
            <div className="card-topline">
              <ChatIcon name="band" />
              <span className="type-badge">PERSONA BAND</span>
            </div>
            <h2>
              Your intelligence.
              <br />
              Within reach.
            </h2>
            <p>
              Capture what matters in the moment, with Persona on your wrist.
            </p>
            <div className="band-availability">
              <span className="status-dot" />
              Pairing isn&apos;t available here yet.
            </div>
            <a
              href="https://yourpersona.com/band"
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >
              Meet Persona Band <ChatIcon name="arrowRight" />
            </a>
          </section>
          <section className="context-card">
            <ChatIcon name="spark" />
            <h2>A familiar starting point.</h2>
            <p>
              {agent} carries your accepted profile details into each new daily
              chat. Your setup conversation stays in Onboarding.
            </p>
            <Link className="text-link" href="/dashboard/onboarding">
              View onboarding <span className="type-badge">Onboarding</span>
            </Link>
          </section>
        </aside>
      </div>
      <section className="helpful-starts">
        <header>
          <h2>A little help goes a long way.</h2>
          <p>Pick a starting point. Make it your own.</p>
        </header>
        <div>
          {starters.map((starter) => (
            <Link
              key={starter.title}
              href={`/dashboard/conversation?prompt=${encodeURIComponent(starter.prompt)}`}
            >
              <ChatIcon name={starter.icon} />
              <h3>{starter.title}</h3>
              <p>{starter.detail}</p>
              <ChatIcon name="arrowRight" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
