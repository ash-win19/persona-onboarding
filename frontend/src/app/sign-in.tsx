"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { destination, startFresh } from "@/lib/journey";
import { PersonaLogo } from "./persona-logo";

export default function SignIn() {
  const router = useRouter();
  const [conversation, setConversation] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const check = async (pageLoad = false) => {
      const attempt = generation.current;
      try {
        if (pageLoad) await startFresh();
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(65000),
          ]),
        });
        if (attempt !== generation.current || controller.signal.aborted) return;
        if (response.status === 401) setConversation(null);
        else if (response.ok) {
          const data = await response.json();
          if (attempt !== generation.current || controller.signal.aborted)
            return;
          setConversation(data.conversationId);
          router.replace(destination(data.journey));
        } else throw new Error("UNAVAILABLE");
      } catch {
        if (!controller.signal.aborted)
          setError("We couldn't connect to Persona. Please try again.");
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    };
    const signedOut = () => {
      generation.current++;
      setConversation(null);
      setChecking(false);
    };
    const focus = () => {
      void check();
    };
    void check(true);
    window.addEventListener("persona:unauthorized", signedOut);
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.removeEventListener("persona:unauthorized", signedOut);
      window.removeEventListener("focus", focus);
    };
  }, [router]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || checking) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Persona-Client": "web",
        },
        body: JSON.stringify({
          email: values.get("email"),
          password: values.get("password"),
        }),
        signal: AbortSignal.timeout(65000),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "That email and password don't match. Try again."
            : response.status === 429
              ? "Too many attempts. Please try again in 15 minutes."
              : "We couldn't sign you in. Please try again.",
        );
        return;
      }
      const data = await response.json();
      generation.current++;
      form.reset();
      setConversation(data.conversationId);
      router.replace(destination(data.journey));
    } catch {
      setError("We couldn't sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (conversation)
    return (
      <main className="app-loading">
        <p role="status">Opening your Persona…</p>
      </main>
    );

  return (
    <main className="sign-in-shell">
      <Link className="sign-in-back text-link" href="/">
        ← Back to home
      </Link>
      <div className="sign-in-content">
        <div className="sign-in-logo" aria-label="Persona">
          <PersonaLogo />
        </div>
        <h1>Sign in.</h1>
        <p className="sign-in-description">
          Your Persona is right where you left it.
        </p>
        <form
          className="sign-in-form"
          onSubmit={signIn}
          aria-busy={busy || checking}
        >
          <div className="sign-in-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              placeholder="you@example.com"
              disabled={busy}
            />
          </div>
          <div className="sign-in-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              placeholder="Your password"
              disabled={busy}
            />
          </div>
          {error && (
            <p className="sign-in-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="sign-in-submit"
            type="submit"
            disabled={busy || checking}
          >
            {checking ? "Connecting…" : busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
