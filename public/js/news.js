/* ════════════════════════════════════════════════════
   LIVE NEWS FEED  —  RSS (ET Markets, Business Standard, Reuters)
   Refreshes every 90 seconds
════════════════════════════════════════════════════ */

var newsCache = [];

var CATEGORY_COLORS = {
  'India':       '#79db8d',
  'US Markets':  '#abc7ff',
  'Energy':      '#f28b82',
  'Forex':       '#ffd966',
  'Macro':       '#ffb347',
  'Equities':    '#c4a6e8',
  'Commodities': '#80cbc4',
  'Markets':     '#9ba3b0',
};

function timeAgo(unixSec) {
  if (!unixSec) return '';
  var diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)    return diff + 's ago';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNews(articles) {
  var feed = document.getElementById('news-feed');
  if (!feed) return;

  if (!articles || articles.length === 0) {
    feed.innerHTML = '<div class="news-empty">No headlines available</div>';
    return;
  }

  feed.innerHTML = articles.map(function(a, idx) {
    var color = CATEGORY_COLORS[a.category] || '#9ba3b0';
    var time  = timeAgo(a.publishedAt);

    return '<a class="news-item" href="' + escapeHtml(a.link) + '" target="_blank" rel="noopener noreferrer" '
      + 'style="animation-delay:' + (idx * 0.04) + 's">'
      + '<div class="news-body">'
      + '<div class="news-meta">' + escapeHtml(time) + ' &bull; ' + escapeHtml(a.publisher) + '</div>'
      + '<div class="news-headline">' + escapeHtml(a.title) + '</div>'
      + '<div class="news-tag">'
      + '<span class="news-tag-dot" style="background:' + color + '"></span>'
      + escapeHtml(a.category)
      + '</div>'
      + '</div>'
      + '</a>';
  }).join('');
}

async function refreshNews() {
  try {
    var res  = await fetch('/api/news', { signal: AbortSignal.timeout(12000) });
    var data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      newsCache = data;
      renderNews(data);
      var ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      var el = document.getElementById('news-update-time');
      if (el) el.textContent = 'Updated ' + ts;
    }
  } catch (e) {
    console.error('[news] fetch failed:', e);
    if (newsCache.length > 0) renderNews(newsCache);
  }
}

refreshNews();
setInterval(refreshNews, 120000);
