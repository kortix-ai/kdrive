# Testing KDRIVE locally

## Automated checks

```bash
bun run typecheck   # shared, api, web
bun run test        # shared, api (emulated storage + volumes_test), web (lib + components)
```

The API suite needs PostgreSQL with a `volumes_test` database (`createdb volumes_test`;
`VOLUMES_TEST_DATABASE_URL` points it elsewhere). `apps/api/test/setup.ts` runs first.
It forces its own database, storage (the emulator in a fresh temporary directory),
auth and quota settings, and migrates `volumes_test`. Bun still loads `.env`, so
other keys (for example `PT_API_URL`) pass through, but tests never use Platinum
unless the conformance suite below is enabled. Each reset (`resetDb` in
`test/helpers.ts`) re-runs the migration's admin seed and adds `admin@test.local`,
the admin the suites sign in as.

### What the API suites cover

| Where | What |
|---|---|
| `apps/api/src/**/*.test.ts` | Unit and route tests for each service (ledger, uploads, versions, restore, links, workspaces, admin, storage drivers) |
| `apps/api/test/e2e/drive.test.ts` | Sign-in and default workspace, quota refusal at plan time, block upload with dedup, folder upload with empty folders, conflicts, create / rename / move / copy / delete with undo, Range and zip downloads, search |
| `apps/api/test/e2e/versioning.test.ts` | Timeline grouping and paging, time travel reads, file versions across renames, file and drive compare, file / folder / drive restore with undo, checkpoints and the 100-tag budget, Recently deleted, reads after retention thinning |
| `apps/api/test/e2e/sharing.test.ts` | Live vs pinned links, public access without a session, revoke, expiry, traversal on public paths |
| `apps/api/test/e2e/account.test.ts` | Duplicate a workspace at a past version, admin quota changes, account deletion |
| `apps/api/test/e2e/security.test.ts` | Cross-user workspace access, path traversal, active content served as attachment, CSRF origin and content-type checks, dev sign-in only from this machine, client address rules |
| `apps/api/test/e2e/admin-panel.test.ts` | Admins in the database (seeded first admin, add and remove, last-admin refusal, verified address only, closed sign-ups, request mail), 403 for everyone else, overview totals, users with usage (sort, search, pages), one user's drives and shared drives, usage by domain, the audit log's filters, paging and CSV export |
| `apps/api/test/e2e/storage-requests.test.ts` | Requesting a paid plan (one open request, updates, refusals, rate limit, admin mail), admin grant and dismiss |
| `apps/api/test/e2e/billing.test.ts` | Stripe configured entirely by the STRIPE_* variables (a fake client, real webhook signatures): Checkout and portal sessions, signature rejection, subscription → quota up, upgrade, cancel → back to 10 GB, past due, idempotent and retried events, cancel on account deletion |
| `apps/api/test/e2e/billing-admin.test.ts` | Admin → Billing: admins only (and CSRF), key format and Stripe's verdict, no secret in any response, row or audit event, plan Products and Prices created and reused (a new amount is a new Price), the webhook endpoint created automatically and replaced with the key, the manual signing-secret fallback on a private URL, disconnect, a key sealed under another auth secret, STRIPE_SECRET_KEY alone (read-only, prices and webhook set up with it), env-over-saved precedence for the key, webhook secret and Prices, Checkout with the stored Price and plans from Price metadata |
| `apps/api/test/e2e/integrity.test.ts` | Restores that never write the wrong bytes, undo guards, logical-byte quota and upload reservations, commit-time conflicts, retries and lost responses, upload slots, share links that follow their item, batch restore, dedup that never reveals other users' files |
| `apps/api/test/e2e/storage.test.ts` | Settings → Storage: bytes and files by kind, per drive, largest files, replaced and deleted content in the retention window; who wrote each current file in a shared drive through moves, overwrites, folder copies, deletes, undo, agents, former members and duplicates |

Every e2e test gets an empty database and its own emulator (`test/e2e/kit.ts`),
so tests never share volumes. The emulator caps live volumes per process like
a Platinum org does.

The Platinum conformance suite (`apps/api/src/storage/platinum.contract.test.ts`)
is skipped unless `PT_API_URL`, `PT_TOKEN` and `VOLUMES_CONFORMANCE=1` are set.

## Demo data

```bash
bun run db:migrate
bun run seed          # dev@volumes.local; --email you@x.com for another account
bun run dev           # http://localhost:4100/signin → "Continue with dev account"
```

The dev account is not an admin. For the admin panel, sign in with the seeded
admin address (`allen@kortix.ai`), or seed it with `--email allen@kortix.ai`.

The seed script uses the running API when it finds one on port 4101. Otherwise
it runs the app in-process, so you can seed before or after `bun run dev`. It
creates:

- folders with Markdown, code, CSV, JSON, a PDF, a WAV clip and generated PNG images
- several edits, so files have versions
- a rename and a deleted file (shown in Recently deleted)
- a checkpoint called "First draft"
- a live link to a photo folder and a pinned link to `plan.md`

If the drive already has files, it stops. Use `--force` to clear the root first.

## Manual walk-through

With `bun run dev` running and the seed loaded, check each of these at
http://localhost:4100:

1. **Sign in:** use "Continue with dev account". The storage meter in the left rail shows your usage.
2. **Upload:** drag files or a folder onto the drive. The tray shows per-file progress, and a re-upload says "already stored".
3. **Files:** open, preview (Space), download, rename (F2), move, copy and delete. After each change, Undo from the toast or with ⌘Z.
4. **History:** press `h` to open the timeline. Click an entry to see the whole drive as it was then (amber banner). Use "Compare with now" and "Back to now" (Esc).
5. **Versions:** open Versions on `Projects/KDRIVE launch/plan.md`. Pick A and B, then Compare, then Restore.
6. **Recently deleted:** restore `old-draft.md` (if you already brought it back, delete it first).
7. **Checkpoints:** create one. The budget readout counts pinned links too.
8. **Share:** create a live or a pinned link. Open `/s/<token>` in a private window (no sign-in needed), then revoke the link.
9. **Workspaces:** duplicate the drive at a past version, then switch between workspaces in the left rail.
10. **Themes:** KDRIVE opens in Dark for a new browser. Switch with the sun/moon button in the top bar (or the landing nav), or pick Dark, Light or System under Settings → Appearance. The choice applies before paint on reload, to the landing too, and to other open tabs.
11. **Pricing:** "Get more storage" under the sidebar meter opens `/pricing`. Request Plus, then as an admin grant it under Admin → Requests; the sidebar shows 100 GB.
12. **Settings and admin:** check the activity log and drives in Settings. Sign in as an admin (the seeded `allen@kortix.ai`, or an address added under Admin → Admins) and walk the admin tabs: Overview totals, Users (sort, search, open a user, change a quota), Domains, Requests, Audit (filter by person, events, window and drive, expand a row, Export CSV) and Admins (add, remove; the last one stays).
