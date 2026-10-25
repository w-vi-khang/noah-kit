import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describeReleaseSource, loadReleaseIndex, selectUpdateCandidate, validateReleaseIndex } from '../src/release-index.js';

const COMMIT = 'ff353d7c6a6141016dce60a05cb030c91dfc7a9f';

function release(version, overrides = {}) {
  return {
    version,
    channel: 'stable',
    published_at: '2026-10-26T00:00:00.000Z',
    classification: 'patch',
    source: { type: 'git', repository: 'github:w-vi-khang/noah-kit', commit: COMMIT },
    ...overrides
  };
}

function index(releases) {
  return { schema_version: 1, kit_id: 'noah-kit', releases };
}

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-release-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts a valid release index, including an empty one', () => {
  assert.ok(validateReleaseIndex(index([])));
  assert.ok(validateReleaseIndex(index([release('0.1.1'), release('0.2.0', { classification: 'feature' })])));
});

test('rejects malformed release indexes instead of trusting them', () => {
  const cases = [
    [{ ...index([]), schema_version: 2 }, /schema_version/],
    [{ ...index([]), kit_id: 'other-kit' }, /kit_id/],
    [{ schema_version: 1, kit_id: 'noah-kit' }, /releases field must be an array/],
    [index([release('0.2.0-beta.1')]), /stable MAJOR\.MINOR\.PATCH/],
    [index([release('0.2.0', { channel: 'Stable!' })]), /invalid channel/],
    [index([release('0.2.0', { published_at: 'yesterday' })]), /published_at/],
    [index([release('0.2.0', { classification: 'minor' })]), /classification/],
    [index([release('0.2.0', { source: undefined })]), /source of type "git"/],
    [index([release('0.2.0', { source: { type: 'tarball', url: 'https://example.com/a.tgz' } })]), /source of type "git"/],
    [index([release('0.2.0', { source: { type: 'git', repository: 'https://github.com/a/b', commit: COMMIT } })]), /github:<owner>\/<name>/],
    [index([release('0.2.0', { source: { type: 'git', repository: 'github:w-vi-khang/noah-kit', commit: 'ff353d7' } })]), /40-character/],
    [index([release('0.2.0', { source: { type: 'git', repository: 'github:w-vi-khang/noah-kit', commit: COMMIT.toUpperCase() } })]), /40-character/],
    [index([release('0.2.0'), release('0.2.0')]), /more than once/]
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(() => validateReleaseIndex(candidate), pattern);
  }
});

test('selects the newest release in the channel that satisfies the project range', () => {
  const releases = index([
    release('0.1.0'),
    release('0.1.1'),
    release('0.1.4'),
    release('0.1.9', { channel: 'beta' }),
    release('0.2.0', { classification: 'breaking' })
  ]);

  const compatible = selectUpdateCandidate(releases, { channel: 'stable', baselineVersion: '0.1.0', versionRange: '>=0.1.0 <0.2.0' });
  assert.equal(compatible.version, '0.1.4');

  const unconstrained = selectUpdateCandidate(releases, { channel: 'stable', baselineVersion: '0.1.0', versionRange: null });
  assert.equal(unconstrained.version, '0.2.0');

  const beta = selectUpdateCandidate(releases, { channel: 'beta', baselineVersion: '0.1.0', versionRange: '>=0.1.0 <0.2.0' });
  assert.equal(beta.version, '0.1.9');
});

test('reports no candidate when nothing newer than the baseline exists', () => {
  const releases = index([release('0.1.0'), release('0.0.9')]);
  assert.equal(selectUpdateCandidate(releases, { channel: 'stable', baselineVersion: '0.1.0', versionRange: null }), null);
});

test('accepts only https URLs or local file paths as release sources', () => {
  assert.deepEqual(describeReleaseSource('https://example.com/releases.json'), { kind: 'url', location: 'https://example.com/releases.json' });
  assert.throws(() => describeReleaseSource('http://example.com/releases.json'), /https:\/\//);
  assert.throws(() => describeReleaseSource('file:///tmp/releases.json'), /not allowed/);
  assert.throws(() => describeReleaseSource('ftp://example.com/releases.json'), /not allowed/);
  assert.deepEqual(describeReleaseSource('releases.json'), { kind: 'file', location: path.resolve('releases.json') });
});

test('loads a release index from a local file and rejects invalid or oversized content', async () => {
  await withTemporaryDirectory(async (root) => {
    const validPath = path.join(root, 'valid.json');
    await writeFile(validPath, JSON.stringify(index([release('0.1.1')])));
    const loaded = await loadReleaseIndex(validPath);
    assert.equal(loaded.index.releases[0].version, '0.1.1');
    assert.equal(loaded.source.kind, 'file');

    const invalidPath = path.join(root, 'invalid.json');
    await writeFile(invalidPath, '{not json');
    await assert.rejects(loadReleaseIndex(invalidPath), /not valid JSON/);

    const oversizedPath = path.join(root, 'oversized.json');
    await writeFile(oversizedPath, ' '.repeat(1024 * 1024 + 1));
    await assert.rejects(loadReleaseIndex(oversizedPath), /exceeds/);
  });
});

test('the committed release index is valid', async () => {
  const { index: committed } = await loadReleaseIndex(fileURLToPath(new URL('../releases.json', import.meta.url)));
  assert.equal(committed.kit_id, 'noah-kit');
});
