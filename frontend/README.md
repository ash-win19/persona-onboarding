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

Set `NEXT_PUBLIC_API_URL` to the backend's deployed URL in this Vercel project's environment variables before building. To customize local development, copy `.env.example` to `.env.local`; otherwise, API calls default to `http://localhost:3001`. Production API calls require the variable.

Use `apiFetch` from `@/lib/api` in browser code to make backend requests. It returns a standard `Response`; use `.text()` for the existing root endpoint and `.json()` for future JSON endpoints. The starter homepage remains unchanged.

See the [repository README](../README.md) for running the backend alongside the frontend.
