---
name: altera-new-app
description: Deploy a new application on the Altera framework into an empty directory — from scaffold to a working login screen — and verify that it actually runs. Use when asked to "deploy an Altera app", "create a new Altera application", or when shown an empty folder with that intent.
argument-hint: Give the project name (latin letters) and say whether to bring up PostgreSQL in Docker or use an existing one.
metadata:
  audience: bootstrap
---

# Deploying a New Altera Application

This skill is for an **empty directory**: there is no application yet, and your job is to
take it from `jsr:@altera/create` to a login screen someone can actually log into.

Do not stop at the scaffold. It writes the files and prints six next steps — and those steps
are where installation actually breaks, quietly: a skipped `deno install` fails later rather
than where it was skipped; a leftover `VITE_DEV_URL` gives a blank page with no error; an
empty `BLOB_TOKEN_SECRET` does not matter until the app is marked production. Walk every
step and **verify the result**, not the fact that a command ran.

## 0. Preflight

Check before creating anything — redoing it costs more:

```bash
deno --version          # 2.9+ required
docker --version        # only if the database goes into a container
```

Ask the user unless already told: the **project name** (lowercase latin letters, digits,
`-`, `_`, first character a letter — it becomes the database name and goes into `sql.json`)
and **where PostgreSQL comes from** — a Docker container or an existing server. Do not
invent a name if the directory is not named to the pattern.

**The name must not repeat a neighbouring application's**, and that is not about tidiness:
the template derives `PGDATABASE`, `PGUSER` and `AUTH_COOKIE_NAME` from it. Two applications
with different names collide on nothing but the numeric ports; two with the same name collide
on all three at once — and that one is quiet, because the credentials match too, so
`sql:publish` publishes this schema into the neighbour's database and says nothing. What is
already on the machine:

```bash
docker ps -a --format "{{.Names}}\t{{.Ports}}"
```

Ports, all three at once (`deno` is here anyway, and this reads the same on Windows and POSIX):

```bash
deno eval --allow-net "for (const p of [3000,5173,5432]) { try { Deno.listen({port:p}).close(); console.log(p+' free') } catch { console.log(p+' BUSY') } }"
```

A busy port is not a silent failure — Vite has `strictPort`, `Deno.serve` throws `AddrInUse`,
Docker says `port is already allocated`. Looking early is about **order**, not about the
error: `PGPORT` has to be settled *before* `deno task startdb`, because the container creates
the database with whatever `.env` held at its first start, and editing the file afterwards
changes nothing (`deno task stopdb` and up again is the way back). `PORT` and `VITE_PORT` can
be changed at any time — `VITE_PORT` only together with `VITE_DEV_URL`.

## 1. Scaffold

From inside the empty directory:

```bash
deno run -A jsr:@altera/create .
```

The project name comes from the directory name. If it does not fit the pattern (spaces,
capitals, non-latin), pass one: `deno run -A jsr:@altera/create . --name myerp`.

The scaffold refuses to write into a non-empty directory. If it does, show the user what is
in there and ask; do not reach for `--force` on your own.

## 2. `.env`

```bash
cp .env.example .env
```

Then edit it — this is not a formality, three values have to change:

- **`PGPASSWORD`** — your own (the example says `change-me`). `docker-compose.yml` reads the
  same file, so the password is written once and cannot drift apart.
- **`BLOB_TOKEN_SECRET`** — it signs attachment links, and with the placeholder
  `change-me-in-production` a production server refuses to start at all. Generate one:

  ```bash
  deno eval "console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''))"
  ```

- **`BOOTSTRAP_PASSWORD`** — set it if the administrator should be created automatically.
  Left empty, the login screen switches to "first run: create an administrator", where a
  human types both login and password. Both paths work; a password set here counts as
  temporary and must be changed on the first login.

**If another Altera application already lives on this machine**, these must differ: `PORT`,
`VITE_PORT` + `VITE_DEV_URL`, `PGDATABASE`, `BLOB_TOKEN_SECRET`, and — the least obvious one
— `AUTH_COOKIE_NAME`. Cookies do not distinguish ports: to a browser `localhost:3000` and
`localhost:3001` are the same host and one cookie jar, so with a shared name, logging into
the neighbouring app silently overwrites this session. The template already puts
`<project>_session` there, so with a distinct project name (step 0) the database, the role
and the cookie differ on their own — what is left to pick by hand is the ports and
`BLOB_TOKEN_SECRET`.

## 3. Database

```bash
deno task startdb
```

Brings up PostgreSQL in Docker with the credentials from `.env`. If step 0 showed 5432
busy, change `PGPORT` rather than fighting someone else's container — and change it before
this command, not after: the container takes `.env` as it is at first start and keeps it. With an existing PostgreSQL
this step is skipped: create the database and role (`create database <name> owner <role>`)
and put them into `.env`.

## 4. Dependencies — BEFORE the build

```bash
deno install
```

Not a formality. `deno.json` carries `"vendor": true`: the Vite preset and Tailwind read the
framework sources **from disk**, and the JSR cache is a flat list of hash-named files with
nothing to scan. Skip it and the build fails with
`Could not load .../vendor/jsr.io/@altera/client/...`.

If a framework release is less than a day old, Deno will not take it ("A newer matching
version was found, but it was newer than the specified minimum dependency date") — then
`deno install --min-dep-age=0`.

## 5. Schema

```bash
deno task sql:registry && deno task sql:assemble && deno task sql:publish
```

- `sql:registry` — model registry, routes and the view manifest from the models' `manifest.json`;
- `sql:assemble` — the SQL package from the core and the application's models;
- `sql:publish` — runs it against the database: structure → migrations → functions → seeds.

Publishing is idempotent. `sql:publish` works **only** against a local database; for a remote
one there is a separate entry point, `deno task sql:deploy --yes`.

## 6. Run and verify

```bash
deno task dev
```

Brings up the backend (`:3000`) and Vite (`:5173`). **Open the interface at the Vite
address** — while `VITE_DEV_URL` is non-empty, port 3000 serves only `/api`. This is the most
common confusion on a first run: `:3000` gives a page where no tab ever opens.

Do not report success because a command started. Confirm it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

200 and a login screen means the app is alive. Then log in (or create the administrator) and
open at least one menu item: the demo model "Counterparties" sits in
`app/catalog/counterparty/`.

If you can drive a browser, do that and show the result. If you cannot, tell the user plainly
that only the HTTP response was checked.

## 7. What to say at the end

- the application is created, the schema is published, login works;
- `.env` is in `.gitignore` — the password and secret go nowhere, but they will have to be
  set up again on another machine;
- `.claude/skills/**` are already in place and **are committed with everything else** —
  refresh them with `deno task skills:sync` whenever `@altera/client` moves;
- the "Counterparties" demo model is removed in four steps, described in the app's `CLAUDE.md`;
- to add a model, the `model-feature-architecture` skill is already there.

## When it goes wrong

Messages below are quoted as the tools print them.

| Symptom | Cause |
|---|---|
| `Каталог ... не порожній` | the scaffold does not overwrite; show the contents and ask |
| `Ім'я проєкту «.» не годиться` | old `@altera/create` — update it, or pass `--name` |
| `Could not load .../vendor/...` | `deno install` was skipped before the build |
| Blank page, empty console | no `tsconfig.json` with `experimentalDecorators` — do not delete it |
| Empty page on `:3000` | the interface belongs on `:5173` while `VITE_DEV_URL` is set |
| `Команду «X/list» не реалізовано` | the SQL was not published |
| `password authentication failed` | `.env` was edited after `deno task startdb` — the container created the database with the old password; `deno task stopdb` and bring it up again |
