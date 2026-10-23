# Deploying to homeserver (192.168.50.69)

Host `f13r@192.168.50.69`, Ubuntu 24.04, Node 22, timezone Europe/Kyiv.

## First install (once, needs sudo)

```bash
ssh -i ~/.ssh/minipc f13r@192.168.50.69

sudo cp /home/f13r/telegram-alert/deploy/vinnytsia-alert.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vinnytsia-alert
systemctl status vinnytsia-alert
```

`enable` is what starts it again after a power cut; `Restart=always` covers crashes.

### Optional: let deploys restart it without a password

```bash
echo 'f13r ALL=(ALL) NOPASSWD: /bin/systemctl restart vinnytsia-alert' \
  | sudo tee /etc/sudoers.d/vinnytsia-alert
sudo chmod 440 /etc/sudoers.d/vinnytsia-alert
```

Without this, `deploy.sh` syncs and builds but leaves the restart to you.

## Updating

```bash
./deploy/deploy.sh
```

- **On the server** (`/home/f13r/telegram-alert` is the deployed copy): runs
  `npm ci && npm run build` in place and restarts the service.
- **From the Mac**: first syncs source (never `node_modules`, `dist`, `data`) and
  copies `.env` as 0600, then builds and restarts over ssh.

It tells which by checking whether it runs in `/home/f13r/telegram-alert` on the
host's IP; force it with `DEPLOY_LOCAL=1` or `DEPLOY_LOCAL=0`. Restart uses
passwordless sudo if the rule above is installed, otherwise asks for the password
when run from a terminal, otherwise prints the command to run yourself.

## Watching it

```bash
journalctl -u vinnytsia-alert -f              # live
journalctl -u vinnytsia-alert --since "1 hour ago" | grep alert
systemctl status vinnytsia-alert
```

## Checking health

```bash
cd /home/f13r/telegram-alert
npm run scrapecheck                            # are all four channels readable?
grep -i 'вінн\|винн\|vinn' data/shadow-*.ndjson | jq -r 'select(.matched==false) | .text'
```

## Stopping

```bash
sudo systemctl stop vinnytsia-alert            # until next boot
sudo systemctl disable --now vinnytsia-alert   # for good
```

## Only ever run one instance

The bot takes a PID lock at `data/bot.pid`. A second copy refuses to start.
Two instances would double the scrape traffic (which gets the IP throttled by
Telegram), send duplicate alerts, and break `/start` and `/status` with
`409 Conflict` on the Bot API long-poll.

So: do not run `npm start` on the Mac while the service is up on the server.
