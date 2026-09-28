# Persona deployment

The public entry point is the Vercel `usepersona` project. Next.js proxies `/api/*` to the Render service through its build-time `BACKEND_URL`. The backend authenticates session cookies itself and checks `Origin` plus the custom client header on every write.

## Account selection

Use the personal Render workspace `My Personal Workspace`, ID `tea-d731qrp9fqoc73cc7ehg`. The backend service is `persona-api`, ID `srv-datekju0tbcc73aeq1h0`, at `https://persona-api-ngfi.onrender.com`. Before a deployment mutation, run `render whoami` and `render workspace current` and verify the personal account and this workspace. Do not reuse an unrelated work account's credentials.

## Configuration

The backend requires `DATABASE_URL`, `OPENAI_API_KEY` and `APP_ORIGINS`. Set `NODE_ENV=production` on Render for Secure cookies. `APP_ORIGINS` is a comma-separated list of exact permitted browser origins. Never configure a wildcard. Set `OPENAI_MODEL` to select a model, defaulting to `gpt-4.1-mini`. Local secrets belong in the ignored `backend/.env` file.

Use the Neon Free project `persona-onboarding` in Ashwin's personal organization, production branch, database `persona`, Oregon region. The Render service uses the Free web-service plan in Oregon. The repository's `render.yaml` describes its settings. Configure secret variables in Render, never in the Blueprint or repository.

Render builds with `npm ci --include=dev && npm run build` from `backend/`. `npm run start:prod` runs the transactional, repeatable initial migration before starting NestJS. A failed migration prevents startup. `/ready` queries the conversation table; it returns 503 when storage is unavailable. The process-only starter root response is not a readiness signal.

Every database operation runs inside a transaction with `SET LOCAL statement_timeout = '10s'`. This is applied after beginning the transaction because the deployed Neon connection did not preserve the driver's startup timeout setting. CI exercises cancellation and subsequent recovery against Postgres, and the same check runs against Neon during release verification.

Vercel uses `frontend/` as its root directory. Set production `BACKEND_URL` to the Render HTTPS URL, then redeploy because rewrites are generated during the build. `APP_ORIGINS` must include the stable frontend origin. Previews should use isolated services/data if enabled; arbitrary preview origins are not trusted automatically.

## Merge and release

1. CI must pass backend and frontend checks plus browser recovery tests before merging.
2. Both hosting projects follow `main`. Render auto-deploys the backend; Vercel's Git integration deploys the frontend.
3. Wait for the Render migration/startup and readiness check, then the Vercel deployment. Independent hosts do not switch atomically. Schema and API changes must remain compatible with the previously deployed frontend until both finish.
4. Verify `/api/ready` through the public frontend and record both deployed revisions. A successful merge alone is not a completed release.
5. Run the browser checks below and record the result before promoting checkpoint 2.

## Production review

- Open a fresh private browser session, send a concrete help request and wait for the real assistant reply. Both messages should show Saved only after the server returns them.
- Refresh, close and reopen the same browser session. The committed transcript should remain in order. Another browser session must show a separate conversation.
- Restart the backend, reconnect and confirm the committed transcript survives. Let the free backend idle naturally and open the frontend later to observe wake-up behavior.
- In browser automation, allow a real `/api/turns` request to finish at the server, discard its response, then click Retry message. Confirm one user turn and one assistant turn. Repeated delivery of the same identifier must not call the model again after completion.
- Simulate database unavailability through an isolated test configuration or a controlled test adapter. Check readiness and submit failure, visible pending content, and successful retry after recovery. Do not disrupt unrelated databases.

## Recovery limits

Pending messages stay visible while the page remains open. A refreshed page restores committed turns and any unfinished saved operation. Unsubmitted drafts and requests that never reached the backend are not guaranteed after a browser crash.

One unresolved submission is allowed per conversation. Concurrent replays return that operation instead of starting another reply. Each generation attempt has a 90-second lease and a unique attempt identifier; late results from superseded attempts cannot save a reply. A process crash can leave an uncertain provider request. After lease expiry, an explicit retry may invoke the provider again, but only one assistant turn can be committed. Provider-level exactly-once execution across process failure is not claimed.

The model receives the latest 40 committed turns. Transcripts remain stored in the app database. App-generated logs contain failure codes and operation IDs, not message content, cookies, connection strings or API keys. The app requests `store: false` from OpenAI, which does not change the provider's separate abuse-monitoring policy.

Start over, operator cleanup, voice and Gmail belong to later checkpoints. Use a fresh private browser session to test a new conversation before Start over ships.

## Checkpoint 2

The migration adds fact history, per-submission assessment receipts and integration verification timestamps. It is additive and repeatable, so the previous frontend and backend remain compatible during rollout. Follow the [conversational onboarding checks](./onboarding.md) after the usual readiness and saved-chat checks.
