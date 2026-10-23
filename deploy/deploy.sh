#!/usr/bin/env bash
# Rebuild and restart on the home server.
#   ./deploy/deploy.sh
# From the Mac it pushes the source over first. On the server itself (the
# checkout IS the deployed copy) it only builds and restarts. Force either with
# DEPLOY_LOCAL=1 / DEPLOY_LOCAL=0.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-f13r@192.168.50.69}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/minipc}"
DIR="${DEPLOY_DIR:-/home/f13r/telegram-alert}"
SSH=(ssh -i "$KEY" -o BatchMode=yes)

if [ -z "${DEPLOY_LOCAL:-}" ]; then
    DEPLOY_LOCAL=0
    if [ "$(pwd -P)" = "$DIR" ] && hostname -I 2>/dev/null | tr ' ' '\n' | grep -qx "${HOST#*@}"; then
        DEPLOY_LOCAL=1
    fi
fi

# Without the sudoers rule in deploy/README.md, ask for the password only when
# someone is at the terminal to type it.
RESTART='systemctl is-enabled vinnytsia-alert >/dev/null 2>&1 || { echo "service not installed yet — see deploy/README"; exit 0; }
if sudo -n systemctl restart vinnytsia-alert 2>/dev/null || { [ -t 0 ] && sudo systemctl restart vinnytsia-alert; }; then
    echo restarted
else
    echo "not restarted — run: sudo systemctl restart vinnytsia-alert"
fi'

if [ "$DEPLOY_LOCAL" = 1 ]; then
    echo "→ on the server: building in place ($DIR)"
    npm ci --silent && npm run build
    echo "→ restarting service"
    bash -c "$RESTART"
    echo "✓ done"
    exit 0
fi

echo "→ syncing source to $HOST:$DIR"
rsync -az --delete \
    -e "ssh -i $KEY -o BatchMode=yes" \
    --exclude node_modules/ --exclude dist/ --exclude data/ \
    --exclude .git/ --exclude .env \
    ./ "$HOST:$DIR/"

# .env holds the bot token and API credentials; copied separately and locked
# down afterwards (macOS rsync has no --chmod).
echo "→ syncing .env (0600)"
rsync -az -e "ssh -i $KEY -o BatchMode=yes" .env "$HOST:$DIR/.env"
"${SSH[@]}" "$HOST" "chmod 600 $DIR/.env"

echo "→ installing dependencies and building"
"${SSH[@]}" "$HOST" "cd $DIR && npm ci --silent && npm run build"

echo "→ restarting service"
"${SSH[@]}" -t "$HOST" "$RESTART"

echo "✓ done"
