# Supplies

Small Flask + SQLite app for tracking what's in our cellar. Mobile-first UI, hosted on a Raspberry Pi, shared over Tailscale. Built to mirror the conventions of the [`portfolio`](../portfolio) and [`watchlist`](../watchlist) apps.

## Run locally (Mac dev)

```bash
cd ~/Projects/supplies
source venv/bin/activate            # one-time: python3 -m venv venv && pip install -r requirements.txt
flask --app app run --port 8002
# open http://localhost:8002
```

A `supplies.db` file appears next to the code on first request — gitignored.

## Stack

- Python 3 + Flask (single `app.py`, factory-less — gunicorn invokes `app:app`)
- SQLite via the stdlib `sqlite3` module
- Vanilla JS + `fetch()` in `static/app.js` (no build step)
- Auto light/dark mode via CSS variables + `prefers-color-scheme`

## Where things live on the Pi (`mat-pi`)

| Path | Purpose |
|---|---|
| `/opt/supplies/app/` | Code — git checkout |
| `/opt/supplies/app/venv/` | Python venv |
| `/opt/supplies/backup.sh` | Symlink → `app/deploy/backup.sh` |
| `/var/lib/supplies/supplies.db` | The database (back this up if you'd hate to lose it) |
| `/var/lib/supplies/backups/` | Local SQLite snapshots, last 7 days |
| `/etc/supplies.env` | Config: `PORT`, `DATABASE_PATH` (root-owned, mode 0640) |
| `/etc/systemd/system/supplies.service` | Service unit (mirrored from `app/deploy/supplies.service`) |
| `/var/log/supplies-backup.log` | Backup log |

The service runs as a dedicated `supplies` system user with `ProtectHome` + `ProtectSystem=strict`, so the code **must** live under `/opt/`, not `/home/`.

## Deploy an update

After pushing to `main` on GitHub:

```bash
ssh mat-pi
sudo -u supplies git -C /opt/supplies/app pull
sudo -u supplies /opt/supplies/app/venv/bin/pip install -q -r /opt/supplies/app/requirements.txt
sudo systemctl restart supplies
```

If the change is to `deploy/supplies.service`, also: `sudo cp /opt/supplies/app/deploy/supplies.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart supplies`.

`backup.sh` is a symlink, so `git pull` updates it automatically — no copy needed.

## Operations

```bash
sudo systemctl status supplies        # current state
sudo journalctl -u supplies -f        # live app logs
sudo systemctl restart supplies       # after a config or env change
sudo tail /var/log/supplies-backup.log
```

## Backup

`/opt/supplies/backup.sh` runs nightly at 04:10 from root's crontab:

1. `sqlite3 .backup` snapshot → `/var/lib/supplies/backups/`
2. Local retention: 7 days
3. `rclone copy` → `gdrive:supplies-backups/`
4. Drive retention: 30 days

To test the restore path:

```bash
sqlite3 /var/lib/supplies/backups/supplies-YYYY-MM-DD.db "SELECT COUNT(*) FROM products;"
```

## Access

Anyone on the tailnet (or with shared access to the `mat-pi` node) can use the app. No application-level auth — Tailscale is the perimeter.

| Who | URL |
|---|---|
| Owner (own tailnet) | `http://mat-pi:5002` |
| Shared user (external tailnet) | `http://mat-pi.<tailnet>.ts.net:5002` |

If access ever needs hardening, the `DASHBOARD_PASSWORD` + `before_request` pattern in [`portfolio/app.py`](../portfolio/app.py) drops in cleanly.
