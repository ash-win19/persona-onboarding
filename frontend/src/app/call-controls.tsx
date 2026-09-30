"use client";

import type { useVoice } from "./use-voice";

export function CallControls({
  voice,
}: {
  voice: ReturnType<typeof useVoice>;
}) {
  const { microphoneEnabled, replyMode } = voice.preferences;
  const ready = voice.state === "active";
  return (
    <div className="call-controls" aria-label="Call controls">
      <button
        type="button"
        disabled={!ready || voice.preferencesPending}
        aria-label={microphoneEnabled ? "Mute microphone" : "Enable microphone"}
        aria-pressed={!microphoneEnabled}
        onClick={() =>
          void voice.changePreferences({
            microphoneEnabled: !microphoneEnabled,
          })
        }
      >
        {microphoneEnabled ? "I'll type · Mic on" : "Mic off"}
      </button>
      <button
        type="button"
        disabled={!ready || voice.preferencesPending}
        aria-label={
          replyMode === "audio" ? "Use text replies" : "Use spoken replies"
        }
        aria-pressed={replyMode === "text"}
        onClick={() =>
          void voice.changePreferences({
            replyMode: replyMode === "audio" ? "text" : "audio",
          })
        }
      >
        {replyMode === "audio" ? "Spoken replies" : "Text replies"}
      </button>
      <button
        type="button"
        className="end-call"
        onClick={() => void voice.end()}
      >
        End call
      </button>
      {voice.preferencesPending && (
        <span role="status">Updating call controls…</span>
      )}
    </div>
  );
}
