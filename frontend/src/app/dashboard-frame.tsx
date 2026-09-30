"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PersonaLogo, PersonaMark } from "./persona-logo";
import { ChatIcon } from "./chat-icons";
import { AccountMenu } from "./account-menu";
import { CalendarPanel } from "./calendar-panel";
import { DemoIntegrations } from "./demo-integrations";
import { GmailConnection } from "./gmail-connection";
import { IntelligenceDashboard } from "./intelligence-dashboard";
import { DailyChat } from "./daily-chat";
import { YourTasks } from "./your-tasks";
import { workspaceRequest, type WorkspaceData } from "./workspace-data";
import type { Snapshot } from "./chat";

const pages = [
  { href: "/dashboard", label: "Overview", icon: "home" },
  { href: "/dashboard/tasks", label: "Your Tasks", icon: "checklist" },
  { href: "/dashboard/conversation", label: "Conversation", icon: "message" },
] as const;

export function DashboardFrame({
  children,
  snapshot,
  call,
  callPanel,
  callControls,
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
  callPanel: ReactNode;
  callControls: ReactNode;
  onSignOut: () => void;
  signingOut: boolean;
  headers: () => Record<string, string>;
  enabled: boolean;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  notice: string;
}) {
  const pathname = usePathname();
  const initialPrompt = useSearchParams().get("prompt")?.slice(0, 8000) || "";
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const dashboard =
    pathname.startsWith("/dashboard") && !!snapshot?.journey?.entered;
  const onboarding = !dashboard || pathname === "/dashboard/onboarding";
  const daily = dashboard && pathname.startsWith("/dashboard/conversation");
  const settings =
    pathname.startsWith("/dashboard/settings") ||
    pathname === "/dashboard/connections";
  const integrations =
    pathname === "/dashboard/settings/integrations" ||
    pathname === "/dashboard/connections";
  const active =
    pathname === "/dashboard/account"
      ? "My Account"
      : settings
        ? integrations
          ? "Integrations"
          : "Settings"
        : onboarding
          ? "Onboarding"
          : daily
            ? "Conversation"
            : pathname === "/dashboard/tasks"
              ? "Your Tasks"
              : "Overview";
  const heading = useRef<HTMLHeadingElement>(null);
  const name = snapshot?.onboarding?.facts.userName.value;
  const agent = snapshot?.onboarding?.facts.agentName.value || "Persona";
  const task = snapshot?.onboarding?.intake
    ? snapshot.onboarding.intake.tasks[0]
    : snapshot?.onboarding?.facts.helpRequest.value;
  const gmail = snapshot?.onboarding?.gmail === "connected";
  const root = snapshot?.conversationId;
  useEffect(() => {
    if (dashboard && !onboarding && !daily) heading.current?.focus();
  }, [pathname, dashboard, onboarding, daily]);
  useEffect(() => {
    if (!dashboard) return;
    let current = true;
    workspaceRequest<WorkspaceData>()
      .then((next) => {
        if (current) {
          setData(next);
          setError("");
        }
      })
      .catch(() => {
        if (current)
          setError(
            "We couldn't load your workspace. Your saved priorities and chats are still there.",
          );
      });
    return () => {
      current = false;
    };
  }, [dashboard, root, pathname, version]);
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
            <p className="sidebar-caption">YOUR SPACE</p>
            <nav aria-label="Dashboard navigation">
              {pages.map((page) => (
                <Link
                  aria-label={page.label}
                  title={page.label}
                  key={page.href}
                  href={page.href}
                  aria-current={
                    pathname === page.href ||
                    (page.label === "Conversation" && daily)
                      ? "page"
                      : undefined
                  }
                >
                  <ChatIcon name={page.icon} />
                  <span>{page.label}</span>
                </Link>
              ))}
            </nav>
            <div className="sidebar-footer">
              <nav aria-label="Settings navigation" className="settings-nav">
                <Link
                  href="/dashboard/settings"
                  aria-label="Settings"
                  title="Settings"
                  aria-current={settings ? "page" : undefined}
                >
                  <ChatIcon name="settings" />
                  <span>Settings</span>
                </Link>
              </nav>
              <AccountMenu
                name={name}
                active={pathname === "/dashboard/account"}
                signingOut={signingOut}
                onSignOut={onSignOut}
              />
            </div>
          </aside>
          <header className="mobile-app-header">
            <Link
              className="wordmark"
              href="/dashboard"
              aria-label="Persona dashboard"
            >
              <PersonaLogo />
            </Link>
            <span>{active}</span>
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
            {integrations && (
              <>
                <Link href="/dashboard/settings">Settings</Link>
                <span className="toolbar-slash" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <strong>{active}</strong>
            {call && (
              <span className="toolbar-status">
                <span className="status-dot" />
                Call in progress
              </span>
            )}
          </header>
        )}
        {dashboard &&
          snapshot &&
          !onboarding &&
          !integrations &&
          (daily || call) && (
            <CalendarPanel
              key={snapshot.conversationId}
              conversationId={snapshot.conversationId}
              headers={headers}
              enabled={enabled}
            />
          )}
        {dashboard && !onboarding && notice && (
          <p className="dashboard-notice" role="status">
            {notice}
          </p>
        )}
        {dashboard && !onboarding && !daily && (
          <main className="dashboard-page page-enter" key={pathname}>
            <header className="dashboard-heading">
              <p className="eyebrow">
                {pathname === "/dashboard"
                  ? "YOUR PERSONAL INTELLIGENCE"
                  : "YOUR PERSONA"}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {pathname === "/dashboard"
                  ? name
                    ? `Your day, ${name}.`
                    : "Your day, with Persona."
                  : `${active}.`}
              </h1>
              <p>
                {pathname === "/dashboard"
                  ? "Your priorities, plans, and next steps. All in one place."
                  : settings
                    ? "Make Persona fit the way you live and work."
                    : pathname === "/dashboard/tasks"
                      ? "Pick up where your onboarding conversation left off."
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
                <IntelligenceDashboard
                  data={data}
                  error={error}
                  reload={() => setVersion((v) => v + 1)}
                  onChanged={setData}
                  headers={headers}
                  enabled={enabled}
                  task={task}
                  agent={agent}
                />
              </>
            )}
            {settings && !integrations && (
              <section className="settings-list">
                <Link href="/dashboard/settings/integrations">
                  <div className="card-icon">
                    <ChatIcon name="plug" />
                  </div>
                  <div>
                    <h2>Integrations</h2>
                    <p>Connect the apps you use and manage their access.</p>
                  </div>
                  <ChatIcon name="arrowRight" />
                </Link>
              </section>
            )}
            {pathname === "/dashboard/tasks" && (
              <YourTasks
                key={root}
                snapshot={snapshot}
                data={data}
                error={error}
                reload={() => setVersion((v) => v + 1)}
                onChanged={setData}
                headers={headers}
                enabled={enabled}
              />
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
                <p>
                  Your setup details are saved in the onboarding conversation.
                  You can update them there.
                </p>
                <Link className="text-link" href="/dashboard/onboarding">
                  View onboarding <span className="type-badge">Onboarding</span>
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
            {integrations && (
              <section
                className="connections-page"
                aria-label="Your integrations"
              >
                <div className="dashboard-card integration-card">
                  <div className="connection-heading">
                    <div className="card-icon integration-icon">
                      <Image src="/gmail.svg" alt="" width={32} height={32} />
                    </div>
                    <div>
                      <h2>Gmail</h2>
                      <p>Verify your Google account.</p>
                    </div>
                    <span
                      className={`connection-badge ${gmail ? "is-connected" : ""}`}
                    >
                      {gmail ? "Connected" : "Optional"}
                    </span>
                  </div>
                  <p>
                    This version verifies your Gmail connection. It does not
                    read or send your emails.
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
                    Gmail access is separate from your Calendar connection.
                  </p>
                </div>
                {snapshot?.control && (
                  <CalendarPanel
                    conversationId={snapshot.conversationId}
                    headers={headers}
                    enabled={enabled}
                    settings
                  />
                )}
                <DemoIntegrations key={root} />
              </section>
            )}
          </main>
        )}
        {daily && (
          <DailyChat
            key={`${pathname}:${initialPrompt}`}
            initialPrompt={initialPrompt}
            id={pathname.split("/")[3]}
            agent={agent}
            headers={headers}
            enabled={enabled}
            onChanged={() => setVersion((v) => v + 1)}
          />
        )}
        {dashboard && onboarding && (
          <div className="onboarding-label">
            <div>
              <span className="type-badge">Onboarding</span>
              <p>Your setup conversation and original call history.</p>
            </div>
            <Link href="/dashboard/conversation" className="text-link">
              Start a daily chat <ChatIcon name="arrowRight" />
            </Link>
          </div>
        )}
        <div className="persistent-conversation" hidden={!onboarding}>
          {children}
        </div>
        {dashboard && !onboarding && call && (
          <div className="persistent-call" aria-label="Active call">
            <ChatIcon name="headphones" />
            <div>
              <strong>Your call continues</strong>
              <small>Onboarding conversation with {agent}.</small>
            </div>
            <Link href="/dashboard/onboarding">Open conversation</Link>
            {callControls}
            {callPanel}
          </div>
        )}
      </div>
    </div>
  );
}
