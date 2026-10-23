// Turns raw statement text lines (from PDF text layer, OCR or CSV) into transactions.

const MONTHS = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
const MON = 'jan|feb|mar|mär|apr|may|mai|jun|jul|aug|sep|oct|okt|nov|dec|dez';

const RE_NUM_DATE = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;
const RE_ISO_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const RE_SHORT_DATE = /^\s*(\d{1,2})\.(\d{1,2})\.(?!\d)/;
const RE_DMON = new RegExp(`^\\s*(\\d{1,2})\\.?\\s+(${MON})[a-zä]*\\.?,?(?:\\s+(\\d{4}))?`, 'i');
const RE_MOND = new RegExp(`^\\s*(${MON})[a-zä]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?`, 'i');

const RE_AMOUNT = /(?<![\d.,])([-+−–]?)\s?(?:[€$£]|CHF|EUR|USD|GBP)?\s?(\d{1,3}(?:[.,'’]\d{3})+|\d+)([.,]\d{2})(?![\d])(?![.,]\d)\s?(-|\+|CR|DR|Cr|Dr|S|H)?(?![A-Za-z])/g;

const SKIP = /^(alter|neuer|opening|closing|previous|new|starting|ending)?\s*(kontostand|saldo|balance|übertrag|uebertrag|carried|brought)|^(summe|total|gesamt|zwischensumme|subtotal)\b/i;

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100;

export function detectContext(text) {
  let dmy = 0, mdy = 0;
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g)) {
    if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++;
  }
  const years = {};
  for (const m of text.matchAll(/\b(20\d\d)\b/g)) years[m[1]] = (years[m[1]] || 0) + 1;
  const year = +Object.entries(years).sort((a, b) => b[1] - a[1])[0]?.[0] || new Date().getFullYear();
  let currency = null;
  if (/€|\bEUR\b/.test(text)) currency = 'EUR';
  else if (/£|\bGBP\b/.test(text)) currency = 'GBP';
  else if (/\bCHF\b/.test(text)) currency = 'CHF';
  else if (/\$|\bUSD\b/.test(text)) currency = 'USD';
  return { mdy: mdy > dmy, year, currency };
}

// Returns { date, rest } or null.
function takeDate(line, ctx) {
  let m;
  if ((m = line.match(RE_ISO_DATE))) {
    if (validDate(+m[1], +m[2], +m[3])) return { date: iso(m[1], m[2], m[3]), rest: line.slice(m[0].length) };
  }
  if ((m = line.match(RE_NUM_DATE))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    const [d, mo] = ctx.mdy ? [b, a] : [a, b];
    if (validDate(y, mo, d)) return { date: iso(y, mo, d), rest: line.slice(m[0].length) };
  }
  if ((m = line.match(RE_DMON))) {
    const y = m[3] ? +m[3] : ctx.year;
    return { date: iso(y, MONTHS[m[2].toLowerCase()], +m[1]), rest: line.slice(m[0].length) };
  }
  if ((m = line.match(RE_MOND))) {
    const y = m[3] ? +m[3] : ctx.year;
    return { date: iso(y, MONTHS[m[1].toLowerCase()], +m[2]), rest: line.slice(m[0].length) };
  }
  if ((m = line.match(RE_SHORT_DATE))) {
    const [d, mo] = ctx.mdy ? [+m[2], +m[1]] : [+m[1], +m[2]];
    if (validDate(ctx.year, mo, d)) return { date: iso(ctx.year, mo, d), rest: line.slice(m[0].length) };
  }
  return null;
}

function parseAmount(m) {
  const dec = m[3][0];
  const intPart = m[2].replace(/[.,'’]/g, '');
  let v = parseFloat(`${intPart}.${m[3].slice(1)}`);
  if (!isFinite(v)) return null;
  const pre = m[1], post = m[4];
  let sign = 0;
  if (pre === '-' || pre === '−' || pre === '–') sign = -1;
  else if (pre === '+') sign = 1;
  if (post === '-' || post === 'DR' || post === 'Dr' || post === 'S') sign = -1;
  else if (post === '+' || post === 'CR' || post === 'Cr' || post === 'H') sign = 1;
  return { value: v, sign, dec, start: m.index, end: m.index + m[0].length };
}

const INCOME_HINT = /(gehalt|lohn|salary|payroll|wages|gutschrift|erstattung|refund|dividend|deposit|zinsen|rückzahlung|bonus|credit|eingang|incoming|cashback)/i;

export function parseLines(lines, ctx) {
  const txs = [];
  let prev = null, conts = 0, prevBalance = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const dt = takeDate(line, ctx);

    if (!dt) {
      // continuation of previous transaction's description
      if (prev && conts < 3 && !SKIP.test(line) && !/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(line) && line.length < 90) {
        const hasAmt = [...line.matchAll(RE_AMOUNT)].length;
        if (!hasAmt) { prev.raw += ' ' + line; conts++; }
      }
      continue;
    }

    let rest = dt.rest;
    const dt2 = takeDate(rest, ctx); // value date column
    if (dt2) rest = dt2.rest;

    const ms = [...rest.matchAll(RE_AMOUNT)].map(parseAmount).filter(Boolean);
    if (!ms.length) { prev = null; continue; }

    const desc = rest.replace(RE_AMOUNT, ' ').replace(/\s+/g, ' ').trim();
    if (SKIP.test(desc)) {
      prevBalance = ms[ms.length - 1].value * (ms[ms.length - 1].sign || 1);
      prev = null;
      continue;
    }

    let amt, bal = null;
    if (ms.length >= 2) { amt = ms[ms.length - 2]; bal = ms[ms.length - 1]; }
    else amt = ms[0];
    let balVal = bal ? bal.value * (bal.sign || 1) : null;

    let sign = amt.sign;
    let conf = sign ? 1 : 0.5;
    if (!sign && balVal != null && prevBalance != null) {
      const delta = balVal - prevBalance;
      if (Math.abs(Math.abs(delta) - amt.value) < 0.02) { sign = delta > 0 ? 1 : -1; conf = 1; }
    }
    if (!sign) sign = INCOME_HINT.test(desc) ? 1 : -1;
    if (balVal != null) prevBalance = balVal;

    const tx = { date: dt.date, amount: Math.round(sign * amt.value * 100) / 100, raw: desc, conf };
    txs.push(tx);
    prev = tx; conts = 0;
  }
  return txs;
}

export function parseCsv(text) {
  const rows = [];
  const delim = ((text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length) ? ';'
    : (text.split('\n')[0].includes('\t') ? '\t' : ',');
  let cur = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { cur.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(cell); cell = ''; if (cur.some(x => x.trim())) rows.push(cur); cur = []; }
    else cell += c;
  }
  cur.push(cell); if (cur.some(x => x.trim())) rows.push(cur);
  if (rows.length < 2) return [];

  // header row: first row containing a date-ish and amount-ish column name
  const hdr = rows[0].map(h => h.trim().toLowerCase());
  const find = re => hdr.findIndex(h => re.test(h));
  let iDate = find(/^(buchungstag|buchung|booking|date|datum|transaction date|posted|valuta|wertstellung)/);
  if (iDate < 0) iDate = find(/date|datum|tag/);
  let iAmt = find(/^(betrag|amount|umsatz|value|summe)/);
  const iDebit = find(/debit|soll|belastung|withdraw/), iCredit = find(/credit|haben|gutschrift|deposit/);
  const iDesc = [find(/verwendungszweck|description|beschreibung|memo|details|reference|text|buchungstext/), find(/empf|payee|name|beguenstigter|begünstigter|merchant/)].filter(i => i >= 0);
  if (iDate < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) return [];

  const body = rows.slice(1);
  const sample = body.map(r => r[iDate]).join('\n');
  const ctx = detectContext(sample);
  const num = s => {
    s = (s || '').replace(/[^\d,.\-+−]/g, '').replace('−', '-');
    if (!s) return null;
    const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
    s = lastC > lastD ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  };
  const out = [];
  for (const r of body) {
    const d = takeDate((r[iDate] || '').trim(), ctx);
    if (!d) continue;
    let a = iAmt >= 0 ? num(r[iAmt]) : null;
    if (a == null) {
      const db = iDebit >= 0 ? num(r[iDebit]) : null, cr = iCredit >= 0 ? num(r[iCredit]) : null;
      a = cr ? Math.abs(cr) : db ? -Math.abs(db) : null;
    }
    if (a == null || a === 0) continue;
    const raw = iDesc.map(i => (r[i] || '').trim()).filter(Boolean).join(' · ') || 'Transaction';
    out.push({ date: d.date, amount: Math.round(a * 100) / 100, raw, conf: 1 });
  }
  return out;
}
