"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { destination, type Journey } from "@/lib/journey";
export function EntryLink({ hero = false }: { hero?: boolean }) {
  const [href, setHref] = useState("/sign-in");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/session", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data: { journey?: Journey } = await response.json();
        if (!controller.signal.aborted) setHref(destination(data.journey));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <Link
      className={`brand-button ${hero ? "brand-button-large" : ""}`}
      href={href}
    >
      {href === "/sign-in"
        ? hero
          ? "Meet your Persona"
          : "Sign in"
        : href === "/onboarding"
          ? "Continue setup"
          : "Open dashboard"}
      {hero && <span aria-hidden="true">↗</span>}
    </Link>
  );
}
