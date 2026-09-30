"use client";
import Link from "next/link";
import { MessagesSkeleton } from "./skeletons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PersonaMark } from "./persona-logo";
import { ChatIcon } from "./chat-icons";
import { AssistantMessage } from "./assistant-message";
import {
  workspaceRequest,
  type DailyThread,
  type DailyEntry,
} from "./workspace-data";

export const starters = [
  {
    icon: "check",
    title: "Plan my day",
    detail: "Find a manageable next step.",
    prompt:
      "Help me plan my day. Ask me about my priorities and the time I have available.",
  },
  {
    icon: "message",
    title: "Find the right words",
    detail: "Turn a thought into a first draft.",
    prompt:
      "Help me draft a message. Ask me who it is for and what I want to say.",
  },
  {
    icon: "spark",
    title: "Think it through",
    detail: "Make space for a clear decision.",
    prompt:
      "Help me think through a decision. Ask me about my options and what matters most to me.",
  },
] as const;

export function DailyChat({
  id,
  initialPrompt,
  agent,
  headers,
  enabled,
  onChanged,
}: {
  id?: string;
  initialPrompt: string;
  agent: string;
  headers: () => Record<string, string>;
  enabled: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [thread, setThread] = useState<DailyThread | null>(null);
  const [draft, setDraft] = useState(id ? "" : initialPrompt);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<DailyEntry | null>(null);
  const target = useRef(id || "");
  const end = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const next = await workspaceRequest<DailyThread>(`/threads/${id}`);
        if (!active) return;
        setThread(next);
        setError("");
        setLoading(false);
        if (next.entries.some((entry) => entry.status === "generating"))
          timer = setTimeout(read, 2000);
      } catch {
        if (active) {
          setError("We couldn't load this conversation. Try again.");
          setLoading(false);
        }
      }
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [thread, pending, busy]);

  async function send(retry?: DailyEntry) {
    if (!enabled || busy) return;
    const content = retry?.content || draft.trim();
    if (!content) return;
    target.current ||= crypto.randomUUID();
    const entry: DailyEntry = retry || {
      id: crypto.randomUUID(),
      content,
      reply: null,
      status: "generating",
    };
    setPending(entry);
    setBusy(true);
    setError("");
    try {
      const result = await workspaceRequest<DailyThread>(
        `/threads/${target.current}`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ submissionId: entry.id, content }),
        },
      );
      if (!alive.current) return;
      setThread(result);
      setPending(null);
      setDraft("");
      onChanged();
      if (!id) router.replace(`/dashboard/conversation/${target.current}`);
      else if (result.entries.some((item) => item.status === "generating"))
        setReload((value) => value + 1);
    } catch (failure) {
      if (alive.current) {
        setPending({ ...entry, status: "failed" });
        setError(
          failure instanceof Error
            ? failure.message
            : "We couldn't send that. Please retry.",
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const entries = [...(thread?.entries || [])];
  if (pending && !entries.some((entry) => entry.id === pending.id))
    entries.push(pending);
  const unresolved = entries.find((entry) => entry.status !== "completed");
  return (
    <main className="daily-chat">
      <div className="daily-chat-scroll">
        {loading ? (
          <div className="daily-messages">
            <MessagesSkeleton label="Loading your conversation…" />
          </div>
        ) : !entries.length && !error ? (
          <div className="daily-welcome">
            <div className="daily-mark">
              <PersonaMark />
            </div>
            <p className="eyebrow">YOUR PERSONAL INTELLIGENCE</p>
            <h1>What can we take off your mind?</h1>
          </div>
        ) : (
          <div
            className="daily-messages"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {entries.map((entry) => (
              <div key={entry.id} className="daily-exchange">
                <div className="daily-user">
                  <span className="sr-only">You: </span>
                  {entry.content}
                </div>
                {entry.reply ? (
                  <div className="daily-assistant">
                    <PersonaMark />
                    <div>
                      <span className="daily-author">{agent}</span>
                      <AssistantMessage content={entry.reply} />
                    </div>
                  </div>
                ) : (
                  entry.status === "generating" && (
                    <p className="daily-thinking" role="status">
                      {agent} is thinking…
                    </p>
                  )
                )}
                {entry.status === "failed" && (
                  <div className="daily-failed">
                    <p>
                      The reply didn&apos;t finish. Your message is kept here.
                    </p>
                    <button
                      className="secondary-button"
                      disabled={!enabled || busy}
                      onClick={() => void send(entry)}
                    >
                      Retry reply
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="daily-error" role="alert">
            <p>{error}</p>
            {id && !thread && (
              <button
                className="secondary-button"
                onClick={() => {
                  setLoading(true);
                  setReload((value) => value + 1);
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="daily-composer-wrap">
        <form
          className="daily-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="Message Persona"
            placeholder="What's on your mind?"
            value={draft}
            maxLength={8000}
            rows={2}
            disabled={busy || !!unresolved || loading || (!!id && !thread)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>Daily conversation</span>
            <button
              className="brand-button"
              aria-label="Send message"
              disabled={
                !enabled ||
                !draft.trim() ||
                busy ||
                !!unresolved ||
                loading ||
                (!!id && !thread)
              }
            >
              <ChatIcon name="arrowUp" />
            </button>
          </div>
        </form>
        <p className="daily-composer-note">
          {!enabled ? (
            <Link href="/dashboard/onboarding">
              Open Onboarding to take control of this tab.
            </Link>
          ) : (
            "A fresh conversation, with what Persona already knows about you."
          )}
        </p>
      </div>
    </main>
  );
}
