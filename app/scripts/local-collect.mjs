import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local operator tool; never expose arbitrary collector flags through an API.
const args = process.argv.slice(2);
const argument = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const target = argument('--url');
const placeId = argument('--place-id');
const cid = argument('--cid');
if (!target || (!placeId && !cid)) throw new Error('Usage: node scripts/local-collect.mjs --url <Google Maps listing URL> (--place-id <expected Place ID> | --cid <expected decimal CID>) [--label <name>] [--email]');
if (cid && !/^\d+$/.test(cid)) throw new Error('CID must contain decimal digits.');
const url = new URL(target);
if (url.protocol !== 'https:' || !['www.google.com', 'maps.google.com', 'maps.app.goo.gl'].includes(url.hostname)) throw new Error('Use an HTTPS Google Maps listing URL.');
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date().toISOString();
const runDir = resolve(appDir, '.dev', 'collections', startedAt.replace(/[:.]/g, '-'));
await mkdir(runDir, { recursive: true });
await writeFile(resolve(runDir, 'queries.txt'), target + '\n');
const outputPath = resolve(runDir, 'results.jsonl');
const logPath = resolve(runDir, 'collector.log');
// Build with build-local-scraper.mjs first to apply the pinned Windows runtime fixes.
const flags = ['-input', resolve(runDir, 'queries.txt'), '-results', outputPath, '-json', '-extra-reviews', '-c', '1', '-browser-pool-size', '1', '-pages-per-browser', '1', '-depth', '1'];
if (args.includes('--email')) flags.push('-email');
const child = spawn(resolve(appDir, '.tools', 'axiocred-scraper.exe'), flags, {
  cwd: runDir, windowsHide: true,
  env: { ...process.env, PLAYWRIGHT_INSTALL_ONLY: '0', DISABLE_TELEMETRY: '1', PLAYWRIGHT_BROWSERS_PATH: resolve(appDir, '.tools', 'browsers'), PLAYWRIGHT_DRIVER_PATH: resolve(appDir, '.tools', 'playwright-driver') }
});
const chunks = [];
child.stdout.on('data', chunk => chunks.push(chunk));
child.stderr.on('data', chunk => chunks.push(chunk));
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  // Terminate this collector's process tree only, including its headless browser.
  if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}, 20 * 60 * 1000);
console.log(JSON.stringify({ status: 'collecting', startedAt, runDir, target, concurrency: 1, timeoutMinutes: 20 }));
const code = await new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); }).finally(() => clearTimeout(timer));
await writeFile(logPath, Buffer.concat(chunks));
if (timedOut || code !== 0) throw new Error(`Collection ${timedOut ? 'timed out' : 'failed with exit ' + code}. Inspect ${logPath}. No data imported.`);
const raw = await readFile(outputPath, 'utf8');
let entries;
try { const parsed = JSON.parse(raw); entries = Array.isArray(parsed) ? parsed : [parsed]; }
catch { entries = raw.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
const matched = entries.filter(entry => (!placeId || entry.place_id === placeId) && (!cid || String(entry.cid) === cid));
if (matched.length !== 1) throw new Error(`Expected one listing with identity ${placeId ?? cid}; found ${matched.length} among ${entries.length}. Inspect ${outputPath}. No data imported.`);
const collectedAt = new Date().toISOString();
const provenance = { target, expectedPlaceId: placeId, expectedCid: cid, emailCrawlEnabled: args.includes('--email'), startedAt, collectedAt, rawSha256: createHash('sha256').update(raw).digest('hex'), outputPath, logPath, rows: entries.length };
await writeFile(resolve(runDir, 'provenance.json'), JSON.stringify(provenance, null, 2));
const response = await fetch('http://localhost:8080/api/intelligence/imports', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ label: argument('--label') ?? matched[0].title, collectedAt, entries: matched })
});
const result = await response.json();
if (!response.ok) throw new Error(`Import rejected: ${JSON.stringify(result)}. Raw output remains in ${runDir}.`);
const listing = result.listings[0];
console.log(JSON.stringify({ status: 'imported', datasetId: result.id, name: listing.name, placeId: listing.placeId, rating: listing.rating, reportedReviews: listing.reviewCount, collectedReviews: listing.reviews.length, ownerReplies: listing.reviews.filter(review => review.reply).length, discoveredEmails: listing.emails.length, collectedAt, runDir }, null, 2));
