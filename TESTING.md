# Testing Volumes locally

## Automated checks

```bash
bun run typecheck   # shared, api, web
bun run test        # shared, api (emulated storage + volumes_test), web (lib + components)
```

The API suite needs PostgreSQL with a `volumes_test` database (`createdb volumes_test`).
`apps/api/test/setup.ts` runs first. It forces the test environment, migrates
`volumes_test`, and points the emulator at a fresh temporary directory. Your
`.env` is never used by tests.

### What the API suites cover

| Where | What |
|---|---|
| `apps/api/src/**/*.test.ts` | Unit and route tests for each service (ledger, uploads, versions, restore, links, workspaces, admin, storage drivers) |
| `apps/api/test/e2e/drive.test.ts` | Sign-in and default workspace, quota refusal at plan time, block upload with dedup, folder upload with empty folders, conflicts, create / rename / move / copy / delete with undo, Range and zip downloads, search |
| `apps/api/test/e2e/versioning.test.ts` | Timeline grouping and paging, time travel reads, file versions across renames, file and drive compare, file / folder / drive restore with undo, checkpoints and the 100-tag budget, Recently deleted, reads after retention thinning |
| `apps/api/test/e2e/sharing.test.ts` | Live vs pinned links, public access without a session, revoke, expiry, traversal on public paths |
| `apps/api/test/e2e/account.test.ts` | Duplicate a workspace at a past version, admin quota changes, account deletion |
| `apps/api/test/e2e/security.test.ts` | Cross-user workspace access, path traversal, active content served as attachment, CSRF origin and content-type checks |

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
5. **Versions:** open Versions on `Projects/Volumes launch/plan.md`. Pick A and B, then Compare, then Restore.
6. **Recently deleted:** restore `old-draft.md` (if you already brought it back, delete it first).
7. **Checkpoints:** create one. The budget readout counts pinned links too.
8. **Share:** create a live or a pinned link. Open `/s/<token>` in a private window (no sign-in needed), then revoke the link.
9. **Workspaces:** duplicate the drive at a past version, then switch between workspaces in the left rail.
10. **Settings and admin:** check the theme, activity log and workspaces in Settings. The admin page lists users and quotas; admins are the emails in `VOLUMES_ADMIN_EMAILS`.
