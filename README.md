Persona onboarding uses two independent TypeScript apps:

- `frontend/`: Next.js App Router, Tailwind CSS, and ESLint. Runs on port 3000.
- `backend/`: NestJS, Vitest, and Oxlint. Runs on port 3001, or the `PORT` environment variable.

Use Node.js 22. Run these commands from the repository root in separate terminals:

```sh
npm --prefix frontend run dev
```

```sh
npm --prefix backend run start:dev
```

On a fresh checkout, install each app with `npm --prefix frontend ci` and `npm --prefix backend ci`.

The apps use these environment variables:

| App | Variable | Local default | Vercel production example |
| --- | --- | --- | --- |
| Frontend | `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | `https://your-backend.vercel.app` |
| Backend | `FRONTEND_URL` | `http://localhost:3000` | `https://your-frontend.vercel.app` |

In each Vercel project's Settings → Environment Variables, set its variable for Production using the stable URL of the other app. `FRONTEND_URL` must be an origin with no path, query, or fragment. Configure Preview separately with the corresponding frontend and backend URLs. Only the configured frontend origin receives CORS permission; preview URLs are not automatically allowed.

Redeploy both projects after changing the values. Next.js embeds `NEXT_PUBLIC_API_URL` into browser code during the build, so it must be set before the frontend deployment builds. This value is public and must not contain secrets. Production requires explicit configuration: the backend refuses to start without `FRONTEND_URL`, and the frontend API helper rejects requests without a configured `NEXT_PUBLIC_API_URL`.

Local development works with the defaults above. To override them, copy `frontend/.env.example` to `frontend/.env.local`, and copy `backend/.env.example` to `backend/.env`. Next.js loads its local file automatically; load the backend file using `npm --prefix backend run start:dev -- --env-file .env`. Real environment files are ignored by Git.

Frontend browser code can call the backend with the shared helper:

```ts
import { apiFetch } from "@/lib/api";

const response = await apiFetch("/");
const message = await response.text(); // The starter endpoint returns "Hello World!".
```

`apiFetch` accepts fetch options, preserves an optional API path prefix, and rejects unsuccessful HTTP responses. Call it from the client component or browser event handler that needs backend data. The starter homepage does not make API requests yet. Cookie authentication is not part of this setup; CORS controls browser access and does not authenticate requests.

Build and check the apps:

```sh
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run build
```

If local process restrictions prevent Turbopack from building, use `npm --prefix frontend run build -- --webpack`.

The apps currently contain starter code. The onboarding flow, voice, Gmail, and conversation coordinator are not implemented yet.
