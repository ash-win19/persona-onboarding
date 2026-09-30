"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { startFresh, destination, type Journey } from "@/lib/journey";
import Chat from "./chat";
import { PersonaMark } from "./persona-logo";
import { DashboardSkeleton, OnboardingSkeleton } from "./skeletons";
export function Experience() {
  const router = useRouter();
  const pathname = usePathname();
  const [conversation, setConversation] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function open() {
      try {
        if (window.location.pathname === "/onboarding") await startFresh();
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(65000),
          ]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          router.replace("/sign-in");
          return;
        }
        if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
        const data: { conversationId: string; journey?: Journey } =
          await response.json();
        if (controller.signal.aborted) return;
        const path = window.location.pathname;
        const target = destination(data.journey, path);
        if (path !== target) router.replace(target + window.location.search);
        setConversation(data.conversationId);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void open();
    const expired = () => {
      setConversation(null);
      router.replace("/sign-in");
    };
    window.addEventListener("persona:unauthorized", expired);
    return () => {
      controller.abort();
      window.removeEventListener("persona:unauthorized", expired);
    };
  }, [router, attempt]);
  if (!conversation && !error)
    return pathname.startsWith("/dashboard") ? (
      <DashboardSkeleton label="Opening your Persona…" />
    ) : (
      <OnboardingSkeleton label="Opening your Persona…" />
    );
  if (!conversation)
    return (
      <main className="app-loading">
        <PersonaMark />
        <p role={error ? "alert" : "status"}>
          {error
            ? "We couldn't open Persona. Your conversation is saved."
            : "Opening your Persona…"}
        </p>
        {error && (
          <button
            className="brand-button"
            onClick={() => {
              setError(false);
              setAttempt(attempt + 1);
            }}
          >
            Try again
          </button>
        )}
      </main>
    );
  return (
    <Chat
      key={conversation}
      onSignedOut={() => {
        setConversation(null);
        router.replace("/sign-in");
      }}
    />
  );
}
