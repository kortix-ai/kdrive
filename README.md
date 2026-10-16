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
`http://localhost:4100/api/auth/callback/github`. Setting up Google (Cloud Console
client, consent screen, local and server env) is in
[docs/google-sign-in.md](docs/google-sign-in.md). For local testing without OAuth
apps, `VOLUMES_DEV_LOGIN=1` shows "Continue with dev account". It works only with
`NODE_ENV=development` (the dev script's default), a localhost `BETTER_AUTH_URL`
and a caller on this machine.

### Admins

`VOLUMES_ADMIN_EMAILS` (comma-separated) is the source of truth for admins. On
boot the API mirrors it into the `admins` table, idempotently: a listed user who
already exists becomes an admin, and a listed address that signs up later is one
from its first sign-in. Listed addresses may always create an account, even when
sign-up is invite-only or closed (how the founder of a closed server gets in),
and cannot be removed in the app (they show as "from server config"). Admins
added under Admin → Admins are extra and stay removable (the last admin cannot
be removed). Rights always need the address verified on the account.

The admin console lives at `/admin`, in its own frame apart from the drive. For
anyone who is not an admin (signed out included), `/admin/**` is the app's
normal 404 and `/api/admin/*` answers 404 like a route that does not exist; the
refusals are audited. Sections: Overview (totals and sign-ups per day), Users
(each opens their drives, shared drives, quota and admin rights; usage by email
domain), Drives, Storage requests, Billing, Logs (the audit log with filters and
CSV export, and a Server log: the API's recent warnings, errors and 5xx answers,
kept in memory and redacted), Admins and a read-only Settings page.

### Accounts and email

Email + password accounts are on by default (`VOLUMES_EMAIL_PASSWORD=0` turns them
off). Passwords are hashed with argon2id; older scrypt hashes keep working and are
replaced on the next change or reset. The flows are written not to reveal which
addresses have accounts: sign-up answers the same for a new and a taken address
(the owner of a taken one gets an email instead), sign-in says "wrong email or
password" for both, and forgot-password and resend-verification always succeed.
Sign-in, sign-up, forgot-password, resend-verification, reset and change-password
are rate limited per address and per client.

| Variable | Default | What it does |
| --- | --- | --- |
| `RESEND_API_KEY` | – | Sends account mail through Resend (tried first). |
| `MAILTRAP_API_TOKEN` | – | Sends through Mailtrap (fallback, or the only provider). |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | `noreply@<host>` / `KDRIVE` | Sender; verify its domain with each provider. |
| `VOLUMES_SIGNUP_MODE` | `open` | `invite-only` admits `VOLUMES_SIGNUP_ALLOWLIST` and admins; `closed` admits admins only. |
| `VOLUMES_SIGNUP_ALLOWLIST` | – | Addresses or `@domain` entries, comma-separated. |
| `VOLUMES_REQUIRE_EMAIL_VERIFICATION` | `0` | `1` holds unverified users at a "check your inbox" screen. Needs a provider outside development. |

Mail: a verification link on sign-up (resend from the in-app banner or Settings,
60 s cooldown; links live 24 h and never sign anyone in), password reset (one use,
1 h, signs out every session and every agent credential, and counts as verifying
the address), a notice after any password change or reset, a welcome once the
address is confirmed, and a two-step email change for verified accounts (the
current inbox approves, the new inbox confirms while signed in). Every emailed
link opens a page on the app that acts only when the user presses its button, so
mail scanners that prefetch links change nothing. With no provider, a local run prints each
message's links to the API log; production sends nothing and hides "Forgot
password". `GET /api/config` tells the web app what is on (`email.enabled`,
`passwordReset`, `emailVerification`, `signupMode`, …), never which provider or key.
The sign-up page links its legal line when `NEXT_PUBLIC_TERMS_URL` and
`NEXT_PUBLIC_PRIVACY_URL` are set for the web build.

### Plans and billing

Everyone starts on **Free** (10 GB). **Plus** (100 GB) and **Pro** (1 TB) are listed
at `/pricing`; their names, sizes and selling points live in one constant, `PLANS` in
`packages/shared/src/plans.ts`. Their monthly prices are set by an admin (below) and
handed out by `GET /api/config`; a plan without one shows "Price coming soon". The
sidebar's "Get more storage" leads there.

- **Without Stripe** (the default): a paid plan's button opens a request. Admins are
  emailed and grant (the quota becomes the plan's size) or dismiss it under Admin →
  Requests; the person sees the request's status on `/pricing`.
- **With Stripe**, set up under **Admin → Billing**: paste one Stripe secret key
  (`sk_live_…`/`sk_test_…`, or a restricted `rk_…` key allowed to manage products, prices,
  webhook endpoints, customers, Checkout, the billing portal and subscriptions) and type
  the Plus and Pro prices. KDRIVE checks the key, creates the webhook endpoint at
  `<BETTER_AUTH_URL>/api/billing/webhook` and a Product (`kdrive_plus`, `kdrive_pro`) with a
  monthly Price per plan, and keeps the key and the webhook's signing secret encrypted in
  `app_settings` (AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`; rotating that
  secret means pasting the key again). A new amount is a new Price: people already
  subscribed keep what they pay. On a server Stripe cannot reach (localhost), the key is
  saved and the page asks for a signing secret instead, e.g. the one
  `stripe listen --forward-to <BETTER_AUTH_URL>/api/billing/webhook` prints.

  The key can instead come from the server environment: with `STRIPE_SECRET_KEY` set, Admin
  → Billing shows it read-only (mode, a hint of the key, the account) instead of the paste
  field, and saving the prices there creates the Prices and the webhook endpoint with that
  key. Precedence is per piece, the environment first: `STRIPE_SECRET_KEY` over a saved key;
  `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PLUS` / `STRIPE_PRICE_PRO` (optional, read only
  next to that key) over the saved webhook secret and Prices. Billing is on once a key, a
  webhook secret and a Price for both plans resolve, wherever each comes from.

  Paid plans then go to Stripe Checkout as monthly subscriptions, subscribers manage them
  in Stripe's billing portal, and the webhook (`checkout.session.completed`,
  `customer.subscription.created` / `updated` / `deleted`, `invoice.payment_failed`) sets
  the quota: the plan's size while active, trialing or past due, 10 GB once it ends.
  Files are never deleted; a drive over its quota only refuses uploads. Deleting an
  account cancels its subscription.

### Running it for real

`bun run build` type-checks everything and builds the web app. `bun run --cwd
apps/api start` runs the API with `NODE_ENV=production`: it refuses to start
without a private `BETTER_AUTH_SECRET` of 32+ characters, dev sign-in is off, and
session cookies are `Secure` whenever `BETTER_AUTH_URL` is https. Put a reverse
proxy that appends `X-Forwarded-For` in front of the web app, so rate limits and
the audit trail see each client's address. `VOLUMES_TRUSTED_ORIGINS` adds origins
allowed to call mutating routes; `VOLUMES_MAX_WORKSPACES_PER_USER` (default 5)
caps workspaces per person.

`bun run --cwd apps/api start:prod` does the same with its variables from an encrypted
`apps/api/.env.prod` ([dotenvx](https://dotenvx.com)): the server holds only the
decryption key, as `DOTENV_PRIVATE_KEY_PROD` in its environment (or an `.env.keys` file
next to it, never committed), and `dotenvx run` decrypts the file at boot. `start` keeps
reading plain `.env` files.

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
