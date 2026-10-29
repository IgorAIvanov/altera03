# Altera

**English** | [Українська](README.uk.md)

**Altera is a harness for an AI agent, built for creating business applications.**
The agent (Claude Code) writes the accounting system; the framework keeps it on rails:
models are declared rather than coded, the routine parts (CRUD, lists, forms, printing,
permissions, audit) come from the core, and the rules for writing each layer reach the
agent as skills shipped with the application. A missing framework capability is not
worked around in the application — it is fixed in the core, so the code the agent writes
stays uniform and predictable.

The first application domain is Ukrainian accounting (chart of accounts, double-entry
postings with analytics, source documents, reports), but the mechanism is general:
catalogs, posted documents, registers, reports.

## Demo

A deployed accounting application built on Altera — **<https://altera-ai.com.ua>**
(login: `admin` / `DemoAdmin`).

## Inspiration

Altera's ideas and vocabulary come from the **A2v10** platform by
[Alex Kukhtin](https://github.com/alex-kukhtin): the model as the basic unit, logic in
database SQL functions, a single response envelope across the whole API, print templates
as data. Altera carries that approach over to a modern web stack and makes the agent the
main "developer".

## Stack

| Layer | Technology |
|---|---|
| Runtime | [Deno](https://deno.com) 2.9+, monorepo of workspace packages |
| Database | PostgreSQL 15+ — functions `{schema}.{model}_{command}(user_id, payload jsonb)` |
| Backend | [Danet](https://danet.land) — one HTTP model runtime, no controller per model |
| Frontend | Lit Web Components, Vite, Tailwind CSS v4, daisyUI v5 |
| Contracts | TypeBox — one schema per model for the server, SQL and forms |
| Printing | built-in PDF renderer (pdf-lib), templates stored as data |
| Agent | HTTP API for an external agent, MCP wrapper `@altera/mcp`, personal tokens |

The framework is published on [JSR](https://jsr.io/@altera) as `@altera/server`,
`@altera/client`, `@altera/tools`, `@altera/create`, `@altera/skills`.

## Prerequisites

- **Deno 2.9+** — <https://docs.deno.com/runtime/getting_started/installation/>.
  Node.js is not needed: Deno installs the npm dependencies.
- **PostgreSQL 15+** — either **Docker** (the application brings the database up itself,
  `deno task startdb`) or an existing server where you can create a separate database.
- **Claude Code** — CLI, desktop app or IDE extension:
  <https://docs.claude.com/en/docs/claude-code>.
- `curl` (on Windows, the built-in `curl.exe`) and, optionally, `git`.

## Installing with Claude

The agent deploys the application itself, using the `altera-new-app` skill: from the
scaffold to the login screen, verifying each step (ports, `.env`, database, dependencies,
schema publishing, first administrator). All you do is put the skill into an empty folder.

**1. An empty folder with the skill in it**

```bash
mkdir myerp && cd myerp && curl --create-dirs -o .claude/skills/altera-new-app/SKILL.md https://raw.githubusercontent.com/IgorAIvanov/altera03/master/skills/src/altera-new-app/SKILL.md
```

In PowerShell:

```powershell
mkdir myerp; cd myerp; curl.exe --create-dirs -o .claude/skills/altera-new-app/SKILL.md https://raw.githubusercontent.com/IgorAIvanov/altera03/master/skills/src/altera-new-app/SKILL.md
```

**2. Start Claude Code in that folder and ask**

> Deploy an Altera application. PostgreSQL in Docker.

The agent asks for what it cannot invent (the project name, where PostgreSQL comes from)
and takes you to a login screen open in the browser. The project name is lowercase latin:
the database name, role and session cookie are derived from it, so two applications on one
machine must have different names.

**3. Then — development**

The scaffold puts the application skills (`.claude/skills`) and a `CLAUDE.md` into the
application, so further requests — "add a warehouse catalog", "make a goods receipt
document with a tabular section", "add a printed form" — the agent carries out by the
framework's rules. What changed between framework versions lands in the application as
`FRAMEWORK-CHANGELOG.md`.

### Without the agent

The same steps by hand — [`docs/deployment.md`](docs/deployment.md): `deno run -A
jsr:@altera/create myerp`, `.env`, database, `deno install`, SQL publishing, first
administrator. Deploying to Deno Deploy — [`docs/deno-deploy.md`](docs/deno-deploy.md).
The documentation in `docs/` is in Ukrainian.

## Connecting an agent to a running database

Besides development, an agent can work **inside** the accounting system on behalf of a
user: browse catalogs, create and post documents, print. That takes a personal token
(issued from the browser) and the MCP wrapper: [`mcp/README.md`](mcp/README.md).

## This repository

It holds the framework and the demo application it is tested against:

```
app/      demo application: models, SQL, screens
client/   ui-kit and client runtime (@altera/client)
server/   backend library and core SQL (@altera/server)
tools/    codegen, SQL assembly and publishing (@altera/tools)
create/   new-application scaffold (@altera/create)
skills/   agent skills (@altera/skills)
mcp/      MCP wrapper over the HTTP API (@altera/mcp)
docs/     decisions, plans and explanations
```

Running from the repository:

```bash
cp .env.example .env        # then fill in passwords and secrets
deno task startdb
deno install
deno task sql:assemble && deno task sql:publish
deno task dev
```

Repository map, commands and invariants — [`CLAUDE.md`](CLAUDE.md); roadmap —
[`docs/development-plan.md`](docs/development-plan.md).

## License

[MIT](LICENSE). Licenses of third-party components that end up in a build are derived
automatically — `THIRD-PARTY-NOTICES.md` next to the bundle and inside the
`@altera/server` package.
