Next.js frontend for Persona onboarding, using TypeScript, the App Router, Tailwind CSS, and ESLint.

Run from this directory:

```sh
npm ci
npm run dev
```

The development server runs at [localhost:3000](http://localhost:3000). The starter page is in `src/app/page.tsx`; shared styles and metadata are in `src/app/globals.css` and `src/app/layout.tsx`. The app uses system fonts, so builds do not need to download fonts.

Check and build:

```sh
npm run lint
npm test
npm run build
npm start
```

If local process restrictions block Turbopack, use `npm run build -- --webpack`.

Set `BACKEND_URL` to the backend's deployed URL in this Vercel project's environment variables before building. Next.js proxies `/api/*` to that URL, so the browser only talks to this app. The variable is server-only and is not exposed to browser code. To customize local development, copy `.env.example` to `.env.local` and restart the dev server; otherwise, the proxy targets `http://localhost:3001`. Production builds require the variable.

Use `apiFetch` from `@/lib/api` in browser code to make backend requests. `apiFetch("/messages")` requests `/api/messages`, which reaches `${BACKEND_URL}/messages`. It returns a standard `Response`; use `.text()` for the existing root endpoint and `.json()` for future JSON endpoints. The starter homepage remains unchanged.

See the [repository README](../README.md) for running the backend alongside the frontend.
