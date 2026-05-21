#!/usr/bin/env bash
# Push Grafana_site to https://github.com/IanisCatalin15/Grafana_Site
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  git init -b "$BRANCH"
  git remote add "$REMOTE" "https://github.com/IanisCatalin15/Grafana_Site.git" 2>/dev/null || \
    git remote set-url "$REMOTE" "https://github.com/IanisCatalin15/Grafana_Site.git"
fi

git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "${1:-Update Grafana_site}"
fi

git push -u "$REMOTE" "$BRANCH"
