---
name: app-run-and-deploy
description: Run the application in development or production, fill in .env, publish the schema to a local or remote database, put several instances on one machine, and deploy to Deno Deploy. Use whenever the task is starting the app, a connection or environment variable, a build that behaves differently from dev, or shipping the app to a server.
argument-hint: Say what you are doing — starting dev, preparing a production build, connecting a managed database, or deploying — and to which host or platform.
metadata:
  audience: app
---

# Running and Deploying the Application

Use this skill when:
- starting the app, in development or production
- something in `.env` needs to be set, and it is not obvious which variable
- the production build behaves differently from `deno task dev`
- publishing the schema to a database that is not the local container
- putting a second application (or a training copy) on the same machine
- deploying to Deno Deploy

The framework is a library: it never reads `Deno.env` by itself. The application does, in
one place — `configFromEnv()` inside `app/server.ts`. Every variable below is read there.

## Tasks

```bash
deno task dev              # backend + Vite together
deno task dev:server       # backend only (--watch)
deno task dev:front        # Vite only
deno task build:front      # production build into dist/
deno task startdb          # docker compose up -d (PostgreSQL)
deno task sql:registry     # regenerate app/_generated/** from manifest.json
deno task sql:assemble     # build the SQL package from the models' db/ files
deno task sql:publish      # publish it into the LOCAL database
deno task sql:deploy --yes # publish it into a REMOTE database
deno task skills:sync      # refresh .claude/skills from @altera/skills
```

After changing a model, almost always the same three:

```bash
deno task sql:registry && deno task sql:assemble && deno task sql:publish
```

## `.env`

One file, in the repository root — `docker-compose.yml` feeds from it too, so the database
password is written once. The template is `.env.example`; keep it current.

```
# Connection — libpq names, the ones psql, pg_dump and every managed database
# already understand. A provider that hands out a single string goes into
# DATABASE_URL: it is read when PGHOST and PGDATABASE are not set. The source is
# taken whole, never field by field.
# DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
PGHOST=localhost
PGPORT=5432
PGDATABASE=myapp
PGUSER=myapp
PGPASSWORD=change-me
PGSSLMODE=            # empty → derived from the host: local plain, anything else `require`
DB_POOL_SIZE=10       # 1–3 on serverless: many isolates, each with its own pool

PORT=3000             # backend; vite.config.ts reads it too, to point the /api proxy here
VITE_PORT=5173        # Vite dev server; strictPort is on
VITE_DEV_URL=http://localhost:5173   # non-empty → views are served by Vite (dev mode)

BLOB_TOKEN_SECRET=change-me-in-production   # signs attachment links; the placeholder
                                            # refuses to start in production
AUTH_SESSION_TTL_HOURS=720
AUTH_COOKIE_SECURE=          # empty → on in production, off locally (http)
AUTH_COOKIE_NAME=myapp_session   # unique per machine — see "Several instances"

BOOTSTRAP_LOGIN=admin        # login + password together → an administrator is created
BOOTSTRAP_PASSWORD=          # on the first successful login
```

Everything else has a default. Two rules worth remembering:

- **`--env-file` does not override variables already exported in the shell.** `PGHOST` is a
  name people do export globally for their own `psql`, and then it quietly beats the
  project's `.env`. Where the app actually went is printed at startup:
  `✅ PostgreSQL <host>:<port>/<database> відповідає`. Start there when the data looks wrong.
- **TLS to the database follows the host** unless `PGSSLMODE` says otherwise. A managed
  database will not accept a plain connection, a local container does not offer TLS, and
  the only way to get this wrong is to forget the variable — so the default covers exactly
  that case. An explicit value, `disable` included, always wins; an unknown one fails at
  startup rather than silently opening an unencrypted connection.

## Development

```bash
deno task dev
```

Brings up the backend (`:3000`) and Vite (`:5173`). **Open the interface at the Vite
address.** While `VITE_DEV_URL` is non-empty, port 3000 serves only `/api`; the views come
from Vite as source modules. Opening `:3000` in this mode gives a page where no tab opens.

## Production

```bash
deno task build:front
```

Then **remove `VITE_DEV_URL` from `.env`** — otherwise the server keeps looking for views in
a Vite that is not running: the page loads and no tab ever opens. Run:

```bash
deno run --allow-net --allow-read --allow-env --env-file ./app/server.ts
```

The server now serves `dist/` itself.

**A production build is not the same code path as dev.** In dev the views arrive from Vite
as source modules; in production they are built chunks loaded by dynamic import, and the
shell creates each form from the chunk's exported `tagName`. Bugs that only exist in the
built output are invisible until then, so run the built app at least once before shipping.

## Publishing the schema

`sql:publish` refuses to run against anything but a local database, and against an
environment marked `production`/`prod`/`staging`. That guard is not about publishing — it
protects against the tools that **write test data** into whatever `.env` points at. It has
no bypass on purpose.

For a remote database there is a separate entry point:

```bash
deno task sql:deploy --yes
```

It requires `--yes` and prints the target before doing anything (`→ публікую SQL у
host:port/database`), because the likely mistake here is the wrong `.env`, not an attacker.
Publishing is idempotent: structure → migrations → functions → seeds with
`on conflict do nothing`.

## Several instances on one machine

Each application in its own directory with its own `.env` — the tasks pass `--env-file`
without a path, so they read `./.env` relative to where they are started. Five values must
differ:

| Variable | Why |
|---|---|
| `PORT` | backend port; `vite.config.ts` reads it for the `/api` proxy |
| `VITE_PORT` + `VITE_DEV_URL` | Vite port; development only |
| `AUTH_COOKIE_NAME` | **cookies do not distinguish ports** — see below |
| `PGDATABASE` (or `PGPORT`) | its own database |
| `BLOB_TOKEN_SECRET` | otherwise one app accepts the other's attachment links |

**The cookie one is the trap.** To a browser, `localhost:3000` and `localhost:3001` are the
same host and one cookie jar — the port is not part of the scope at all. Both instances
write the session cookie at `path=/`, so with the same name, logging into the second app
overwrites the first app's session. It looks like random logouts, not like a configuration
clash. The same applies behind a reverse proxy on one hostname, where there is no port to
begin with.

An occupied Vite port is an error, not a move to 5174: `strictPort` is on, because
otherwise the second Vite would relocate while `VITE_DEV_URL` still pointed at 5173.

## Deno Deploy

The platform provides the database (credentials injected as `PG*`, which the framework
reads directly — the names are libpq), TLS, the port, and the production marker
(`DENO_DEPLOY`, counted the same as `NODE_ENV=production`). So `PG*`, `PORT`, `PGSSLMODE`
and `NODE_ENV` are **not** set by hand; `VITE_DEV_URL` must be absent.

Add a `deploy` block to `deno.json`:

```json
"deploy": {
  "install": "deno install",
  "build": "deno task sql:assemble && deno task build:front",
  "predeploy": "deno run -A ./scripts/sql-deploy.ts ./app --yes --no-assemble --verbose",
  "runtime": { "type": "dynamic", "entrypoint": "./app/server.ts" }
}
```

The schema is assembled in `build` and published in `predeploy` — and the split matters.
A build runs for every build, including one that never ships; `predeploy` runs once per
rollout, right before the revision takes traffic, with the same environment the app gets.
So the credentials never leave the dashboard, and each context (preview, production)
migrates its own database. `--no-assemble` is there because the deployment file system is
not for writing, and the package is already built.

`--yes` belongs in this config rather than in a task, so it cannot be tripped over from a
developer machine. The trade-off is deliberate: DDL now runs automatically on every rollout.

Set in the dashboard: `BLOB_TOKEN_SECRET` (a real random value — the placeholder refuses to
start), `DB_POOL_SIZE=3`, and `BOOTSTRAP_LOGIN`/`BOOTSTRAP_PASSWORD` for the first login.

## When it goes wrong

| Symptom | Cause |
|---|---|
| Blank page in dev, tabs do not open | opened `:3000` while `VITE_DEV_URL` is set — use the Vite address |
| Same in production | `VITE_DEV_URL` left in `.env` after `build:front` |
| `relation "app.users" does not exist` | schema not published into that database |
| Random logouts with two apps on one machine | shared `AUTH_COOKIE_NAME` |
| Login does nothing, no errors | `Secure` cookie over HTTP — either TLS, or clear the production marker |
| The app is on a different database than expected | a globally exported `PGHOST` beat `.env`; read the startup line |
| `Port 5173 is already in use` | intended (`strictPort`) — give the second app its own `VITE_PORT` |
