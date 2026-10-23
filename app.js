import { extractFile } from './extract.js';
import { detectContext, parseLines, parseCsv } from './parser.js';
import { CATEGORIES, merchantOf, categorize } from './categories.js';

const $ = s => document.querySelector(s);
const KEY = 'bankInsights.v1';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let state = { txs: [], overrides: {}, currency: 'EUR' };
let ui = { tab: 'overview', period: 'all', sort: 'date', dir: -1, limit: 200 };
const charts = {};

// ---------- storage ----------
function load() {
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* fresh start */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Could not save: browser storage full or blocked. Export a backup.', 'err'); }
}

// ---------- helpers ----------
const fmt = v => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
const fmtFull = v => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(v);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const catColor = c => CATEGORIES[c] || CATEGORIES.Other;
const monthLabel = ym => new Date(ym + '-01T12:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const dayDate = d => new Date(d + 'T12:00');
const txId = t => `${t.date}|${t.amount}|${t.raw.toLowerCase().replace(/\W+/g, '').slice(0, 40)}`;
const isOut = t => t.amount < 0 && t.category !== 'Transfers';
const isIn = t => t.amount > 0 && t.category !== 'Transfers';

function toast(msg, cls = '') {
  const log = $('#log'); log.hidden = false;
  const el = document.createElement('div'); el.className = 'item ' + cls; el.textContent = msg;
  $('#logBody').prepend(el);
}

// ---------- import ----------
async function importFiles(files) {
  $('#log').hidden = false;
  $('#logBody').innerHTML = '';
  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<div class="nm">${esc(file.name)}</div><div class="st muted">Reading…</div><div class="bar"><i></i></div>`;
    $('#logBody').appendChild(item);
    const st = item.querySelector('.st'), bar = item.querySelector('.bar i');
    try {
      const ex = await extractFile(file, (m, p) => { st.textContent = m; bar.style.width = (p * 100) + '%'; });
      let parsed, ctx;
      if (ex.kind === 'csv') { parsed = parseCsv(ex.text); ctx = detectContext(ex.text); }
      else { const text = ex.lines.join('\n'); ctx = detectContext(text); parsed = parseLines(ex.lines, ctx); }

      const seen = new Set(state.txs.map(t => t.id));
      let added = 0, dupes = 0, uncertain = 0;
      for (const p of parsed) {
        const merchant = merchantOf(p.raw);
        const t = { ...p, merchant, source: file.name };
        t.id = txId(t);
        if (seen.has(t.id)) { dupes++; continue; }
        seen.add(t.id);
        t.category = categorize(t.raw, t.amount, merchant, state.overrides);
        if (p.conf < 1) uncertain++;
        state.txs.push(t); added++;
      }
      if (!state.txs.length || (added && !state.curSet)) { if (ctx.currency) state.currency = ctx.currency; state.curSet = true; }
      bar.style.width = '100%';
      const ocr = ex.ocrPages ? ` · OCR on ${ex.ocrPages} page(s)` : '';
      if (!parsed.length) { st.className = 'st err'; st.textContent = 'No transactions found. Try a CSV export or a clearer scan.'; }
      else {
        st.className = 'st ok';
        st.textContent = `${added} added${dupes ? `, ${dupes} duplicates skipped` : ''}${ocr}` + (uncertain ? ` · ${uncertain} with guessed +/- sign (check Transactions)` : '');
      }
    } catch (e) {
      console.error(e);
      st.className = 'st err'; st.textContent = 'Failed: ' + (e.message || e);
    }
  }
  state.txs.sort((a, b) => a.date.localeCompare(b.date));
  save(); render();
}

// ---------- period / filtering ----------
function buildPeriods() {
  const months = [...new Set(state.txs.map(t => t.date.slice(0, 7)))].sort().reverse();
  const years = [...new Set(months.map(m => m.slice(0, 4)))];
  const opts = [['all', 'All time'], ['last3', 'Last 3 months'], ['last12', 'Last 12 months'],
    ...years.map(y => [`y:${y}`, y]), ...months.map(m => [`m:${m}`, monthLabel(m)])];
  const sel = $('#period');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (!opts.some(o => o[0] === ui.period)) ui.period = 'all';
  sel.value = ui.period;
}

function periodRange() {
  if (!state.txs.length) return null;
  const last = state.txs.reduce((m, t) => t.date > m ? t.date : m, '0');
  const first = state.txs.reduce((m, t) => t.date < m ? t.date : m, '9');
  const p = ui.period;
  const lastD = dayDate(last);
  const monthsBack = n => { const d = new Date(lastD.getFullYear(), lastD.getMonth() - n + 1, 1, 12); return d.toISOString().slice(0, 10); };
  if (p === 'last3') return [monthsBack(3), last];
  if (p === 'last12') return [monthsBack(12), last];
  if (p.startsWith('y:')) return [`${p.slice(2)}-01-01`, `${p.slice(2)}-12-31`];
  if (p.startsWith('m:')) { const [y, m] = p.slice(2).split('-').map(Number); return [`${p.slice(2)}-01`, `${p.slice(2)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`]; }
  return [first, last];
}

const inRange = (t, r) => t.date >= r[0] && t.date <= r[1];

function previousRange(r) {
  if (ui.period === 'all') return null;
  const a = dayDate(r[0]), b = dayDate(r[1]);
  const len = Math.round((b - a) / 864e5) + 1;
  const pe = new Date(a - 864e5), ps = new Date(pe - (len - 1) * 864e5);
  return [ps.toISOString().slice(0, 10), pe.toISOString().slice(0, 10)];
}

// ---------- stats ----------
function sum(arr) { return arr.reduce((s, t) => s + t.amount, 0); }

function groupBy(arr, fn) {
  const m = new Map();
  for (const t of arr) { const k = fn(t); (m.get(k) || m.set(k, []).get(k)).push(t); }
  return m;
}

function findRecurring(all) {
  const out = [];
  for (const [m, list] of groupBy(all.filter(isOut), t => t.merchant)) {
    const months = new Set(list.map(t => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const amts = list.map(t => -t.amount).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)];
    const close = list.filter(t => Math.abs(-t.amount - med) <= med * 0.12);
    const cm = new Set(close.map(t => t.date.slice(0, 7)));
    if (cm.size >= 3 && close.length / list.length >= 0.6) {
      const lastTx = close[close.length - 1];
      out.push({ merchant: m, amount: med, months: cm.size, last: lastTx.date, category: lastTx.category });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ---------- render ----------
function render() {
  const has = state.txs.length > 0;
  $('#empty').hidden = has;
  $('#tabs').hidden = !has;
  $('#period').hidden = !has;
  $('#overview').hidden = !has || ui.tab !== 'overview';
  $('#transactions').hidden = !has || ui.tab !== 'transactions';
  $('#currency').value = state.currency;
  if (!has) return;
  buildPeriods();
  renderCategoryFilter();
  if (ui.tab === 'overview') renderOverview(); else renderTable();
}

function chartDefaults() {
  const cs = getComputedStyle(document.documentElement);
  Chart.defaults.color = cs.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = cs.getPropertyValue('--line').trim();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}

function mk(id, cfg) {
  charts[id]?.destroy();
  charts[id] = new Chart($('#' + id), cfg);
}

function renderOverview() {
  chartDefaults();
  const range = periodRange();
  const cur = state.txs.filter(t => inRange(t, range));
  const out = cur.filter(isOut), inc = cur.filter(isIn);
  const spent = -sum(out), earned = sum(inc), net = earned - spent;
  const days = Math.max(1, Math.round((dayDate(range[1]) - dayDate(range[0])) / 864e5) + 1);
  const spanDays = Math.max(1, Math.round((dayDate(cur.reduce((m, t) => t.date > m ? t.date : m, range[0])) - dayDate(range[0])) / 864e5) + 1);

  const pr = previousRange(range);
  let dSpent = '', dEarn = '';
  if (pr) {
    const prev = state.txs.filter(t => inRange(t, pr));
    const ps = -sum(prev.filter(isOut)), pe = sum(prev.filter(isIn));
    const delta = (a, b, goodUp) => {
      if (!b) return '';
      const p = (a - b) / b * 100, up = p > 0;
      const cls = goodUp ? (up ? 'good' : 'bad') : (up ? 'up' : 'down');
      return `<div class="d ${cls}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs previous period</div>`;
    };
    dSpent = delta(spent, ps, false); dEarn = delta(earned, pe, true);
  }
  const rate = earned > 0 ? net / earned * 100 : null;
  $('#kpis').innerHTML = [
    ['Spent', fmt(spent), dSpent || `<div class="d">${out.length} transactions</div>`],
    ['Income', fmt(earned), dEarn || `<div class="d">${inc.length} transactions</div>`],
    ['Net', (net >= 0 ? '+' : '−') + fmt(Math.abs(net)).replace('-', ''), `<div class="d ${net >= 0 ? 'good' : 'bad'}">${rate != null ? `${rate.toFixed(0)}% savings rate` : '&nbsp;'}</div>`],
    ['Avg. per day', fmt(spent / spanDays), `<div class="d">${fmt(spent / spanDays * 30)} per 30 days</div>`],
    ['Avg. transaction', fmt(out.length ? spent / out.length : 0), `<div class="d">${days} days in view</div>`],
  ].map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d}</div>`).join('');

  // monthly
  const allMonths = [...new Set(state.txs.filter(t => inRange(t, range)).map(t => t.date.slice(0, 7)))].sort();
  const byM = groupBy(cur, t => t.date.slice(0, 7));
  const mInc = allMonths.map(m => sum((byM.get(m) || []).filter(isIn)));
  const mOut = allMonths.map(m => -sum((byM.get(m) || []).filter(isOut)));
  const css = getComputedStyle(document.documentElement);
  const good = css.getPropertyValue('--good').trim(), bad = css.getPropertyValue('--bad').trim(), accent = css.getPropertyValue('--accent').trim();
  mk('cMonthly', {
    type: 'bar',
    data: {
      labels: allMonths.map(monthLabel),
      datasets: [
        { label: 'Income', data: mInc, backgroundColor: good, borderRadius: 5 },
        { label: 'Spending', data: mOut, backgroundColor: bad, borderRadius: 5 },
        { type: 'line', label: 'Net', data: mInc.map((v, i) => v - mOut[i]), borderColor: accent, backgroundColor: accent, tension: .3, pointRadius: 3 },
      ],
    },
    options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtFull(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: v => fmt(v) } } } },
  });

  // categories
  const byCat = [...groupBy(out, t => t.category)].map(([c, l]) => [c, -sum(l)]).sort((a, b) => b[1] - a[1]);
  mk('cCat', {
    type: 'doughnut',
    data: { labels: byCat.map(c => c[0]), datasets: [{ data: byCat.map(c => c[1]), backgroundColor: byCat.map(c => catColor(c[0])), borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmtFull(c.parsed)}` } } } },
  });
  $('#catList').innerHTML = byCat.map(([c, v]) =>
    `<div class="catrow"><span class="dot" style="background:${catColor(c)}"></span><span>${esc(c)}</span><span class="pct">${spent ? (v / spent * 100).toFixed(0) : 0}%</span><span class="num">${fmt(v)}</span></div>`).join('');

  // daily cumulative
  const byD = groupBy(out, t => t.date);
  const dayList = [];
  for (let d = dayDate(range[0]), end = dayDate(range[1]), cum = 0; d <= end; d = new Date(d.getTime() + 864e5)) {
    const k = d.toISOString().slice(0, 10);
    const v = -sum(byD.get(k) || []);
    cum += v; dayList.push({ k, v, cum });
  }
  mk('cDaily', {
    data: {
      labels: dayList.map(d => d.k),
      datasets: [
        { type: 'bar', label: 'Daily', data: dayList.map(d => d.v), backgroundColor: accent + 'aa', yAxisID: 'y', borderRadius: 3 },
        { type: 'line', label: 'Cumulative', data: dayList.map(d => d.cum), borderColor: bad, pointRadius: 0, tension: .2, yAxisID: 'y1' },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 10, callback(v) { return this.getLabelForValue(v).slice(5); } } }, y: { ticks: { callback: v => fmt(v) } }, y1: { position: 'right', grid: { display: false }, ticks: { callback: v => fmt(v) } } },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtFull(c.parsed.y)}` } } },
    },
  });

  // weekday
  const wd = Array(7).fill(0), wdN = Array(7).fill(0);
  for (const t of out) { const i = (dayDate(t.date).getDay() + 6) % 7; wd[i] -= t.amount; wdN[i]++; }
  mk('cWeek', {
    type: 'bar',
    data: { labels: DAYS, datasets: [{ data: wd, backgroundColor: wd.map(v => v === Math.max(...wd) ? bad : accent + 'bb'), borderRadius: 6 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtFull(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => fmt(v) } } } },
  });

  // merchants
  const byMer = [...groupBy(out, t => t.merchant)].map(([m, l]) => [m, -sum(l), l.length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxM = byMer[0]?.[1] || 1;
  $('#merchants').innerHTML = byMer.map(([m, v, n]) => `<div class="bar"><div class="top2"><span>${esc(m)} <span class="muted">×${n}</span></span><span class="num">${fmt(v)}</span></div><div class="track"><div class="fill" style="width:${v / maxM * 100}%"></div></div></div>`).join('') || '<div class="empty-note">No spending in this period.</div>';

  // biggest
  const big = [...out].sort((a, b) => a.amount - b.amount).slice(0, 6);
  $('#biggest').innerHTML = big.map(t => `<div class="row"><div class="t"><div>${esc(t.merchant)}</div><div class="sub">${t.date} · ${esc(t.category)}</div></div><b class="num">${fmtFull(-t.amount)}</b></div>`).join('') || '<div class="empty-note">Nothing here.</div>';

  // recurring (uses all data for pattern detection)
  const rec = findRecurring(state.txs);
  $('#recTotal').textContent = rec.length ? `· ${fmt(rec.reduce((s, r) => s + r.amount, 0))}/month` : '';
  $('#recurring').innerHTML = rec.slice(0, 7).map(r => `<div class="row"><div class="t"><div>${esc(r.merchant)}</div><div class="sub">${r.months} months · last ${r.last}</div></div><b class="num">${fmtFull(r.amount)}</b></div>`).join('') || '<div class="empty-note">Needs ≥ 3 months of data to detect subscriptions.</div>';

  // insights
  const ins = [];
  if (byCat[0]) ins.push(`Biggest category: <b>${esc(byCat[0][0])}</b> – ${fmt(byCat[0][1])} (${(byCat[0][1] / spent * 100).toFixed(0)}% of spending).`);
  const topWd = wd.indexOf(Math.max(...wd));
  if (out.length) ins.push(`You spend the most on <b>${['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][topWd]}</b> (${fmt(wd[topWd])} total).`);
  if (big[0]) ins.push(`Largest single expense: <b>${esc(big[0].merchant)}</b>, ${fmtFull(-big[0].amount)} on ${big[0].date}.`);
  const peakDay = [...dayList].sort((a, b) => b.v - a.v)[0];
  if (peakDay?.v > 0) ins.push(`Most expensive day: <b>${peakDay.k}</b> with ${fmt(peakDay.v)} spent.`);
  if (byMer[0]) ins.push(`Most money goes to <b>${esc(byMer[0][0])}</b> (${byMer[0][2]} payments).`);
  const small = out.filter(t => -t.amount < 10);
  if (small.length > 5) ins.push(`<b>${small.length}</b> small purchases under 10 add up to ${fmt(-sum(small))}.`);
  if (mOut.length > 1) { const hi = mOut.indexOf(Math.max(...mOut)); ins.push(`Highest-spending month: <b>${monthLabel(allMonths[hi])}</b> (${fmt(mOut[hi])}).`); }
  if (rec.length) ins.push(`<b>${rec.length}</b> recurring payments cost about ${fmt(rec.reduce((s, r) => s + r.amount, 0) * 12)} per year.`);
  $('#insights').innerHTML = ins.map(i => `<li>${i}</li>`).join('');
}

function renderCategoryFilter() {
  const sel = $('#fCat'), v = sel.value || 'all';
  sel.innerHTML = '<option value="all">All categories</option>' + Object.keys(CATEGORIES).map(c => `<option>${esc(c)}</option>`).join('');
  sel.value = v;
}

function renderTable() {
  const range = periodRange();
  const q = $('#q').value.trim().toLowerCase(), fc = $('#fCat').value, ft = $('#fType').value;
  let rows = state.txs.filter(t => inRange(t, range)
    && (fc === 'all' || t.category === fc)
    && (ft === 'all' || (ft === 'out' ? t.amount < 0 : t.amount > 0))
    && (!q || t.raw.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q)));
  rows.sort((a, b) => ui.sort === 'date' ? ui.dir * a.date.localeCompare(b.date) : ui.dir * (a.amount - b.amount));
  $('#txCount').textContent = `${rows.length} transactions · ${fmtFull(sum(rows))}`;
  const shown = rows.slice(0, ui.limit);
  const opts = Object.keys(CATEGORIES);
  $('#txTable tbody').innerHTML = shown.map(t => `
    <tr data-id="${esc(t.id)}">
      <td>${t.date}</td>
      <td><div>${esc(t.merchant)}</div><div class="raw" title="${esc(t.raw)}">${esc(t.raw)}</div></td>
      <td><select class="catsel">${opts.map(c => `<option${c === t.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td class="r amt ${t.amount > 0 ? 'in' : 'neg'}" title="${t.conf < 1 ? 'Sign was guessed – click to flip' : 'Click to flip +/−'}">${t.conf < 1 ? '? ' : ''}${t.amount > 0 ? '+' : '−'}${fmtFull(Math.abs(t.amount)).replace('-', '')}</td>
      <td><button class="del" title="Delete">×</button></td>
    </tr>`).join('');
  $('#moreBtn').hidden = rows.length <= ui.limit;
}

// ---------- events ----------
function bind() {
  const fi = $('#fileInput');
  $('#uploadBtn').onclick = $('#uploadBtn2').onclick = () => fi.click();
  fi.onchange = () => { if (fi.files.length) importFiles([...fi.files]); fi.value = ''; };
  $('#logClose').onclick = () => $('#log').hidden = true;

  let dragN = 0;
  addEventListener('dragenter', e => { e.preventDefault(); dragN++; $('#dropOverlay').hidden = false; });
  addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#dropOverlay').hidden = true; } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropOverlay').hidden = true; if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });

  $('#tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    ui.tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
    render();
  };
  $('#period').onchange = e => { ui.period = e.target.value; ui.limit = 200; render(); };
  $('#currency').onchange = e => { state.currency = e.target.value; save(); render(); };
  for (const id of ['#q', '#fCat', '#fType']) $(id).oninput = () => { ui.limit = 200; renderTable(); };
  $('#moreBtn').onclick = () => { ui.limit += 300; renderTable(); };

  document.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    if (ui.sort === th.dataset.sort) ui.dir *= -1; else { ui.sort = th.dataset.sort; ui.dir = -1; }
    renderTable();
  });

  $('#txTable tbody').addEventListener('change', e => {
    if (!e.target.classList.contains('catsel')) return;
    const t = state.txs.find(x => x.id === e.target.closest('tr').dataset.id);
    t.category = e.target.value;
    // remember choice for this merchant and apply to the rest
    state.overrides[t.merchant] = t.category;
    for (const o of state.txs) if (o.merchant === t.merchant) o.category = t.category;
    save(); renderTable();
  });
  $('#txTable tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const t = state.txs.find(x => x.id === tr.dataset.id);
    if (e.target.closest('.del')) { state.txs = state.txs.filter(x => x !== t); save(); render(); }
    else if (e.target.closest('td.amt')) {
      t.amount = -t.amount; t.conf = 1;
      t.category = categorize(t.raw, t.amount, t.merchant, state.overrides);
      save(); renderTable();
    }
  });

  // menu
  const closeMenu = () => document.querySelector('.menu').open = false;
  $('#exportCsv').onclick = () => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = ['date,amount,category,merchant,description,source', ...state.txs.map(t => [t.date, t.amount, q(t.category), q(t.merchant), q(t.raw), q(t.source || '')].join(','))].join('\n');
    download('transactions.csv', csv, 'text/csv'); closeMenu();
  };
  $('#exportJson').onclick = () => { download('bank-insights-backup.json', JSON.stringify(state), 'application/json'); closeMenu(); };
  $('#importJson').onclick = () => { $('#jsonInput').click(); closeMenu(); };
  $('#jsonInput').onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(d.txs)) throw new Error('not a backup file');
      state = { txs: d.txs, overrides: d.overrides || {}, currency: d.currency || 'EUR', curSet: true };
      save(); render();
    } catch (err) { toast('Restore failed: ' + err.message, 'err'); }
    e.target.value = '';
  };
  $('#clearAll').onclick = () => {
    closeMenu();
    if (confirm('Delete all imported transactions and learned categories from this browser?')) {
      state = { txs: [], overrides: {}, currency: state.currency }; save(); render();
    }
  };
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

load(); bind(); render();
