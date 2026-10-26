#!/usr/bin/env bash
# Sync content from mindforge, then publish to GitHub and the managed app.
# Usage: scripts/release.sh [commit message]
#
# ms.config.json is not tracked (it holds tenant-specific IDs), but the platform
# build requires it in the tree. So the platform remote gets GitHub's main plus
# one extra commit that adds the config; that commit is rebuilt on every release.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f ms.config.json ] || { echo "ms.config.json missing: copy ms.config.example.json and fill in your IDs (or run ms app init)"; exit 1; }
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

# Build "main + ms.config.json" with a throwaway index, leaving the working tree alone
index=$(mktemp -u)
GIT_INDEX_FILE=$index git read-tree HEAD
GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$(git hash-object -w ms.config.json),ms.config.json"
tree=$(GIT_INDEX_FILE=$index git write-tree)
rm "$index"
deploy_commit=$(git commit-tree "$tree" -p HEAD -m "Add Managed Runtime app config (platform remote only)")

git push platform "+$deploy_commit:refs/heads/main"
ms app deploy --commit "$deploy_commit"
