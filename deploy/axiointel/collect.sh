#!/usr/bin/env bash
# Collect each place listed in places.txt with the Axio-CRED collector, and send it to AxioIntel.
#
# Runs on the collector's own machine, which must have no link to AxioIntel's Google Cloud
# project: its own provider account, its own IP addresses. One place at a time, with the same
# arguments Axio-CRED's app uses for an exact Place ID: the collector opens the public Google
# Maps listing, collects its reviews, and writes JSON lines. push_native.py -- AxioIntel's sender,
# copied from Axio-Backend's scripts/ -- signs what came back and posts it to
# /api/ingest/native. Nothing here reports, flags or appeals anything.
#
# Usage: collect.sh [places-file]        (default: places.txt beside this script)
#
# Configuration, from /etc/axiointel/collector.env (root-owned, mode 600) or the environment:
#   AXIOINTEL_NATIVE_INGEST_SECRET   the shared secret; required
#   AXIOINTEL_INGEST_URL             default https://axiointel.com/api/ingest/native
#   COLLECTOR_IMAGE                  docker image built from this repository; default axio-cred-collector
#   COLLECTOR_PROXIES_FILE           optional; one proxy URL per line, passed as -proxies-file
#   COLLECTOR_TIMEOUT_SECONDS        per place; default 1200, Axio-CRED's own full-review budget
#   COLLECTOR_WORK_DIR               default /var/lib/axiointel-collector
#   COLLECTOR_KEEP_DAYS              local results kept this long; default 14
#
# Exit status: 0 when every place was collected and sent; 1 when any was not.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${AXIOINTEL_COLLECTOR_ENV:-/etc/axiointel/collector.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
: "${AXIOINTEL_NATIVE_INGEST_SECRET:?set AXIOINTEL_NATIVE_INGEST_SECRET in $ENV_FILE}"
export AXIOINTEL_NATIVE_INGEST_SECRET

PLACES="${1:-$HERE/places.txt}"
IMAGE="${COLLECTOR_IMAGE:-axio-cred-collector}"
TIMEOUT="${COLLECTOR_TIMEOUT_SECONDS:-1200}"
PUSHER="${AXIOINTEL_PUSHER:-$HERE/push_native.py}"
WORK="${COLLECTOR_WORK_DIR:-/var/lib/axiointel-collector}"
KEEP_DAYS="${COLLECTOR_KEEP_DAYS:-14}"

[ -f "$PLACES" ] || { echo "no places file at $PLACES" >&2; exit 1; }
[ -f "$PUSHER" ] || { echo "no sender at $PUSHER; copy scripts/push_native.py from Axio-Backend" >&2; exit 1; }
mkdir -p "$WORK"

# One collection at a time: a second cron firing while a long one runs would share a browser
# budget and an IP address with it.
exec 9>"$WORK/.lock"
flock -n 9 || { echo "a collection is already running; skipping this one"; exit 0; }

# Results hold reviewers' names and words. They are needed only until AxioIntel has them.
find "$WORK" -mindepth 2 -maxdepth 2 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null

failures=0
while read -r place purpose _; do
  case "$place" in ''|\#*) continue ;; esac
  if ! [[ "$place" =~ ^[A-Za-z0-9_-]{10,300}$ ]]; then
    echo "skipping a line that is not a place ID: $place" >&2
    failures=$((failures + 1))
    continue
  fi
  case "${purpose:-owned}" in owned|competitor) ;; *)
    echo "skipping $place: purpose must be owned or competitor, not $purpose" >&2
    failures=$((failures + 1))
    continue ;;
  esac

  run="$WORK/$place/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$run"
  printf 'https://www.google.com/maps/search/?api=1&query=Google&query_place_id=%s\n' "$place" \
    > "$run/query.txt"

  proxy=()
  if [ -n "${COLLECTOR_PROXIES_FILE:-}" ]; then
    proxy=(-v "$COLLECTOR_PROXIES_FILE:/run/proxies.txt:ro")
  fi
  proxy_flag=()
  [ -n "${COLLECTOR_PROXIES_FILE:-}" ] && proxy_flag=(-proxies-file /run/proxies.txt)

  name="axiointel-collect-$$-${place:0:40}"
  echo "$(date -u +%FT%TZ) collecting $place"
  timeout --kill-after=30 "$TIMEOUT" \
    docker run --rm --name "$name" -e DISABLE_TELEMETRY=1 -v "$run:/work" \
      ${proxy[@]+"${proxy[@]}"} "$IMAGE" \
      -input /work/query.txt -results /work/results.jsonl -json -lang en -depth 1 -zoom 15 \
      -c 1 -browser-pool-size 1 -pages-per-browser 1 -extra-reviews \
      ${proxy_flag[@]+"${proxy_flag[@]}"} \
    > "$run/collector.log" 2>&1
  code=$?
  # A timed-out docker client does not always take its container with it.
  [ "$code" -eq 124 ] || [ "$code" -eq 137 ] && docker rm -f "$name" >/dev/null 2>&1
  # Never keep proxy credentials a collector echoed into its log.
  sed -i -E 's#(https?|socks5)://[^[:space:]/@]+:[^[:space:]/@]+@#\1://[redacted]@#g' \
    "$run/collector.log"

  if [ ! -s "$run/results.jsonl" ]; then
    echo "$(date -u +%FT%TZ) no results for $place (collector exit $code); see $run/collector.log" >&2
    failures=$((failures + 1))
    continue
  fi

  stopped=()
  if [ "$code" -ne 0 ]; then
    # A collection cut off by the time budget or an error still holds real reviews, but it is
    # not the whole list, and AxioIntel must not treat the reviews it lacks as removed.
    stopped=(--incomplete)
    echo "$(date -u +%FT%TZ) collector exit $code for $place; sending what it collected as incomplete" >&2
  fi
  if ! python3 "$PUSHER" "$run/results.jsonl" --place-id "$place" --purpose "${purpose:-owned}" \
       ${stopped[@]+"${stopped[@]}"}; then
    failures=$((failures + 1))
  fi
done < "$PLACES"

if [ "$failures" -gt 0 ]; then
  echo "$(date -u +%FT%TZ) finished with $failures place(s) not collected or not sent" >&2
  exit 1
fi
echo "$(date -u +%FT%TZ) finished"
