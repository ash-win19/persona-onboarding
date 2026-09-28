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

Build and check the apps:

```sh
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run build
```

If local process restrictions prevent Turbopack from building, use `npm --prefix frontend run build -- --webpack`.

The apps currently contain starter code. The onboarding flow, voice, Gmail, and conversation coordinator are not implemented yet.
