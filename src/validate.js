// "2026-09-05" and nothing else (rejects 2026-13-45, 2026-9-5, timestamps, ...)
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

module.exports = { isValidDate };
