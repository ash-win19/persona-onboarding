import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona | Your personal assistant",
  description:
    "One conversation to think things through, get help, and pick up where you left off.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
