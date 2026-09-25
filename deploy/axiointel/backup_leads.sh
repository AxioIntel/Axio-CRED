#!/usr/bin/env bash
# Nightly backup of the lead list to Google Cloud Storage (or Google Drive).
#
# The lead list (leads.db) is the one thing on the collector's machine that cannot be scraped
# again: which leads were sent to Saleshandy and where, and the operator's statuses and notes --
# above all "do_not_contact". This takes a consistent copy while the dashboard keeps running,
# checks it, compresses it, and uploads it (with saleshandy.json) through rclone. The last 7 days
# are also kept on the machine.
#
# Usage: backup_leads.sh            run one backup now
#        backup_leads.sh install    install and start the nightly systemd timer (03:30 UTC)
#        backup_leads.sh status     the timer and the last run's log
#
# Google Cloud Storage (the default): a bucket in the lead lab's own GCP project -- never the
# axiointel project -- and a service account key at /etc/axiointel/gcs-backup.json (root, 600)
# whose account may only create and read objects in that bucket, so a stolen key cannot delete a
# backup. The bucket's lifecycle rule deletes backups after 30 days; this script deletes nothing
# there. Name the bucket in /etc/axiointel/backup.env:  LEADS_BACKUP_BUCKET=<bucket>
#
# Google Drive instead: sudo rclone config --config /etc/axiointel/rclone.conf (a "drive" remote
# named gdrive, scope drive.file) and LEADS_BACKUP_REMOTE=gdrive:AxioCRED-backups; there, backups
# older than LEADS_BACKUP_KEEP_DAYS (default 30) are deleted by this script.
#
# Configuration (environment, or /etc/axiointel/backup.env):
#   LEADS_DATA_DIR          default /var/lib/axio-leads
#   LEADS_BACKUP_BUCKET     the Cloud Storage bucket
#   GCS_KEY_FILE            default /etc/axiointel/gcs-backup.json
#   LEADS_BACKUP_REMOTE     an rclone remote instead of the bucket, e.g. gdrive:AxioCRED-backups
#   RCLONE_CONFIG_FILE      default /etc/axiointel/rclone.conf (root, 600), for such a remote
#   LEADS_BACKUP_KEEP_DAYS  default 30 (remotes other than the bucket)
#   LEADS_BACKUP_LOCAL      default /var/backups/axio-leads
set -euo pipefail

if [ -r /etc/axiointel/backup.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/axiointel/backup.env
  set +a
fi

DATA="${LEADS_DATA_DIR:-/var/lib/axio-leads}"
CONF="${RCLONE_CONFIG_FILE:-/etc/axiointel/rclone.conf}"
KEY="${GCS_KEY_FILE:-/etc/axiointel/gcs-backup.json}"
BUCKET="${LEADS_BACKUP_BUCKET:-}"
REMOTE="${LEADS_BACKUP_REMOTE:-}"
KEEP_DAYS="${LEADS_BACKUP_KEEP_DAYS:-30}"
LOCAL="${LEADS_BACKUP_LOCAL:-/var/backups/axio-leads}"
HERE="$(cd "$(dirname "$0")" && pwd)"

install_timer() {
  sudo tee /etc/systemd/system/axio-leads-backup.service >/dev/null <<EOF
[Unit]
Description=Back up the lead list to Google Drive
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$HERE/backup_leads.sh
EOF
  sudo tee /etc/systemd/system/axio-leads-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Nightly lead list backup

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now axio-leads-backup.timer
  systemctl list-timers axio-leads-backup.timer --no-pager
}

case "${1:-run}" in
  install) install_timer; exit 0 ;;
  status)
    systemctl list-timers axio-leads-backup.timer --no-pager || true
    journalctl -u axio-leads-backup.service -n 20 --no-pager || true
    exit 0 ;;
  run) ;;
  *) echo "usage: $0 [run|install|status]" >&2; exit 1 ;;
esac

[ "$(id -u)" -eq 0 ] || { echo "run as root (the lead list and the keys are root's)" >&2; exit 1; }

# Where the backup goes: the bucket (an rclone connection string, no config file needed) or a
# configured remote.
if [ -n "$REMOTE" ]; then
  [ -r "$CONF" ] || { echo "no rclone config at $CONF; run: rclone config --config $CONF" >&2; exit 1; }
  RCLONE=(rclone --config "$CONF")
  DEST="$REMOTE"
  PRUNE=1
elif [ -n "$BUCKET" ]; then
  [ -r "$KEY" ] || { echo "no service account key at $KEY" >&2; exit 1; }
  RCLONE=(rclone --config /dev/null)
  DEST=":gcs,service_account_file=$KEY,bucket_policy_only=true,no_check_bucket=true:$BUCKET/leads"
  PRUNE=0 # the bucket's lifecycle rule deletes old backups; the key cannot
else
  echo "set LEADS_BACKUP_BUCKET (or LEADS_BACKUP_REMOTE) in /etc/axiointel/backup.env" >&2
  exit 1
fi
[ -f "$DATA/leads.db" ] || { echo "no lead list at $DATA/leads.db" >&2; exit 1; }

stamp=$(date -u +%Y-%m-%d)
mkdir -p "$LOCAL"
chmod 700 "$LOCAL"
copy="$LOCAL/leads-$stamp.db"

# SQLite's online backup: a consistent copy even while the dashboard is writing to the list.
python3 - "$DATA/leads.db" "$copy" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
ok = dst.execute("PRAGMA quick_check").fetchone()[0]
leads = dst.execute("SELECT count(*) FROM leads").fetchone()[0]
dst.close()
src.close()
if ok != "ok":
    sys.exit("the copy failed its integrity check: " + ok)
print(leads, "leads copied")
PY

gzip -f "$copy"
[ -f "$DATA/saleshandy.json" ] && cp "$DATA/saleshandy.json" "$LOCAL/saleshandy-$stamp.json"

"${RCLONE[@]}" copy "$LOCAL" "$DEST" \
  --include "leads-$stamp.db.gz" --include "saleshandy-$stamp.json"
if [ "$PRUNE" = 1 ]; then
  "${RCLONE[@]}" delete "$DEST" --min-age "${KEEP_DAYS}d"
fi
find "$LOCAL" -type f -mtime +7 -delete

echo "$(date -u +%FT%TZ) backed up leads-$stamp.db.gz ($(du -h "$copy.gz" | cut -f1)) to ${REMOTE:-gs://$BUCKET/leads}"
