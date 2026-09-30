import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./app-flow.css";
import "./dashboard-blocks.css";
import "./onboarding-progress.css";

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Persona | Your personal assistant",
  description:
    "One conversation to think things through, get help, and pick up where you left off.",
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
