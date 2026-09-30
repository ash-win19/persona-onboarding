"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PersonaLogo, PersonaMark } from "./persona-logo";
import { ChatIcon } from "./chat-icons";
import { AccountMenu } from "./account-menu";
import { GmailConnection } from "./gmail-connection";
import type { Snapshot } from "./chat";

const pages = [
  { href: "/dashboard", label: "Overview", icon: "home" },
  { href: "/dashboard/conversation", label: "Conversation", icon: "message" },
  { href: "/dashboard/connections", label: "Connections", icon: "mail" },
] as const;

export function DashboardFrame({
  children,
  snapshot,
  call,
  onEndCall,
  onSignOut,
  signingOut,
  headers,
  enabled,
  onRefresh,
  onNotice,
  notice,
}: {
  children: ReactNode;
  snapshot: Snapshot | null;
  call: boolean;
  onEndCall: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  headers: () => Record<string, string>;
  enabled: boolean;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  notice: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const dashboard =
    pathname.startsWith("/dashboard") && !!snapshot?.journey?.entered;
  const conversation = !dashboard || pathname === "/dashboard/conversation";
  const active =
    pathname === "/dashboard/account"
      ? { label: "Account" }
      : (pages.find((page) => page.href === pathname) ?? pages[0]);
  const messages =
    snapshot?.turns.filter(
      (turn) => turn.kind !== "opening" && turn.kind !== "handoff",
    ) ?? [];
  const heading = useRef<HTMLHeadingElement>(null);
  const name = snapshot?.onboarding?.facts.userName.value;
  const agent = snapshot?.onboarding?.facts.agentName.value || "Persona";
  const task = snapshot?.onboarding?.intake
    ? snapshot.onboarding.intake.tasks[0]
    : snapshot?.onboarding?.facts.helpRequest.value;
  const gmail = snapshot?.onboarding?.gmail === "connected";
  useEffect(() => {
    if (dashboard && !conversation) heading.current?.focus();
  }, [pathname, dashboard, conversation]);
  return (
    <div
      className={dashboard ? "dashboard-shell" : "onboarding-shell"}
      data-collapsed={collapsed || undefined}
    >
      {dashboard && (
        <>
          <a className="skip-link" href="#dashboard-main">
            Skip to content
          </a>
          <aside className="app-sidebar">
            <Link
              className="wordmark"
              href="/dashboard"
              aria-label="Persona dashboard"
            >
              <span className="sidebar-wordmark">
                <PersonaLogo />
              </span>
              <span className="sidebar-brand-mark">
                <PersonaMark />
              </span>
            </Link>
            <p className="sidebar-caption">WORKSPACE</p>
            <nav aria-label="Dashboard navigation">
              {pages.map((page) => (
                <Link
                  aria-label={page.label}
                  title={page.label}
                  key={page.href}
                  href={page.href}
                  aria-current={pathname === page.href ? "page" : undefined}
                >
                  <ChatIcon name={page.icon} />
                  <span>{page.label}</span>
                </Link>
              ))}
            </nav>
            <AccountMenu
              name={name}
              active={pathname === "/dashboard/account"}
              signingOut={signingOut}
              onSignOut={onSignOut}
            />
          </aside>
          <header className="mobile-app-header">
            <Link
              className="wordmark"
              href="/dashboard"
              aria-label="Persona dashboard"
            >
              <PersonaLogo />
            </Link>
            <span>{active.label}</span>
          </header>
        </>
      )}
      <div className="app-content" id="dashboard-main">
        {dashboard && (
          <header className="dashboard-toolbar">
            <button
              className="sidebar-toggle"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChatIcon name="panel" />
            </button>
            <span className="toolbar-divider" />
            <span className="toolbar-workspace">Your space</span>
            <span className="toolbar-slash" aria-hidden="true">
              /
            </span>
            <strong>{active.label}</strong>
            <span className="toolbar-status">
              <span className="status-dot" />
              {call ? "Call in progress" : "Personal to you"}
            </span>
          </header>
        )}

        {dashboard && !conversation && notice && (
          <p className="dashboard-notice" role="status">
            {notice}
          </p>
        )}
        {dashboard && !conversation && (
          <main className="dashboard-page">
            <header className="dashboard-heading">
              <p className="eyebrow">
                {pathname === "/dashboard"
                  ? "A LITTLE MORE YOU"
                  : "YOUR PERSONA"}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {pathname === "/dashboard"
                  ? name
                    ? `Welcome, ${name}.`
                    : "Make yourself at home."
                  : `${active.label}.`}
              </h1>
              <p>
                {pathname === "/dashboard"
                  ? "Pick up the conversation. We'll take it from here."
                  : pathname.endsWith("connections")
                    ? "Choose what you connect. Keep going at your own pace."
                    : "The details that make this yours."}
              </p>
            </header>
            {pathname === "/dashboard" && (
              <>
                {snapshot?.onboarding?.intake?.plan?.accepted && (
                  <section className="saved-plan" aria-label="Your saved plan">
                    <h2>Your plan</h2>
                    <ol>
                      {snapshot.onboarding.intake.plan.steps.map(
                        (step, index) => (
                          <li key={index}>{step}</li>
                        ),
                      )}
                    </ol>
                  </section>
                )}
                <dl
                  className="dashboard-stats"
                  aria-label="Your Persona at a glance"
                >
                  <div>
                    <dt>Your assistant</dt>
                    <dd>{agent}</dd>
                    <span>Ready when you are</span>
                  </div>
                  <div>
                    <dt>Conversation</dt>
                    <dd>
                      {messages.length}
                      <small> messages</small>
                    </dd>
                    <span>Saved in your personal space</span>
                  </div>
                  <div>
                    <dt>Gmail</dt>
                    <dd>{gmail ? "Connected" : "Not connected"}</dd>
                    <Link href="/dashboard/connections">
                      {gmail
                        ? "Manage connection"
                        : "Connect when you're ready"}
                      <ChatIcon name="arrowRight" />
                    </Link>
                  </div>
                </dl>
                <section className="assistant-card">
                  <div className="assistant-card-mark">
                    <PersonaMark />
                  </div>
                  <div>
                    <p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p>
                    <h2>{agent} is here.</h2>
                    <p>
                      {task
                        ? "Your first task is a good place to start."
                        : "Bring a question, an idea, or something you need a hand with."}
                    </p>
                    <Link
                      className="brand-button"
                      href="/dashboard/conversation"
                    >
                      Continue the conversation <ChatIcon name="arrowRight" />
                    </Link>
                  </div>
                </section>
                <div className="dashboard-grid">
                  <section className="dashboard-card first-task">
                    <p className="eyebrow">YOUR STARTING POINT</p>
                    <h2>
                      {task ? "One thing at a time." : "What's on your mind?"}
                    </h2>
                    <p className="task-copy">
                      {task ||
                        "You don't need a plan to begin. Tell your Persona what you'd like help with."}
                    </p>
                    <Link href="/dashboard/conversation" className="text-link">
                      {task ? "Work on this" : "Start a conversation"}{" "}
                      <ChatIcon name="arrowRight" />
                    </Link>
                  </section>
                  <section className="dashboard-card">
                    <div className="card-icon">
                      <ChatIcon name="mail" />
                    </div>
                    <h2>A connection, on your terms.</h2>
                    <p>
                      {gmail
                        ? "Gmail is connected. You can review its status in Connections."
                        : "Gmail is optional. Connect it when you're ready, or keep the conversation going."}
                    </p>
                    <Link className="text-link" href="/dashboard/connections">
                      {gmail ? "View connection" : "Explore connections"}{" "}
                      <ChatIcon name="arrowRight" />
                    </Link>
                  </section>
                </div>
                <section
                  className="recent-conversation"
                  aria-labelledby="recent-title"
                >
                  <header>
                    <div>
                      <h2 id="recent-title">Recent conversation</h2>
                      <p>A few words from where you left off.</p>
                    </div>
                    <Link href="/dashboard/conversation" className="text-link">
                      View conversation
                      <ChatIcon name="arrowRight" />
                    </Link>
                  </header>
                  {messages.length ? (
                    <ul>
                      {messages
                        .slice(-3)
                        .reverse()
                        .map((turn) => (
                          <li key={turn.id}>
                            <span className="message-avatar">
                              {turn.role === "user" ? (
                                (name || "You").slice(0, 1).toUpperCase()
                              ) : (
                                <PersonaMark />
                              )}
                            </span>
                            <div>
                              <strong>
                                {turn.role === "user" ? "You" : agent}
                              </strong>
                              <p>{turn.content}</p>
                            </div>
                            <span className="message-channel">
                              {turn.channel === "voice" ? "Voice" : "Chat"}
                            </span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <div className="dashboard-empty">
                      <ChatIcon name="message" />
                      <p>Your next conversation starts here.</p>
                      <Link href="/dashboard/conversation">
                        Tell {agent} what&apos;s on your mind
                        <ChatIcon name="arrowRight" />
                      </Link>
                    </div>
                  )}
                </section>
              </>
            )}
            {pathname.endsWith("account") && (
              <section className="dashboard-card account-details">
                <h2>A few familiar details.</h2>
                <dl>
                  <div>
                    <dt>Your name</dt>
                    <dd>{name || "Not shared yet"}</dd>
                  </div>
                  <div>
                    <dt>Your assistant</dt>
                    <dd>{agent}</dd>
                  </div>
                  <div>
                    <dt>Gmail</dt>
                    <dd>{gmail ? "Connected" : "Not connected"}</dd>
                  </div>
                </dl>
                <p>You can tell your Persona when a name or detail changes.</p>
                <Link className="text-link" href="/dashboard/conversation">
                  Update in conversation <ChatIcon name="arrowRight" />
                </Link>
                <button
                  className="secondary-button account-signout"
                  onClick={onSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </section>
            )}
          </main>
        )}
        <section
          className="connections-page"
          hidden={!dashboard || !pathname.endsWith("connections")}
          aria-label="Your connections"
        >
          <div className="dashboard-card">
            <div className="connection-heading">
              <div className="card-icon">
                <ChatIcon name="mail" />
              </div>
              <div>
                <h2>Gmail</h2>
                <p>Connect your Google account.</p>
              </div>
              <span
                className={`connection-badge ${gmail ? "is-connected" : ""}`}
              >
                {gmail ? "Connected" : "Optional"}
              </span>
            </div>
            <p>
              This version verifies your Gmail connection. It does not read or
              send your emails.
            </p>
            {snapshot?.control && snapshot.journey?.entered && (
              <GmailConnection
                headers={headers}
                enabled={enabled}
                introduced
                conversationId={snapshot.conversationId}
                onChanged={onRefresh}
                onNotice={onNotice}
              />
            )}
            <p className="connection-note">
              You can use Persona without connecting Gmail.
            </p>
          </div>
        </section>
        <div className="persistent-conversation" hidden={!conversation}>
          {children}
        </div>
        {dashboard && !conversation && call && (
          <div className="persistent-call" role="status">
            <ChatIcon name="headphones" />
            <div>
              <strong>Your call continues</strong>
              <small>Same {agent}. Same conversation.</small>
            </div>
            <Link href="/dashboard/conversation">Open conversation</Link>
            <button className="secondary-button" onClick={onEndCall}>
              End call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
