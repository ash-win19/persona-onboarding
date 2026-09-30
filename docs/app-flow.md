# Persona app flow

The public root is a landing page. Sign-in lives at `/sign-in`. Authenticated users resume `/onboarding` until they enter the dashboard, then return to `/dashboard` or an existing dashboard deep link.

Overview centers on saved priorities, completion and task shortcuts. Conversation opens an empty daily chat by default. Its history picker includes saved daily chats and a separate Onboarding conversation. Settings sits above My Account at the bottom of the desktop sidebar. Integrations lives at `/dashboard/settings/integrations`; the old Connections URL redirects there. Mobile uses bottom navigation and safe-area spacing.

While a page opens, a placeholder shaped like it holds the layout: the onboarding conversation, the dashboard, message lists, priorities and tasks. Each keeps a screen-reader status line.

Daily chats have separate persisted message histories. The daily assistant receives accepted names and the first task, but it does not run onboarding capture or change profile facts. New chats are created only on the first message. Responses have durable submission IDs, failure states and retry protection. Reopening a pending chat polls for its result; an expired generation lease becomes retryable. The latest 100 chats appear in history, and older saved chat URLs still work.

Priorities are explicitly added, completed or reopened by the user. The accepted first task is offered as a suggestion to add, never automatically marked done. A Work on this action prefills a new chat for the user to review and send. The dashboard does not claim that the assistant performed external actions.

Workspace data belongs to the authenticated account's root conversation, follows its tab-control checks, and is removed with an account conversation reset. Additive database migrations create the daily threads, daily entries and priorities tables. No existing onboarding messages are moved or removed.

## Onboarding handoff

Readiness comes from the onboarding service's durable graduation state. That service accounts for the first task, delivered invitations, declines, deferrals and a user's explicit request to leave setup. The handoff records preparation and dashboard entry separately. Gmail remains optional. **Skip for now** allows entry without inventing profile details or a task.

Preparation records one acknowledgement. During a call, the server queues a tagged acknowledgement after the current response, then waits for that response's uninterrupted playback receipt. The highlighted **Go to dashboard** button starts a five-second border countdown after delivery. Clicking enters immediately. Users can pause and resume the countdown; reduced-motion users get discrete progress updates. A failed entry remains retryable.

A shared layout keeps the original onboarding conversation and browser call mounted while navigating. The call bar returns to the explicitly tagged Onboarding conversation; daily chats have independent text histories. Dashboard entry is durable and idempotent. Reloading, signing back in, or an expired Gmail connection does not undo it. The existing operator-configured fresh-start test accounts retain their reset behavior on onboarding entry.

## Brand and content

The visual reference is [Persona Band](https://yourpersona.com/band). The interface reuses Persona's mark and system/SF font stack, medium-weight tight headings, black pill buttons, rounded cards, white backgrounds, `#1d1d1f` text, `#6e6e73` secondary text and `#f5f5f7` surfaces.

Dashboard content comes from saved priorities and accepted onboarding details. Empty states remain explicit. Persona Band has an honest pairing-unavailable state and a link to the product page. Integrations describes the current Gmail verification capability without claiming inbox access or email actions. Daily chat supports text assistance; browser voice remains in the original Onboarding conversation.

## Verification

Browser coverage exercises the complete flow at 1440px, 390px and 320px, returning sessions, protected routes, Gmail callbacks, failed entry, the timer and a mocked call that remains connected during navigation. Backend coverage verifies durable entry, invitation delivery, optional goals, origin and ownership checks, and the tagged voice acknowledgement. Voice-provider events are simulated in these tests; they do not replace a live-provider smoke test.
