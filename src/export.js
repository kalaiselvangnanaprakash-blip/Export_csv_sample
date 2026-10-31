// GET /expenses/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD -> CSV download, inclusive range, date ascending
const express = require('express');
const store = require('./store');
const { isValidDate } = require('./validate');

const router = express.Router();

// Wrap in quotes when the value holds a comma, a double quote or a newline; double any inner quote.
function csvField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = ['date,category,amount,note'];
  for (const r of rows) {
    lines.push([r.date, r.category, r.amount, r.note].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

router.get('/expenses/export.csv', (req, res) => {
  const { from, to } = req.query;
  if (!isValidDate(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  if (!isValidDate(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });
  if (from > to) return res.status(400).json({ error: 'from must not be later than to' });

  const rows = store
    .readAll()
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="expenses-${from}-${to}.csv"`);
  res.send(toCsv(rows));
});

module.exports = router;
