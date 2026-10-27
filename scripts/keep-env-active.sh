#!/usr/bin/env bash
# Keep the app's Power Platform environment from being disabled for inactivity.
# Does what "Trigger environment activity" does in the Power Platform admin center:
# POSTs to the BAP lastActivity endpoint, then reads the timestamp back.
#
# Usage: scripts/keep-env-active.sh             trigger once
#        scripts/keep-env-active.sh --status    only show the last activity
#        scripts/keep-env-active.sh --install   run weekly via launchd (macOS)
#        scripts/keep-env-active.sh --uninstall remove the launchd job
#
# Needs: az CLI signed in to the environment's tenant (az login --tenant <id>).
# The endpoint is the one the admin center uses, not a documented public API.
set -euo pipefail

TENANT_ID="${TENANT_ID:-72f988bf-86f1-41af-91ab-2d7cd011db47}"
ENV_ID="${ENV_ID:-$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["environmentId"])' "$(dirname "$0")/../ms.config.json")}"
API="https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/$ENV_ID/lastActivity?api-version=2021-04-01"
LABEL="com.mindforge.keep-env-active"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/$LABEL.log"
# launchd jobs can't read ~/Downloads, ~/Documents or ~/Desktop (macOS privacy
# protection), so the scheduled copy lives here with the IDs passed in the plist
INSTALLED="$HOME/Library/Application Support/$LABEL/keep-env-active.sh"

case "${1:-}" in
  --install)
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")" "$(dirname "$INSTALLED")"
    cp "$0" "$INSTALLED"
    chmod +x "$INSTALLED"
    # Monday 10:00 local time; launchd runs a missed job when the Mac wakes up
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$INSTALLED</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>ENV_ID</key><string>$ENV_ID</string>
    <key>TENANT_ID</key><string>$TENANT_ID</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: runs every Monday 10:00, log at $LOG"
    exit 0 ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    rm -rf "$(dirname "$INSTALLED")"
    echo "uninstalled"
    exit 0 ;;
esac

# az picks its default account, which may be in another tenant; pick a subscription
# signed in to this tenant first, and fall back to --tenant
sub=$(az account list --all --query "[?tenantId=='$TENANT_ID'] | [0].id" -o tsv 2>/dev/null || true)
if [ -n "$sub" ]; then
  token=$(az account get-access-token --subscription "$sub" --resource https://service.powerapps.com/ --query accessToken -o tsv)
else
  token=$(az account get-access-token --tenant "$TENANT_ID" --resource https://service.powerapps.com/ --query accessToken -o tsv)
fi

last_activity() {
  curl -sf -H "Authorization: Bearer $token" "$API" |
    python3 -c 'import json,sys;print(json.load(sys.stdin)["lastActivity"]["lastActivityTime"])'
}

echo "$(date '+%F %T') env $ENV_ID"
echo "  last activity before: $(last_activity)"
[ "${1:-}" = "--status" ] && exit 0

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -H 'Content-Length: 0' "$API")
case "$code" in 2??) ;; *) echo "  trigger failed: HTTP $code"; exit 1 ;; esac
# the admin center notes the timestamp updates "after a few seconds"
sleep 15
echo "  triggered (HTTP $code), last activity now: $(last_activity)"
