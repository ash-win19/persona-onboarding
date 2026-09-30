import Image from "next/image";
import type { ReactNode } from "react";
import { ChatIcon } from "./chat-icons";

// A compact integration card for onboarding: the product's logo and name as a
// lockup, one line of detail beneath the name, and a short action.
export function IntegrationTile({
  label,
  className = "",
  logo,
  name,
  detail,
  connected,
  action,
  children,
}: {
  label: string;
  className?: string;
  logo: string;
  name: string;
  detail: string;
  connected: boolean;
  action: {
    text: string;
    // The accessible name repeats the visible text with the product name.
    name: string;
    busy: boolean;
    disabled: boolean;
    onClick: () => void;
  };
  children?: ReactNode;
}) {
  return (
    <section className={`integration-tile ${className}`} aria-label={label}>
      <div className="integration-tile-row">
        <div className="integration-tile-text">
          <div className="integration-lockup">
            <Image src={logo} alt="" width={18} height={18} />
            <strong>{name}</strong>
          </div>
          <p className="integration-tile-detail" title={detail}>
            {detail}
          </p>
        </div>
        {connected ? (
          <span className="integration-tile-status">
            <ChatIcon name="check" />
            Connected
          </span>
        ) : (
          <button
            type="button"
            className="integration-tile-action"
            aria-label={action.busy ? undefined : action.name}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.busy ? "Connecting…" : action.text}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
