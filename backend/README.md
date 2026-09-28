NestJS backend for Persona onboarding, using TypeScript, Vitest, and Oxlint.

Run from this directory:

```sh
npm ci
npm run start:dev
```

The server runs at [localhost:3001](http://localhost:3001). Set the `PORT` environment variable to change the port. The starter `GET /` endpoint returns `Hello World!`.

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
