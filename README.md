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

Only the frontend is configured with the other app's location. The browser calls the frontend's own `/api/*` routes, and Next.js proxies them to the backend. The backend does not need to know the frontend's URL and has no CORS configuration.

| App | Variable | Local default | Vercel production example |
| --- | --- | --- | --- |
| Frontend | `BACKEND_URL` | `http://localhost:3001` | `https://your-backend.vercel.app` |

In the frontend Vercel project's Settings → Environment Variables, set `BACKEND_URL` for Production to the backend's stable URL, and configure Preview separately if previews should use a different backend. Next.js reads it when building the proxy rules, so redeploy the frontend after changing it. It is server-only and is not included in browser code. Production builds fail without it. The backend needs no environment variables; it listens on `PORT` when one is provided.

Local development works with the default. To override it, copy `frontend/.env.example` to `frontend/.env.local` and restart the dev server. Real environment files are ignored by Git.

Frontend browser code can call the backend with the shared helper:

```ts
import { apiFetch } from "@/lib/api";

const response = await apiFetch("/");
const message = await response.text(); // The starter endpoint returns "Hello World!".
```

`apiFetch("/messages")` requests `/api/messages` on the frontend, which proxies to `${BACKEND_URL}/messages`. It accepts fetch options and rejects unsuccessful HTTP responses. Call it from the client component or browser event handler that needs backend data. The starter homepage does not make API requests yet. The backend is still publicly reachable at its own URL; the proxy does not authenticate requests.

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
