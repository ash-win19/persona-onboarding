"use client";

import { useEffect, useRef, useState } from "react";

type Meeting = {
  id: string;
  revision: number;
  status: string;
  step: string;
  organizer: string | null;
  input: {
    title: string | null;
    attendees: string[];
    start?: string;
    localStart: string | null;
    timeZone: string | null;
    durationMinutes: number;
  };
  eventUrl: string | null;
  meetUrl: string | null;
  errorCode: string | null;
};
type CalendarState = {
  calendar: {
    available: boolean;
    enabled: boolean;
    status: string;
    email: string | null;
    attempt: { id: string; status: string } | null;
  };
  meetings: Meeting[];
};
const messages: Record<string, string> = {
  MEET_CREATION_FAILED:
    "The Calendar event exists, but Google could not create its Meet link. Guests have not been invited.",
  MEET_PENDING:
    "The event exists. Its Meet link is still being prepared; guests have not been invited.",
  ACCOUNT_MISMATCH:
    "Reconnect the Google account originally selected for this meeting.",
  EVENT_CHANGED:
    "The event changed in Google Calendar. Check it there before continuing.",
  EVENT_NOT_FOUND:
    "This event could not be found. It may have been removed in Calendar.",
  MEETING_TIME_PASSED:
    "The requested start time has passed. Ask Persona for a new meeting time.",
  RECONNECT_REQUIRED: "Reconnect Google Calendar to continue this meeting.",
  INVITE_OTHER_ATTENDEE: "Add a recipient other than the meeting organizer.",
  CALENDAR_REJECTED:
    "Google rejected this action. Check the connected account's Calendar and Meet access.",
};
function when(meeting: Meeting) {
  if (!meeting.input.start) return "Waiting for a date and time";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: meeting.input.timeZone || undefined,
    timeZoneName: "short",
  }).format(new Date(meeting.input.start));
}
export function CalendarPanel({
  conversationId,
  headers,
  enabled,
  settings = false,
}: {
  conversationId: string;
  headers: () => Record<string, string>;
  enabled: boolean;
  settings?: boolean;
}) {
  const [state, setState] = useState<CalendarState | null>(null);
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const headersRef = useRef(headers);
  const enabledRef = useRef(enabled);
  const popup = useRef<Window | null>(null);
  const attempt = useRef<string | null>(null);
  const resumed = useRef(new Set<string>());
  useEffect(() => {
    headersRef.current = headers;
    enabledRef.current = enabled;
  }, [headers, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch("/api/calendar/timezone", {
      method: "POST",
      headers: headersRef.current(),
      body: JSON.stringify({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [enabled, conversationId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch("/api/calendar/status", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!response.ok) throw new Error("status");
        const next: CalendarState = await response.json();
        if (
          controller.signal.aborted ||
          !next.calendar ||
          !Array.isArray(next.meetings)
        )
          return;
        setState(next);
        if (
          attempt.current &&
          next.calendar.attempt?.id === attempt.current &&
          !["pending", "exchanging"].includes(next.calendar.attempt.status)
        ) {
          attempt.current = null;
          popup.current?.close();
          popup.current = null;
          setConnecting(false);
          setNotice(
            next.calendar.status === "connected"
              ? "Google Calendar connected."
              : "Calendar was not connected. Your meeting details are saved.",
          );
        } else if (popup.current?.closed && attempt.current) {
          const id = attempt.current;
          attempt.current = null;
          setConnecting(false);
          await fetch("/api/calendar/cancel", {
            method: "POST",
            headers: headersRef.current(),
            body: JSON.stringify({ id }),
            signal: controller.signal,
          });
        }
        if (
          enabledRef.current &&
          next.calendar.status === "connected" &&
          next.calendar.available
        ) {
          for (const meeting of next.meetings.filter(
            (m) => m.status === "connection_required",
          )) {
            const key = meeting.id + ":" + meeting.revision;
            if (resumed.current.has(key)) continue;
            resumed.current.add(key);
            const result = await fetch(`/api/meetings/${meeting.id}/execute`, {
              method: "POST",
              headers: headersRef.current(),
              body: JSON.stringify({ expectedRevision: meeting.revision }),
              signal: controller.signal,
            });
            if (!result.ok) {
              const error = await result.json();
              setNotice(
                messages[error.code] ||
                  "Your meeting could not continue. Check the details and retry.",
              );
            }
          }
        }
      } catch {
        if (!controller.signal.aborted && attempt.current)
          setNotice(
            "Could not check Google Calendar yet. Your request is saved.",
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 3000);
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
      popup.current?.close();
    };
  }, [conversationId]);
  async function connect() {
    setConnecting(true);
    setNotice("");
    const opened = window.open(
      "about:blank",
      "persona-calendar",
      "popup,width=560,height=720",
    );
    if (opened) opened.opener = null;
    popup.current = opened;
    try {
      const response = await fetch("/api/calendar/start", {
        method: "POST",
        headers: headersRef.current(),
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("connect");
      const result: { attemptId: string; url: string } = await response.json();
      attempt.current = result.attemptId;
      if (opened) opened.location.href = result.url;
      else window.location.assign(result.url);
    } catch {
      opened?.close();
      setConnecting(false);
      setNotice("Google Calendar could not connect. Please try again.");
    }
  }
  async function resume(meeting: Meeting) {
    setBusy(meeting.id);
    setNotice("");
    try {
      const execute = meeting.status === "connection_required";
      const response = await fetch(
        `/api/meetings/${meeting.id}/${execute ? "execute" : "resume"}`,
        {
          method: "POST",
          headers: headersRef.current(),
          body: JSON.stringify(
            execute ? { expectedRevision: meeting.revision } : {},
          ),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(
          messages[result.code] ||
            "Could not resume this meeting. Please try again.",
        );
      }
      setNotice(
        "Checking the saved meeting. This will reuse the existing event.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not resume this meeting.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function dismiss(meeting: Meeting) {
    setBusy(meeting.id);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/dismiss`, {
        method: "POST",
        headers: headersRef.current(),
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      setState(await response.json());
      setNotice(
        "Request removed from Persona. Any Google event or invitation already created remains in Calendar.",
      );
    } catch {
      setNotice(
        "This request is still running. Wait for its status before removing it.",
      );
    } finally {
      setBusy(null);
    }
  }
  if (
    !state ||
    (!state.calendar.enabled && !settings && !state.meetings.length)
  )
    return null;
  const meetings = state.meetings.slice(0, 5);
  return (
    <section
      className="calendar-panel"
      aria-label="Google Calendar and meetings"
    >
      <div className="calendar-connection">
        <div>
          <strong>Google Calendar</strong>
          <span>
            {state.calendar.email
              ? `Organizing as ${state.calendar.email}`
              : "Create a Google Meet and email the invitation."}
          </span>
        </div>
        {state.calendar.status === "connected" ? (
          <span className="calendar-connected">Connected</span>
        ) : (
          <button
            className="secondary-button"
            disabled={!enabled || connecting || !state.calendar.available}
            onClick={() => void connect()}
          >
            {connecting
              ? "Connecting…"
              : state.calendar.status === "reconnect_needed"
                ? "Reconnect Calendar"
                : "Connect Google Calendar"}
          </button>
        )}
      </div>
      {!state.calendar.available && (
        <p className="calendar-note">Calendar scheduling is not enabled yet.</p>
      )}
      {notice && (
        <p className="calendar-note" role="status">
          {notice}
        </p>
      )}
      {meetings.length > 0 && (
        <details className="meeting-list" open>
          <summary>
            {meetings.length === 1 ? "Your meeting" : "Your recent meetings"}
          </summary>
          {meetings.map((meeting) => (
            <article key={meeting.id} className="meeting-card">
              <div className="meeting-heading">
                <h3>{meeting.input.title || "Meeting details"}</h3>
                <span
                  className={
                    meeting.status === "completed"
                      ? "calendar-connected"
                      : "meeting-progress"
                  }
                >
                  {meeting.status === "completed"
                    ? "Scheduled"
                    : ["queued", "running"].includes(meeting.status)
                      ? "Scheduling…"
                      : meeting.status === "draft"
                        ? "Draft"
                        : "Needs attention"}
                </span>
              </div>
              <p>
                {when(meeting)} · {meeting.input.durationMinutes} minutes
              </p>
              <p>
                Guests:{" "}
                {meeting.input.attendees.join(", ") ||
                  "Add an email address in chat"}
              </p>
              {meeting.organizer && <p>Organizer: {meeting.organizer}</p>}
              <p role="status">
                {meeting.status === "completed"
                  ? "Google Calendar accepted the request to email the invitations."
                  : meeting.status === "connection_required"
                    ? "Connect Calendar to continue your saved request."
                    : meeting.status === "draft"
                      ? "Continue in chat to finish the meeting details."
                      : meeting.errorCode
                        ? messages[meeting.errorCode] ||
                          "Could not verify completion. Check the saved event before retrying."
                        : meeting.step === "sending_invites"
                          ? "Requesting the email invitations…"
                          : "Preparing the event and Google Meet link…"}
              </p>
              <div className="meeting-actions">
                {meeting.eventUrl && (
                  <a
                    href={meeting.eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Calendar
                  </a>
                )}
                {meeting.meetUrl && (
                  <a
                    href={meeting.meetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Join Google Meet
                  </a>
                )}
                {[
                  "attention_required",
                  "reconnect_needed",
                  "connection_required",
                ].includes(meeting.status) && (
                  <button
                    className="secondary-button"
                    disabled={
                      !enabled ||
                      busy === meeting.id ||
                      state.calendar.status !== "connected"
                    }
                    onClick={() => void resume(meeting)}
                  >
                    {busy === meeting.id ? "Checking…" : "Check and continue"}
                  </button>
                )}
                {[
                  "draft",
                  "connection_required",
                  "attention_required",
                  "reconnect_needed",
                ].includes(meeting.status) && (
                  <button
                    className="secondary-button"
                    disabled={!enabled || busy === meeting.id}
                    onClick={() => void dismiss(meeting)}
                    title="Stop tracking this request. Existing Google events and invitations remain in Calendar."
                  >
                    {meeting.status === "draft" ||
                    meeting.status === "connection_required"
                      ? "Discard request"
                      : "Stop tracking"}
                  </button>
                )}
              </div>
              {["attention_required", "reconnect_needed"].includes(
                meeting.status,
              ) && (
                <p className="calendar-note">
                  Stopping tracking leaves any Google event and invitations in
                  place.
                </p>
              )}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
