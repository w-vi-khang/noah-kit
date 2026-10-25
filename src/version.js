// Leading zeros are rejected so that one version has exactly one spelling, and
// components stay small enough to compare exactly as numbers.
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export function isStableVersion(version) {
  return typeof version === 'string' && STABLE_VERSION_PATTERN.test(version);
}

export function compareVersions(left, right) {
  if (!isStableVersion(left) || !isStableVersion(right)) {
    throw new Error('Core versions must use the stable MAJOR.MINOR.PATCH format.');
  }
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function isVersionCompatible(version, range) {
  const terms = range.trim().split(/\s+/);
  if (terms.length === 0 || !range.trim()) {
    throw new Error('The project Core version range is empty.');
  }

  return terms.every((term) => {
    const match = term.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match) {
      throw new Error(`Unsupported Core version range syntax: "${range}". Use space-separated exact versions or >=, >, <=, < constraints.`);
    }
    const operator = match[1] ?? '=';
    const comparison = compareVersions(version, match[2]);
    if (operator === '>=') return comparison >= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '<') return comparison < 0;
    return comparison === 0;
  });
}
