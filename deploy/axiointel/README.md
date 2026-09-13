# Collecting for AxioIntel

This folder runs Axio-CRED's collector on a schedule and sends what it collects to AxioIntel.
For each place in `places.txt`, `collect.sh` opens the public Google Maps listing with the
collector, using the same arguments Axio-CRED's app uses for an exact Place ID, including
`-extra-reviews`. It then hands the results to `push_native.py`, AxioIntel's sender, which
signs them and posts them to `https://axiointel.com/api/ingest/native`.

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

3. **Fetch AxioIntel's sender** into this folder. It is not copied into this repository, so it
   cannot drift from the endpoint it talks to. Axio-Backend's tests hold it to that contract.
   ```bash
   gh api -H "Accept: application/vnd.github.raw" repos/AxioIntel/Axio-Backend/contents/scripts/push_native.py > deploy/axiointel/push_native.py
   ```
   Fetch it again whenever Axio-Backend changes it.

4. **Give it the shared secret.** Read the value in Cloud Shell with
   `gcloud secrets versions access latest --secret native-ingest-secret --project axiointel`.
   Put it on this machine only, in a root-owned file:
   ```bash
   sudo install -d -m 700 /etc/axiointel
   sudo sh -c 'umask 077; printf "AXIOINTEL_NATIVE_INGEST_SECRET=%s\n" "PASTE-THE-VALUE" > /etc/axiointel/collector.env'
   ```
   Never commit it, never paste it into a chat, and rotate it (a new secret version, then this
   file) if it has been anywhere else.

5. **List the places** to collect, one place ID per line, optionally followed by `owned` or
   `competitor`.
   ```bash
   cp deploy/axiointel/places.example.txt deploy/axiointel/places.txt
   ```

6. **Run it once by hand**, and watch the first place come through.
   ```bash
   sudo deploy/axiointel/collect.sh
   ```
   A profile appears in AxioIntel under `native/<place id>`. A place with a few hundred reviews
   takes several minutes; the collector's budget is 20 minutes per place. How long each place
   took is sent with it, and AxioIntel's **Pull speed** screen sets it beside pulls of the same
   place made from the dashboard.

7. **Schedule it.** Once a day is plenty for most places.
   ```bash
   echo '30 2 * * * root /path/to/Axio-CRED/deploy/axiointel/collect.sh >> /var/log/axiointel-collect.log 2>&1' | sudo tee /etc/cron.d/axiointel-collect
   ```

## Proxies

Google rate-limits a single datacenter IP address that loads many listings. Put one proxy URL
per line in a root-owned file and set `COLLECTOR_PROXIES_FILE=/etc/axiointel/proxies.txt` in
`collector.env`. The log is scrubbed of proxy credentials after every run.

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
