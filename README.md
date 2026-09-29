# Persona

Persona is a conversational onboarding trial with saved text chat, browser voice, Gmail consent, and recovery across interruptions. It learns the agent's name, the user's name, and a help request while allowing useful work to start before every onboarding goal is met. Refusals and deferrals persist across channels and refreshes.

Try [the production app](https://usepersona.vercel.app). Next.js runs on Vercel, NestJS on the personal Render service, and Postgres on Neon. All three hosting plans are Free; OpenAI requests use the configured account's credits. Read the [evaluator runbook](docs/release-checks.md) for the full test journey and [release evidence](docs/planning/persona-linear/checkpoint-three-six-release.json) for verification tied to deployed revisions.

Use Node.js 22 or later. Install each app with `npm --prefix frontend ci` and `npm --prefix backend ci`.

Create `backend/.env` from `backend/.env.example` and set a PostgreSQL connection string and OpenAI API key. Real environment files are ignored by Git. For local development, `APP_ORIGINS=http://localhost:3000` and frontend `BACKEND_URL` defaults to `http://localhost:3001`.

Voice uses `OPENAI_REALTIME_MODEL`, with `gpt-realtime-mini` as the default. Gmail requires a Google web OAuth client, the matching `GOOGLE_REDIRECT_URI`, and a stable `GMAIL_TOKEN_KEY`. The [Google setup instructions](docs/release-checks.md#google-testing-configuration) cover evaluator allowlisting and encrypted credential storage. The trial requests Gmail metadata permission and fetches only the verified account address.

```sh
npm --prefix backend run build
npm --prefix backend run start:prod
```

In a separate terminal:

```sh
npm --prefix frontend run dev
```

Open `http://localhost:3000`. A browser-owned HttpOnly credential creates or resumes an anonymous conversation. Submitted messages use stable IDs, so a retry after a lost response restores the accepted result. The UI distinguishes unconfirmed input from committed turns and offers explicit recovery when the backend, database or model is unavailable.

Production requires `NODE_ENV=production` on Render and `APP_ORIGINS=https://usepersona.vercel.app`. Set Vercel's `BACKEND_URL` to the Render service URL. The frontend proxy preserves cookies but does not replace backend authorization. Read [deployment and production verification](docs/deployment.md) before changing hosting or environment configuration.

## Checks

```sh
npm --prefix backend run typecheck
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run build
npm --prefix frontend test
npm --prefix frontend run lint
BACKEND_URL=http://localhost:3001 npm --prefix frontend run build
npm --prefix frontend run typecheck
npm --prefix frontend run test:browser
```

API tests run against embedded PostgreSQL with controlled provider adapters. Set `TEST_DATABASE_URL` to a disposable local PostgreSQL database to include the connection and transaction deadline test. Browser tests exercise the real UI against controlled HTTP responses. Real OpenAI, Google consent and hosting checks are recorded separately. CI runs all checks for pull requests and merges to main.
