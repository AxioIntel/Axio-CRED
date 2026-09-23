#!/usr/bin/env bash
# Collect the places AxioIntel is watching with the Axio-CRED collector, and send them back.
#
# Runs on the collector's own machine, which must have no link to AxioIntel's Google Cloud
# project: its own provider account, its own IP addresses. fetch_targets.py asks AxioIntel which
# places to collect; a list kept here instead goes stale the moment a workspace watches something
# new. Then one place at a time, with the same arguments Axio-CRED's app uses for an exact
# Place ID: the collector opens the public Google Maps listing, collects its reviews, and writes
# JSON lines. push_native.py signs what came back and posts it to /api/ingest/native. Both
# programs are AxioIntel's, fetched from Axio-Backend's scripts/ so they cannot drift from the
# endpoints they talk to. Nothing here reports, flags or appeals anything.
#
# Usage: collect.sh [places-file]        (default: ask AxioIntel)
#
# Configuration, from /etc/axiointel/collector.env (root-owned, mode 600) or the environment:
#   AXIOINTEL_NATIVE_INGEST_SECRET   the shared secret; required
#   AXIOINTEL_BASE_URL               which deployment to ask and send to; default
#                                    https://axiointel.com/api -- point it at staging for a first run
#   AXIOINTEL_TARGETS_URL            overrides only where the list comes from
#   AXIOINTEL_INGEST_URL             overrides only where collections are sent
#   COLLECTOR_PLACES_FILE            collect this list instead of asking AxioIntel
#   COLLECTOR_IMAGE                  docker image built from this repository; default axio-cred-collector
#   COLLECTOR_PROXIES_FILE           optional; one proxy URL per line, passed as -proxies-file
#   COLLECTOR_TIMEOUT_SECONDS        per place; default 1200, Axio-CRED's own full-review budget
#   COLLECTOR_WORK_DIR               default /var/lib/axiointel-collector
#   COLLECTOR_KEEP_DAYS              local results kept this long; default 14
#
# Exit status: 0 when every place was collected and sent; 1 when the list could not be fetched,
# or when any place was not.
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

IMAGE="${COLLECTOR_IMAGE:-axio-cred-collector}"
TIMEOUT="${COLLECTOR_TIMEOUT_SECONDS:-1200}"
PUSHER="${AXIOINTEL_PUSHER:-$HERE/push_native.py}"
FETCHER="${AXIOINTEL_FETCHER:-$HERE/fetch_targets.py}"
WORK="${COLLECTOR_WORK_DIR:-/var/lib/axiointel-collector}"
KEEP_DAYS="${COLLECTOR_KEEP_DAYS:-14}"
BASE_URL="${AXIOINTEL_BASE_URL:-https://axiointel.com/api}"
BASE_URL="${BASE_URL%/}"
TARGETS_URL="${AXIOINTEL_TARGETS_URL:-$BASE_URL/collector/targets}"
INGEST_URL="${AXIOINTEL_INGEST_URL:-$BASE_URL/ingest/native}"

# A list named here is collected as given; otherwise AxioIntel is asked, below, once this run
# holds the lock. An answered list belongs to the run that asked for it, not to this folder.
PLACES="${1:-${COLLECTOR_PLACES_FILE:-}}"

[ -f "$PUSHER" ] || { echo "no sender at $PUSHER; copy scripts/push_native.py from Axio-Backend" >&2; exit 1; }
mkdir -p "$WORK"

# One collection at a time: a second cron firing while a long one runs would share a browser
# budget and an IP address with it.
exec 9>"$WORK/.lock"
flock -n 9 || { echo "a collection is already running; skipping this one"; exit 0; }

# Results hold reviewers' names and words. They are needed only until AxioIntel has them.
find "$WORK" -mindepth 2 -maxdepth 2 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null

# What to collect. Asked for now rather than read from a file edited by hand here, so a place a
# workspace started watching today is collected tonight. Asking starts nothing: AxioIntel never
# runs, schedules or calls this collector, and the answer is a list.
if [ -z "$PLACES" ]; then
  [ -f "$FETCHER" ] || { echo "no target fetcher at $FETCHER; copy scripts/fetch_targets.py from Axio-Backend, or set COLLECTOR_PLACES_FILE" >&2; exit 1; }
  PLACES="$WORK/targets.txt"
  trap 'rm -f "$WORK/targets.txt"' EXIT
  if ! python3 "$FETCHER" "$PLACES" --url "$TARGETS_URL"; then
    echo "$(date -u +%FT%TZ) could not get the list of places to collect from $TARGETS_URL" >&2
    exit 1
  fi
fi
[ -f "$PLACES" ] || { echo "no places file at $PLACES" >&2; exit 1; }

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
  started=$(date +%s)
  timeout --kill-after=30 "$TIMEOUT" \
    docker run --rm --name "$name" -e DISABLE_TELEMETRY=1 -v "$run:/work" \
      ${proxy[@]+"${proxy[@]}"} "$IMAGE" \
      -input /work/query.txt -results /work/results.jsonl -json -lang en -depth 1 -zoom 15 \
      -c 1 -browser-pool-size 1 -pages-per-browser 1 -extra-reviews \
      ${proxy_flag[@]+"${proxy_flag[@]}"} \
    > "$run/collector.log" 2>&1
  code=$?
  elapsed=$(( $(date +%s) - started ))
  echo "$(date -u +%FT%TZ) collector finished $place in ${elapsed}s (exit $code)"
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
  # AxioIntel compares the collector with pulls made from the dashboard on speed. Older copies
  # of the sender do not know the flag, so it is passed only to one that does.
  timing=()
  if python3 "$PUSHER" --help 2>/dev/null | grep -q -- --collected-seconds; then
    timing=(--collected-seconds "$elapsed")
  fi
  if ! python3 "$PUSHER" "$run/results.jsonl" --place-id "$place" --purpose "${purpose:-owned}" \
       --url "$INGEST_URL" ${stopped[@]+"${stopped[@]}"} ${timing[@]+"${timing[@]}"}; then
    failures=$((failures + 1))
  fi
done < "$PLACES"

if [ "$failures" -gt 0 ]; then
  echo "$(date -u +%FT%TZ) finished with $failures place(s) not collected or not sent" >&2
  exit 1
fi
echo "$(date -u +%FT%TZ) finished"
