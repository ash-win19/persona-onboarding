// Placeholders shaped like the content they stand in for, so a page keeps its
// layout while data loads. Each one pairs a hidden status line for screen
// readers with a decorative shimmer.
import type { CSSProperties } from "react";

export function Bone({
  width = "100%",
  height = 12,
  round = false,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  round?: boolean;
  className?: string;
}) {
  const style: CSSProperties = { width, height };
  return (
    <span
      className={`skeleton${round ? " skeleton-round" : ""} ${className}`}
      style={style}
    />
  );
}

function Status({ children }: { children: string }) {
  return (
    <p className="sr-only" role="status">
      {children}
    </p>
  );
}

// Assistant and user message shapes, in the conversation column.
export function MessagesSkeleton({ label }: { label: string }) {
  return (
    <div className="messages-skeleton">
      <Status>{label}</Status>
      <div aria-hidden="true">
        <div className="skeleton-turn">
          <Bone width="82%" height={14} />
          <Bone width="58%" height={14} />
        </div>
        <div className="skeleton-turn skeleton-turn-user">
          <Bone width={180} height={44} className="skeleton-bubble" />
        </div>
        <div className="skeleton-turn">
          <Bone width="70%" height={14} />
          <Bone width="44%" height={14} />
        </div>
      </div>
    </div>
  );
}

// Checklist rows, for priorities and tasks.
export function RowsSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div className="rows-skeleton">
      <Status>{label}</Status>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <Bone width={20} height={20} round />
            <Bone width={`${72 - index * 14}%`} height={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

// The onboarding conversation before its first load: header, a few message
// shapes and the composer, in the same places the real ones appear.
export function OnboardingSkeleton({ label }: { label: string }) {
  return (
    <main className="chat-shell page-skeleton">
      <Status>{label}</Status>
      <div aria-hidden="true" className="skeleton-chat">
        <header className="chat-header">
          <Bone width={116} height={23} />
          <div className="skeleton-inline">
            <Bone width={84} height={12} />
            <Bone width={56} height={12} />
          </div>
        </header>
        <div className="conversation">
          <div className="conversation-content">
            <div className="skeleton-turn">
              <Bone width="76%" height={14} />
              <Bone width="48%" height={14} />
            </div>
          </div>
        </div>
        <div className="composer-area">
          <Bone height={112} className="skeleton-composer" />
        </div>
      </div>
    </main>
  );
}

// The dashboard before its first load: sidebar, toolbar, heading and cards.
export function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div className="dashboard-shell page-skeleton">
      <Status>{label}</Status>
      <aside className="app-sidebar" aria-hidden="true">
        <Bone width={116} height={23} />
        <div className="skeleton-nav">
          {[72, 88, 96].map((width) => (
            <div className="skeleton-row" key={width}>
              <Bone width={18} height={18} round />
              <Bone width={width} height={12} />
            </div>
          ))}
        </div>
      </aside>
      <div className="app-content skeleton-content" aria-hidden="true">
        <Bone width={180} height={12} />
        <div className="skeleton-heading">
          <Bone width={170} height={10} />
          <Bone width="min(420px, 80%)" height={34} />
          <Bone width="min(360px, 70%)" height={13} />
        </div>
        <Bone height={200} className="skeleton-card" />
        <div className="skeleton-grid">
          <Bone height={240} className="skeleton-card" />
          <Bone height={240} className="skeleton-card" />
        </div>
      </div>
    </div>
  );
}
