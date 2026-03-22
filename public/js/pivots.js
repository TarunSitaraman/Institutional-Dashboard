/* ════════════════════════════════════════════════════
   PIVOT LEVELS — DAILY REFRESH AT MARKET OPEN
   OHLC data fetched via local Express proxy:
   GET /api/ohlc/:symbol  → { H, L, C }
════════════════════════════════════════════════════ */

// Watchlist is managed by watchlist.js — read shared state
function getWatchlist() { return typeof watchlistState !== 'undefined' ? watchlistState : []; }

function calcPivots(H, L, C) {
  var P = (H + L + C) / 3;
  var R = H - L;
  return {
    pivot: P,
    s1: (2 * P) - H,
    s2: P - R,
    s3: ((2 * P) - H) - R,
    r1: (2 * P) - L,
    r2: P + R,
    r3: ((2 * P) - L) + R,
  };
}

function fmtPivot(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchPreviousDayOHLC(symbol) {
  var url = '/api/ohlc/' + encodeURIComponent(symbol);
  try {
    var res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) { console.warn('[pivots] HTTP ' + res.status + ' for ' + symbol); return null; }
    var json = await res.json();
    if (json.error) { console.warn('[pivots] Error response for ' + symbol); return null; }
    console.log('[pivots] ' + symbol + ': H=' + json.H + ' L=' + json.L + ' C=' + json.C);
    return json; // { H, L, C }
  } catch (e) {
    console.error('[pivots] fetchPreviousDayOHLC failed for ' + symbol + ':', e);
    return null;
  }
}

function setPivotRow(key, pivots) {
  var fields = ['s3', 's2', 's1', 'pivot', 'r1', 'r2', 'r3'];
  var vals   = pivots
    ? [pivots.s3, pivots.s2, pivots.s1, pivots.pivot, pivots.r1, pivots.r2, pivots.r3]
    : [null, null, null, null, null, null, null];

  fields.forEach(function (f, i) {
    var el = document.getElementById(key + '-' + f);
    if (el) el.textContent = fmtPivot(vals[i]);
  });
}

function todayDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

async function loadPivots(forceRefresh) {
  var CACHE_KEY = 'sn-pivots-v1';
  var today     = todayDateStr();

  // Check localStorage cache (skip on forceRefresh)
  if (!forceRefresh) {
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.date === today && cached.data) {
        var wl = getWatchlist();
        // Only trust cache if every watchlist symbol has an entry
        var complete = wl.length > 0 && wl.every(function(item) {
          var d = cached.data[item.symbol];
          return d && d.pivot != null;
        });
        if (complete) {
          wl.forEach(function (item) { setPivotRow(item.symbol, cached.data[item.symbol]); });
          var tsEl = document.getElementById('pivot-timestamp-text');
          if (tsEl) tsEl.textContent = 'Pivots calculated at market open · ' + cached.date;
          return;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Fetch fresh OHLC data from our proxy (append .NS for NSE equities)
  var ohlcResults = await Promise.all(
    getWatchlist().map(function (item) { return fetchPreviousDayOHLC(item.symbol + '.NS'); })
  );

  var data = {};
  getWatchlist().forEach(function (item, i) {
    var ohlc = ohlcResults[i];
    if (ohlc) {
      data[item.symbol] = calcPivots(ohlc.H, ohlc.L, ohlc.C);
      setPivotRow(item.symbol, data[item.symbol]);
    } else {
      setPivotRow(item.symbol, null);
    }
  });

  // Cache with today's date
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, data: data }));
  } catch (e) { /* ignore */ }

  var tsEl = document.getElementById('pivot-timestamp-text');
  if (tsEl) tsEl.textContent = 'Pivots calculated at market open · ' + today;
}

// loadPivots() is called from watchlist.js after DOM rows are rendered

// Schedule a daily check: refresh when the calendar date changes
(function scheduleDailyPivotRefresh() {
  var lastDate = todayDateStr();
  setInterval(function () {
    var currentDate = todayDateStr();
    if (currentDate !== lastDate) {
      lastDate = currentDate;
      loadPivots(true);
    }
  }, 60 * 1000); // check every minute
})();
