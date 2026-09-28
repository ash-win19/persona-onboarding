"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5">
      <div className="max-w-[1600px] mx-auto px-6 sm:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image
            src="/icon.svg"
            alt="Persona"
            width={32}
            height={32}
            className="h-8 w-8"
          />
        </Link>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-10 h-10 flex items-center justify-center"
          aria-label="Menu"
        >
          <div className="flex flex-col gap-1.5">
            <span className="w-5 h-0.5 bg-ink rounded-full transition-transform" />
            <span className="w-5 h-0.5 bg-ink rounded-full transition-transform" />
          </div>
        </button>
      </div>
    </header>
  );
}
