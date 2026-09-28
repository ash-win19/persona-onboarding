# 01: Resume a saved text conversation on the deployed stack

Published: [AW-72](https://linear.app/ashwinworkspace/issue/AW-72/resume-a-saved-text-conversation-on-the-deployed-stack). Label: ready-for-agent.

## What to build

A user opens Persona, exchanges text with the agent, refreshes or returns in the same browser, and sees the committed conversation without signing in or connecting Gmail.

## Scope

Deliver the smallest real text conversation through Next.js, NestJS, the model provider and Neon. Deploy this slice to the selected free hosts. Full onboarding policy and voice arrive in later slices.

## Acceptance criteria

- [ ] A first visit creates an anonymous conversation and a server-issued Secure, HttpOnly session cookie; another browser cannot read it by guessing a conversation ID.
- [ ] A submitted message produces a real assistant reply, and committed turns reappear in order after refresh and a later visit.
- [ ] The same-origin frontend API path preserves the session cookie through the backend proxy; direct backend requests still require authorization.
- [ ] Accepted turns and their metadata are stored in Postgres, survive a backend restart, and are never stored only on the Render filesystem.
- [ ] Provider failure leaves the saved user message visible and offers a recoverable error without inventing a successful reply.
- [ ] The deployed Vercel Hobby, Render Free and Neon Free path passes a browser smoke test without enabling a paid plan.

## High-level implementation

Use one durable conversation owned by an opaque browser credential. NestJS handles model calls and saves turns; Next.js renders the returned state. Introduce small storage and provider interfaces inside this slice because later recovery tests need controlled failures.

## Low-level implementation

- Persist conversations, hashed session credentials and turns with stable IDs, role, content, timestamps, delivery state and a conversation revision.
- Create or resume a session, read its transcript and submit a turn through authenticated operations. Validate request bodies and origin/CSRF controls; the proxy is not authentication.
- Commit the user turn before invoking the model and commit the assistant turn before acknowledging it as saved. Keep model secrets server-side.
- Render one transcript with a composer, pending/saved/error states and a retry affordance. Restore only the current browser's authorized conversation.
- Configure migrations, runtime environment validation and production start commands for the selected hosts. Keep database and backend near each other where supported.
- Use existing test tooling and consult the installed Next.js documentation before frontend changes. Avoid an unrelated framework refactor.

## Development plan

1. Define the session and turn contract plus the first database migration.
2. Implement storage and authenticated operations with a replaceable model adapter.
3. Wire the conversation page and model response flow.
4. Deploy the thin slice and record the real browser smoke result.

## Verification and demo

Send a help request, receive a reply, refresh, restart the backend and revisit. Confirm the same committed transcript returns. Test an unauthorized conversation lookup and a model failure.

## Blocked by

- None (can start immediately)

## Design references

- Agreed decision: conversations are independent of Google and temporary voice sessions.
- Hosting is fixed to Next.js on Vercel Hobby, NestJS on Render Free and PostgreSQL on Neon Free.
