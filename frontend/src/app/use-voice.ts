"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
type Media = {
  id: string;
  peer: RTCPeerConnection;
  stream: MediaStream;
  audio: HTMLAudioElement;
  events: RTCDataChannel;
  serverStarted: boolean;
};
export function useVoice(
  controlHeaders: () => Record<string, string>,
  refresh: () => Promise<void>,
) {
  const media = useRef<Media | null>(null);
  const pending = useRef(false);
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

  const release = useCallback(() => {
    const current = media.current;
    media.current = null;
    if (current) {
      current.stream.getTracks().forEach((t) => t.stop());
      current.audio.pause();
      current.audio.srcObject = null;
      current.events.close();
      current.peer.close();
    }
    pending.current = false;
    setState("idle");
    return current;
  }, []);
  const end = useCallback(
    async (reason = "user_hangup") => {
      const current = release();
      if (!current) return;
      setNotice(
        reason === "user_hangup"
          ? "Call ended. You can keep chatting here."
          : "The call stopped. Your saved conversation is still here.",
      );
      if (current.serverStarted) {
        await fetch("/api/calls/end", {
          method: "POST",
          headers: headersRef.current(),
          credentials: "same-origin",
          body: JSON.stringify({ id: current.id, reason }),
          keepalive: true,
          signal: AbortSignal.timeout(8000),
        }).catch(() => undefined);
      }
      await refreshRef.current().catch(() => undefined);
    },
    [release],
  );

  const reconcile = useCallback(
    (server: CallState | null, hasControl: boolean) => {
      setCall(server);
      const current = media.current;
      if (!current || !current.serverStarted) return;
      if (
        !hasControl ||
        !server ||
        server.id !== current.id ||
        server.status !== "active" ||
        !server.controlReady
      ) {
        release();
        setNotice(
          server?.reason === "time_limit"
            ? "The ten-minute call has ended. You can keep chatting or start another call."
            : "Voice stopped because this tab no longer has an active, controlled call. Your saved messages remain here.",
        );
      }
    },
    [release],
  );
  const controlLost = useCallback(() => {
    if (media.current) {
      release();
      setNotice(
        "Voice stopped while the connection recovers. Reconnect before starting another call.",
      );
    }
  }, [release]);

  const start = useCallback(async () => {
    if (pending.current || media.current) return;
    pending.current = true;
    setNotice("");
    setState("permission");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!pending.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setState("connecting");
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      const events = peer.createDataChannel("oai-events");
      const current: Media = {
        id: crypto.randomUUID(),
        peer,
        stream,
        audio,
        events,
        serverStarted: false,
      };
      media.current = current;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio
          .play()
          .catch(() =>
            setNotice(
              "Audio playback was blocked. Use Play call audio to listen.",
            ),
          );
      };
      peer.onconnectionstatechange = () => {
        if (media.current !== current) return;
        if (peer.connectionState === "connected") setState("active");
        if (["failed", "disconnected", "closed"].includes(peer.connectionState))
          void end("connection_lost");
      };
      events.onmessage = () => {
        /* Canonical transcripts arrive from the backend after commit. */
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
      });
      const response = await fetch("/api/calls/start", {
        method: "POST",
        headers: headersRef.current(),
        credentials: "same-origin",
        body: JSON.stringify({
          id: current.id,
          sdp: peer.localDescription?.sdp,
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error("CALL_SETUP_FAILED");
      const result: { call: CallState; sdp: string } = await response.json();
      current.serverStarted = true;
      if (media.current !== current) {
        void fetch("/api/calls/end", {
          method: "POST",
          headers: headersRef.current(),
          body: JSON.stringify({ id: current.id, reason: "user_hangup" }),
          keepalive: true,
        });
        return;
      }
      setCall(result.call);
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
      pending.current = false;
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      await end("connection_lost");
      release();
      setNotice(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was declined. You can keep typing or try the call again."
          : "The call could not connect. You can keep typing and try again when ready.",
      );
    }
  }, [end, release]);

  useEffect(() => {
    const leave = () => {
      void end("page_exit");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      release();
    };
  }, [end, release]);
  useEffect(() => {
    if (!call || state !== "active") return;
    const timer = setInterval(() => {
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
    play: () => media.current?.audio.play(),
    active: state !== "idle",
  };
}
