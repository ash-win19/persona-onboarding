NestJS backend for Persona onboarding, using TypeScript, Vitest, and Oxlint.

Run from this directory:

```sh
npm ci
npm run start:dev
```

The server runs at [localhost:3001](http://localhost:3001). Set the `PORT` environment variable to change the port. The starter `GET /` endpoint returns `Hello World!`.

Set `FRONTEND_URL` to the frontend's deployed origin in this Vercel project's environment variables. It must be an HTTP(S) origin without a path, query, or fragment. Production startup requires it. Locally, CORS defaults to `http://localhost:3000`.

To override local settings, copy `.env.example` to `.env` and run `npm run start:dev -- --env-file .env`. Vercel supplies environment variables directly; it does not need this local file. For Preview deployments, set the exact corresponding frontend origin separately.

CORS allows browser requests and preflights from the configured origin. It does not grant other origins permission or enable cookie credentials, and it is not an authentication mechanism.

Check and build:

```sh
npm run lint
npm test
npm run test:e2e
npm run build
npm run start:prod
```

The onboarding coordinator, persistence, voice, and Gmail integrations have not been implemented yet.

See the [repository README](../README.md) for running both apps.
