#!/usr/bin/env bash
# Sync content from mindforge, then publish to GitHub and the managed app.
# Usage: scripts/release.sh [commit message]
#
# The platform remote mirrors GitHub's main. It is force-pushed because older
# releases left a platform-only config commit on top that main does not contain.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f ms.config.json ] || { echo "ms.config.json missing: run ms app init"; exit 1; }
ms auth status >/dev/null

python3 scripts/sync-content.py
npm run build >/dev/null
echo "local build ok"

git add -A
if git diff --cached --quiet; then
  echo "no changes to commit"
else
  git commit -m "${1:-Sync content from mindforge@$(git -C .cache/mindforge rev-parse --short HEAD)}"
fi
git push github main
git push platform +main:refs/heads/main
ms app deploy --commit "$(git rev-parse HEAD)"
