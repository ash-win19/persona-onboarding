"use client";
import { useEffect, useRef, useState } from "react";
import { ChatIcon } from "./chat-icons";

export function DashboardHandoff({
  message,
  ready,
  busy,
  error,
  onContinue,
}: {
  message: string;
  ready: boolean;
  busy: boolean;
  error: string;
  onContinue: () => void;
}) {
  const [remaining, setRemaining] = useState(5);
  const [paused, setPaused] = useState(false);
  const progress = useRef<SVGPathElement>(null);
  const continued = useRef(false);
  const action = useRef(onContinue);
  useEffect(() => {
    action.current = onContinue;
  }, [onContinue]);
  useEffect(() => {
    if (!ready || busy || error || paused) return;
    const start = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(now - start, 5000);
      setRemaining(Math.max(1, Math.ceil((5000 - elapsed) / 1000)));
      const fraction = reduced.matches
        ? Math.floor(elapsed / 1000) / 5
        : elapsed / 5000;
      progress.current?.style.setProperty(
        "stroke-dashoffset",
        String(100 * (1 - fraction)),
      );
      if (elapsed < 5000) frame = requestAnimationFrame(tick);
      else if (!continued.current) {
        continued.current = true;
        action.current();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, busy, error, paused]);
  function continueNow() {
    if (busy) return;
    continued.current = true;
    action.current();
  }
  return (
    <section className="handoff-panel" aria-label="Ready for your dashboard">
      <p className="handoff-message">{message}</p>
      <div className="handoff-action">
        <svg className="handoff-border" viewBox="0 0 254 66" aria-hidden="true">
          <path
            className="handoff-track"
            d="M127 3 H221 A30 30 0 0 1 251 33 A30 30 0 0 1 221 63 H33 A30 30 0 0 1 3 33 A30 30 0 0 1 33 3 Z"
          />
          <path
            ref={progress}
            pathLength="100"
            className="handoff-progress"
            d="M127 3 H221 A30 30 0 0 1 251 33 A30 30 0 0 1 221 63 H33 A30 30 0 0 1 3 33 A30 30 0 0 1 33 3 Z"
          />
        </svg>
        <button className="brand-button" onClick={continueNow} disabled={busy}>
          {busy ? "Opening dashboard…" : "Go to dashboard"}
          <ChatIcon name="arrowRight" />
        </button>
      </div>
      <p className="handoff-timer" aria-hidden="true">
        {error
          ? "Your conversation is saved."
          : busy
            ? "Just a moment."
            : paused
              ? "Continue when you're ready."
              : ready
                ? `Opening in ${remaining}s`
                : "Your Persona is finishing up."}
      </p>
      <p className="sr-only" role="status">
        {ready && !paused && !busy
          ? "Your dashboard will open in five seconds. Go to dashboard opens it now. Pause lets you take more time."
          : "You can open your dashboard when you're ready."}
      </p>
      {ready && !busy && !error && (
        <button
          className="handoff-pause"
          onClick={() => {
            setPaused(!paused);
            continued.current = false;
          }}
        >
          {paused ? "Resume countdown" : "Pause countdown"}
        </button>
      )}
      {error && (
        <p className="sign-in-error" role="alert">
          {error} <button onClick={continueNow}>Try again</button>
        </p>
      )}
    </section>
  );
}
