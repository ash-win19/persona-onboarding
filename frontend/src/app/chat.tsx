"use client";

import { CallControls } from "./call-controls";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Journey } from "@/lib/journey";
import { DashboardFrame } from "./dashboard-frame";
import { DashboardHandoff } from "./dashboard-handoff";
import { GmailConnection } from "./gmail-connection";
import { AssistantMessage } from "./assistant-message";
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
  callId?: string | null;
  kind?: "opening" | "message" | "handoff" | "recap";
};
type CallRecord = {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
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
export type Snapshot = {
  journey?: Journey;
  control?: Control;
  onboarding?: Onboarding;
  conversationId: string;
  revision: number;
  turns: Turn[];
  calls?: CallRecord[];
  introduction?: boolean;
  operation: {
    id: string;
    status: "generating" | "completed" | "failed";
    errorCode?: string | null;
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

function clockTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function callLength(from: string, to: string) {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(to) - Date.parse(from)) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function CallMarker({ children }: { children: string }) {
  return (
    <p className="call-marker">
      <ChatIcon name="phone" width={14} height={14} />
      <span>{children}</span>
    </p>
  );
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
  const router = useRouter();
  const pathname = usePathname();
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const handoffRequest = useRef(false);
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

  async function changeJourney(action: "prepare" | "skip" | "enter") {
    if (handoffRequest.current || !hasControl) return;
    handoffRequest.current = true;
    setHandoffBusy(true);
    setHandoffError("");
    try {
      const data = await api<Snapshot>(
        "journey",
        new AbortController().signal,
        { action },
        ownerRef.current,
      );
      accept(data);
      if (action === "enter") router.replace("/dashboard");
    } catch {
      setHandoffError("We couldn't open your dashboard yet. Please try again.");
    } finally {
      handoffRequest.current = false;
      setHandoffBusy(false);
    }
  }

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.journey?.entered && pathname === "/onboarding")
      router.replace("/dashboard" + window.location.search);
    else if (!snapshot.journey?.entered && pathname.startsWith("/dashboard"))
      router.replace("/onboarding");
  }, [snapshot, pathname, router]);

  useEffect(() => {
    if (
      snapshot?.journey?.ready &&
      !snapshot.journey.prepared &&
      !snapshot.journey.entered &&
      hasControl &&
      connection === "ready" &&
      !busy &&
      snapshot.operation?.status !== "generating" &&
      (!voice.active || voice.phase === "listening") &&
      !handoffError
    ) {
      const timer = setTimeout(() => void changeJourney("prepare"), 0);
      return () => clearTimeout(timer);
    }
    // Preparation follows readiness and settled delivery, never a URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshot?.journey?.ready,
    snapshot?.journey?.prepared,
    snapshot?.journey?.entered,
    snapshot?.operation?.status,
    hasControl,
    connection,
    busy,
    voice.active,
    voice.phase,
    handoffError,
  ]);

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
        voiceTurnFailed = voice.typedTurn(payload.submissionId);
        try {
          await api(
            "calls/turns",
            controller.signal,
            { ...payload, id: voice.call.id },
            ownerRef.current,
          );
        } catch (error) {
          if (!(error instanceof RequestError) || error.status !== 409)
            throw error;
          const status = await api<{ call: CallState | null }>(
            "calls/status",
            controller.signal,
          );
          if (
            status.call &&
            ["active", "connecting"].includes(status.call.status)
          )
            throw error;
          // Reuse the ID so a message accepted just before hangup is never duplicated.
          await api("turns", controller.signal, payload, ownerRef.current);
        }
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
  const calls = new Map(snapshot?.calls?.map((call) => [call.id, call]));
  // Markers go before a call's first turn and after its last, so a message
  // posted during the call, such as the onboarding handoff, stays inside them.
  const callBounds = new Map<string, { first: number; last: number }>();
  snapshot?.turns.forEach(({ callId }, index) => {
    if (!callId) return;
    const bounds = callBounds.get(callId);
    if (bounds) bounds.last = index;
    else callBounds.set(callId, { first: index, last: index });
  });
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
    (!retryPayload ||
      snapshot?.operation?.errorCode === "CALL_REPLY_INTERRUPTED") &&
    !!draft.trim();
  const visibleNotice =
    notice ||
    (!busy && retryPayload && !generating
      ? "Your latest result is not confirmed. Retry safely with the same message."
      : "");
  const hasUserMessage =
    !!pending || !!snapshot?.turns.some((turn) => turn.role === "user");
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
          : voice.phase === "speaking" &&
              voice.preferences.replyMode === "audio"
            ? voice.playback === "playing"
              ? `${agentName} is speaking`
              : "Waiting for call audio"
            : voice.phase === "thinking"
              ? `${agentName} is thinking`
              : voice.preferences.microphoneEnabled
                ? "Listening"
                : "Mic off. Type your reply.";

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
    <DashboardFrame
      snapshot={snapshot}
      call={voice.active}
      callPanel={
        <details className="call-panel">
          <summary>Message this call</summary>
          <div
            className="call-panel-transcript"
            role="log"
            aria-label="Call conversation"
          >
            {snapshot?.turns.slice(-8).map((turn) => (
              <p key={turn.id}>
                <strong>{turn.role === "user" ? "You" : agentName}</strong>{" "}
                {turn.content}
              </p>
            ))}
            {shownPending && (
              <p>
                <strong>You</strong> {pending.content}{" "}
                <small>Not confirmed</small>
              </p>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              sendDraft();
            }}
          >
            <label htmlFor="call-message">Message this call</label>
            <textarea
              id="call-message"
              rows={2}
              maxLength={8000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={!canSend}>
              Send to call
            </button>
            {!!retryPayload && !busy && (
              <button type="button" onClick={retry}>
                Retry message
              </button>
            )}
          </form>
        </details>
      }
      callControls={<CallControls voice={voice} />}
      onSignOut={() => void signOut()}
      signingOut={signingOut}
      headers={headers}
      enabled={hasControl && connection === "ready"}
      onRefresh={refresh}
      onNotice={setGmailNotice}
      notice={gmailNotice || notice || voice.notice}
    >
      <main
        className={`chat-shell ${introducing ? "is-introducing" : "has-messages"}`}
      >
        <header className="chat-header">
          <Link className="wordmark" href="/" aria-label="Persona home">
            <PersonaLogo />
          </Link>
          {!snapshot?.journey?.entered && (
            <span className="onboarding-label">A little introduction</span>
          )}
          {!snapshot?.journey?.prepared &&
            !snapshot?.journey?.entered &&
            snapshot && (
              <button
                className="skip-setup"
                disabled={handoffBusy || busy || !hasControl}
                onClick={() => void changeJourney("skip")}
              >
                Skip for now
              </button>
            )}
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
                  What would you like to call me? Or jump right into something
                  you need a hand with.
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
              {snapshot?.turns.map((turn, index) => {
                const call = turn.callId ? calls.get(turn.callId) : undefined;
                const starts = call && callBounds.get(call.id)?.first === index;
                const ends =
                  call?.endedAt && callBounds.get(call.id)?.last === index;
                const cutOff = turn.delivery === "interrupted";
                return (
                  <Fragment key={turn.id}>
                    {starts && (
                      <CallMarker>{`Call started · ${clockTime(call.startedAt)}`}</CallMarker>
                    )}
                    <article
                      className={`turn ${turn.role}${turn.kind === "opening" ? openingClassName : ""}${turn.kind === "recap" ? " recap" : ""}${cutOff ? " cut-off" : ""}`}
                      aria-label={turn.role === "user" ? "You" : agentName}
                    >
                      <div className="turn-body">
                        {turn.kind === "recap" && (
                          <span className="turn-label">Call recap</span>
                        )}
                        {turn.role === "assistant" ? (
                          <AssistantMessage content={turn.content} />
                        ) : (
                          <p>{turn.content}</p>
                        )}
                        {turn.channel === "voice" && (
                          <span className="turn-note">
                            <ChatIcon name="phone" width={11} height={11} />
                            {cutOff ? "Spoken · cut off" : "Spoken"}
                          </span>
                        )}
                      </div>
                    </article>
                    {ends && call.endedAt && (
                      <CallMarker>{`${call.status === "failed" ? "Call disconnected" : "Call ended"} · ${callLength(call.startedAt, call.endedAt)}`}</CallMarker>
                    )}
                  </Fragment>
                );
              })}
              {shownPending && (
                <article className="turn user pending" aria-label="You">
                  <div className="turn-body">
                    <p>{pending.content}</p>
                  </div>
                </article>
              )}
              {streamed && (
                <article className="turn assistant" aria-label={agentName}>
                  <div className="turn-body">
                    <AssistantMessage content={streamed.text} />
                  </div>
                </article>
              )}
              {waitingText && !streamed && (
                <ThinkingIndicator
                  text={waitingText}
                  active={
                    generating || (connection === "ready" && !!submitting)
                  }
                />
              )}
            </div>
          </div>
        </section>

        <footer className="composer-area">
          {snapshot?.journey?.prepared &&
            !snapshot.journey.entered &&
            hasControl && (
              <DashboardHandoff
                message={snapshot.journey.message}
                ready={
                  connection === "ready" &&
                  (snapshot.journey.delivery === "text" ||
                    (snapshot.journey.delivery === "played" &&
                      (!voice.active || voice.playback === "playing")))
                }
                busy={handoffBusy}
                error={handoffError}
                onContinue={() => void changeJourney("enter")}
              />
            )}
          {handoffError && !snapshot?.journey?.prepared && (
            <div className="notice" role="alert">
              <p>{handoffError}</p>
              <button
                onClick={() =>
                  void changeJourney(
                    snapshot?.journey?.ready ? "prepare" : "skip",
                  )
                }
              >
                Try again
              </button>
            </div>
          )}

          {showJump && (
            <button
              className="jump-button"
              type="button"
              aria-label="Back to latest"
              title="Back to latest"
              onClick={() => {
                followLatest.current = true;
                setShowJump(false);
                scrollArea.current?.scrollTo({
                  top: scrollArea.current.scrollHeight,
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                });
              }}
            >
              <ChatIcon name="arrowDown" />
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
              {voice.playback === "blocked" &&
                voice.preferences.replyMode === "audio" && (
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
                  voice.preferences.microphoneEnabled &&
                  (voice.phase !== "speaking" ||
                    (voice.playback === "playing" &&
                      voice.preferences.replyMode === "audio"))
                }
              />
              <span>
                <strong>{callStatus}</strong>
                <small>
                  {voice.preferences.replyMode === "text"
                    ? "Replies appear here in text."
                    : "You can speak or keep typing here."}
                </small>
              </span>
              <CallControls voice={voice} />
            </div>
          )}
          {snapshot?.control && (
            <div className="composer-connections">
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
                !snapshot || hasUserMessage
                  ? ""
                  : voice.active
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
    </DashboardFrame>
  );
}
