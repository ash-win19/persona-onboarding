"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GmailConnection } from "./gmail-connection";
import { useVoice, type Control, type CallState } from "./use-voice";
import { ChatIcon } from "./chat-icons";
import { PersonaLogo, PersonaMark } from "./persona-logo";
import { CallAnimation, ThinkingIndicator } from "./conversation-animation";

type Turn = {
  id: string;
  submissionId: string;
  role: "user" | "assistant";
  content: string;
  channel?: string;
  delivery?: string;
  kind?: "opening" | "message";
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
  policy?: { goals: { gmail: { introduced: boolean } } };
};
type Snapshot = {
  control?: Control;
  onboarding?: Onboarding;
  conversationId: string;
  revision: number;
  turns: Turn[];
  introduction?: boolean;
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
  if (response.status === 401)
    window.dispatchEvent(new Event("persona:unauthorized"));
  if (!response.ok) throw new RequestError(response.status);
  return response.json();
}

class StreamInterrupted extends Error {}

// Posts a turn and reads the streamed reply. The usual 15 second limit applies
// until the response starts; after that the limit restarts with every chunk, so
// a long reply is not cut off while text keeps arriving.
async function streamTurn(
  payload: Pending,
  signal: AbortSignal,
  owner: { tabId: string; epoch: number } | undefined,
  on: { snapshot: (data: Snapshot) => void; delta: (text: string) => void },
): Promise<Snapshot> {
  const idle = new AbortController();
  const expire = () => idle.abort();
  const limit = AbortSignal.timeout(15000);
  limit.addEventListener("abort", expire, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetch("/api/turns", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-Persona-Client": "web",
        ...(owner
          ? {
              "X-Persona-Tab": owner.tabId,
              "X-Persona-Epoch": String(owner.epoch),
            }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, idle.signal]),
    });
    limit.removeEventListener("abort", expire);
    if (response.status === 401)
      window.dispatchEvent(new Event("persona:unauthorized"));
    if (!response.ok) throw new RequestError(response.status);
    if (!response.headers.get("Content-Type")?.includes("text/event-stream"))
      return response.json();
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new StreamInterrupted();
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), 20000);
      buffer += value;
      for (
        let end = buffer.indexOf("\n\n");
        end !== -1;
        end = buffer.indexOf("\n\n")
      ) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!event || data === undefined) continue;
        if (event === "snapshot") on.snapshot(JSON.parse(data));
        else if (event === "delta") on.delta(JSON.parse(data).text);
        else if (event === "done") return JSON.parse(data);
        else if (event === "error") throw new StreamInterrupted();
      }
    }
  } finally {
    limit.removeEventListener("abort", expire);
    clearTimeout(timer);
  }
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

export default function Chat({ onSignedOut }: { onSignedOut?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [streamed, setStreamed] = useState<{
    submissionId: string;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [introductionPhase, setIntroductionPhase] = useState<
    "holding" | "leaving" | null
  >(null);
  const introducing = introductionPhase !== null;
  const introDismissed = useRef(false);
  const finishIntroduction = useCallback(() => {
    introDismissed.current = true;
    setIntroductionPhase(null);
  }, []);
  const active = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [gmailNotice, setGmailNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const tabId = useRef("");
  const ownerRef = useRef<{ tabId: string; epoch: number } | undefined>(
    undefined,
  );
  const [hasControl, setHasControl] = useState(true);
  const conversationRef = useRef<string | null>(null);
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
      introDismissed.current = false;
      setIntroductionPhase(null);
      voiceRef.current.controlLost();
    }
    conversationRef.current = data.conversationId;
    if (data.control?.tabId) control(data.control);
    setSnapshot(data);
    if (
      data.introduction &&
      data.turns.length === 1 &&
      data.turns[0].kind === "opening" &&
      !introDismissed.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      setIntroductionPhase((phase) => phase ?? "holding");
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

  useEffect(() => {
    if (!introductionPhase) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (motion.matches) finishIntroduction();
    };
    motion.addEventListener("change", changed);
    const timer =
      introductionPhase === "holding"
        ? setTimeout(() => setIntroductionPhase("leaving"), 2500)
        : setTimeout(finishIntroduction, 450);
    return () => {
      clearTimeout(timer);
      motion.removeEventListener("change", changed);
    };
  }, [introductionPhase, finishIntroduction]);

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
  }, [
    lastTurn?.id,
    lastTurn?.content,
    pending?.submissionId,
    busy,
    streamed?.text,
  ]);

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
    let voiceTurnFailed: (() => void) | undefined;
    let saved = false;
    try {
      let data: Snapshot;
      if (voice.active && voice.call?.status === "active") {
        voiceTurnFailed = voice.typedTurn();
        await api(
          "calls/turns",
          controller.signal,
          { ...payload, id: voice.call.id },
          ownerRef.current,
        );
        data = await api<Snapshot>("session", controller.signal);
      } else
        data = await streamTurn(payload, controller.signal, ownerRef.current, {
          snapshot: (current) => {
            saved = true;
            if (!controller.signal.aborted) accept(current);
          },
          delta: (text) => {
            if (controller.signal.aborted) return;
            setStreamed((current) => ({
              submissionId: payload.submissionId,
              text:
                (current?.submissionId === payload.submissionId
                  ? current.text
                  : "") + text,
            }));
          },
        });
      if (controller.signal.aborted) return;
      setStreamed(null);
      accept(data);
      await waitForReply(data, controller.signal);
    } catch (error) {
      voiceTurnFailed?.();
      if (!controller.signal.aborted) setStreamed(null);
      // A conflict, or a stream that broke after the message was saved, is
      // resolved from the saved conversation.
      if (
        ((error instanceof RequestError && error.status === 409) || saved) &&
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
  const generating =
    connection === "ready" && snapshot?.operation?.status === "generating";
  const submitting =
    busy && pending && snapshot?.operation?.id !== pending.submissionId;
  const waitingText = generating
    ? `${agentName} is thinking`
    : connection !== "ready" && retryPayload
      ? "Reconnecting to check your reply…"
      : submitting
        ? "Sending your message…"
        : "";
  const canSend =
    connection === "ready" &&
    hasControl &&
    (!voice.active || voice.state === "active") &&
    !busy &&
    !retryPayload &&
    !!draft.trim();
  const visibleNotice =
    notice ||
    (!busy && retryPayload && !generating
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
    setNotice("");
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    void connect(controller);
  }

  function sendDraft() {
    if (!canSend) return;
    finishIntroduction();
    const payload = {
      submissionId: crypto.randomUUID(),
      content: draft.trim(),
    };
    setDraft("");
    followLatest.current = true;
    setShowJump(false);
    void submit(payload);
  }

  const gmailIntroduced =
    snapshot?.onboarding?.policy?.goals.gmail.introduced ||
    snapshot?.onboarding?.gmail === "connected" ||
    snapshot?.turns.some(
      (turn) => turn.role === "assistant" && /\bgmail\b/i.test(turn.content),
    );
  const callStatus =
    voice.state === "permission"
      ? "Waiting for microphone permission"
      : voice.state === "connecting"
        ? "Connecting your call"
        : voice.playback === "blocked"
          ? "Call audio is paused"
          : voice.phase === "speaking"
            ? voice.playback === "playing"
              ? `${agentName} is speaking`
              : "Waiting for call audio"
            : voice.phase === "thinking"
              ? `${agentName} is thinking`
              : "Listening";

  async function signOut() {
    setSigningOut(true);
    try {
      await api("auth/logout", new AbortController().signal, {});
      voiceRef.current.controlLost();
      active.current?.abort();
      onSignedOut?.();
    } catch {
      setNotice("We couldn't sign you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const openingClassName =
    introductionPhase === "holding"
      ? " opening-waiting"
      : introductionPhase === "leaving"
        ? " opening-arriving"
        : "";

  return (
    <main
      className={`chat-shell ${introducing ? "is-introducing" : "has-messages"}`}
    >
      <header className="chat-header">
        <Link className="wordmark" href="/" aria-label="Persona home">
          <PersonaLogo />
        </Link>
        <button
          className="sign-out"
          onClick={() => void signOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
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
          {!snapshot && connection === "connecting" && (
            <p className="conversation-loading" role="status">
              Opening your conversation…
            </p>
          )}
          {introducing && (
            <div
              className={`welcome welcome-intro${introductionPhase === "leaving" ? " welcome-leaving" : ""}`}
              aria-hidden={introductionPhase === "leaving"}
            >
              <div className="welcome-mark">
                <PersonaMark />
              </div>
              <h1>Where should we start?</h1>
              <p>
                What would you like to call me? Or jump right into something you
                need a hand with.
              </p>
            </div>
          )}
          <div
            className="turns"
            role="log"
            aria-label="Messages"
            aria-live="polite"
            aria-relevant="additions text"
            aria-hidden={introductionPhase === "holding"}
            aria-busy={!!streamed}
          >
            {snapshot?.turns.map((turn) => (
              <article
                key={turn.id}
                className={`turn ${turn.role}${turn.kind === "opening" ? openingClassName : ""}`}
                aria-label={turn.role === "user" ? "You" : agentName}
              >
                <div className="turn-body">
                  <p>{turn.content}</p>
                </div>
              </article>
            ))}
            {shownPending && (
              <article className="turn user pending" aria-label="You">
                <div className="turn-body">
                  <p>{pending.content}</p>
                  <span className="delivery-note">Not yet confirmed</span>
                </div>
              </article>
            )}
            {streamed && (
              <article className="turn assistant" aria-label={agentName}>
                <div className="turn-body">
                  <p>{streamed.text}</p>
                </div>
              </article>
            )}
            {waitingText && !streamed && (
              <ThinkingIndicator
                text={waitingText}
                active={generating || (connection === "ready" && !!submitting)}
              />
            )}
          </div>
          {snapshot?.control && (
            <div className="conversation-tools">
              <GmailConnection
                key={snapshot.conversationId}
                headers={headers}
                enabled={hasControl && connection === "ready"}
                introduced={!!gmailIntroduced}
                conversationId={snapshot.conversationId}
                onChanged={refresh}
                onNotice={setGmailNotice}
              />
            </div>
          )}
        </div>
      </section>

      <footer className="composer-area">
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
            {!busy && !generating && (
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
            {voice.playback === "blocked" && (
              <button type="button" onClick={() => void voice.play()}>
                Play call audio
              </button>
            )}
          </div>
        )}
        {voice.active && (
          <div className="call-banner" role="status">
            <CallAnimation
              level={voice.level}
              processing={voice.phase === "thinking"}
              active={
                voice.state === "active" &&
                voice.playback !== "blocked" &&
                (voice.phase !== "speaking" || voice.playback === "playing")
              }
            />
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
            onChange={(event) => {
              finishIntroduction();
              setDraft(event.target.value);
            }}
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
            <div className="composer-tools" />
            <div className="send-tools">
              {snapshot?.control && !voice.active && (
                <button
                  className="voice-button"
                  type="button"
                  disabled={
                    !hasControl ||
                    connection !== "ready" ||
                    busy ||
                    !!retryPayload
                  }
                  onClick={() => {
                    finishIntroduction();
                    void voice.start();
                  }}
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
      </footer>
    </main>
  );
}
