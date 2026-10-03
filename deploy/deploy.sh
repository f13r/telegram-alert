#!/usr/bin/env bash
# Push this project to the home server and rebuild it there.
#   ./deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-f13r@192.168.50.69}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/minipc}"
DIR="${DEPLOY_DIR:-/home/f13r/telegram-alert}"
SSH=(ssh -i "$KEY" -o BatchMode=yes)

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

echo "→ restarting service (if installed)"
"${SSH[@]}" "$HOST" "systemctl is-enabled vinnytsia-alert >/dev/null 2>&1 && sudo -n systemctl restart vinnytsia-alert && echo restarted || echo 'service not installed yet — see deploy/README'"

echo "✓ done"
