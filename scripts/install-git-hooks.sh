#!/usr/bin/env bash
# Points git at the versioned hooks in .githooks/. Idempotent — run once per
# clone: bash scripts/install-git-hooks.sh
set -euo pipefail
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
