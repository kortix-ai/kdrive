# Volumes

Versioned files you can share with a link.

A **volume** is a folder of files with a complete history. Every change is saved
as a new **version**, so you can see what changed, compare any two points in time,
and roll back without losing anything. Any volume can be shared with a **link**,
either pinned to an exact version or live so it always shows the latest files.

**Status:** proof of concept in progress. Bun workspaces monorepo:
`apps/api` (Bun + Hono + Drizzle + better-auth), `apps/web` (Next.js 16 +
React 19 + Tailwind v4) and `packages/shared` (zod contracts and helpers).
Files and versions are stored in Platinum volumes; a faithful on-disk emulator
is available for local development and tests.

## Concepts

| | |
|---|---|
| **Volume** | A named collection of files, such as a project folder or a dataset. |
| **Version** | An immutable snapshot of every file in a volume. |
| **Link** | A revocable URL to a volume, pinned to one version or following the latest. |

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
#   VOLUMES_DEV_LOGIN=1        (email-only sign-in for local testing)

bun run db:migrate
bun run dev
```

`bun run dev` starts both servers:

| URL | What |
|---|---|
| http://localhost:4100 | Web app (sign in at `/signin`) |
| http://localhost:4101/api/health | API health check |

The browser only talks to port 4100. Next rewrites `/api/*` to the API, so
cookies stay first-party. The API reads `.env` from the repo root and then
`apps/api/.env` (later values win).

### Storage modes

- **Platinum** (default when `PT_API_URL` and `PT_TOKEN` are set): the real thing.
- **Emulated** (`VOLUMES_STORAGE=emulated`): an on-disk emulator of Platinum
  volume semantics under `apps/api/.data/` (git-ignored). The UI shows an
  "Emulated storage" badge. With neither configured, the API refuses to start.

### Sign-in

Google and GitHub buttons appear only when their client id and secret are set.
OAuth callback URLs: `http://localhost:4100/api/auth/callback/google` and
`http://localhost:4100/api/auth/callback/github`. For local testing without OAuth
apps, `VOLUMES_DEV_LOGIN=1` shows "Continue with dev account" (never enabled in
production). Emails in `VOLUMES_ADMIN_EMAILS` get the admin page.

### Checks

```bash
bun run typecheck      # shared, api, web
bun run test           # unit + API tests (uses volumes_test and the emulator)
bun run db:generate    # after changing apps/api/src/db/schema.ts (never db:push)
bun run hygiene        # repo hygiene check over tracked files
```

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
