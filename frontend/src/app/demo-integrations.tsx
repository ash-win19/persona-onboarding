"use client";

import Image from "next/image";
import { useState } from "react";

const categories = [
  "All apps",
  "Productivity",
  "AI assistants",
  "Communication",
  "Lifestyle",
] as const;

type Category = (typeof categories)[number];
type Integration = {
  id: string;
  name: string;
  category: Exclude<Category, "All apps">;
  description: string;
  wordmark?: { width: number; height: number };
};

const integrations: Integration[] = [
  {
    id: "spotify",
    name: "Spotify",
    category: "Lifestyle",
    description: "Music, podcasts, and a soundtrack for your day.",
    wordmark: { width: 120, height: 36 },
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    category: "AI assistants",
    description: "Ideas, answers, and a fresh perspective.",
  },
  {
    id: "claude",
    name: "Claude",
    category: "AI assistants",
    description: "Thoughtful writing, research, and reasoning.",
    wordmark: { width: 140, height: 30 },
  },
  {
    id: "x",
    name: "X",
    category: "Communication",
    description: "Conversations and what's happening now.",
  },
  {
    id: "google-health",
    name: "Google Health",
    category: "Lifestyle",
    description: "Activity, sleep, and your everyday wellbeing.",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    description: "Your notes, knowledge, and projects in one place.",
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    description: "Team conversations, channels, and updates.",
    wordmark: { width: 119, height: 30 },
  },
  {
    id: "linear",
    name: "Linear",
    category: "Productivity",
    description: "Issues, projects, and the next thing to ship.",
  },
  {
    id: "figma",
    name: "Figma",
    category: "Productivity",
    description: "Design files, ideas, and creative collaboration.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Productivity",
    description: "Repositories, pull requests, and your team's code.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Productivity",
    description: "Documents, shared files, and everything you keep.",
  },
  {
    id: "trello",
    name: "Trello",
    category: "Productivity",
    description: "Boards and cards for every moving part.",
    wordmark: { width: 132, height: 27 },
  },
  {
    id: "asana",
    name: "Asana",
    category: "Productivity",
    description: "Projects, deadlines, and the work ahead.",
    wordmark: { width: 136, height: 27 },
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "Communication",
    description: "Video calls and face-to-face time with your team.",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    category: "Communication",
    description: "Team chats, meetings, and shared workspaces.",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "Productivity",
    description: "Files and folders, wherever your work takes you.",
    wordmark: { width: 133, height: 36 },
  },
  {
    id: "todoist",
    name: "Todoist",
    category: "Productivity",
    description: "To-dos, routines, and a little more headspace.",
  },
];

export function DemoIntegrations() {
  const [category, setCategory] = useState<Category>("All apps");
  const [query, setQuery] = useState("");
  const [connections, setConnections] = useState<Record<string, boolean>>({});
  const visible = integrations.filter(
    (app) =>
      (category === "All apps" || app.category === category) &&
      `${app.name} ${app.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  return (
    <section
      className="demo-integrations"
      aria-labelledby="demo-integrations-heading"
    >
      <header className="demo-integrations-heading">
        <div>
          <div className="demo-integrations-title">
            <h2 id="demo-integrations-heading">Explore integrations</h2>
          </div>
        </div>
        <label className="integration-search">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <span className="sr-only">Search integrations</span>
          <input
            type="search"
            placeholder="Search apps..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      <div
        className="integration-filters"
        role="group"
        aria-label="Integration categories"
      >
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
            {item === "All apps" && <span>{integrations.length}</span>}
          </button>
        ))}
      </div>
      <div className="demo-integrations-grid">
        {visible.map((app) => {
          const connected = !!connections[app.id];
          return (
            <article
              className="demo-integration-card"
              data-connected={connected || undefined}
              key={app.id}
            >
              <h3 className="demo-integration-brand">
                {app.wordmark ? (
                  <Image
                    src={`/integrations/${app.id}-wordmark.svg`}
                    alt={app.name}
                    width={app.wordmark.width}
                    height={app.wordmark.height}
                    className="integration-wordmark"
                  />
                ) : (
                  <>
                    <Image
                      src={`/integrations/${app.id}.${app.id === "google-health" ? "png" : "svg"}`}
                      alt=""
                      width={32}
                      height={32}
                      className="integration-brand-icon"
                    />
                    <span>{app.name}</span>
                  </>
                )}
              </h3>
              <p>{app.description}</p>
              <div className="demo-integration-footer">
                <span className="demo-integration-category">
                  {app.category}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={connected}
                  aria-label={`${app.name} connection`}
                  className="integration-switch"
                  onClick={() =>
                    setConnections((current) => ({
                      ...current,
                      [app.id]: !current[app.id],
                    }))
                  }
                >
                  <span>{connected ? "On" : "Off"}</span>
                  <span className="integration-switch-track" aria-hidden="true">
                    <span />
                  </span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="integration-empty" role="status">
          <h3>No apps found</h3>
          <p>Try another name or browse all integrations.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("All apps");
            }}
          >
            Show all apps
          </button>
        </div>
      )}
    </section>
  );
}
