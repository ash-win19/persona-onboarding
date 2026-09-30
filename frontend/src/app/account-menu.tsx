"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChatIcon } from "./chat-icons";

// The bottom profile disclosure follows Blocks.so's chat-03 sidebar pattern.
// Native popover handles Escape, light dismissal and focus restoration.
export function AccountMenu({
  name,
  active,
  signingOut,
  onSignOut,
}: {
  name?: string | null;
  active: boolean;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  return (
    <div className="sidebar-bottom">
      <button
        className="account-trigger"
        popoverTarget="persona-account-menu"
        aria-label="Account menu"
        data-active={active || undefined}
        title="Account menu"
      >
        <span className="account-avatar">
          {(name || "You").slice(0, 1).toUpperCase()}
        </span>
        <span className="account-trigger-copy">
          <strong>{name || "My Account"}</strong>
          <small>Personal space</small>
        </span>
        <ChatIcon name="chevrons" />
        <span className="mobile-account-label">Account</span>
      </button>
      <div
        ref={menu}
        popover="auto"
        id="persona-account-menu"
        className="account-popover"
        aria-label="Account options"
      >
        <div className="account-popover-heading">
          <strong>{name || "My Account"}</strong>
          <span>Personal space</span>
        </div>
        <nav aria-label="Account navigation">
          <Link
            href="/dashboard/account"
            aria-current={active ? "page" : undefined}
            onClick={() => menu.current?.hidePopover()}
          >
            <ChatIcon name="user" /> My Account
          </Link>
          <button
            disabled={signingOut}
            onClick={() => {
              menu.current?.hidePopover();
              onSignOut();
            }}
          >
            <ChatIcon name="logout" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </div>
    </div>
  );
}
