import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareVersions, isStableVersion, isVersionCompatible } from './version.js';
import { isIsoTimestamp } from './timestamp.js';

export const RELEASE_INDEX_SCHEMA_VERSION = 1;
export const DEFAULT_RELEASE_SOURCE = 'https://raw.githubusercontent.com/w-vi-khang/noah-kit/main/releases.json';
// Core accepts release entries only from this repository until a signed
// metadata format exists, so a substituted index cannot name another source.
export const OFFICIAL_REPOSITORY = 'github:w-vi-khang/noah-kit';
export const RELEASE_CLASSIFICATIONS = ['security', 'patch', 'feature', 'breaking'];

const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_RELEASES = 1000;
const FETCH_TIMEOUT_MS = 10000;
const CHANNEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function isValidChannel(channel) {
  return typeof channel === 'string' && CHANNEL_PATTERN.test(channel);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateRelease(release, index) {
  const label = `Release entry ${index}`;
  if (!isPlainObject(release)) {
    throw new Error(`${label} must be an object.`);
  }
  if (!isStableVersion(release.version)) {
    throw new Error(`${label} must have a stable MAJOR.MINOR.PATCH version.`);
  }
  if (!isValidChannel(release.channel)) {
    throw new Error(`${label} (${release.version}) has an invalid channel.`);
  }
  if (!isIsoTimestamp(release.published_at)) {
    throw new Error(`${label} (${release.version}) must have an ISO 8601 published_at timestamp.`);
  }
  if (!RELEASE_CLASSIFICATIONS.includes(release.classification)) {
    throw new Error(`${label} (${release.version}) must have a classification of ${RELEASE_CLASSIFICATIONS.join(', ')}.`);
  }
  if (!isPlainObject(release.source) || release.source.type !== 'git') {
    throw new Error(`${label} (${release.version}) must declare a source of type "git"; other source types are not supported.`);
  }
  if (release.source.repository !== OFFICIAL_REPOSITORY) {
    throw new Error(`${label} (${release.version}) must declare source.repository as ${OFFICIAL_REPOSITORY}.`);
  }
  if (typeof release.source.commit !== 'string' || !GIT_COMMIT_PATTERN.test(release.source.commit)) {
    throw new Error(`${label} (${release.version}) must pin source.commit to a full 40-character lowercase Git commit ID.`);
  }
}

export function validateReleaseIndex(index) {
  if (!isPlainObject(index)) {
    throw new Error('The release index must be a JSON object.');
  }
  if (index.schema_version !== RELEASE_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported release index schema_version. Expected ${RELEASE_INDEX_SCHEMA_VERSION}.`);
  }
  if (index.kit_id !== 'noah-kit') {
    throw new Error('The release index kit_id must be "noah-kit".');
  }
  if (!Array.isArray(index.releases)) {
    throw new Error('The release index releases field must be an array.');
  }
  if (index.releases.length > MAX_RELEASES) {
    throw new Error(`The release index contains more than ${MAX_RELEASES} releases.`);
  }

  const seen = new Set();
  index.releases.forEach((release, position) => {
    validateRelease(release, position);
    const key = `${release.channel}@${release.version}`;
    if (seen.has(key)) {
      throw new Error(`The release index lists ${release.version} more than once in channel ${release.channel}.`);
    }
    seen.add(key);
  });
  return index;
}

// Returns the newest release in the channel that is newer than the baseline
// and satisfies the project range, or null when none qualifies.
export function selectUpdateCandidate(index, { channel, baselineVersion, versionRange }) {
  let candidate = null;
  for (const release of index.releases) {
    if (release.channel !== channel) continue;
    if (compareVersions(release.version, baselineVersion) <= 0) continue;
    if (versionRange && !isVersionCompatible(release.version, versionRange)) continue;
    if (!candidate || compareVersions(release.version, candidate.version) > 0) {
      candidate = release;
    }
  }
  return candidate;
}

export function describeReleaseSource(source) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    let url;
    try {
      url = new URL(source);
    } catch {
      throw new Error(`The release source "${source}" is not a valid URL.`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`The release source must use https:// or be a local file path; "${url.protocol}" is not allowed.`);
    }
    if (url.username || url.password) {
      throw new Error('The release source URL must not contain credentials.');
    }
    return { kind: 'url', location: url.href };
  }
  return { kind: 'file', location: path.resolve(source) };
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INDEX_BYTES) {
    throw new Error(`The release index exceeds ${MAX_INDEX_BYTES} bytes.`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_INDEX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`The release index exceeds ${MAX_INDEX_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function readSourceText(source) {
  if (source.kind === 'file') {
    const content = await readFile(source.location);
    if (content.byteLength > MAX_INDEX_BYTES) {
      throw new Error(`The release index exceeds ${MAX_INDEX_BYTES} bytes.`);
    }
    return content.toString('utf8');
  }

  let response;
  try {
    response = await fetch(source.location, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' }
    });
  } catch (error) {
    throw new Error(`Could not reach the release source: ${error.cause?.message ?? error.message}`);
  }
  if (!response.ok) {
    throw new Error(`The release source responded with HTTP ${response.status}.`);
  }
  return readBoundedResponse(response);
}

export async function loadReleaseIndex(rawSource) {
  const source = describeReleaseSource(rawSource);
  const text = await readSourceText(source);
  let index;
  try {
    index = JSON.parse(text);
  } catch {
    throw new Error('The release index is not valid JSON.');
  }
  return { source, index: validateReleaseIndex(index) };
}
