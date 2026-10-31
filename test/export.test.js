const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Work on a temp copy of the data so tests never touch data/expenses.json
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expenses-')), 'expenses.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'expenses.json'), tmp);
process.env.EXPENSES_FILE = tmp;

const app = require('../src/app');
const server = app.listen(0);
after(() => server.close());

function request(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const req = http.request(
      {
        port: server.address().port,
        path: urlPath,
        method,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const json = res.headers['content-type']?.includes('json') ? JSON.parse(body) : body;
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const HEADER = 'date,category,amount,note';
const exportCsv = (from, to) => request('GET', `/expenses/export.csv?from=${from}&to=${to}`);
// Lines of the body minus the trailing newline; does not split quoted newlines correctly on purpose
const lines = (body) => body.replace(/\n$/, '').split('\n');

test('export: September has the header and 18 rows in ascending date order', async () => {
  const res = await exportCsv('2026-09-01', '2026-09-30');
  assert.strictEqual(res.status, 200);
  const ls = lines(res.body);
  assert.strictEqual(ls[0], HEADER);
  assert.strictEqual(ls.length - 1, 18);
  assert.ok(res.body.endsWith('\n'), 'last line ends with \n');
  const dates = ls.slice(1).map((l) => l.split(',')[0]);
  assert.deepStrictEqual(dates, [...dates].sort());
  assert.ok(dates.every((d) => d >= '2026-09-01' && d <= '2026-09-30'));
});

test('export: a note containing a comma is wrapped in double quotes', async () => {
  const res = await exportCsv('2026-08-01', '2026-12-31');
  assert.ok(res.body.includes(',"Groceries: rice, dal, oil"\n'));
});

test('export: a double quote inside a note is doubled', async () => {
  await request('POST', '/expenses', { date: '2027-01-05', amount: 10, category: 'misc', note: 'Said "hi"' });
  const res = await exportCsv('2027-01-05', '2027-01-05');
  assert.strictEqual(lines(res.body)[1], '2027-01-05,misc,10,"Said ""hi"""');
});

test('export: a newline inside a note is kept inside quotes', async () => {
  await request('POST', '/expenses', { date: '2027-01-06', amount: 20, category: 'misc', note: 'line one\nline two' });
  const res = await exportCsv('2027-01-06', '2027-01-06');
  assert.strictEqual(res.body, `${HEADER}\n2027-01-06,misc,20,"line one\nline two"\n`);
});

test('export: an empty note gives an empty last field', async () => {
  await request('POST', '/expenses', { date: '2027-01-07', amount: 12.5, category: 'misc' });
  const res = await exportCsv('2027-01-07', '2027-01-07');
  assert.strictEqual(lines(res.body)[1], '2027-01-07,misc,12.5,');
});

test('export: missing to returns 400 with a JSON error', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-01');
  assert.strictEqual(res.status, 400);
  assert.ok(res.headers['content-type'].includes('application/json'));
  assert.match(res.body.error, /to/);
});

test('export: malformed dates return 400', async () => {
  for (const bad of ['2026-9-5', '2026-02-30', '2026-13-01', '2026-09-01T00:00:00Z']) {
    const res = await exportCsv(encodeURIComponent(bad), '2026-09-30');
    assert.strictEqual(res.status, 400, `from=${bad}`);
    assert.match(res.body.error, /from/);
  }
  const twice = await request('GET', '/expenses/export.csv?from=2026-09-01&from=2026-09-02&to=2026-09-30');
  assert.strictEqual(twice.status, 400);
});

test('export: from later than to returns 400', async () => {
  const res = await exportCsv('2026-09-30', '2026-09-01');
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(res.body, { error: 'from must not be later than to' });
});

test('export: from equal to to returns that single day', async () => {
  const res = await exportCsv('2026-08-03', '2026-08-03');
  const ls = lines(res.body);
  assert.strictEqual(ls.length - 1, 2);
  assert.ok(ls.slice(1).every((l) => l.startsWith('2026-08-03,')));
});

test('export: range is inclusive on both ends', async () => {
  // Rows on the day before, both boundary days, and the day after a March 2027 range
  for (const [date, note] of [['2027-02-28', 'before'], ['2027-03-01', 'first'], ['2027-03-31', 'last'], ['2027-04-01', 'after']]) {
    await request('POST', '/expenses', { date, amount: 1, category: 'edge', note });
  }
  const res = await exportCsv('2027-03-01', '2027-03-31');
  assert.deepStrictEqual(lines(res.body).slice(1), ['2027-03-01,edge,1,first', '2027-03-31,edge,1,last']);
});

test('export: an empty range returns 200 with only the header', async () => {
  const res = await exportCsv('2020-01-01', '2020-01-31');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body, `${HEADER}\n`);
});

test('export: a row posted out of order is sorted into place', async () => {
  await request('POST', '/expenses', { date: '2026-08-02', amount: 5, category: 'misc', note: 'late add' });
  const res = await exportCsv('2026-08-01', '2026-08-03');
  const dates = lines(res.body).slice(1).map((l) => l.split(',')[0]);
  assert.ok(dates.includes('2026-08-02'));
  assert.deepStrictEqual(dates, [...dates].sort());
});

test('export: Content-Type and Content-Disposition headers', async () => {
  const res = await exportCsv('2026-09-01', '2026-09-30');
  assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.strictEqual(res.headers['content-disposition'], 'attachment; filename="expenses-2026-09-01-2026-09-30.csv"');
});
