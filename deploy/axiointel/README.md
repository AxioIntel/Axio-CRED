# Collecting for AxioIntel

This folder runs Axio-CRED's collector on a schedule and sends what it collects to AxioIntel.
`collect.sh` first asks AxioIntel which places to collect, with `fetch_targets.py`; then, for
each place, it opens the public Google Maps listing with the collector, using the same arguments
Axio-CRED's app uses for an exact Place ID, including `-extra-reviews`. It hands the results to
`push_native.py`, AxioIntel's sender, which signs them and posts them to
`https://axiointel.com/api/ingest/native`.

Asking is a read. AxioIntel never runs, schedules or calls this collector: it answers with a
list, and this machine decides on its own clock what to do with it.

Nothing here reports, flags or appeals a review. The collector reads public pages. AxioIntel
stores what arrives and never treats it as proof that anyone owns a place.

## Where it runs

On a machine that has **no link to AxioIntel's Google Cloud project**: its own provider
account, its own billing and its own IP addresses. Do not run it on Cloud Run, Cloud Shell or
any VM in the `axiointel` project. AxioIntel's project is the one Google is reviewing for
Business Profile API access.

A small Linux VM is enough, collecting one place at a time: Ubuntu 24.04, 2 vCPU, 4 GB RAM,
20 GB disk. Chromium is the heavy part. Hetzner and DigitalOcean both work, and
`infra/hetzner` and `infra/digitalocean` in this repository can provision one.

## Setting it up

1. **Install Docker, Python 3 and git.**
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io python3 git
   ```

2. **Build the collector image** from a checkout of this repository.
   ```bash
   git clone https://github.com/AxioIntel/Axio-CRED.git && cd Axio-CRED
   sudo docker build -t axio-cred-collector .
   ```

3. **Fetch AxioIntel's own programs** into this folder: the sender, and the one that asks what
   to collect. Neither is copied into this repository, so neither can drift from the endpoint it
   talks to. Axio-Backend's tests hold both to that contract.
   ```bash
   for f in push_native.py fetch_targets.py; do
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/AxioIntel/Axio-Backend/contents/scripts/$f" > "deploy/axiointel/$f"
   done
   ```
   Fetch them again whenever Axio-Backend changes them.

4. **Give it the shared secret.** Read the value in Cloud Shell with
   `gcloud secrets versions access latest --secret native-ingest-secret --project axiointel`.
   Put it on this machine only, in a root-owned file:
   ```bash
   sudo install -d -m 700 /etc/axiointel
   sudo sh -c 'umask 077; printf "AXIOINTEL_NATIVE_INGEST_SECRET=%s\n" "PASTE-THE-VALUE" > /etc/axiointel/collector.env'
   ```
   Never commit it, never paste it into a chat, and rotate it (a new secret version, then this
   file) if it has been anywhere else.

5. **Run it once against staging**, and watch the first place come through before production
   ever sees this machine. `AXIOINTEL_BASE_URL` moves both the question and the answer to
   another deployment. It is the API's base, ending in `/api` for the site and without it for
   the Cloud Run service, which answers either way.
   ```bash
   sudo AXIOINTEL_BASE_URL=<staging base URL> deploy/axiointel/collect.sh
   ```
   Staging needs its own `native-ingest-secret`, and `collector.env` must hold that one while
   this run is pointed at it. `collect.sh` asks that deployment what it is watching, collects
   the first place on the list, and posts it back. A profile appears there under `native/<place id>`. A place with a few
   hundred reviews takes several minutes; the collector's budget is 20 minutes per place. How
   long each place took is sent with it, and AxioIntel's **Pull speed** screen sets it beside
   pulls of the same place made from the dashboard.

   To collect a list of your own instead of asking -- to try one particular place, or while a
   deployment has no targets endpoint yet -- name it:
   ```bash
   cp deploy/axiointel/places.example.txt deploy/axiointel/places.txt
   sudo COLLECTOR_PLACES_FILE=deploy/axiointel/places.txt deploy/axiointel/collect.sh
   ```

6. **Run it once against production**, the same way without `AXIOINTEL_BASE_URL`.
   ```bash
   sudo deploy/axiointel/collect.sh
   ```

7. **Schedule it.** Once a day is plenty for most places.
   ```bash
   echo '30 2 * * * root /path/to/Axio-CRED/deploy/axiointel/collect.sh >> /var/log/axiointel-collect.log 2>&1' | sudo tee /etc/cron.d/axiointel-collect
   ```

## Proxies

Google rate-limits a single datacenter IP address that loads many listings. Put one proxy URL
per line in a root-owned file and set `COLLECTOR_PROXIES_FILE=/etc/axiointel/proxies.txt` in
`collector.env`. The log is scrubbed of proxy credentials after every run.

## What it collects

`collect.sh` asks AxioIntel, every run, which places it is watching: every public place a
workspace watches or the house still holds, once each however many sources have read it, with
the one that has waited longest first. A list edited by hand here would go stale the moment a
workspace watched something new, so there is none to keep up to date.

The question is signed with the same secret as a push, so the collector carries one credential.
If AxioIntel answers `401` the secret here is not the one it holds, or this machine's clock is
more than five minutes out; if it answers `503`, that deployment has no secret configured. Both
are printed in full and the run stops without collecting.

## What it keeps

Each run writes `query.txt`, `results.jsonl` and `collector.log` under
`/var/lib/axiointel-collector/<place id>/<time>/`. The results contain reviewers' names and
words, and are needed only until AxioIntel has them, so runs older than 14 days are deleted at
the start of every collection. Set `COLLECTOR_KEEP_DAYS` to change that.

## When a place is not complete

When the collector times out or exits with an error, whatever it gathered is still sent, but
marked incomplete. AxioIntel then stores those reviews without treating the ones it lacks as
removed. When the collector finds fewer distinct reviews than the listing shows, the sender
also marks the collection incomplete, and for the same reason.

## Exit status

`collect.sh` exits `0` when every place was collected and sent, and `1` when any place was
not. The log names each place that failed and why.
