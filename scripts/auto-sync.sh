#!/usr/bin/env bash
# Daily auto-release: when mindforge has new commits, run scripts/release.sh.
#
# Usage: scripts/auto-sync.sh             check once, release if mindforge changed
#        scripts/auto-sync.sh --status    show the last synced commit and log tail
#        scripts/auto-sync.sh --install   run every day 21:00 via launchd (macOS)
#        scripts/auto-sync.sh --uninstall remove the launchd job and its clone
#
# The job works in its own clone under ~/Library/Application Support: launchd
# can't read ~/Downloads (macOS privacy protection), and a separate working tree
# keeps release.sh's `git add -u` away from uncommitted edits in the main checkout.
# Needs `ms auth login` to stay valid; a failed run posts a macOS notification.
set -euo pipefail

SOURCE_REPO="https://github.com/huqianghui/mindforge.git"
LABEL="com.mindforge.auto-sync"
HOME_DIR="$HOME/Library/Application Support/$LABEL"
REPO="$HOME_DIR/repo"
STATE="$HOME_DIR/last-synced"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/$LABEL.log"
INSTALLED="$HOME_DIR/auto-sync.sh"
PATH_DIRS="/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/bin:/bin"

notify() {
  osascript -e "display notification \"$1\" with title \"Mindforge auto-sync\"" 2>/dev/null || true
}

case "${1:-}" in
  --install)
    src="$(cd "$(dirname "$0")/.." && pwd)"
    mkdir -p "$HOME_DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
    if [ ! -d "$REPO/.git" ]; then
      git clone "$(git -C "$src" remote get-url github)" "$REPO"
      git -C "$REPO" remote rename origin github
      git -C "$REPO" remote add platform "$(git -C "$src" remote get-url platform)"
    fi
    # The platform remote signs in through Git Credential Manager, configured
    # per repository by `ms app init`; give the clone the same settings
    git -C "$src" config --local --get-regexp '^credential\.' | while read -r k v; do
      git -C "$REPO" config --local --unset-all "$k" 2>/dev/null || true
    done
    git -C "$src" config --local --get-regexp '^credential\.' | while read -r k v; do
      git -C "$REPO" config --local --add "$k" "$v"
    done
    cp "$0" "$INSTALLED"
    chmod +x "$INSTALLED"
    # 21:00 local time every day; launchd runs a missed job when the Mac wakes up
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$INSTALLED</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATH_DIRS</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: runs every day 21:00, clone at $REPO, log at $LOG"
    exit 0 ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    rm -rf "$HOME_DIR"
    echo "uninstalled"
    exit 0 ;;
  --status)
    echo "last synced mindforge: $(cat "$STATE" 2>/dev/null || echo none)"
    echo "mindforge main now:    $(git ls-remote "$SOURCE_REPO" refs/heads/main | cut -f1)"
    [ -f "$LOG" ] && { echo "--- $LOG"; tail -n 20 "$LOG"; }
    exit 0 ;;
esac

[ -d "$REPO/.git" ] || { echo "no clone at $REPO: run scripts/auto-sync.sh --install"; exit 1; }
trap 'notify "release failed, see $LOG"' ERR

echo "$(date '+%F %T') checking mindforge"
head=$(git ls-remote "$SOURCE_REPO" refs/heads/main | cut -f1)
if [ "$head" = "$(cat "$STATE" 2>/dev/null)" ]; then
  echo "  unchanged at ${head:0:7}"
  exit 0
fi

# The clone belongs to this job, so it always restarts from the published main
cd "$REPO"
git fetch -q github main
git reset -q --hard github/main
npm ci --no-audit --no-fund >/dev/null
scripts/release.sh
echo "$head" > "$STATE"
echo "  released mindforge@${head:0:7}"
notify "released mindforge@${head:0:7}"
