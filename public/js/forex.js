/* ════════════════════════════════════════════════════
   FOREX — dynamic currency pairs, add/remove by user
   Stored in localStorage under 'sn-forex-v1'
   Fetched via /api/quote/:symbol (Yahoo Finance)
════════════════════════════════════════════════════ */

var FOREX_KEY = 'sn-forex-v1';

// Common pairs available to add
var FOREX_PAIRS = [
  { symbol: 'USDINR=X',  label: 'USD / INR', decimals: 4 },
  { symbol: 'EURINR=X',  label: 'EUR / INR', decimals: 4 },
  { symbol: 'GBPINR=X',  label: 'GBP / INR', decimals: 4 },
  { symbol: 'JPYINR=X',  label: 'JPY / INR', decimals: 4 },
  { symbol: 'EURUSD=X',  label: 'EUR / USD', decimals: 4 },
  { symbol: 'GBPUSD=X',  label: 'GBP / USD', decimals: 4 },
  { symbol: 'AUDUSD=X',  label: 'AUD / USD', decimals: 4 },
  { symbol: 'USDJPY=X',  label: 'USD / JPY', decimals: 2 },
  { symbol: 'USDCHF=X',  label: 'USD / CHF', decimals: 4 },
  { symbol: 'USDSGD=X',  label: 'USD / SGD', decimals: 4 },
];

var DEFAULT_FOREX = [
  { symbol: 'USDINR=X', label: 'USD / INR', decimals: 4 },
];

var forexState = [];

function loadForexState() {
  try {
    var stored = JSON.parse(localStorage.getItem(FOREX_KEY));
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch (e) {}
  return DEFAULT_FOREX.slice();
}

function saveForexState() {
  localStorage.setItem(FOREX_KEY, JSON.stringify(forexState));
}

/* ── Render ── */
function renderForexRows() {
  var stack = document.getElementById('forex-stack');
  if (!stack) return;

  if (forexState.length === 0) {
    stack.innerHTML = '<div style="padding:18px 0;color:var(--text-muted);font-size:13px;text-align:center;">No pairs added. Click + Add.</div>';
    return;
  }

  stack.innerHTML = forexState.map(function(p) {
    return '<div class="index-row" id="forex-row-' + p.symbol.replace(/[^a-zA-Z0-9]/g,'_') + '">' +
      '<span class="index-row-name">' + p.label + '</span>' +
      '<div class="index-row-val">' +
        '<div class="index-row-price" id="forex-price-' + p.symbol.replace(/[^a-zA-Z0-9]/g,'_') + '">—</div>' +
        '<div class="index-row-chg" id="forex-chg-' + p.symbol.replace(/[^a-zA-Z0-9]/g,'_') + '">—</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ── Fetch + update ── */
var forexPriceCache = {};

function fmtF(val, dec) {
  if (val == null || isNaN(val)) return '—';
  return val.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPctF(val) {
  if (val == null || isNaN(val)) return '—';
  return (val >= 0 ? '+' : '') + (val * 100).toFixed(2) + '%';
}

function updateForexRow(pair, data) {
  var key = pair.symbol.replace(/[^a-zA-Z0-9]/g,'_');
  var pe = document.getElementById('forex-price-' + key);
  var ce = document.getElementById('forex-chg-' + key);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.textContent = '—'; ce.className = 'index-row-chg'; return; }
  var prev = forexPriceCache[key];
  if (prev != null && data.price !== prev) {
    pe.classList.remove('flash-up','flash-down');
    void pe.offsetWidth;
    pe.classList.add(data.price > prev ? 'flash-up' : 'flash-down');
  }
  forexPriceCache[key] = data.price;
  pe.textContent = fmtF(data.price, pair.decimals);
  ce.textContent = fmtPctF(data.changePct);
  ce.className = 'index-row-chg ' + (data.changePct >= 0 ? 'up' : 'dn');
}

async function refreshForex() {
  if (forexState.length === 0) return;
  var results = await Promise.all(forexState.map(function(p) {
    return fetch('/api/quote/' + encodeURIComponent(p.symbol), { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; });
  }));
  forexState.forEach(function(p, i) {
    var data = results[i];
    updateForexRow(p, (data && !data.error) ? data : null);
  });
}

/* ── Modal ── */
function openForexModal(mode) {
  var modal = document.getElementById('forex-modal');
  var title = document.getElementById('forex-modal-title');
  var addSection = document.getElementById('forex-add-list');
  var removeSection = document.getElementById('forex-remove-list');

  modal.style.display = 'flex';

  if (mode === 'add') {
    title.textContent = 'Add Currency Pair';
    addSection.style.display = 'block';
    removeSection.style.display = 'none';

    var available = FOREX_PAIRS.filter(function(p) {
      return !forexState.some(function(f) { return f.symbol === p.symbol; });
    });

    addSection.innerHTML = available.length === 0
      ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">All available pairs already added.</div>'
      : available.map(function(p) {
          return '<div class="forex-pair-item" onclick="addForexPair(\'' + p.symbol + '\')">' +
            '<span class="forex-pair-label">' + p.label + '</span>' +
            '<span class="forex-pair-add">+</span>' +
          '</div>';
        }).join('');
  } else {
    title.textContent = 'Remove Currency Pair';
    addSection.style.display = 'none';
    removeSection.style.display = 'block';

    removeSection.innerHTML = forexState.length === 0
      ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No pairs to remove.</div>'
      : forexState.map(function(p) {
          return '<div class="forex-pair-item" onclick="removeForexPair(\'' + p.symbol + '\')">' +
            '<span class="forex-pair-label">' + p.label + '</span>' +
            '<span class="forex-pair-remove">−</span>' +
          '</div>';
        }).join('');
  }
}

function closeForexModal() {
  document.getElementById('forex-modal').style.display = 'none';
}

function addForexPair(symbol) {
  var pair = FOREX_PAIRS.find(function(p) { return p.symbol === symbol; });
  if (!pair || forexState.some(function(f) { return f.symbol === symbol; })) return;
  forexState.push(pair);
  saveForexState();
  renderForexRows();
  closeForexModal();
  refreshForex();
}

function removeForexPair(symbol) {
  forexState = forexState.filter(function(p) { return p.symbol !== symbol; });
  saveForexState();
  renderForexRows();
  closeForexModal();
}

/* ── Init ── */
forexState = loadForexState();
renderForexRows();
refreshForex(); // initial load; subsequent refreshes driven by market.js interval