# Persona app flow

The public root is a landing page. Sign-in lives at `/sign-in`. Authenticated users resume `/onboarding` until they enter the dashboard, then return to `/dashboard` or an existing dashboard deep link.

The dashboard includes Overview, Conversation, Connections and Account. A shared layout keeps the conversation and browser voice connection mounted as users move between pages. Desktop uses a sidebar; mobile uses bottom navigation and safe-area spacing.

## Onboarding handoff

The server records readiness, preparation and dashboard entry separately. A normal handoff requires a first task and the required goals to have been fulfilled, declined, deferred or invited through delivered conversation. Gmail remains optional. Explicit **Skip for now** allows entry without inventing profile details or a task.

Preparation records one acknowledgement. During a call, the server queues a tagged acknowledgement after the current response, then waits for that response's uninterrupted playback receipt. The highlighted **Go to dashboard** button starts a five-second border countdown after delivery. Clicking enters immediately. Users can pause and resume the countdown; reduced-motion users get discrete progress updates. A failed entry remains retryable.

Navigation preserves the same conversation and call. Dashboard entry is durable and idempotent. Reloading, signing back in, or an expired Gmail connection does not undo it. The existing operator-configured fresh-start test accounts retain their reset behavior on onboarding entry.

## Brand and content

The visual reference is [Persona Band](https://yourpersona.com/band). The interface reuses Persona's mark and system/SF font stack, medium-weight tight headings, black pill buttons, rounded cards, white backgrounds, `#1d1d1f` text, `#6e6e73` secondary text and `#f5f5f7` surfaces.

Dashboard content comes from the saved conversation. Unknown details have explicit empty states. The landing page labels its sample conversation. Connections describes the current Gmail verification capability without claiming inbox access or email actions.

## Verification

Browser coverage exercises the complete flow at 1440px, 390px and 320px, returning sessions, protected routes, Gmail callbacks, failed entry, the timer and a mocked call that remains connected during navigation. Backend coverage verifies durable entry, invitation delivery, optional goals, origin and ownership checks, and the tagged voice acknowledgement. Voice-provider events are simulated in these tests; they do not replace a live-provider smoke test.
