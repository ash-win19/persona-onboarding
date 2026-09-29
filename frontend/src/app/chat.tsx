"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GmailConnection } from "./gmail-connection";
import { useVoice, type Control, type CallState } from "./use-voice";

type Turn = {
  id: string;
  submissionId: string;
  role: "user" | "assistant";
  content: string;
  channel?: string;
  delivery?: string;
};
type SavedFact = {
  value: string | null;
  status: "missing" | "known" | "ambiguous";
};
type Onboarding = {
  facts: Record<"agentName" | "userName" | "helpRequest", SavedFact>;
  gmail: "connected" | "not_connected";
  graduated: boolean;
  onboardingComplete: boolean;
};
type Snapshot = {
  control?: Control;
  onboarding?: Onboarding;
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

class RequestError extends Error {
  constructor(readonly status: number) {
    super(`REQUEST_${status}`);
  }
}

async function api<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
  owner?: { tabId: string; epoch: number },
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Persona-Client": "web",
      ...(owner
        ? {
            "X-Persona-Tab": owner.tabId,
            "X-Persona-Epoch": String(owner.epoch),
          }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new RequestError(response.status);
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
  const tabId = useRef("");
  const ownerRef = useRef<{ tabId: string; epoch: number } | undefined>(
    undefined,
  );
  const [hasControl, setHasControl] = useState(true);
  const conversationRef = useRef<string | null>(null);
  const resetAttempt = useRef<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const headers = () => ({
    "Content-Type": "application/json",
    "X-Persona-Client": "web",
    ...(ownerRef.current
      ? {
          "X-Persona-Tab": ownerRef.current.tabId,
          "X-Persona-Epoch": String(ownerRef.current.epoch),
        }
      : {}),
  });
  const refresh = async () => {
    const data = await api<Snapshot>("session", new AbortController().signal);
    accept(data);
  };
  const voice = useVoice(headers, refresh);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  function control(value: Control) {
    const mine = value.tabId === tabId.current;
    ownerRef.current = mine
      ? { tabId: tabId.current, epoch: value.epoch }
      : undefined;
    setHasControl(mine);
    if (!mine) voiceRef.current.controlLost();
  }
  async function takeControl() {
    const result = await api<{ control: Control }>(
      "control",
      new AbortController().signal,
      { tabId: tabId.current, takeover: true },
    );
    control(result.control);
    await refresh();
  }

  function accept(data: Snapshot) {
    if (
      conversationRef.current &&
      conversationRef.current !== data.conversationId
    ) {
      setPending(null);
      setDraft("");
      voiceRef.current.controlLost();
    }
    conversationRef.current = data.conversationId;
    if (data.control?.tabId) control(data.control);
    setSnapshot(data);
    setConnection("ready");
    if (data.operation?.status === "completed") {
      setPending((current) =>
        current?.submissionId === data.operation?.id ? null : current,
      );
    }
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
      if (data.control) {
        const claim = await api<{ control: Control }>(
          "control",
          controller.signal,
          { tabId: tabId.current, takeover: false },
        );
        data.control = claim.control;
      }
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
    if (!tabId.current) tabId.current = crypto.randomUUID();
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
    if (!snapshot?.control || !snapshot.conversationId) return;
    const controller = new AbortController();
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(5000),
        ]);
        const claim = await api<{ control: Control }>("control", signal, {
          tabId: tabId.current,
          takeover: false,
        });
        if (controller.signal.aborted) return;
        control(claim.control);
        const status = await api<{ call: CallState | null; control: Control }>(
          "calls/status",
          signal,
        );
        voiceRef.current.reconcile(
          status.call,
          status.control.tabId === tabId.current,
        );
        const data = await api<Snapshot>("session", signal);
        if (!controller.signal.aborted) accept(data);
      } catch {
        if (!controller.signal.aborted) {
          voiceRef.current.controlLost();
          setConnection("unavailable");
        }
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
    // Polling follows the conversation; current media and authority live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.conversationId, !!snapshot?.control]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [snapshot, pending, notice]);

  async function submit(payload: Pending) {
    if (busy) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending((current) => current ?? payload);
    setBusy(true);
    setNotice("");
    try {
      let data: Snapshot;
      if (voice.active && voice.call?.status === "active") {
        await api(
          "calls/turns",
          controller.signal,
          { ...payload, id: voice.call.id },
          ownerRef.current,
        );
        data = await api<Snapshot>("session", controller.signal);
      } else
        data = await api<Snapshot>(
          "turns",
          controller.signal,
          payload,
          ownerRef.current,
        );
      if (controller.signal.aborted) return;
      accept(data);
      await waitForReply(data, controller.signal);
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.status === 409 &&
        !controller.signal.aborted
      ) {
        try {
          const current = await api<Snapshot>("session", controller.signal);
          if (controller.signal.aborted) return;
          accept(current);
          await waitForReply(current, controller.signal);
          return;
        } catch {
          /* Preserve the waiting input if reconciliation is also unavailable. */
        }
      }
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

  async function startOver() {
    if (resetting) return;
    setResetting(true);
    setConfirmReset(false);
    resetAttempt.current ??= crypto.randomUUID();
    active.current?.abort();
    voiceRef.current.controlLost();
    try {
      const data = await api<Snapshot>(
        "reset",
        new AbortController().signal,
        { operationId: resetAttempt.current },
        ownerRef.current,
      );
      accept(data);
      setPending(null);
      setDraft("");
      setNotice("A fresh conversation is ready.");
      resetAttempt.current = null;
    } catch {
      setNotice(
        "Start over could not be confirmed. Use Start over again to retry safely.",
      );
    } finally {
      setResetting(false);
      setBusy(false);
    }
  }

  const agentName = snapshot?.onboarding?.facts.agentName.value || "Persona";
  const unresolved =
    snapshot?.operation && snapshot.operation.status !== "completed"
      ? snapshot.turns.find(
          (turn) =>
            turn.role === "user" &&
            turn.submissionId === snapshot.operation?.id,
        )
      : undefined;
  const retryPayload = unresolved
    ? { submissionId: unresolved.submissionId, content: unresolved.content }
    : pending;
  const canSend =
    connection === "ready" &&
    hasControl &&
    (!voice.active || voice.state === "active") &&
    !resetting &&
    !busy &&
    !retryPayload &&
    !!draft.trim();
  const visibleNotice =
    notice ||
    (!busy && retryPayload
      ? "Your latest result is not confirmed. Retry safely with the same message."
      : "");
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
              What would you like to call me? You can also tell me your name, or
              jump straight into something you need help with.
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
        {snapshot?.control && (
          <div className="conversation-controls">
            {!hasControl ? (
              <p>
                This conversation is controlled in another tab.{" "}
                <button
                  onClick={() =>
                    void takeControl().catch(() =>
                      setNotice("Could not take control. Try again."),
                    )
                  }
                >
                  Take control
                </button>
              </p>
            ) : (
              <div className="call-controls">
                {voice.active ? (
                  <button onClick={() => void voice.end()}>End call</button>
                ) : (
                  <button
                    disabled={connection !== "ready" || busy || !!retryPayload}
                    onClick={() => void voice.start()}
                  >
                    Start a call
                  </button>
                )}
                <span role="status">
                  {voice.state === "permission"
                    ? "Waiting for microphone permission"
                    : voice.state === "connecting"
                      ? "Connecting your call"
                      : voice.state === "active"
                        ? "Call active"
                        : "Voice is optional"}
                </span>
              </div>
            )}
            {voice.notice && (
              <p role="status">
                {voice.notice}
                {voice.notice.includes("Play call audio") && (
                  <button onClick={() => void voice.play()}>
                    Play call audio
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        {snapshot?.control && (
          <>
            <GmailConnection
              headers={headers}
              enabled={hasControl && connection === "ready" && !resetting}
              conversationId={snapshot.conversationId}
              onChanged={refresh}
            />
            <div className="reset-controls">
              {confirmReset ? (
                <div role="alertdialog" aria-label="Start over confirmation">
                  <p>
                    Delete this app&apos;s saved conversation, names, preferences,
                    and Gmail credentials? This does not delete data retained
                    independently by providers.
                  </p>
                  <button onClick={() => void startOver()}>
                    Delete saved conversation
                  </button>
                  <button onClick={() => setConfirmReset(false)}>
                    Keep conversation
                  </button>
                </div>
              ) : (
                <button
                  disabled={!hasControl || resetting}
                  onClick={() => setConfirmReset(true)}
                >
                  {resetting ? "Starting over…" : "Start over"}
                </button>
              )}
            </div>
          </>
        )}
        {snapshot?.onboarding && snapshot.turns.length > 0 && (
          <details className="memory" aria-label="Saved details">
            <summary>What I remember</summary>
            <dl>
              {(
                [
                  ["agentName", "Your assistant"],
                  ["userName", "Your name"],
                  ["helpRequest", "What we are working on"],
                ] as const
              ).map(([key, label]) => {
                const fact = snapshot.onboarding!.facts[key];
                return (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {fact.value || "Not shared yet"}
                      {fact.status === "ambiguous" && (
                        <span className="clarification">
                          Needs clarification
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
              <div>
                <dt>Gmail</dt>
                <dd>
                  {snapshot.onboarding.gmail === "connected"
                    ? "Connected"
                    : "Not connected"}
                </dd>
              </div>
            </dl>
            <p>You can correct any detail in the conversation.</p>
          </details>
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
                {turn.role === "user" ? "You" : agentName}
                <span>
                  {turn.delivery === "interrupted"
                    ? "Saved transcript · interrupted"
                    : turn.channel === "voice"
                      ? "Saved transcript"
                      : "Saved"}
                </span>
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
              {agentName} is thinking<span aria-hidden="true">...</span>
            </p>
          )}
        </div>
        {visibleNotice && (
          <div className="notice" role="status">
            <p>{visibleNotice}</p>
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
