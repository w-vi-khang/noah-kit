const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

// Date.parse alone accepts loose forms such as "2026" or "Nov 1 2026".
export function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
