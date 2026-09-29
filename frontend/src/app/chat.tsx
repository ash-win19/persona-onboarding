"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GmailConnection } from "./gmail-connection";
import { useVoice, type Control, type CallState } from "./use-voice";
import { ChatIcon, PersonaMark } from "./chat-icons";
import { ConversationDialog } from "./conversation-dialog";

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
  const scrollArea = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [gmailNotice, setGmailNotice] = useState("");
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
  const [resetNotice, setResetNotice] = useState("");
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
      setResetNotice("");
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

  const lastTurn = snapshot?.turns.at(-1);
  useEffect(() => {
    const area = scrollArea.current;
    if (area && followLatest.current) area.scrollTop = area.scrollHeight;
  }, [lastTurn?.id, lastTurn?.content, pending?.submissionId, busy]);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  }, [draft]);

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
    setResetNotice("");
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
      setDetailsOpen(false);
      followLatest.current = true;
      setShowJump(false);
      setNotice("A fresh conversation is ready.");
      resetAttempt.current = null;
    } catch {
      setResetNotice(
        "Start over could not be confirmed. Retry to check the result safely.",
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
    followLatest.current = true;
    setShowJump(false);
    void submit(payload);
  }

  const empty = !snapshot?.turns.length && !pending;
  const callStatus =
    voice.state === "permission"
      ? "Waiting for microphone permission"
      : voice.state === "connecting"
        ? "Connecting your call"
        : "Call active";

  return (
    <main className={`chat-shell ${empty ? "is-empty" : "has-messages"}`}>
      <header className="chat-header">
        <Link className="wordmark" href="/" aria-label="Persona home">
          <PersonaMark />
          persona
        </Link>
        <div className="header-actions">
          <div className={`connection ${connection}`} role="status">
            <span aria-hidden="true" />
            {connection === "ready"
              ? "Connected"
              : connection === "connecting"
                ? "Connecting"
                : "Connection interrupted"}
          </div>
          <button
            className="details-button"
            type="button"
            onClick={() => setDetailsOpen(true)}
          >
            <ChatIcon name="memory" />
            <span>What I remember</span>
          </button>
        </div>
      </header>

      <section
        ref={scrollArea}
        className="conversation"
        aria-label="Conversation"
        onScroll={(event) => {
          const area = event.currentTarget;
          const nearEnd =
            area.scrollHeight - area.scrollTop - area.clientHeight < 80;
          followLatest.current = nearEnd;
          setShowJump(!nearEnd);
        }}
      >
        <div className="conversation-content">
          {empty && (
            <div className="welcome">
              <div className="welcome-mark">
                <PersonaMark />
              </div>
              <h1>Where should we start?</h1>
              <p>
                What would you like to call me?
                <br />
                Or jump right into something you need a hand with.
              </p>
              <div className="suggestions" aria-label="Conversation starters">
                {(
                  [
                    ["briefcase", "Prepare for an interview", "Find the words"],
                    ["idea", "Untangle an idea", "Think it through"],
                    ["calendar", "Plan my week", "Make some room"],
                  ] as const
                ).map(([icon, suggestion, caption]) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setDraft(suggestion);
                      input.current?.focus();
                    }}
                  >
                    <ChatIcon name={icon} />
                    <span>
                      <strong>{suggestion}</strong>
                      <small>{caption}</small>
                    </span>
                    <ChatIcon name="arrowRight" className="suggestion-arrow" />
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
                {turn.role === "assistant" && (
                  <PersonaMark className="message-mark" />
                )}
                <div className="turn-body">
                  <div className="turn-label">
                    {turn.role === "user" ? "You" : agentName}
                    <span
                      className={
                        turn.channel === "voice" ||
                        turn.delivery === "interrupted"
                          ? "delivery"
                          : "sr-only"
                      }
                    >
                      {turn.delivery === "interrupted"
                        ? "Saved transcript · interrupted"
                        : turn.channel === "voice"
                          ? "Saved transcript"
                          : "Saved"}
                    </span>
                  </div>
                  <p>{turn.content}</p>
                </div>
              </article>
            ))}
            {shownPending && (
              <article className="turn user pending">
                <div className="turn-body">
                  <div className="turn-label">
                    You<span className="delivery">Not yet confirmed</span>
                  </div>
                  <p>{pending.content}</p>
                </div>
              </article>
            )}
            {busy && (pending || unresolved) && (
              <div className="thinking" role="status">
                <PersonaMark />
                <span>{agentName} is thinking</span>
                <span className="thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="composer-area">
        {!detailsOpen && resetNotice && (
          <div className="notice" role="status">
            <p>{resetNotice}</p>
            <button type="button" onClick={() => setDetailsOpen(true)}>
              Review start over
            </button>
          </div>
        )}
        {showJump && (
          <button
            className="jump-button"
            type="button"
            onClick={() => {
              followLatest.current = true;
              setShowJump(false);
              scrollArea.current?.scrollTo({
                top: scrollArea.current.scrollHeight,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
              });
            }}
          >
            <ChatIcon name="arrowDown" /> Back to latest
          </button>
        )}
        {!hasControl && snapshot?.control && (
          <div className="notice" role="status">
            <p>This conversation is controlled in another tab.</p>
            <button
              type="button"
              onClick={() =>
                void takeControl().catch(() =>
                  setNotice("Could not take control. Try again."),
                )
              }
            >
              Take control
            </button>
          </div>
        )}
        {visibleNotice && (
          <div className="notice" role="status">
            <p>{visibleNotice}</p>
            {!busy && (
              <button type="button" onClick={retry}>
                {retryPayload ? "Retry message" : "Try connecting again"}
              </button>
            )}
          </div>
        )}
        {gmailNotice && (
          <div className="notice gmail-notice" role="status">
            <p>{gmailNotice}</p>
          </div>
        )}
        {voice.notice && (
          <div className="notice voice-notice" role="status">
            <p>{voice.notice}</p>
            {voice.notice.includes("Play call audio") && (
              <button type="button" onClick={() => void voice.play()}>
                Play call audio
              </button>
            )}
          </div>
        )}
        {voice.active && (
          <div className="call-banner" role="status">
            <span
              className={`voice-bars ${voice.state === "active" ? "is-active" : ""}`}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>{callStatus}</strong>
              <small>You can speak or keep typing here.</small>
            </span>
            <button
              type="button"
              className="end-call"
              onClick={() => void voice.end()}
            >
              <ChatIcon name="stop" /> End call
            </button>
          </div>
        )}
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
            rows={1}
            maxLength={8000}
            placeholder={
              voice.active
                ? "Type to join the conversation…"
                : "What's on your mind?"
            }
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
          <div className="composer-toolbar">
            <div className="composer-tools">
              {snapshot?.control && (
                <GmailConnection
                  key={snapshot.conversationId}
                  headers={headers}
                  enabled={hasControl && connection === "ready" && !resetting}
                  conversationId={snapshot.conversationId}
                  onChanged={refresh}
                  onNotice={setGmailNotice}
                />
              )}
            </div>
            <div className="send-tools">
              {snapshot?.control && !voice.active && (
                <button
                  className="voice-button"
                  type="button"
                  disabled={
                    !hasControl ||
                    connection !== "ready" ||
                    busy ||
                    !!retryPayload ||
                    resetting
                  }
                  onClick={() => void voice.start()}
                >
                  <ChatIcon name="headphones" /> Start a call
                </button>
              )}
              <button
                className="send"
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
              >
                <ChatIcon name="arrowUp" />
              </button>
            </div>
          </div>
        </form>
        <p className="privacy-note">
          <span>One conversation. Pick up where you left off.</span>
          <span className="keyboard-hint">Shift + Enter for a new line</span>
        </p>
      </footer>

      <ConversationDialog
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setConfirmReset(false);
        }}
      >
        <section className="memory" role="group" aria-label="Saved details">
          <h3>Saved details</h3>
          <dl>
            {(
              [
                ["agentName", "Your assistant"],
                ["userName", "Your name"],
                ["helpRequest", "What we are working on"],
              ] as const
            ).map(([key, label]) => {
              const fact = snapshot?.onboarding?.facts[key];
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {fact?.value || "Not shared yet"}
                    {fact?.status === "ambiguous" && (
                      <span className="clarification">Needs clarification</span>
                    )}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>Gmail</dt>
              <dd>
                {snapshot?.onboarding?.gmail === "connected"
                  ? "Connected"
                  : "Not connected"}
              </dd>
            </div>
          </dl>
          <p>You can correct any detail in the conversation.</p>
        </section>
        <div className="conversation-info">
          <ChatIcon name="info" />
          <p>
            This conversation is saved for this browser. Voice and text share
            the same history.
          </p>
        </div>
        {snapshot?.control && (
          <div className="reset-controls">
            {resetNotice ? (
              <div className="notice" role="alert">
                <p>{resetNotice}</p>
                <button
                  type="button"
                  disabled={!hasControl || resetting}
                  onClick={() => void startOver()}
                >
                  Retry start over
                </button>
              </div>
            ) : confirmReset ? (
              <div role="alertdialog" aria-label="Start over confirmation">
                <h3>Start over?</h3>
                <p>
                  Delete this app&apos;s saved conversation, names, preferences,
                  and Gmail credentials? This does not delete data retained
                  independently by providers.
                </p>
                <div className="reset-actions">
                  <button
                    className="destructive-button"
                    type="button"
                    onClick={() => void startOver()}
                  >
                    Delete saved conversation
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setConfirmReset(false)}
                  >
                    Keep conversation
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="reset-button"
                type="button"
                disabled={!hasControl || resetting}
                onClick={() => setConfirmReset(true)}
              >
                <ChatIcon name="reset" />
                {resetting ? "Starting over…" : "Start over"}
              </button>
            )}
          </div>
        )}
      </ConversationDialog>
    </main>
  );
}
