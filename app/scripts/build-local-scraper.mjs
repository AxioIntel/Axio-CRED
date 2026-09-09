import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync, chmodSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(appDir, '..');
const tools = resolve(appDir, '.tools');
const go = resolve(tools, 'go', 'bin', 'go.exe');
const env = { ...process.env, GOPATH: resolve(tools, 'gopath'), GOCACHE: resolve(tools, 'go-cache'), CGO_ENABLED: '0' };
function run(args, capture=false) {
  const result = spawnSync(go, args, { cwd: repoDir, env, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || 'Go command failed');
  return result.stdout;
}
const module = JSON.parse(run(['mod', 'download', '-json', 'github.com/gosom/scrapemate@v1.3.0'], true));
const localModule = resolve(tools, 'scrapemate-v1.3.0-local');
if (!existsSync(localModule)) cpSync(module.Dir, localModule, { recursive: true });
function overlay(file, edit) {
  const source = resolve(module.Dir, 'adapters', 'fetchers', 'jshttp', file);
  const destination = resolve(localModule, 'adapters', 'fetchers', 'jshttp', file);
  const original = readFileSync(source, 'utf8');
  const changed = edit(original);
  if (changed === original) throw new Error('Expected pinned dependency patch did not apply to ' + file);
  chmodSync(destination, 0o644);
  writeFileSync(destination, changed);
}
// Keep dependency cache and repository go.mod untouched; use a private module copy.
overlay('session_slot.go', source => source.replace('return !p.p.IsClosed()', 'return p.p.IsClosed()').replace('return nil, s.runtime.recreateBrowser()', 'if err := s.runtime.recreateBrowser(); err != nil { return nil, err }; return s.runtime.primaryPage()'));
// The upstream single-process Chromium flags crash the Windows runtime. Use normal
// Chromium process/security defaults for this local build, with audio muted.
overlay('jshttp.go', source => {
  const start = source.indexOf('\t\tArgs: []string{', source.indexOf('func newBrowser('));
  const end = source.indexOf('\n\t\t},', start);
  if (start < 0 || end < 0) throw new Error('Pinned browser launch options changed');
  return source.slice(0, start) + '\t\tArgs: []string{"--mute-audio"},' + source.slice(end + '\n\t\t},'.length);
});
const modFile = resolve(tools, 'local.mod');
writeFileSync(modFile, readFileSync(resolve(repoDir, 'go.mod'), 'utf8') + '\nreplace github.com/gosom/scrapemate => ' + JSON.stringify(localModule.replaceAll('\\', '/')) + '\n');
writeFileSync(resolve(tools, 'local.sum'), readFileSync(resolve(repoDir, 'go.sum')));
run(['build', '-modfile', modFile, '-o', resolve(tools, 'axiocred-scraper.exe'), '.']);
console.log('Local scraper built with the documented Windows browser fixes.');
