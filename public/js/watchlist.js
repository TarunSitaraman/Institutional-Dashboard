/* ════════════════════════════════════════════════════
   WATCHLIST STATE + DYNAMIC TABLE RENDERER
   Shared by pivots.js and momentum.js
   Persisted to localStorage under 'sn-watchlist-v1'
════════════════════════════════════════════════════ */

var DEFAULT_WATCHLIST = [];

var WL_KEY = 'sn-watchlist-v1';

/* ── State ── */
function loadWatchlistState() {
  try {
    var stored = JSON.parse(localStorage.getItem(WL_KEY));
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch (e) {}
  return DEFAULT_WATCHLIST.slice();
}

function saveWatchlistState(list) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch (e) {}
}

/* Exposed globally so pivots.js and momentum.js can read it */
var watchlistState = loadWatchlistState();

// Always clear pivot cache on page load — pivots.js will refetch and re-cache
localStorage.removeItem('sn-pivots-v1');

/* ── Table rendering ── */
function fmtR(v, dec) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function renderOHLCTable() {
  var tbody = document.getElementById('ohlc-tbody');
  if (!tbody) return;
  tbody.innerHTML = watchlistState.map(function(w) {
    return '<tr data-key="' + w.symbol + '">'
      + '<td><div class="sym-name">' + w.symbol + '</div><div class="sym-full">' + escHtml(w.name) + '</div></td>'
      + '<td id="' + w.symbol + '-open">—</td>'
      + '<td class="resist-cell" id="' + w.symbol + '-high">—</td>'
      + '<td class="support-cell" id="' + w.symbol + '-low">—</td>'
      + '<td id="' + w.symbol + '-close">—</td>'
      + '<td class="pivot-cell" id="' + w.symbol + '-mscore">—</td>'
      + '<td id="' + w.symbol + '-mlabel">—</td>'
      + '</tr>';
  }).join('');
}

function renderPivotTable() {
  var tbody = document.getElementById('pivot-tbody');
  if (!tbody) return;
  tbody.innerHTML = watchlistState.map(function(w) {
    return '<tr data-key="' + w.symbol + '">'
      + '<td><div class="sym-name">' + w.symbol + '</div><div class="sym-full">' + escHtml(w.name) + '</div></td>'
      + '<td class="support-cell" id="' + w.symbol + '-s3">—</td>'
      + '<td class="support-cell" id="' + w.symbol + '-s2">—</td>'
      + '<td class="support-cell" id="' + w.symbol + '-s1">—</td>'
      + '<td class="pivot-cell"   id="' + w.symbol + '-pivot">—</td>'
      + '<td class="resist-cell"  id="' + w.symbol + '-r1">—</td>'
      + '<td class="resist-cell"  id="' + w.symbol + '-r2">—</td>'
      + '<td class="resist-cell"  id="' + w.symbol + '-r3">—</td>'
      + '</tr>';
  }).join('');
}

function renderBothTables() {
  renderOHLCTable();
  renderPivotTable();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Add / Remove ── */
function addToWatchlist(symbol, name) {
  symbol = symbol.toUpperCase().trim();
  if (watchlistState.some(function(w) { return w.symbol === symbol; })) return false; // already exists
  watchlistState.push({ symbol: symbol, name: name || symbol });
  saveWatchlistState(watchlistState);
  renderBothTables();
  // Trigger data refresh for the new row
  if (typeof loadPivots === 'function') loadPivots(true);
  if (typeof loadMomentumData === 'function') loadMomentumData();
  return true;
}

function removeFromWatchlist(symbol) {
  symbol = symbol.toUpperCase().trim();
  var idx = watchlistState.findIndex(function(w) { return w.symbol === symbol; });
  if (idx === -1) return false;
  watchlistState.splice(idx, 1);
  saveWatchlistState(watchlistState);
  // Remove from pivot cache without busting the whole cache
  try {
    var cached = JSON.parse(localStorage.getItem('sn-pivots-v1') || 'null');
    if (cached && cached.data) {
      delete cached.data[symbol];
      localStorage.setItem('sn-pivots-v1', JSON.stringify(cached));
    }
  } catch (e) {}
  renderBothTables();
  // Re-populate the remaining rows immediately after re-render
  if (typeof loadPivots === 'function') loadPivots(false);
  if (typeof loadMomentumData === 'function') loadMomentumData();
  return true;
}

/* ── Autocomplete search ── */
var acTimer = null;
var acResults = [];

function openModal(mode) {
  var modal = document.getElementById('wl-modal');
  var title = document.getElementById('wl-modal-title');
  var input = document.getElementById('wl-input');
  var hint  = document.getElementById('wl-hint');
  var removeList = document.getElementById('wl-remove-list');

  modal.dataset.mode = mode;
  input.value = '';
  document.getElementById('wl-dropdown').innerHTML = '';
  document.getElementById('wl-dropdown').style.display = 'none';

  if (mode === 'add') {
    title.textContent = 'Add to Watchlist';
    hint.textContent  = 'Type a ticker symbol or company name';
    document.getElementById('wl-input-wrap').style.display = '';
    removeList.style.display = 'none';
  } else {
    title.textContent = 'Remove from Watchlist';
    hint.textContent  = 'Select a symbol to remove';
    document.getElementById('wl-input-wrap').style.display = 'none';
    removeList.style.display = '';
    renderRemoveList();
  }

  modal.style.display = 'flex';
  if (mode === 'add') setTimeout(function() { input.focus(); }, 50);
}

function closeModal() {
  document.getElementById('wl-modal').style.display = 'none';
  clearTimeout(acTimer);
}

function renderRemoveList() {
  var el = document.getElementById('wl-remove-list');
  if (!watchlistState.length) {
    el.innerHTML = '<div class="wl-empty">Watchlist is empty</div>';
    return;
  }
  el.innerHTML = watchlistState.map(function(w) {
    return '<div class="wl-remove-item" onclick="confirmRemove(\'' + w.symbol + '\')">'
      + '<div><div class="wl-ri-sym">' + escHtml(w.symbol) + '</div><div class="wl-ri-name">' + escHtml(w.name) + '</div></div>'
      + '<span class="material-symbols-outlined wl-ri-del">remove_circle</span>'
      + '</div>';
  }).join('');
}

function confirmRemove(symbol) {
  removeFromWatchlist(symbol);
  closeModal();
}

function onSearchInput(e) {
  var q = e.target.value.trim();
  var dd = document.getElementById('wl-dropdown');
  if (q.length < 1) { dd.style.display = 'none'; dd.innerHTML = ''; return; }

  clearTimeout(acTimer);
  acTimer = setTimeout(function() {
    fetch('/api/nse/search?q=' + encodeURIComponent(q))
      .then(function(r) { return r.json(); })
      .then(function(results) {
        acResults = results;
        if (!results.length) {
          dd.innerHTML = '<div class="wl-dd-empty">No results for "' + escHtml(q) + '"</div>';
          dd.style.display = '';
          return;
        }
        dd.innerHTML = results.map(function(r, i) {
          var alreadyIn = watchlistState.some(function(w) { return w.symbol === r.symbol; });
          return '<div class="wl-dd-item' + (alreadyIn ? ' wl-dd-added' : '') + '" data-i="' + i + '">'
            + '<span class="wl-dd-sym">' + escHtml(r.symbol) + '</span>'
            + '<span class="wl-dd-name">' + escHtml(r.name) + '</span>'
            + (alreadyIn ? '<span class="wl-dd-tag">Added</span>' : '')
            + '</div>';
        }).join('');
        dd.style.display = '';
        // Click handlers
        dd.querySelectorAll('.wl-dd-item:not(.wl-dd-added)').forEach(function(el) {
          el.addEventListener('click', function() {
            var item = acResults[parseInt(el.dataset.i)];
            var added = addToWatchlist(item.symbol, item.name);
            if (added) closeModal();
          });
        });
      })
      .catch(function() { dd.innerHTML = '<div class="wl-dd-empty">Search failed</div>'; dd.style.display = ''; });
  }, 220); // debounce 220ms
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', function() {
  renderBothTables();
  // Trigger pivot + momentum load after DOM rows exist
  if (typeof loadPivots === 'function') loadPivots(true);
  if (typeof loadMomentumData === 'function') loadMomentumData();

  // Wire input
  var input = document.getElementById('wl-input');
  if (input) input.addEventListener('input', onSearchInput);

  // Close modal on backdrop click
  var modal = document.getElementById('wl-modal');
  if (modal) modal.addEventListener('click', function(e) {
    if (e.target === modal) closeModal();
  });

  // ESC to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });
});
