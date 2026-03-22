/* ════════════════════════════════════════════════════
   OHLC + MOMENTUM SCORE
   Sources: Yahoo Finance (OHLC) · Trendlyne (Momentum Score)

   Refresh schedule:
   - On page load
   - At market open  (09:15 IST)
   - At market close (15:30 IST)
   - Every 60 s during market hours to catch intraday OHLC updates
   - Every 15 min outside market hours (momentum score only changes EOD)
════════════════════════════════════════════════════ */

// Watchlist is managed by watchlist.js — read shared state
function getWatchlistM() { return typeof watchlistState !== 'undefined' ? watchlistState : []; }

/* ── Helpers ── */
function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isMarketHours() {
  var now = new Date();
  // Convert to IST (UTC+5:30)
  var ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  var day  = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  var h = ist.getUTCHours(), m = ist.getUTCMinutes();
  var mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

/* ── Momentum score label → CSS class ── */
function momentumClass(label) {
  if (!label) return '';
  var l = label.toLowerCase();
  if (l.includes('bullish'))  return 'momentum-bull';
  if (l.includes('bearish'))  return 'momentum-bear';
  return 'momentum-neutral';
}

/* ── Momentum score → gauge width % ── */
function scoreWidth(score) {
  return Math.min(100, Math.max(0, score)) + '%';
}

/* ── Fetch OHLC from /api/ohlc/:symbol ── */
async function fetchOHLC(symbol) {
  try {
    var res  = await fetch('/api/ohlc/' + encodeURIComponent(symbol), { signal: AbortSignal.timeout(6000) });
    var json = await res.json();
    return json.error ? null : json;
  } catch (e) { return null; }
}

/* ── Fetch calculated momentum score ── */
async function fetchMomentum(symbol) {
  // symbol is bare NSE symbol e.g. CHOLAFIN — server fetches 2yr daily and calculates
  var bare = symbol.replace(/\.NS$/i, '');
  try {
    var res  = await fetch('/api/momentum/' + bare + '.NS', { signal: AbortSignal.timeout(20000) });
    var json = await res.json();
    return json.error ? null : json;
  } catch (e) { return null; }
}

/* ── Update OHLC row ── */
function updateOHLCRow(key, ohlc) {
  var set = function(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  if (!ohlc) {
    set(key + '-open',  '—');
    set(key + '-high',  '—');
    set(key + '-low',   '—');
    set(key + '-close', '—');
    return;
  }
  set(key + '-open',  fmtPrice(ohlc.O != null ? ohlc.O : null));
  set(key + '-high',  fmtPrice(ohlc.H));
  set(key + '-low',   fmtPrice(ohlc.L));
  set(key + '-close', fmtPrice(ohlc.C));
}

/* ── Update momentum row ── */
function updateMomentumRow(key, data) {
  var scoreEl = document.getElementById(key + '-mscore');
  var labelEl = document.getElementById(key + '-mlabel');
  if (!scoreEl || !labelEl) return;

  if (!data) {
    scoreEl.textContent = '—';
    scoreEl.className   = 'pivot-cell';
    labelEl.textContent = '—';
    labelEl.className   = '';
    return;
  }

  // Score cell with mini gauge
  var cls = momentumClass(data.label);
  scoreEl.className = 'pivot-cell';
  scoreEl.innerHTML =
    '<div class="mscore-wrap">'
    + '<span class="mscore-num ' + cls + '">' + data.score.toFixed(1) + '</span>'
    + '<span class="mscore-denom">/100</span>'
    + '<div class="mscore-bar"><div class="mscore-bar-fill ' + cls + '" style="width:' + scoreWidth(data.score) + '"></div></div>'
    + '</div>';

  // Label cell
  labelEl.textContent = data.label || '—';
  labelEl.className   = 'mscore-label ' + cls;
}

/* ── Main load function ── */
async function loadMomentumData() {
  var results = await Promise.all(
    getWatchlistM().map(function(w) {
      var yfSymbol = w.symbol + '.NS';
      return Promise.all([fetchOHLC(yfSymbol), fetchMomentum(w.symbol)])
        .then(function(r) { return { key: w.symbol, ohlc: r[0], momentum: r[1] }; });
    })
  );

  results.forEach(function(r) {
    updateOHLCRow(r.key, r.ohlc);
    updateMomentumRow(r.key, r.momentum);
  });

  // Timestamps
  var ts = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
  var mEl = document.getElementById('momentum-timestamp-text');
  if (mEl) mEl.textContent = 'Momentum + OHLC updated ' + ts + ' · Calculated from 2yr daily data · Yahoo Finance';
}

/* ── Scheduling ── */
// Initial call handled by watchlist.js after DOM rows are rendered

// During market hours: refresh OHLC every 60s (price data changes intraday)
// Outside hours: refresh every 15 min (just momentum, which is EOD anyway)
function scheduleNext() {
  var delay = isMarketHours() ? 60 * 1000 : 15 * 60 * 1000;
  setTimeout(function() { loadMomentumData(); scheduleNext(); }, delay);
}
scheduleNext();

// Also fire at exact market open (09:15) and close (15:30) IST
function msUntilIST(h, m) {
  var now = new Date();
  var ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  var target = new Date(ist);
  target.setUTCHours(h - 5, m - 30, 10, 0); // subtract IST offset to get UTC
  // If already past today, aim for tomorrow
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target - now;
}

setTimeout(loadMomentumData, msUntilIST(9, 15));   // market open
setTimeout(loadMomentumData, msUntilIST(15, 30));  // market close
