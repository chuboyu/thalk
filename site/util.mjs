import crypto from 'node:crypto';

// Stable short hash of a markdown body, used to detect when a machine
// translation's base has changed since it was translated (staleness).
export function hashBody(raw = '') {
  const norm = raw.replace(/\r\n/g, '\n').trim();
  return 'sha256:' + crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

// Message lookup with named {token} substitution. Named (not positional) so
// translations can reorder tokens freely — e.g. the AI-translation banner puts
// model/date/base in different orders in English vs Chinese.
export function makeT(messages) {
  return (key, params = {}) => {
    let s = messages[key] ?? key;
    for (const [k, v] of Object.entries(params)) s = s.replaceAll('{' + k + '}', String(v));
    return s;
  };
}
