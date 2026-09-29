"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatIcon } from "./chat-icons";
type GmailStatus = {
  available: boolean;
  status: "connected" | "not_connected" | "reconnect_needed";
  email: string | null;
  unavailable: boolean;
  attempt: null | { id: string; status: string };
};
export function GmailConnection({
  headers,
  enabled,
  introduced,
  conversationId,
  onChanged,
  onNotice,
}: {
  headers: () => Record<string, string>;
  enabled: boolean;
  introduced: boolean;
  conversationId: string;
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef(onNotice);
  const lifecycle = useRef(new AbortController());
  const popup = useRef<Window | null>(null),
    attempt = useRef<string | null>(null),
    headersRef = useRef(headers),
    changedRef = useRef(onChanged);
  useEffect(() => {
    headersRef.current = headers;
    changedRef.current = onChanged;
    noticeRef.current = onNotice;
  }, [headers, onChanged, onNotice]);
  const refresh = useCallback(async () => {
    const life = lifecycle.current;
    if (life.signal.aborted) return;
    const response = await fetch("/api/gmail/status", {
      cache: "no-store",
      signal: AbortSignal.any([life.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw new Error("GMAIL_STATUS_UNAVAILABLE");
    const status: GmailStatus = await response.json();
    if (typeof status.available !== "boolean") return;
    if (life.signal.aborted) return;
    setGmail(status);
    if (
      attempt.current &&
      status.attempt?.id === attempt.current &&
      !["pending", "exchanging"].includes(status.attempt.status)
    ) {
      setBusy(false);
      attempt.current = null;
      popup.current?.close();
      popup.current = null;
      noticeRef.current(
        status.attempt.status === "connected"
          ? "Gmail connected."
          : status.attempt.status === "denied"
            ? "Access was declined. You can keep chatting or try again."
            : status.attempt.status === "expired"
              ? "The connection attempt expired. You can try again."
              : "Gmail was not connected. You can try again when ready.",
      );
      await changedRef.current();
    }
  }, []);
  useEffect(() => {
    lifecycle.current = new AbortController();
    noticeRef.current("");
    let cancelled = false;
    const initial = setTimeout(() => {
      if (!cancelled) void refresh().catch(() => undefined);
    }, 0);
    const focus = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      lifecycle.current.abort();
      clearTimeout(initial);
      window.removeEventListener("focus", focus);
      popup.current?.close();
      attempt.current = null;
    };
  }, [conversationId, refresh]);
  useEffect(() => {
    if (!busy) return;
    const life = lifecycle.current;
    const timer = setInterval(() => {
      if (life.signal.aborted) return;
      if (popup.current?.closed && attempt.current) {
        const id = attempt.current;
        attempt.current = null;
        setBusy(false);
        void fetch("/api/gmail/cancel", {
          method: "POST",
          headers: headersRef.current(),
          body: JSON.stringify({ id }),
          signal: AbortSignal.any([life.signal, AbortSignal.timeout(10000)]),
        })
          .then(() => {
            if (!life.signal.aborted) return refresh();
          })
          .catch(() => {
            if (!life.signal.aborted)
              noticeRef.current(
                "The window closed. Check connection status before retrying.",
              );
          });
      } else
        void refresh().catch(() => {
          if (!life.signal.aborted)
            noticeRef.current(
              "Could not check Gmail yet. Your conversation is still here.",
            );
        });
    }, 2000);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  async function connect() {
    const life = lifecycle.current;
    setBusy(true);
    noticeRef.current("");
    const opened = window.open(
      "about:blank",
      "persona-gmail",
      "popup,width=560,height=720",
    );
    if (opened) opened.opener = null;
    popup.current = opened;
    try {
      const response = await fetch("/api/gmail/start", {
        method: "POST",
        headers: headersRef.current(),
        body: "{}",
        signal: AbortSignal.any([life.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error("CONNECT_FAILED");
      const result: { attemptId: string; url: string } = await response.json();
      if (life.signal.aborted) {
        opened?.close();
        return;
      }
      attempt.current = result.attemptId;
      if (opened) opened.location.href = result.url;
      else window.location.assign(result.url);
    } catch {
      opened?.close();
      if (life.signal.aborted) return;
      setBusy(false);
      noticeRef.current("Gmail could not start connecting. Please try again.");
    }
  }
  if (
    !gmail ||
    (!introduced && gmail.status === "not_connected" && !gmail.attempt)
  )
    return null;
  return (
    <div className="gmail-controls">
      {gmail.status !== "connected" && (
        <button
          type="button"
          className="tool-button"
          disabled={!enabled || busy || !gmail.available}
          onClick={() => void connect()}
        >
          <ChatIcon name="mail" />
          {busy
            ? "Connecting Gmail…"
            : gmail.status === "reconnect_needed"
              ? "Reconnect Gmail"
              : "Connect Gmail"}
        </button>
      )}
      <details className="gmail-details">
        <summary
          className={
            gmail.status === "connected"
              ? "tool-button gmail-connected"
              : "icon-button"
          }
          aria-label={
            gmail.status === "connected"
              ? "Gmail connection details"
              : "About Gmail connection"
          }
        >
          <ChatIcon name={gmail.status === "connected" ? "check" : "info"} />
          {gmail.status === "connected" && <span>Gmail connected</span>}
        </summary>
        <div className="gmail-popover">
          <strong>
            {gmail.status === "connected"
              ? "Your connected account"
              : "A connection you control"}
          </strong>
          {gmail.status === "connected" && (
            <p>Gmail connected: {gmail.email}</p>
          )}
          <p>
            {gmail.available
              ? "Google consent permits Gmail metadata and headers. This trial only verifies your account address; it does not read your messages."
              : "Gmail connection setup is not available yet. You can continue chatting."}
          </p>
          {gmail.unavailable && (
            <p>Could not verify access just now. Try again shortly.</p>
          )}
        </div>
      </details>
    </div>
  );
}
