# Persona

Checkpoint 1 is a saved text conversation. Next.js serves the chat interface on Vercel, NestJS controls sessions and model requests on Render, and Neon Postgres stores messages and durable submission records. Voice, Gmail and structured onboarding arrive in later checkpoints.

Use Node.js 22 or later. Install each app with `npm --prefix frontend ci` and `npm --prefix backend ci`.

Create `backend/.env` from `backend/.env.example` and set a PostgreSQL connection string and OpenAI API key. Real environment files are ignored by Git. For local development, `APP_ORIGINS=http://localhost:3000` and frontend `BACKEND_URL` defaults to `http://localhost:3001`.

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

API tests run against embedded PostgreSQL with a controlled model adapter. Browser tests exercise the real UI against controlled HTTP responses. Real OpenAI, Neon and hosting checks are recorded separately. CI runs all checks for pull requests and merges to main.
