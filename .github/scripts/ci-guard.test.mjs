import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRuntimeAndActions,checkFallbackDefaults,checkRequiredResults} from './ci-guard.mjs';
const docker='FROM node:22-alpine AS build\nFROM node:22-alpine';
test('rejects mutable action references and inconsistent container runtime',()=>{
  assert(checkRuntimeAndActions({ci:'  - uses: actions/checkout@v4\n    node-version: 20'},docker).length===2);
  assert.deepEqual(checkRuntimeAndActions({ci:`  - uses: actions/checkout@${'a'.repeat(40)}\n    node-version: 22`},docker),[]);
});
test('rejects privileged PR triggers and mixed Docker stages',()=>{
  assert(checkRuntimeAndActions({ci:'  pull_request_target:'},'FROM node:20-alpine\nFROM node:22-alpine').length===2);
});
test('paid fallback cannot become enabled through example defaults',()=>{
  assert.equal(checkFallbackDefaults('OUTSCRAPER_ENABLED=true\nOUTSCRAPER_MONTHLY_REVIEW_LIMIT=5000').length,1);
  assert.equal(checkFallbackDefaults('OUTSCRAPER_ENABLED=false\nOUTSCRAPER_MONTHLY_REVIEW_LIMIT=0').length,0);
});
test('required gate rejects failure, cancellation, skips and empty results',()=>{
  for(const result of ['failure','cancelled','skipped'])assert.equal(checkRequiredResults({lint:{result:'success'},test:{result}}),false);
  assert.equal(checkRequiredResults({}),false);assert.equal(checkRequiredResults({test:{result:'success'}}),true);
});
