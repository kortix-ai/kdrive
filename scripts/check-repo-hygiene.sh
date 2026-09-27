#!/usr/bin/env bash
# Refuses paths that must never enter git history: env files, keys, dependency
# and build directories, local runtime data, and AI assistant / agent files.
#
# .gitignore alone is not enough — `git add -f` bypasses it — so this runs on
# what is actually staged (pre-commit) and on what is tracked or added across a
# commit range (CI).
#
#   scripts/check-repo-hygiene.sh --staged           # pre-commit
#   scripts/check-repo-hygiene.sh --tracked          # whole tree
#   scripts/check-repo-hygiene.sh --range A..B       # every file added in A..B
set -uo pipefail
shopt -s nocasematch

mode="${1:---tracked}"
case "$mode" in
  --staged)  files="$(git diff --cached --name-only --diff-filter=ACMR)" ;;
  --tracked) files="$(git ls-files)" ;;
  --range)
    [[ -n "${2:-}" ]] || { echo "usage: $0 --range A..B" >&2; exit 2; }
    files="$(git log --format= --name-only --diff-filter=AR "$2" | sort -u)" ;;
  *) echo "usage: $0 [--staged | --tracked | --range A..B]" >&2; exit 2 ;;
esac

reason_for() {
  local f="$1" base="${1##*/}"
  case "$base" in
    .env.example) return 1 ;;
    .env|.env.*|*.env|.envrc) echo "env file"; return 0 ;;
    *.pem|*.key|*.p12|*.pfx|*_rsa|*_ed25519|*_ecdsa|credentials.json|service-account*.json)
      echo "key or credential"; return 0 ;;
    *.db|*.db-shm|*.db-wal|*.sqlite|*.sqlite3) echo "database file"; return 0 ;;
    claude.md|claude.local.md|agents.md|agent.md|gemini.md|.cursorrules|.windsurfrules|.clinerules|.aider*)
      echo "AI assistant file"; return 0 ;;
  esac
  case "/$f" in
    */node_modules|*/node_modules/*|*/.bun/*) echo "dependency directory"; return 0 ;;
    */dist/*|*/build/*|*/.next/*|*/.turbo/*|*/.vercel/*|*/coverage/*) echo "build output"; return 0 ;;
    */.data/*|*/secrets/*) echo "local data or secrets directory"; return 0 ;;
    */.claude/*|*/.cursor/*|*/.windsurf/*|*/.cline/*|*/.roo/*|*/.continue/*|*/.codex/*|*/.opencode/*|*/.kortix/*)
      echo "AI assistant directory"; return 0 ;;
    */.github/copilot-instructions.md|*/.github/instructions/*) echo "AI assistant file"; return 0 ;;
  esac
  return 1
}

fail=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if reason="$(reason_for "$f")"; then
    echo "✗ refusing $f ($reason)" >&2
    fail=1
  fi
done <<< "$files"

if (( fail )); then
  echo "" >&2
  echo "These paths must never be committed. Unstage them with:" >&2
  echo "  git rm --cached <path>" >&2
  exit 1
fi
