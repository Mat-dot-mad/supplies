#!/bin/bash
# Daily SQLite backup → local snapshot + Google Drive copy.
# Mirrors /opt/portfolio/backup.sh. Runs as root from cron.
set -e

DEST=/var/lib/supplies/backups
mkdir -p "$DEST"

# 1. Snapshot the SQLite DB safely (online backup, handles WAL).
sqlite3 /var/lib/supplies/supplies.db ".backup '$DEST/supplies-$(date +%F).db'"

# 2. Local cleanup — keep last 7 days.
find "$DEST" -name 'supplies-*.db' -mtime +7 -delete

# 3. Push to Google Drive (off-site copy).
rclone copy "$DEST" gdrive:supplies-backups \
    --config /root/.config/rclone/rclone.conf \
    --log-file /var/log/supplies-backup.log \
    --log-level INFO

# 4. Remote cleanup — keep last 30 days on Drive.
rclone delete gdrive:supplies-backups \
    --min-age 30d \
    --config /root/.config/rclone/rclone.conf \
    --log-file /var/log/supplies-backup.log \
    --log-level INFO
