"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Turn = {
  id: string;
  submissionId: string;
  role: "user" | "assistant";
  content: string;
};
type Snapshot = {
  conversationId: string;
  revision: number;
  turns: Turn[];
  operation: {
    id: string;
    status: "generating" | "completed" | "failed";
  } | null;
};
type Pending = { submissionId: string; content: string };
type Connection = "connecting" | "ready" | "unavailable";

async function api<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Persona-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error(`REQUEST_${response.status}`);
  return response.json();
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export default function Chat() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState(
    "Connecting to your conversation. This may take a moment.",
  );
  const active = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  function accept(data: Snapshot) {
    setSnapshot(data);
    setConnection("ready");
    if (data.operation?.status === "completed") setPending(null);
    setNotice(
      data.operation?.status === "failed"
        ? "Your message is saved. The reply could not finish. You can try again."
        : "",
    );
  }

  async function waitForReply(data: Snapshot, signal: AbortSignal) {
    let current = data;
    for (
      let attempt = 0;
      current.operation?.status === "generating" && attempt < 15;
      attempt++
    ) {
      await pause(2000, signal);
      current = await api<Snapshot>("session", signal);
      if (!signal.aborted) accept(current);
    }
    if (current.operation?.status === "generating" && !signal.aborted)
      setNotice(
        "Your message is saved. The reply is still processing. Check again in a moment.",
      );
  }

  async function connect(controller: AbortController) {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const readiness = await api<{ ready: boolean }>(
            "ready",
            controller.signal,
          );
          if (!readiness.ready) throw new Error("NOT_READY");
          break;
        } catch (error) {
          if (controller.signal.aborted || attempt === 3) throw error;
          await pause(1000 * (attempt + 1), controller.signal);
        }
      }
      const data = await api<Snapshot>("session", controller.signal, {});
      if (controller.signal.aborted) return;
      accept(data);
      await waitForReply(data, controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        setConnection("unavailable");
        setNotice(
          "We could not connect yet. Your conversation stays here. Try connecting again.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => {
      void connect(controller);
    }, 0);
    return () => {
      clearTimeout(timer);
      active.current?.abort();
    };
    // Connection starts once per mounted page; user retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [snapshot, pending, notice]);

  async function submit(payload: Pending) {
    if (busy) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(payload);
    setBusy(true);
    setNotice("");
    try {
      const data = await api<Snapshot>("turns", controller.signal, payload);
      if (controller.signal.aborted) return;
      accept(data);
      await waitForReply(data, controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        setConnection("unavailable");
        setNotice(
          "Connection interrupted. We have not confirmed the latest result. Retry safely with the same message.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const unresolved =
    snapshot?.operation && snapshot.operation.status !== "completed"
      ? snapshot.turns.find(
          (turn) =>
            turn.role === "user" &&
            turn.submissionId === snapshot.operation?.id,
        )
      : undefined;
  const retryPayload =
    pending ??
    (unresolved
      ? { submissionId: unresolved.submissionId, content: unresolved.content }
      : null);
  const canSend =
    connection === "ready" && !busy && !retryPayload && !!draft.trim();
  const shownPending =
    pending &&
    !snapshot?.turns.some(
      (turn) =>
        turn.role === "user" && turn.submissionId === pending.submissionId,
    );

  function retry() {
    if (retryPayload) {
      void submit(retryPayload);
      return;
    }
    setConnection("connecting");
    setBusy(true);
    setNotice("Connecting to your conversation. This may take a moment.");
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    void connect(controller);
  }

  function sendDraft() {
    if (!canSend) return;
    const payload = {
      submissionId: crypto.randomUUID(),
      content: draft.trim(),
    };
    setDraft("");
    void submit(payload);
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <Link className="wordmark" href="/" aria-label="Persona home">
          <span className="persona-mark" aria-hidden="true">
            p
          </span>
          persona<span className="wordmark-dot">.</span>
        </Link>
        <div className={`connection ${connection}`} role="status">
          <span aria-hidden="true" />
          {connection === "ready"
            ? "Connected"
            : connection === "connecting"
              ? "Connecting"
              : "Connection interrupted"}
        </div>
      </header>
      <section className="conversation" aria-label="Conversation">
        {!snapshot?.turns.length && !pending && (
          <div className="welcome">
            <span className="eyebrow">A SPACE TO THINK TOGETHER</span>
            <h1>
              A little help.
              <br />
              <em>A little more headspace.</em>
            </h1>
            <p>
              Bring a question, a half-formed idea, or something on your mind.
              We can work through it together.
            </p>
            <div className="suggestions">
              {[
                "Prepare for an interview",
                "Untangle an idea",
                "Plan my week",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setDraft(suggestion);
                    input.current?.focus();
                  }}
                >
                  {suggestion}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="turns"
          role="log"
          aria-label="Messages"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {snapshot?.turns.map((turn) => (
            <article key={turn.id} className={`turn ${turn.role}`}>
              <div className="turn-label">
                {turn.role === "user" ? "You" : "Persona"}
                <span>Saved</span>
              </div>
              <p>{turn.content}</p>
            </article>
          ))}
          {shownPending && (
            <article className="turn user pending">
              <div className="turn-label">
                You<span>Not yet confirmed</span>
              </div>
              <p>{pending.content}</p>
            </article>
          )}
          {busy && (pending || unresolved) && (
            <p className="thinking" role="status">
              Persona is thinking<span aria-hidden="true">...</span>
            </p>
          )}
        </div>
        {notice && (
          <div className="notice" role="status">
            <p>{notice}</p>
            {!busy && (
              <button onClick={retry}>
                {retryPayload ? "Retry message" : "Try connecting again"}
              </button>
            )}
          </div>
        )}
        <div ref={end} />
      </section>
      <footer className="composer-area">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendDraft();
          }}
        >
          <label className="sr-only" htmlFor="message">
            Message Persona
          </label>
          <textarea
            ref={input}
            id="message"
            value={draft}
            rows={2}
            maxLength={8000}
            placeholder="What's on your mind?"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                sendDraft();
              }
            }}
          />
          <button
            className="send"
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
          >
            <span aria-hidden="true">↑</span>
          </button>
        </form>
        <p className="privacy-note">
          Your conversation is saved for this browser. Pick up where you left
          off.
        </p>
      </footer>
    </main>
  );
}
