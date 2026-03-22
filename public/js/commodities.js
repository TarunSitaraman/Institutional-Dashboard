/* ════════════════════════════════════════════════════
   COMMODITIES — dynamic add/remove
   Stored in localStorage under 'sn-commodities-v1'
   Fetched via /api/quote/:symbol (Yahoo Finance)
════════════════════════════════════════════════════ */

var COMM_KEY = 'sn-commodities-v1';

var COMM_OPTIONS = [
  { symbol: 'BZ=F',   label: 'Crude Brent',   unit: 'USD/bbl' },
  { symbol: 'CL=F',   label: 'Nymex WTI',     unit: 'USD/bbl' },
  { symbol: 'GC=F',   label: 'Gold',           unit: 'USD/oz'  },
  { symbol: 'SI=F',   label: 'Silver',         unit: 'USD/oz'  },
  { symbol: 'HG=F',   label: 'Copper',         unit: 'USD/lb'  },
  { symbol: 'NG=F',   label: 'Natural Gas',    unit: 'USD/MMBtu'},
  { symbol: 'ZW=F',   label: 'Wheat',          unit: 'USc/bu'  },
  { symbol: 'ZC=F',   label: 'Corn',           unit: 'USc/bu'  },
  { symbol: 'ALI=F',  label: 'Aluminium',      unit: 'USD/cwt' },
];

var DEFAULT_COMM = [
  { symbol: 'BZ=F', label: 'Crude Brent', unit: 'USD/bbl' },
  { symbol: 'CL=F', label: 'Nymex WTI',  unit: 'USD/bbl' },
];

var commState = [];

function loadCommState() {
  try {
    var stored = JSON.parse(localStorage.getItem(COMM_KEY));
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch (e) {}
  return DEFAULT_COMM.slice();
}

function saveCommState() {
  localStorage.setItem(COMM_KEY, JSON.stringify(commState));
}

/* ── Render ── */
function renderCommodities() {
  var grid = document.getElementById('commodities-grid');
  if (!grid) return;

  if (commState.length === 0) {
    grid.innerHTML = '<div style="padding:18px 0;color:var(--text-muted);font-size:13px;">No commodities added. Click + Add.</div>';
    return;
  }

  grid.innerHTML = commState.map(function(c) {
    var key = c.symbol.replace(/[^a-zA-Z0-9]/g,'_');
    return '<div class="commodity-item">' +
      '<div class="commodity-name">' + c.label + ' <span class="commodity-unit">' + c.unit + '</span></div>' +
      '<div class="commodity-price-row">' +
        '<span class="commodity-price" id="comm-price-' + key + '">—</span>' +
        '<span class="commodity-chg" id="comm-chg-' + key + '">—</span>' +
      '</div>' +
      '<div class="commodity-bar"><div class="commodity-bar-fill" id="comm-bar-' + key + '"></div></div>' +
    '</div>';
  }).join('');
}

/* ── Fetch + update ── */
var commPriceCache = {};

function updateCommItem(c, data) {
  var key = c.symbol.replace(/[^a-zA-Z0-9]/g,'_');
  var pe = document.getElementById('comm-price-' + key);
  var ce = document.getElementById('comm-chg-' + key);
  var be = document.getElementById('comm-bar-' + key);
  if (!pe || !ce) return;
  if (!data) { pe.textContent = '—'; ce.textContent = '—'; ce.className = 'commodity-chg'; return; }

  var prev = commPriceCache[key];
  if (prev != null && data.price !== prev) {
    pe.classList.remove('flash-up','flash-down');
    void pe.offsetWidth;
    pe.classList.add(data.price > prev ? 'flash-up' : 'flash-down');
  }
  commPriceCache[key] = data.price;

  pe.textContent = data.price != null ? data.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  var pct = data.changePct;
  ce.textContent = pct != null ? (pct >= 0 ? '+' : '') + (pct * 100).toFixed(2) + '%' : '—';
  ce.className = 'commodity-chg ' + (pct >= 0 ? 'up' : 'dn');
  if (be) {
    be.classList.toggle('up-fill', pct >= 0);
    be.style.width = Math.min(90, Math.abs((pct || 0) * 100) * 10 + 20) + '%';
  }
}

async function refreshCommodities() {
  if (commState.length === 0) return;
  var results = await Promise.all(commState.map(function(c) {
    return fetch('/api/quote/' + encodeURIComponent(c.symbol), { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; });
  }));
  commState.forEach(function(c, i) {
    var data = results[i];
    updateCommItem(c, (data && !data.error) ? data : null);
  });
}

/* ── Modal ── */
function openCommModal(mode) {
  var modal = document.getElementById('comm-modal');
  var title = document.getElementById('comm-modal-title');
  var addSection = document.getElementById('comm-add-list');
  var removeSection = document.getElementById('comm-remove-list');

  modal.style.display = 'flex';

  if (mode === 'add') {
    title.textContent = 'Add Commodity';
    addSection.style.display = 'block';
    removeSection.style.display = 'none';

    var available = COMM_OPTIONS.filter(function(c) {
      return !commState.some(function(s) { return s.symbol === c.symbol; });
    });

    addSection.innerHTML = available.length === 0
      ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">All available commodities already added.</div>'
      : available.map(function(c) {
          return '<div class="forex-pair-item" onclick="addCommItem(\'' + c.symbol + '\')">' +
            '<div><span class="forex-pair-label">' + c.label + '</span>' +
            '<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">' + c.unit + '</span></div>' +
            '<span class="forex-pair-add">+</span>' +
          '</div>';
        }).join('');
  } else {
    title.textContent = 'Remove Commodity';
    addSection.style.display = 'none';
    removeSection.style.display = 'block';

    removeSection.innerHTML = commState.length === 0
      ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No commodities to remove.</div>'
      : commState.map(function(c) {
          return '<div class="forex-pair-item" onclick="removeCommItem(\'' + c.symbol + '\')">' +
            '<span class="forex-pair-label">' + c.label + '</span>' +
            '<span class="forex-pair-remove">−</span>' +
          '</div>';
        }).join('');
  }
}

function closeCommModal() {
  document.getElementById('comm-modal').style.display = 'none';
}

function addCommItem(symbol) {
  var item = COMM_OPTIONS.find(function(c) { return c.symbol === symbol; });
  if (!item || commState.some(function(c) { return c.symbol === symbol; })) return;
  commState.push(item);
  saveCommState();
  renderCommodities();
  closeCommModal();
  refreshCommodities();
}

function removeCommItem(symbol) {
  commState = commState.filter(function(c) { return c.symbol !== symbol; });
  saveCommState();
  renderCommodities();
  closeCommModal();
}

/* ── Init ── */
commState = loadCommState();
renderCommodities();
refreshCommodities();
setInterval(refreshCommodities, 2000);