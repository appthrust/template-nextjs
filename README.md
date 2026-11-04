# AppThrust Next.js PostgreSQL template

This starter proves the AppThrust managed PostgreSQL path:

- AppThrust injects `DATABASE_URL` through `ComponentConnection`.
- The initial schema is applied through `DatabaseChange`.
- The Next.js app reads and writes `appthrust_demo_messages`.

The Docker image is a code-only artifact run by the AppThrust Managed Runtime
`nodejs-24`, which supplies Node.js and launches `node server.js` in
`/workspace/app` as UID/GID 1000 with a writable `.next/cache` volume. It is not
runnable standalone with `docker run`. Local development is unchanged: use
`npm run dev`.

The app does not run migrations on startup. For local development, apply
`db/migrations/0001_init.sql` to your PostgreSQL database, then set:

```bash
DATABASE_URL=postgresql://app:password@localhost:5432/app
```

Run locally:

```bash
npm install
npm run dev
```

## Platform health probes

The platform probes `GET /healthz` for startup and liveness, and `GET /` for readiness. Keep `/healthz` static and database-independent so startup and liveness do not depend on database availability.
