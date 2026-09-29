"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

const Orb = dynamic(
  () => import("thinking-orbs").then((module) => module.ThinkingOrb),
  { ssr: false },
);
const Beam = dynamic(
  () => import("voice-glow").then((module) => module.VoiceBeam),
  { ssr: false },
);

function subscribeMotion(change: () => void) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", change);
  document.addEventListener("visibilitychange", change);
  return () => {
    motion.removeEventListener("change", change);
    document.removeEventListener("visibilitychange", change);
  };
}
function motionPaused() {
  return (
    document.hidden ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
function useMotionPaused() {
  return useSyncExternalStore(subscribeMotion, motionPaused, () => true);
}

export function ThinkingIndicator({
  text,
  thinking,
}: {
  text: string;
  thinking: boolean;
}) {
  const paused = useMotionPaused();
  return (
    <div className="thinking" role="status">
      <span
        className="thinking-orb"
        aria-hidden="true"
        data-paused={paused || !thinking}
      >
        <Orb
          state="working"
          size={20}
          theme="light"
          paused={paused || !thinking}
        />
      </span>
      <span>{text}</span>
    </div>
  );
}

export function CallAnimation({
  level,
  processing,
  active,
}: {
  level: () => number;
  processing: boolean;
  active: boolean;
}) {
  const paused = useMotionPaused();
  return (
    <div
      className="call-animation"
      aria-hidden="true"
      data-paused={paused || !active}
    >
      {paused || !active ? (
        <span className="call-animation-static" />
      ) : (
        <Beam
          theme="light"
          colorVariant="mono"
          staticColors
          bandColors={{
            core: "#1d1d1f",
            above: "#6e6e73",
            mid: "#86868b",
            below: "#d2d2d7",
          }}
          level={level}
          processing={processing}
          idle={0}
          scale={0.65}
          distortion={0}
          bandAberration={0}
          borderRadius={15}
          attack={0.12}
          release={0.25}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            pointerEvents: "none",
          }}
        >
          <span />
        </Beam>
      )}
    </div>
  );
}
