"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

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
    }
    current.abort.abort();
    current.stream?.getTracks().forEach((t) => t.stop());
    if (current.audio) {
      current.audio.pause();
      current.audio.srcObject = null;
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

  const start = useCallback(async () => {
    if (attempt.current) return;
    const current: Attempt = {
      id: crypto.randomUUID(),
      headers: headersRef.current(),
      abort: new AbortController(),
      dispatched: false,
      accepted: false,
    };
    attempt.current = current;
    setNotice("");
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
      setState("connecting");
      const peer = (current.peer = new RTCPeerConnection());
      const audio = (current.audio = new Audio());
      audio.autoplay = true;
      current.events = peer.createDataChannel("oai-events");
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.ontrack = (event) => {
        if (attempt.current !== current) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          if (attempt.current === current)
            setNotice(
              "Audio playback was blocked. Use Play call audio to listen.",
            );
        });
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
  }, [cancel, end, release]);

  useEffect(() => {
    const leave = () => {
      void end("page_exit");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
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
  return {
    state,
    notice,
    call,
    start,
    end,
    reconcile,
    controlLost,
    play: () => attempt.current?.audio?.play(),
    active: state !== "idle",
  };
}
