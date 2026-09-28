"use client";

import Link from "next/link";
import { ReactNode } from "react";

interface ButtonProps {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
  className?: string;
}

export default function Button({ href, variant = "primary", children, className = "" }: ButtonProps) {
  const baseStyles = "relative inline-flex items-center gap-2 rounded-full font-semibold transition-all duration-300 overflow-hidden group";
  
  const variantStyles = {
    primary: "px-8 py-4 bg-[#00D8A5] text-white text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]",
    secondary: "px-6 py-3 bg-ink text-white text-base hover:bg-ink/90"
  };

  return (
    <Link href={href} className={`${baseStyles} ${variantStyles[variant]} ${className}`}>
      {/* Hover glow effect */}
      <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <span className="absolute inset-[-20%] bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
      </span>
      
      {/* Button content */}
      <span className="relative z-10">{children}</span>
    </Link>
  );
}
