import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL;
if (!base || !process.env.EXPECTED_COMMIT || !process.env.EXPECTED_UPSTREAM) throw new Error('Deployment URL and expected commits are required.');
let version;
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const url = new URL('version.json', base);
    url.searchParams.set('verification', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) {
      version = await response.json();
      if (version.integration === process.env.EXPECTED_COMMIT && version.upstream === process.env.EXPECTED_UPSTREAM) break;
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.equal(version?.integration, process.env.EXPECTED_COMMIT, 'The published adapter commit does not match.');
assert.equal(version?.upstream, process.env.EXPECTED_UPSTREAM, 'The published CueMol commit does not match.');
const response = await fetch(new URL(version.wasmBase + 'cuemol.wasm', base));
assert.equal(response.ok, true, 'The published native binary is unavailable.');
const actual = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
assert.equal(actual, version.wasmSha256, 'The published native binary hash does not match.');
console.log(JSON.stringify({ integration: version.integration, upstream: version.upstream, wasmSha256: actual }, null, 2));
