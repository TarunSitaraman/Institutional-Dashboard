/* ════════════════════════════════════════════════════
   MARKET DATA  —  multi-source, best available free APIs

   CHUNK 1 · US Futures     → Yahoo Finance / CME      (~15 min delay)
   CHUNK 2 · Gift Nifty     → NSE India official        (live futures)
   CHUNK 3 · Indian Indices → NSE India official        (live spot)
              Sensex         → Yahoo Finance / BSE      (~15 min delay)
   CHUNK 4 · USD-INR        → Yahoo Finance forex       (near-realtime)
   Commodities              → Yahoo Finance / ICE+CME  (~15 min delay)
════════════════════════════════════════════════════ */

var priceCache = {};

/* ── Fetchers ── */
async function fetchQuote(symbol) {
  try {
    var res = await fetch('/api/quote/' + encodeURIComponent(symbol), { signal: AbortSignal.timeout(5000) });
    var json = await res.json();
    return json.error ? null : json;
  } catch (e) { console.error('[market] fetchQuote', symbol, e); return null; }
}

async function fetchNSEIndices() {
  try {
    var res = await fetch('/api/nse/indices', { signal: AbortSignal.timeout(5000) });
    var json = await res.json();
    return json.error ? null : json;
  } catch (e) { console.error('[market] fetchNSEIndices', e); return null; }
}

async function fetchGiftNifty() {
  try {
    var res = await fetch('/api/nse/giftnifty', { signal: AbortSignal.timeout(5000) });
    var json = await res.json();
    return json.error ? null : json;
  } catch (e) { console.error('[market] fetchGiftNifty', e); return null; }
}

/* ── Formatters ── */
function fmt(val, decimals) {
  if (val == null || isNaN(val)) return '—';
  return val.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  return (val >= 0 ? '+' : '') + (val * 100).toFixed(2) + '%';
}
function setChgClass(el, val) {
  el.classList.remove('up', 'dn');
  if (val != null) el.classList.add(val >= 0 ? 'up' : 'dn');
}
function flashEl(el, val, prev) {
  if (prev == null || val === prev) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(val > prev ? 'flash-up' : 'flash-down');
}
function setSource(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ── DOM updaters ── */

function updateFuturesRow(priceId, chgId, data, decimals) {
  var pe = document.getElementById(priceId), ce = document.getElementById(chgId);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.textContent = '—'; ce.classList.remove('up','dn'); return; }
  flashEl(pe, data.price, priceCache[priceId]);
  priceCache[priceId] = data.price;
  pe.textContent = fmt(data.price, decimals);
  ce.textContent = fmtPct(data.changePct);
  setChgClass(ce, data.changePct);
}

function updateIndexCard(priceId, chgId, data, decimals) {
  var pe = document.getElementById(priceId), ce = document.getElementById(chgId);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.innerHTML = '<span class="material-symbols-outlined">remove</span>—'; return; }
  flashEl(pe, data.price, priceCache[priceId]);
  priceCache[priceId] = data.price;
  pe.textContent = fmt(data.price, decimals);
  var up = data.changePct >= 0;
  ce.className = 'idx-chg ' + (up ? 'up' : 'dn');
  ce.innerHTML = '<span class="material-symbols-outlined">' + (up ? 'arrow_drop_up' : 'arrow_drop_down') + '</span>' + fmtPct(data.changePct);
}

function updateIndexRow(priceId, chgId, data, decimals) {
  var pe = document.getElementById(priceId), ce = document.getElementById(chgId);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.textContent = '—'; ce.classList.remove('up','dn'); return; }
  flashEl(pe, data.price, priceCache[priceId]);
  priceCache[priceId] = data.price;
  pe.textContent = fmt(data.price, decimals);
  var pts = data.change != null ? (data.change >= 0 ? '+' : '') + fmt(data.change, decimals) : null;
  var pct = fmtPct(data.changePct);
  ce.textContent = pts ? pts + '  (' + pct + ')' : pct;
  setChgClass(ce, data.changePct);
}

function updateCurrencyCard(priceId, chgId, data) {
  var pe = document.getElementById(priceId), ce = document.getElementById(chgId);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.innerHTML = '<span class="material-symbols-outlined">remove</span>—'; return; }
  flashEl(pe, data.price, priceCache[priceId]);
  priceCache[priceId] = data.price;
  pe.textContent = fmt(data.price, 4);
  var up = data.changePct >= 0;
  ce.className = 'idx-chg ' + (up ? 'up' : 'dn');
  ce.innerHTML = '<span class="material-symbols-outlined">' + (up ? 'arrow_drop_up' : 'arrow_drop_down') + '</span>' + fmtPct(data.changePct);
}

function updateCommodity(priceId, chgId, barId, data) {
  var pe = document.getElementById(priceId), ce = document.getElementById(chgId), be = document.getElementById(barId);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.textContent = '—'; ce.classList.remove('up','dn'); return; }
  flashEl(pe, data.price, priceCache[priceId]);
  priceCache[priceId] = data.price;
  pe.textContent = fmt(data.price, 2);
  ce.textContent = fmtPct(data.changePct);
  setChgClass(ce, data.changePct);
  if (be) {
    be.classList.toggle('up-fill', data.changePct >= 0);
    be.style.width = Math.min(90, Math.abs((data.changePct || 0) * 100) * 10 + 20) + '%';
  }
}

/* ── Main refresh ── */
async function refreshMarketData() {
  var results = await Promise.all([
    fetchQuote('ES=F'),      // S&P 500 futures
    fetchQuote('NQ=F'),      // Nasdaq 100 futures
    fetchQuote('YM=F'),      // Dow Jones futures
    fetchGiftNifty(),        // Gift Nifty — NSE India official
    fetchNSEIndices(),       // Nifty 50 + Bank Nifty + VIX — NSE India official
    fetchQuote('^BSESN'),    // Sensex — Yahoo/BSE (no free BSE API)
    Promise.resolve(null),   // USD-INR now handled by forex.js
    Promise.resolve(null),   // Brent — handled by commodities.js
    Promise.resolve(null),   // WTI   — handled by commodities.js
  ]);

  var sp500     = results[0];
  var nq100     = results[1];
  var dj        = results[2];
  var giftNifty = results[3];
  var nseIdx    = results[4];
  var bsesn     = results[5];

  var nifty50   = nseIdx ? nseIdx.nifty50   : null;
  var niftyBank = nseIdx ? nseIdx.niftyBank : null;
  var indiaVix  = nseIdx ? nseIdx.indiavix  : null;

  // CHUNK 1 — US Futures (Yahoo Finance / CME, ~15 min)
  updateIndexRow('sp500-price', 'sp500-chg', sp500, 2);
  updateIndexRow('nq100-price', 'nq100-chg', nq100, 2);
  updateIndexRow('dj-price',    'dj-chg',    dj,    2);
  setSource('source-futures', 'Yahoo Finance · CME · ~15 min delay');

  // CHUNK 2 — Gift Nifty + India VIX (NSE India official)
  updateIndexRow('giftnifty-price', 'giftnifty-chg', giftNifty, 2);
  if (giftNifty) {
    setSource('source-giftnifty', 'NSE · GIFT City · ' + (giftNifty.expiry || '') + ' · ' + (giftNifty.timestamp || ''));
  } else {
    setSource('source-giftnifty', 'NSE India · GIFT City');
  }
  // India VIX — inverted colour: rising VIX = fear = red, falling = calm = green
  var vixData = indiaVix ? { price: indiaVix.price, changePct: -indiaVix.changePct } : null;
  updateIndexRow('vix-price', 'vix-chg', vixData, 2);

  // CHUNK 3 — Indian Indices
  updateIndexRow('nifty-price',     'nifty-chg',     nifty50,   2);
  updateIndexRow('banknifty-price', 'banknifty-chg', niftyBank, 2);
  updateIndexRow('sensex-price',    'sensex-chg',    bsesn,     2);

  // CHUNK 4 — Forex handled by forex.js

  // Commodities handled by commodities.js

  // Timestamp
  var ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var el = document.getElementById('last-update-time');
  if (el) el.textContent = 'Updated ' + ts;
}

refreshMarketData();
setInterval(refreshMarketData, 2000);
