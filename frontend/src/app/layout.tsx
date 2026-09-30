import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./app-flow.css";
import "./dashboard-blocks.css";
import "./intelligence.css";

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Persona | Your personal intelligence",
  description:
    "Your priorities, plans, and daily conversations, together in your personal intelligence workspace.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
