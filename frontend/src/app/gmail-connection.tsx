"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  conversationId,
  onChanged,
}: {
  headers: () => Record<string, string>;
  enabled: boolean;
  conversationId: string;
  onChanged: () => Promise<void>;
}) {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const popup = useRef<Window | null>(null),
    attempt = useRef<string | null>(null),
    headersRef = useRef(headers),
    changedRef = useRef(onChanged);
  useEffect(() => {
    headersRef.current = headers;
    changedRef.current = onChanged;
  }, [headers, onChanged]);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/gmail/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("GMAIL_STATUS_UNAVAILABLE");
    const status: GmailStatus = await response.json();
    if (typeof status.available !== "boolean") return;
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
      setNotice(
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
      clearTimeout(initial);
      window.removeEventListener("focus", focus);
      popup.current?.close();
      attempt.current = null;
    };
  }, [conversationId, refresh]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      if (popup.current?.closed && attempt.current) {
        const id = attempt.current;
        attempt.current = null;
        setBusy(false);
        void fetch("/api/gmail/cancel", {
          method: "POST",
          headers: headersRef.current(),
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(10000),
        })
          .then(() => refresh())
          .catch(() =>
            setNotice(
              "The window closed. Check connection status before retrying.",
            ),
          );
      } else
        void refresh().catch(() =>
          setNotice(
            "Could not check Gmail yet. Your conversation is still here.",
          ),
        );
    }, 2000);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  async function connect() {
    setBusy(true);
    setNotice("");
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
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("CONNECT_FAILED");
      const result: { attemptId: string; url: string } = await response.json();
      attempt.current = result.attemptId;
      if (opened) opened.location.href = result.url;
      else window.location.assign(result.url);
    } catch {
      opened?.close();
      setBusy(false);
      setNotice("Gmail could not start connecting. Please try again.");
    }
  }
  if (!gmail) return null;
  return (
    <div className="gmail-controls">
      {gmail.status === "connected" ? (
        <p>
          Gmail connected: {gmail.email}
          {gmail.unavailable
            ? " · Could not verify access just now. Try again shortly."
            : ""}
        </p>
      ) : (
        <>
          <button
            disabled={!enabled || busy || !gmail.available}
            onClick={() => void connect()}
          >
            {busy
              ? "Connecting Gmail…"
              : gmail.status === "reconnect_needed"
                ? "Reconnect Gmail"
                : "Connect Gmail"}
          </button>
          <p>
            {gmail.available
              ? "Google consent permits Gmail metadata and headers. This trial only verifies your account address; it does not read your messages."
              : "Gmail connection setup is not available yet. You can continue chatting."}
          </p>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
