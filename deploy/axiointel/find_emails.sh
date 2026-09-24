#!/usr/bin/env bash
# Find the public contact email of every business a Google Maps search lists -- a trial of the
# collector on the collector's own machine. Nothing is sent to AxioIntel: the answer is a CSV here.
#
# Each line of the queries file is one search, as typed into Google Maps ("dentist in Austin TX").
# For each listing the collector reads its public page, then the business's own website -- the
# front page and, when that shows none of the business's own addresses, up to three of its
# contact or about pages. Nothing is submitted to any site, and nothing is reported, flagged or
# appealed to Google.
#
# Usage: find_emails.sh <queries-file> [depth]
#   depth   how far down each search's results to scroll; default 3 (roughly 60 listings a search)
#
# Configuration, from /etc/axiointel/collector.env (root-owned, mode 600) or the environment:
#   COLLECTOR_IMAGE          docker image built from this repository; default axio-cred-collector
#   COLLECTOR_PROXIES_FILE   optional; one proxy URL per line, passed as -proxies-file
#   EMAILS_TIMEOUT_SECONDS   the whole run; default 3600
#   COLLECTOR_WORK_DIR       default /var/lib/axiointel-collector
#   COLLECTOR_KEEP_DAYS      local results kept this long; default 14
#
# Writes <work>/emails/<UTC time>/emails.csv (one row per listing, emails ';'-separated, the
# business's own domain first) and prints how many listings had a website and how many an address.
set -uo pipefail

ENV_FILE="${AXIOINTEL_COLLECTOR_ENV:-/etc/axiointel/collector.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

QUERIES="${1:?usage: find_emails.sh <queries-file> [depth]}"
DEPTH="${2:-3}"
IMAGE="${COLLECTOR_IMAGE:-axio-cred-collector}"
TIMEOUT="${EMAILS_TIMEOUT_SECONDS:-3600}"
WORK="${COLLECTOR_WORK_DIR:-/var/lib/axiointel-collector}"
KEEP_DAYS="${COLLECTOR_KEEP_DAYS:-14}"

[ -f "$QUERIES" ] || { echo "no queries file at $QUERIES" >&2; exit 1; }
[[ "$DEPTH" =~ ^[0-9]+$ ]] || { echo "depth must be a number, not $DEPTH" >&2; exit 1; }
mkdir -p "$WORK/emails"

# The same lock as collect.sh: one run at a time on this machine's address, whichever it is.
exec 9>"$WORK/.lock"
flock -n 9 || { echo "a collection is already running; try again when it ends"; exit 1; }

# Results hold businesses' names, numbers and addresses. Kept only as long as collections are.
find "$WORK/emails" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null

run="$WORK/emails/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$run"
# Each search is tagged with its own words (`#!#`), so every listing says which search found it.
grep -vE '^[[:space:]]*(#|$)' "$QUERIES" \
  | awk '/#!#/ { print; next } { sub(/[[:space:]]+$/, ""); print $0 "#!#" $0 }' > "$run/queries.txt"
[ -s "$run/queries.txt" ] || { echo "no searches in $QUERIES" >&2; exit 1; }

proxy=()
proxy_flag=()
if [ -n "${COLLECTOR_PROXIES_FILE:-}" ]; then
  proxy=(-v "$COLLECTOR_PROXIES_FILE:/run/proxies.txt:ro")
  proxy_flag=(-proxies-file /run/proxies.txt)
fi

name="axiointel-emails-$$"
echo "$(date -u +%FT%TZ) searching $(wc -l < "$run/queries.txt") quer(ies), depth $DEPTH"
started=$(date +%s)
timeout --kill-after=30 "$TIMEOUT" \
  docker run --rm --name "$name" -e DISABLE_TELEMETRY=1 -v "$run:/work" \
    ${proxy[@]+"${proxy[@]}"} "$IMAGE" \
    -input /work/queries.txt -results /work/results.jsonl -json -lang en \
    -depth "$DEPTH" -email -c 2 -exit-on-inactivity 3m \
    ${proxy_flag[@]+"${proxy_flag[@]}"} \
  > "$run/collector.log" 2>&1
code=$?
[ "$code" -eq 124 ] || [ "$code" -eq 137 ] && docker rm -f "$name" >/dev/null 2>&1
sed -i -E 's#(https?|socks5)://[^[:space:]/@]+:[^[:space:]/@]+@#\1://[redacted]@#g' "$run/collector.log"
echo "$(date -u +%FT%TZ) collector finished in $(( $(date +%s) - started ))s (exit $code)"

if [ ! -s "$run/results.jsonl" ]; then
  echo "no results; see $run/collector.log" >&2
  exit 1
fi

python3 - "$run/results.jsonl" "$run/emails.csv" <<'PY'
import csv, json, sys

src, dst = sys.argv[1], sys.argv[2]
rows, seen = [], set()
with open(src, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        try:
            e = json.loads(line)
        except ValueError:
            continue  # a line cut off by the timeout
        if not isinstance(e, dict):
            continue
        key = e.get("place_id") or e.get("link") or e.get("title")
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append({
            "query": e.get("input_id", ""),
            "title": e.get("title", ""),
            "category": e.get("category", ""),
            "address": e.get("address", ""),
            "phone": e.get("phone", ""),
            "website": e.get("web_site", ""),
            "emails": ";".join(e.get("emails") or []),
            "rating": e.get("review_rating", ""),
            "reviews": e.get("review_count", ""),
            "place_id": e.get("place_id", ""),
            "maps_link": e.get("link", ""),
        })
with open(dst, "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0]) if rows else ["title"])
    w.writeheader()
    w.writerows(rows)
with_site = sum(1 for r in rows if r["website"])
with_email = sum(1 for r in rows if r["emails"])
print(f"{len(rows)} listing(s); {with_site} with a website; {with_email} with an email address"
      + (f" ({100 * with_email // with_site}% of those with a website)" if with_site else ""))
PY
echo "$run/emails.csv"
