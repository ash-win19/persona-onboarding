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
npm run build
npm start
```

If local process restrictions block Turbopack, use `npm run build -- --webpack`.

See the [repository README](../README.md) for running the backend alongside the frontend.
