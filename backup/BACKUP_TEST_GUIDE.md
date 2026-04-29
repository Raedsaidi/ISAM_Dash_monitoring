# Backup Service — Test Guide

## Environment Compatibility

| Environment | Works? | Notes |
|---|---|---|
| WSL Debian (Windows) | ✅ Yes | Run all commands from WSL terminal, not PowerShell |
| Native Debian server | ✅ Yes | Identical setup, just change username in volume path |
| PowerShell / CMD | ❌ No | Volume bind mount won't land in the right place |

---

## Prerequisites

Docker and Docker Compose must be installed.

**On WSL Debian or native Debian:**
```bash
docker --version
docker compose version
```
Both commands must return a version number. If not, install Docker first:
```bash
curl -fsSL https://get.docker.com | sh
```

---

## Step 1 — Prepare the Host Backup Folder

```bash
mkdir -p /home/raed/backups
```

> On a real Debian server, replace `raed` with your actual username:
> `mkdir -p /home/YOUR_USERNAME/backups`
> And update the volume path in `docker-compose.yml` accordingly.

---

## Step 2 — Navigate to the Project

**WSL:**
```bash
cd /mnt/d/ISAM_Dashboard-main
```

**Native Debian:**
```bash
cd /path/to/ISAM_Dashboard-main
```

---

## Step 3 — Build and Start Services

```bash
docker compose up -d --build db db-backup
```

Wait ~15 seconds for the MySQL container to become healthy.

---

## Step 4 — Verify Both Containers Are Running

```bash
docker ps | grep -E "db-backup|isam-dash-mysql"
```

Expected: both containers show status `Up`.

---

## Step 5 — Verify Cron Is Registered

```bash
docker exec db-backup crontab -l
```

Expected output:
```
0 2 * * 1 root /bin/bash /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

If this returns `no crontab for root` → the Dockerfile is missing the `crontab` step. Rebuild.

---

## Step 6 — Run a Manual Backup

```bash
docker exec db-backup /bin/bash /usr/local/bin/backup.sh
```

Expected output:
```
[Tue Apr 28 22:xx:xx CET 2026] Starting MySQL dump → /backups/2026-04-28/isam_dash-2026-04-28_22-xx-xx.sql.gz
[Tue Apr 28 22:xx:xx CET 2026] Dump complete. Size: 4.5K
[Tue Apr 28 22:xx:xx CET 2026] Removing backups older than 30 days...
[Tue Apr 28 22:xx:xx CET 2026] Cleanup done.
```

---

## Step 7 — Verify the File on the Host

```bash
ls -lh /home/raed/backups/
ls -lh /home/raed/backups/$(date +%F)/
```

Expected: a `.sql.gz` file with size greater than 0 bytes.

---

## Step 8 — Validate the Backup File Content

```bash
gunzip -c /home/raed/backups/$(date +%F)/*.sql.gz | head -20
```

Expected: MySQL dump header like:
```
-- MySQL dump 10.13  Distrib 8.0.x
-- Host: db    Database: isam_dash
-- Server version  8.0.x
...
```

If the output is empty or shows an error → the dump failed silently. Check logs (Step 10).

---

## Step 9 — Test Restore (Critical)

This confirms the backup file is actually usable.

```bash
BACKUP_FILE=$(ls /home/raed/backups/$(date +%F)/*.sql.gz | tail -1)

gunzip < "$BACKUP_FILE" | docker exec -i isam-dash-mysql \
  mysql -u pfe_user -ppfe_pass isam_dash

echo "Restore exit code: $?"
```

Expected: `Restore exit code: 0`

Any non-zero exit code means the restore failed — check the SQL file content.

---

## Step 10 — Check Logs

```bash
# Docker logs (live)
docker logs -f db-backup

# Log file inside the container
docker exec db-backup cat /var/log/backup.log
```

---

## Step 11 — Test Cron Auto-Run (Optional)

To verify cron fires without waiting until 2 AM, temporarily set it 2 minutes ahead:

```bash
# Calculate time 2 minutes from now
CRON_TIME=$(date -d "+2 minutes" "+%M %H")

# Inject temporary crontab
echo "$CRON_TIME * * * root /bin/bash /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" \
  | docker exec -i db-backup crontab -

# Confirm
docker exec db-backup crontab -l

# Watch live — wait 2 minutes
docker logs -f db-backup
```

After 2 minutes a new `.sql.gz` file should appear. Then restore the original crontab:

```bash
docker compose up -d --build db-backup
```

---

## Test Checklist

| # | Test | Pass Condition |
|---|---|---|
| 1 | `docker ps` | Both containers show `Up` |
| 2 | `crontab -l` | Shows `0 2 * * 1` schedule |
| 3 | Manual run | No errors, prints file size |
| 4 | File on host | `.sql.gz` exists, size > 0 |
| 5 | `gunzip \| head` | Shows `-- MySQL dump` header |
| 6 | Restore | Exit code `0` |
| 7 | Cron auto-run | New file appears after 2 min test |

---

## Deploy on Real Debian Server

Everything works identically on a native Debian server. The only change needed is in `docker-compose.yml`:

```yaml
# Change this line in the db-backup service:
volumes:
  - /home/YOUR_SERVER_USERNAME/backups:/backups
```

Then run the exact same commands above on your server.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no crontab for root` | `crontab` line missing in Dockerfile | Remove `crontab` call, use `/etc/cron.d/` directly |
| `bad minute` error on build | `crontab` command rejects `root` username field | Remove `crontab /etc/cron.d/db-backup` from Dockerfile |
| Backup folder empty after run | Volume mounted in Docker VM not WSL | Run `docker compose` from WSL terminal, not PowerShell |
| `Access denied` in dump | Wrong DB credentials | Check `DB_USER`/`DB_PASSWORD` env vars match `db` service |
| `.sql.gz` is 0 bytes | DB not ready when dump ran | Ensure `db` is healthy before backup runs |
