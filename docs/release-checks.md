# Persona trial release checks

Production is https://usepersona.vercel.app. The NestJS service runs at https://persona-api-ngfi.onrender.com in the personal Render workspace `tea-d731qrp9fqoc73cc7ehg`, account `ashwinshan2001@gmail.com`. Postgres is the personal Neon `persona-onboarding` project. All three hosting plans are Free. OpenAI usage consumes the configured account's credits.

## Evaluator journey

1. Open a fresh browser session. Name the agent, or start with a task such as interview preparation. A useful answer should arrive without requiring setup completion.
2. Volunteer your name, then correct it. Refresh and inspect What I remember. A correction replaces the accepted name while preserving its source turn.
3. Decline Gmail explicitly and defer voice. Refresh and continue chatting. Neither should be requested again in this visit. A refusal lasts until explicit reopening. A deferral becomes eligible once in a later visit after 30 minutes of inactivity with no active call. Polling and OAuth redirects do not create visits.
4. Start a call deliberately and grant microphone permission. Speak a name and a concrete task. Confirm the saved transcript, accepted details, and useful spoken help.
5. Interrupt a long answer by speaking, then by typing. Each typed input appears once. The old answer is interrupted, the call stays open, and the next response uses the current input. Generated transcripts do not claim every word was heard.
6. Open another tab. It should be read-only until Take control. Taking control ends the old call and invalidates stale writes.
7. Connect Gmail through the button. Consent permits metadata and headers, but this trial fetches only the account address. The connected state requires a verified server callback. A typed claim cannot establish it.
8. Close or deny consent, retry, and finish it after hanging up. The same conversation must remain. OAuth callbacks never restart voice.
9. Hang up, refresh, and continue in text. Leave a separate call open to verify the one-minute warning and ten-minute termination.
10. Start over during pending work. Confirm deletion. The new conversation must contain no previous transcript, names, preferences, task, or Gmail credentials. Other tabs cannot write with their old control epoch.

## Google testing configuration

Use a Google Cloud project owned by the personal account. Enable the Gmail API and configure an External OAuth app in Testing. Add each evaluator email as a test user. Create a Web application OAuth client and register this exact authorized redirect URI:

`https://usepersona.vercel.app/api/gmail/callback`

Production uses the personal project `persona-onboarding-510100`, consent app `Persona`, and web client `Persona production web`. The Gmail API is enabled and `ashwinshan2001@gmail.com` is allowlisted. The client credentials are configured on the personal `persona-api` Render service. Real consent, denial, and persistence after refresh were verified on September 29, 2026. Add other evaluator addresses to the Google testing audience before they try connecting.

Request only `https://www.googleapis.com/auth/gmail.metadata`. This is a restricted Gmail scope. Testing access is limited to allowlisted users; refresh tokens for this external testing setup normally expire after seven days. The app handles invalid grants by requiring reconnect while preserving the conversation. It does not request inbox bodies or sending permissions.

The backend needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GMAIL_TOKEN_KEY`. The last value is 32 random bytes encoded as base64, stored outside Postgres. Do not rotate it without handling existing encrypted credentials. Local values belong in ignored `backend/.env`; downloaded clients may be kept as ignored `backend/google-oauth-client.json`. Never paste credentials into tickets, chat, or logs. Only NestJS exchanges codes, refreshes tokens, and calls `users.getProfile?fields=emailAddress`.

OAuth attempts have a ten-minute deadline, an opaque session-bound state, PKCE, and a connection generation. The backend claims each exchange once and accepts its result only while that attempt remains current. Starting a new attempt supersedes pending older attempts. Reset removes both the attempt and encrypted credentials.

Official references: [web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), and [Gmail profile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).

## Operators

Run migrations with the deployment start command, `npm run start:prod`. They are additive, repeatable, and transactional. The prior client remains supported while the two hosts deploy independently.

Use `OPENAI_REALTIME_MODEL=gpt-realtime-mini` for voice. Browser audio uses WebRTC directly to OpenAI; NestJS owns the sideband tools and saved state. Only final transcripts are stored. Voice has a persisted ten-minute deadline, a one-minute warning, a 15-second tab lease renewed every three seconds, and a sideband ping/pong timeout of ten seconds checked every three seconds. Browser ownership/status polling has a five-second timeout and closes local media on failure. Database operations have bounded connection and statement timeouts.

A rejected voice fact proposal can trigger one strict text interpretation per input generation, using the canonical final transcripts and `OPENAI_MODEL`. That request has an eight-second timeout and no provider retries. It runs outside the call event queue, so typing, speech, hangup, takeover, and reset remain responsive. The backend checks call authority again before accepting the result. Continuations for the affected input wait for the canonical result; parallel capture proposals share that result. New input supersedes the pending interpretation. Ordinary spoken replies do not require this interpretation. If the request fails, the existing bounded realtime repair can still attempt recovery.

Operational events contain IDs, timestamps, fixed codes and optional timings. They have no text, raw audio, token, code-exchange response, or model-error payload. Platform and provider retention are separate from app deletion.

The operator credential is `DATABASE_URL`. Run these commands from `backend/` with the intended database configured. The free Render plan does not need a shell or a paid worker; an authorized operator can run the built CLI locally against Neon. Do not put the database URL on the command line or into a ticket.

```sh
npm run build
node --env-file=.env dist/ops.js preview --before 2026-09-01T00:00:00Z
node --env-file=.env dist/ops.js remove --ids UUID_FROM_PREVIEW,ANOTHER_UUID --confirm
node --env-file=.env dist/ops.js purge-diagnostics --confirm
```

Preview selects at most 100 conversations. Live owners, active calls, unexpired model work, and pending OAuth attempts are excluded. Execution checks activity again inside each deletion transaction and reports selected, skipped, removed, missing, and failed counts. Retry the same explicit IDs after a partial failure. It shares Start over's deletion boundary, so late work cannot recreate deleted conversations.

Diagnostics older than seven days can be purged separately. This never ages out canonical transcripts, facts, or necessary reset receipts. No automatic deletion schedule is installed.

## Verification boundaries

Automated tests use isolated databases and controlled provider adapters. They cover session and owner authorization, retry deduplication, cancellation ordering, sideband loss, deadline transitions, typed interruptions, final spoken fact provenance, refusal/visit policy, OAuth replay and stale exchanges, revocation, actual credential deletion, reset races, and active-session exclusion from cleanup.

Real-provider checks are recorded separately with the deployed commit. Mocked OAuth tests do not count as a real Google consent pass. Browser fake microphone audio tests exercise real OpenAI speech, transport and tools without capturing the evaluator's microphone.

On production revision `51e74ef`, one real voice run took 7.963 seconds from the provider speech-stopped event to its playback-start event for the initial response, then 4.172 seconds after a spoken correction. During interruption, speech-started and output-cleared events arrived in the same millisecond. These are browser receipt times for provider events, not acoustic measurements or latency guarantees. Expect several seconds of silence while a fact-changing turn is processed.

For backend restart verification, first save a synthetic conversation and start its call. Restart only `srv-datekju0tbcc73aeq1h0` in the personal workspace. Confirm voice stops and committed history returns after readiness recovers. For cold-start verification, let the Free service idle naturally, then record readiness and first usable chat time through the Vercel URL. Never alter the production database to simulate an outage; use the isolated failure adapter and bounded Neon timeout probe described in deployment documentation.

Known limits: the anonymous credential belongs to the same browser profile; clearing cookies loses access but does not request server deletion. Unsaved drafts may be lost on a crash. Ended calls require an explicit new call. The trial verifies Gmail access but provides no inbox actions. Free Render sleep and restarts can interrupt calls.
