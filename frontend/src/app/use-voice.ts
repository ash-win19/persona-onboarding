"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  initialVoiceActivity,
  interruptVoice,
  receiveVoiceEvent,
  type VoiceActivity,
} from "@/lib/voice-activity";
import { createVoiceMeter } from "@/lib/voice-meter";

export type Control = {
  tabId: string | null;
  epoch: number;
  expiresAt?: string;
};
export type CallState = {
  id: string;
  status: "connecting" | "active" | "ended" | "failed";
  reason: string | null;
  deadline: string;
  warningAt: string;
  controlReady: boolean;
  toolAcknowledged: boolean;
};
type Attempt = {
  id: string;
  headers: Record<string, string>;
  abort: AbortController;
  dispatched: boolean;
  accepted: boolean;
  openingDispatched?: boolean;
  peer?: RTCPeerConnection;
  stream?: MediaStream;
  audio?: HTMLAudioElement;
  events?: RTCDataChannel;
  activity: VoiceActivity;
  playback: "waiting" | "playing" | "blocked";
  meter: ReturnType<typeof createVoiceMeter>;
};
export function useVoice(
  controlHeaders: () => Record<string, string>,
  refresh: () => Promise<void>,
) {
  const attempt = useRef<Attempt | null>(null);
  const [state, setState] = useState<
    "idle" | "permission" | "connecting" | "active"
  >("idle");
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState<VoiceActivity>(initialVoiceActivity);
  const [playback, setPlayback] = useState<Attempt["playback"]>("waiting");
  const [call, setCall] = useState<CallState | null>(null);
  const headersRef = useRef(controlHeaders);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    headersRef.current = controlHeaders;
    refreshRef.current = refresh;
  }, [controlHeaders, refresh]);

  const release = useCallback((current: Attempt) => {
    if (attempt.current === current) {
      attempt.current = null;
      setState("idle");
      setActivity(initialVoiceActivity());
      setPlayback("waiting");
    }
    current.abort.abort();
    current.meter.close();
    current.stream?.getTracks().forEach((t) => t.stop());
    if (current.audio) {
      current.audio.onplaying = null;
      current.audio.onpause = null;
      current.audio.onwaiting = null;
      current.audio.pause();
      current.audio.srcObject = null;
    }
    if (current.events) {
      current.events.onmessage = null;
      current.events.onclose = null;
      current.events.onerror = null;
    }
    current.events?.close();
    current.peer?.close();
  }, []);
  const cancel = useCallback(
    async (current: Attempt, reason: string) => {
      release(current);
      if (current.dispatched) {
        // Cancel even without a setup acknowledgement. The server remembers this
        // attempt ID and rejects setup if that request arrives after cancellation.
        await fetch("/api/calls/end", {
          method: "POST",
          headers: current.headers,
          credentials: "same-origin",
          body: JSON.stringify({ id: current.id, reason }),
          keepalive: true,
          signal: AbortSignal.timeout(8000),
        }).catch(() => undefined);
      }
    },
    [release],
  );
  const end = useCallback(
    async (reason = "user_hangup") => {
      const current = attempt.current;
      if (!current) return;
      setNotice(
        reason === "user_hangup"
          ? "Call ended. You can keep chatting here."
          : "The call stopped. Your saved conversation is still here.",
      );
      await cancel(current, reason);
      await refreshRef.current().catch(() => undefined);
    },
    [cancel],
  );

  const reconcile = useCallback(
    (server: CallState | null, hasControl: boolean) => {
      setCall(server);
      const current = attempt.current;
      if (!current) {
        // A lost cancellation response must not leave an orphan blocking chat.
        if (
          hasControl &&
          server &&
          ["connecting", "active"].includes(server.status)
        ) {
          void fetch("/api/calls/end", {
            method: "POST",
            headers: headersRef.current(),
            body: JSON.stringify({ id: server.id, reason: "connection_lost" }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => undefined);
        }
        return;
      }
      if (!current.accepted) return;
      if (
        !hasControl ||
        !server ||
        server.id !== current.id ||
        server.status !== "active" ||
        !server.controlReady
      ) {
        void cancel(current, "connection_lost");
        setNotice(
          server?.reason === "time_limit"
            ? "The ten-minute call has ended. You can keep chatting or start another call."
            : "Voice stopped because this tab no longer has an active, controlled call. Your saved messages remain here.",
        );
      }
    },
    [cancel],
  );
  const controlLost = useCallback(() => {
    const current = attempt.current;
    if (current) {
      void cancel(current, "connection_lost");
      setNotice(
        "Voice stopped while the connection recovers. Reconnect before starting another call.",
      );
    }
  }, [cancel]);

  const playAudio = useCallback(async (current: Attempt) => {
    if (attempt.current !== current || !current.audio) return;
    current.meter.resume();
    try {
      await current.audio.play();
      if (attempt.current !== current) return;
      current.playback = "playing";
      setPlayback("playing");
      setNotice((previous) =>
        previous.startsWith("Audio playback was blocked.") ? "" : previous,
      );
    } catch {
      if (attempt.current !== current) return;
      current.playback = "blocked";
      setPlayback("blocked");
      setNotice("Audio playback was blocked. Use Play call audio to listen.");
    }
  }, []);

  const start = useCallback(async () => {
    if (attempt.current) return;
    const current: Attempt = {
      id: crypto.randomUUID(),
      headers: headersRef.current(),
      abort: new AbortController(),
      dispatched: false,
      accepted: false,
      activity: initialVoiceActivity(),
      playback: "waiting",
      meter: createVoiceMeter(),
    };
    attempt.current = current;
    setNotice("");
    setActivity(current.activity);
    setPlayback("waiting");
    setState("permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      current.stream = stream;
      if (attempt.current !== current) {
        release(current);
        return;
      }
      current.meter.input(stream);
      setState("connecting");
      const peer = (current.peer = new RTCPeerConnection());
      const audio = (current.audio = new Audio());
      audio.autoplay = true;
      current.events = peer.createDataChannel("oai-events");
      current.events.onmessage = (message) => {
        if (attempt.current !== current || typeof message.data !== "string")
          return;
        try {
          const event: unknown = JSON.parse(message.data);
          const next = receiveVoiceEvent(current.activity, event);
          if (next !== current.activity) {
            if (
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              (event.type === "error" ||
                (event.type === "response.done" &&
                  "response" in event &&
                  typeof event.response === "object" &&
                  event.response !== null &&
                  "status" in event.response &&
                  event.response.status === "failed"))
            ) {
              setNotice(
                "The voice reply could not finish. You can speak again or keep typing.",
              );
            }
            current.activity = next;
            setActivity(next);
          }
        } catch {
          // An unrelated or malformed event must not interrupt the call.
        }
      };
      const eventsLost = () => {
        if (attempt.current === current) void end("connection_lost");
      };
      current.events.onclose = eventsLost;
      current.events.onerror = eventsLost;
      audio.onplaying = () => {
        if (attempt.current !== current) return;
        current.playback = "playing";
        setPlayback("playing");
      };
      const playbackWaiting = () => {
        if (attempt.current !== current || current.playback === "blocked")
          return;
        current.playback = "waiting";
        setPlayback("waiting");
      };
      audio.onpause = playbackWaiting;
      audio.onwaiting = playbackWaiting;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.ontrack = (event) => {
        if (attempt.current !== current) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        current.meter.output(audio.srcObject);
        void playAudio(current);
      };
      peer.onconnectionstatechange = () => {
        if (attempt.current !== current) return;
        if (peer.connectionState === "connected") {
          setState("active");
          if (!current.openingDispatched) {
            current.openingDispatched = true;
            void (async () => {
              for (let retry = 0; retry < 2; retry++) {
                if (attempt.current !== current) return;
                try {
                  await apiFetch("calls/ready", {
                    method: "POST",
                    headers: current.headers,
                    credentials: "same-origin",
                    body: JSON.stringify({ id: current.id }),
                    signal: AbortSignal.any([
                      current.abort.signal,
                      AbortSignal.timeout(8000),
                    ]),
                  });
                  return;
                } catch {
                  if (retry === 1 && attempt.current === current)
                    setNotice(
                      "You're connected. You can start speaking whenever you're ready.",
                    );
                }
              }
            })();
          }
        }
        if (["failed", "disconnected", "closed"].includes(peer.connectionState))
          void end("connection_lost");
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise<void>((resolve, reject) => {
        if (peer.iceGatheringState === "complete") return resolve();
        const timeout = setTimeout(
          () => reject(new Error("ICE_TIMEOUT")),
          10000,
        );
        peer.addEventListener("icegatheringstatechange", () => {
          if (peer.iceGatheringState === "complete") {
            clearTimeout(timeout);
            resolve();
          }
        });
        current.abort.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new Error("CANCELLED"));
          },
          { once: true },
        );
      });
      if (attempt.current !== current) {
        release(current);
        return;
      }
      current.dispatched = true;
      const response = await fetch("/api/calls/start", {
        method: "POST",
        headers: current.headers,
        credentials: "same-origin",
        body: JSON.stringify({
          id: current.id,
          sdp: peer.localDescription?.sdp,
        }),
        signal: AbortSignal.any([
          current.abort.signal,
          AbortSignal.timeout(45000),
        ]),
      });
      if (!response.ok) throw new Error("CALL_SETUP_FAILED");
      const result: { call: CallState; sdp: string } = await response.json();
      if (attempt.current !== current) {
        await cancel(current, "user_hangup");
        return;
      }
      current.accepted = true;
      setCall(result.call);
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) {
      const ownsUi = attempt.current === current;
      // An old rejection only closes its own resources, never a newer attempt.
      await cancel(current, "connection_lost");
      if (ownsUi && !attempt.current) {
        setNotice(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access was declined. You can keep typing or try the call again."
            : "The call could not connect. You can keep typing and try again when ready.",
        );
      }
    }
  }, [cancel, end, release, playAudio]);

  useEffect(() => {
    const leave = () => {
      void end("page_exit");
    };
    const visible = () => {
      if (!document.hidden) attempt.current?.meter.resume();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visible);
      if (attempt.current) void cancel(attempt.current, "page_exit");
    };
  }, [end, cancel]);
  useEffect(() => {
    if (!call || state !== "active") return;
    const timer = setInterval(() => {
      if (attempt.current?.id !== call.id) return;
      if (Date.now() >= Date.parse(call.deadline)) {
        void end("user_hangup");
        setNotice("The ten-minute call has ended. You can continue in text.");
      } else if (Date.now() >= Date.parse(call.warningAt))
        setNotice(
          "This call ends in less than a minute. Your saved conversation will stay here.",
        );
    }, 1000);
    return () => clearInterval(timer);
  }, [call, state, end]);
  const level = useCallback(() => {
    const current = attempt.current;
    if (!current || current.peer?.connectionState !== "connected") return 0;
    if (current.activity.phase === "listening")
      return current.meter.level("user");
    if (current.activity.phase === "speaking" && current.playback === "playing")
      return current.meter.level("agent");
    return 0;
  }, []);
  return {
    state,
    phase: activity.phase,
    playback,
    level,
    notice,
    call,
    start,
    end,
    reconcile,
    controlLost,
    play: () => {
      if (attempt.current) void playAudio(attempt.current);
    },
    typedTurn: () => {
      const current = attempt.current;
      if (!current) return;
      const interrupted = interruptVoice(current.activity, true);
      current.activity = interrupted;
      setActivity(interrupted);
      return () => {
        if (attempt.current !== current || current.activity !== interrupted)
          return;
        current.activity = { ...interrupted, phase: "listening" };
        setActivity(current.activity);
      };
    },
    active: state !== "idle",
  };
}
