import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function checkRuntimeAndActions(workflows,dockerfile){
  const errors=[];
  const majors=[...dockerfile.matchAll(/^FROM node:(\d+)[^\s]*/gm)].map(m=>m[1]);
  if(!majors.length||new Set(majors).size!==1)errors.push('App Docker stages must use one Node major.');
  for(const [name,source] of Object.entries(workflows)){
    for(const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)){
      if(!/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(match[1]))errors.push(`${name}: action is not pinned to a commit: ${match[1]}`);
    }
    for(const match of source.matchAll(/^\s*node-version:\s*['"]?(\d+)/gm))if(match[1]!==majors[0])errors.push(`${name}: Node major differs from app Dockerfile.`);
    if(/pull_request_target\s*:/.test(source))errors.push(`${name}: untrusted PRs must not run in a privileged trigger.`);
  }
  return errors;
}
export function checkFallbackDefaults(example){
  return /^OUTSCRAPER_ENABLED=false\s*$/m.test(example)&&/^OUTSCRAPER_MONTHLY_REVIEW_LIMIT=0\s*$/m.test(example)?[]:['Paid fallback must default to disabled with a zero monthly allowance.'];
}
export function checkRequiredResults(results){return Object.keys(results).length>0&&Object.values(results).every(v=>v.result==='success');}

function main(){
  const workflows=Object.fromEntries(fs.readdirSync('.github/workflows').filter(f=>/\.ya?ml$/.test(f)).map(f=>[f,fs.readFileSync(path.join('.github/workflows',f),'utf8')]));
  const errors=[...checkRuntimeAndActions(workflows,fs.readFileSync('app/Dockerfile','utf8')),...checkFallbackDefaults(fs.readFileSync('app/.env.example','utf8'))];
  const lock=JSON.parse(fs.readFileSync('app/package-lock.json'));
  for(const subdir of ['', 'backend','frontend']){
    const manifest=JSON.parse(fs.readFileSync(path.join('app',subdir,'package.json')));
    for(const field of ['dependencies','devDependencies'])if(JSON.stringify(manifest[field]??{})!==JSON.stringify(lock.packages[subdir]?.[field]??{}))errors.push(`${subdir||'app'} ${field}: package.json and lockfile differ.`);
  }
  const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of tracked)if(/^app\/(?:\.env(?:\..*)?$|\.dev\/|\.tools\/|(?:.*\/)?node_modules\/)/.test(file)&&file!=='app/.env.example')errors.push(`Local-only data is tracked: ${file}`);
  const ci=workflows['ci.yml']??'';
  if(!/name: Required checks/.test(ci)||!/if: always\(\)/.test(ci)||!/if\(!checkRequiredResults\(r\)\)/.test(ci))errors.push('CI must retain its fail-closed required-checks gate.');
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('PASS: action commits, runtime alignment, lockfiles, safe defaults and tracked-file boundaries.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
