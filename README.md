# KDRIVE

A personal cloud drive where every change is a version you can browse, compare,
restore or share.

Each person signs in and gets a **workspace** ("My Drive"). Every upload, rename,
move or delete is saved as a new **version**, so you can scrub back to any point,
compare two versions of a file or of the whole drive, and restore a file, a folder
or everything, without losing anything. A file or folder can be shared by
**link**, either live (it follows the item) or pinned to one version.

**Status:** proof of concept in progress. Bun workspaces monorepo:
`apps/api` (Bun + Hono + Drizzle + better-auth), `apps/web` (Next.js 16 +
React 19 + Tailwind v4) and `packages/shared` (zod contracts and helpers).
Files and versions are stored in Platinum volumes; a faithful on-disk emulator
is available for local development and tests.

## Concepts

| | |
|---|---|
| **Workspace** | A drive of files and folders ("My Drive"); one person can have several. Backed by one Platinum volume. |
| **Version** | The whole drive as it was after one action. One action (an upload of 200 files, a move of 3 items) is one version. |
| **Checkpoint** | A named version kept until you remove it. |
| **Restore** | Puts a file, a folder or the whole drive back to a version, as a new version (so a restore can be undone too). |
| **Share link** | A revocable URL to a file or folder: live (follows the item through renames and moves) or pinned to one version. Optional expiry. |

## AI agents

KDRIVE is also an MCP server at `https://<your-kdrive-host>/mcp`. An agent
signs in with OAuth (or uses an agent token), and you choose whether it may
only read, suggest changes that wait for your review, or change files
directly. Every agent change is a version attributed to the agent and can be
undone. [docs/ai-agents.md](docs/ai-agents.md) covers the URL, sign-in, agent
tokens, access levels and review mode, and the tools.

## Getting started

```bash
git clone https://github.com/kortix-ai/volumes.git
cd volumes
bash scripts/install-git-hooks.sh
```

## Develop

### Prerequisites

- [Bun](https://bun.sh) 1.3 or newer
- PostgreSQL 15 or newer running locally (the current OS user, no password)

### First run

```bash
bun install
bash scripts/install-git-hooks.sh

# databases (once)
createdb volumes_dev
createdb volumes_test

# environment: copy the placeholders and fill them in (never commit .env)
cp .env.example apps/api/.env
#   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
#   VOLUMES_STORAGE=emulated   (or set PT_API_URL + PT_TOKEN for Platinum)
#   VOLUMES_DEV_LOGIN=1        (email-only sign-in on this machine; development only)

bun run db:migrate
bun run seed          # optional demo drive for dev@volumes.local (see TESTING.md)
bun run dev
```

`bun run dev` starts both servers:

| URL | What |
|---|---|
| http://localhost:4100 | Web app (sign in at `/signin`) |
| http://127.0.0.1:4101/api/health | API health check |

The browser only talks to port 4100. Next rewrites `/api/*` to the API, so
cookies stay first-party. Both dev servers listen on 127.0.0.1 only; the API's
interface is `API_HOST` and the rewrite target is `VOLUMES_API_ORIGIN` (default
`http://127.0.0.1:4101`), which is how the web app and the API run on different
hosts. The API reads `.env` from the repo root and then `apps/api/.env` (later
values win).

### Storage modes

- **Platinum** (default when `PT_API_URL` and `PT_TOKEN` are set): the real thing.
- **Emulated** (`VOLUMES_STORAGE=emulated`): an on-disk emulator of Platinum
  volume semantics under `apps/api/.data/` (git-ignored). The UI shows an
  "Emulated storage" badge. With neither configured, the API refuses to start.

### Sign-in

Google and GitHub buttons appear only when their client id and secret are set.
OAuth callback URLs: `http://localhost:4100/api/auth/callback/google` and
`http://localhost:4100/api/auth/callback/github`. For local testing without OAuth
apps, `VOLUMES_DEV_LOGIN=1` shows "Continue with dev account". It works only with
`NODE_ENV=development` (the dev script's default), a localhost `BETTER_AUTH_URL`
and a caller on this machine. Emails in `VOLUMES_ADMIN_EMAILS` get the admin page.

### Running it for real

`bun run build` type-checks everything and builds the web app. `bun run --cwd
apps/api start` runs the API with `NODE_ENV=production`: it refuses to start
without a private `BETTER_AUTH_SECRET` of 32+ characters, dev sign-in is off, and
session cookies are `Secure` whenever `BETTER_AUTH_URL` is https. Put a reverse
proxy that appends `X-Forwarded-For` in front of the web app, so rate limits and
the audit trail see each client's address. `VOLUMES_TRUSTED_ORIGINS` adds origins
allowed to call mutating routes; `VOLUMES_MAX_WORKSPACES_PER_USER` (default 5)
caps workspaces per person.

### Checks

```bash
bun run typecheck      # shared, api, web
bun run test           # unit + API tests (uses volumes_test and the emulator)
bun run build          # typecheck + production build of the web app
bun run seed           # demo data (see TESTING.md)
bun run db:generate    # after changing apps/api/src/db/schema.ts (never db:push)
bun run hygiene        # repo hygiene check over tracked files
```

[TESTING.md](TESTING.md) covers the test suites, the demo data and a manual
walk-through.

Run the storage contract suite against real Platinum with
`PT_API_URL=… PT_TOKEN=… VOLUMES_CONFORMANCE=1 bun test src/storage/platinum.contract.test.ts`
from `apps/api` (it creates and deletes temporary `vx-test-*` volumes).

## What never gets committed

`.env` files and other secrets, keys and credentials, dependency directories such
as `node_modules`, build output, local data, and AI assistant or agent files.
This is enforced in three places:

1. **`.gitignore`**: ignores every `.env` variant by default.
2. **A pre-commit hook** (`.githooks/pre-commit`): checks what is actually staged,
   so `git add -f` can't bypass it.
3. **CI**: checks the tree and every file added across a PR's commits.

Run the check yourself with `bash scripts/check-repo-hygiene.sh`.
