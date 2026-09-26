# Volumes

Versioned files you can share with a link.

A **volume** is a folder of files with a complete history. Every change is saved
as a new **version**, so you can see what changed, compare any two points in time,
and roll back without losing anything. Any volume can be shared with a **link**,
either pinned to an exact version or live so it always shows the latest files.

**Status:** early. The repo is set up; the stack and implementation are not
decided yet.

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

## What never gets committed

`.env` files and other secrets, keys and credentials, dependency directories such
as `node_modules`, build output, local data, and AI assistant or agent files.
This is enforced in three places:

1. **`.gitignore`**: ignores every `.env` variant by default.
2. **A pre-commit hook** (`.githooks/pre-commit`): checks what is actually staged,
   so `git add -f` can't bypass it.
3. **CI**: checks the tree and every file added across a PR's commits.

Run the check yourself with `bash scripts/check-repo-hygiene.sh`.
