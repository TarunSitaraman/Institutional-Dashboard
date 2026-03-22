'use strict';

require('dotenv').config();

const express      = require('express');
const fetch        = require('node-fetch');
const path         = require('path');
const RssParser    = require('rss-parser');
const cookieParser = require('cookie-parser');
const crypto       = require('crypto');
const bcrypt       = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(cookieParser());

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qtqwhltsftxvykmetahf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0cXdobHRzZnR4dnlrbWV0YWhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE2NDQ2OSwiZXhwIjoyMDg5NzQwNDY5fQ.g-QlbAy39dLi6Yv_HJg1ATdd3YC_PJfifLJjO6GoWqI';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth helpers ──────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function createSession(userId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.from('sessions').insert({ token, user_id: userId, expires_at: expiresAt });
  return token;
}

async function getSession(req) {
  const token = req.cookies && req.cookies['sn-session'];
  if (!token) return null;
  const { data } = await db
    .from('sessions')
    .select('user_id, expires_at, users(email, name)')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await db.from('sessions').delete().eq('token', token);
    return null;
  }
  return { userId: data.user_id, email: data.users.email, name: data.users.name };
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const sess = await getSession(req);
  if (sess) { req.session = sess; return next(); }
  res.redirect('/login.html');
}

// ── Auth routes ───────────────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const emailLower = email.toLowerCase().trim();
  const { data: existing } = await db.from('users').select('id').eq('email', emailLower).single();
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const { data: user, error } = await db
    .from('users')
    .insert({ email: emailLower, password_hash: passwordHash, name })
    .select('id')
    .single();
  if (error) return res.status(500).json({ error: 'Failed to create account.' });

  // Create default settings row
  await db.from('user_settings').insert({ user_id: user.id });

  const token = await createSession(user.id);
  res.cookie('sn-session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  return res.json({ ok: true, name });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const { data: user } = await db
    .from('users')
    .select('id, name, password_hash')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = await createSession(user.id);
  res.cookie('sn-session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  return res.json({ ok: true, name: user.name });
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies && req.cookies['sn-session'];
  if (token) await db.from('sessions').delete().eq('token', token);
  res.clearCookie('sn-session');
  res.json({ ok: true });
});

// Me
app.get('/api/auth/me', async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not logged in' });
  return res.json({ email: sess.email, name: sess.name });
});

// ── Protect dashboard ─────────────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Request helpers ───────────────────────────────────────────────────────────

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function timedFetch(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Yahoo Finance session (cookie + crumb) ────────────────────────────────────
// Yahoo v8 requires a valid cookie and crumb since late 2024.
// We obtain them once, cache them, and refresh automatically on 401/403.

let yfSession = null; // { cookie, crumb, at }
let yfSessionPending = null; // deduplicates concurrent refresh calls
const YF_SESSION_TTL = 55 * 60 * 1000; // refresh every 55 min

async function getYFSession(force = false) {
  const now = Date.now();
  if (!force && yfSession && (now - yfSession.at) < YF_SESSION_TTL) return yfSession;

  // If a refresh is already in flight, wait for it instead of spawning another
  if (yfSessionPending) return yfSessionPending;

  yfSessionPending = (async () => {
  try {
    // Step 1: hit the consent / main page to get a cookie
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
      redirect: 'follow',
    });
    const rawCookies = cookieRes.headers.raw()['set-cookie'] || [];
    const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: exchange cookie for a crumb
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': BROWSER_UA, 'Cookie': cookie, 'Accept': '*/*' },
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes('<')) throw new Error('bad crumb: ' + crumb.slice(0, 40));

    yfSession = { cookie, crumb, at: now };
    console.log('[yf] session refreshed, crumb:', crumb);
    return yfSession;
  } catch (e) {
    console.warn('[yf] session refresh failed:', e.message, '— proceeding without crumb');
    yfSession = { cookie: '', crumb: '', at: now };
    return yfSession;
  } finally {
    yfSessionPending = null;
  }
  })();
  return yfSessionPending;
}

async function yfFetch(url) {
  // Ensure we have a session
  let session = await getYFSession();

  const doFetch = async (sess) => {
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = sess.crumb ? url + sep + 'crumb=' + encodeURIComponent(sess.crumb) : url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(fullUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': BROWSER_UA,
          'Cookie': sess.cookie,
        },
      });
      // Force session refresh on auth errors
      if (res.status === 401 || res.status === 403) {
        throw new Error('AUTH:' + res.status);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await doFetch(session);
  } catch (e) {
    if (e.message.startsWith('AUTH:')) {
      // Refresh session once and retry
      session = await getYFSession(true);
      return await doFetch(session);
    }
    throw e;
  }
}

function nseFetch(url) {
  return timedFetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': BROWSER_UA,
      'Referer': 'https://www.nseindia.com/',
    }
  });
}

// ── Route: GET /api/quote/:symbol ─────────────────────────────────────────────
// Yahoo Finance v8 chart — US futures, Sensex, USD-INR, commodities
// Returns { price, changePct, source }
app.get('/api/quote/:symbol', async (req, res) => {
  const symbol  = req.params.symbol;
  const encoded = encodeURIComponent(symbol);
  const url     = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`;

  try {
    const json = await yfFetch(url);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) { console.warn(`[yf/quote] No meta for ${symbol}`); return res.json({ error: true }); }

    const price     = meta.regularMarketPrice;
    const prev      = meta.previousClose || meta.chartPreviousClose;
    const changePct = (prev && prev !== 0) ? (price - prev) / prev : null;
    const change    = (prev != null) ? (price - prev) : null;
    return res.json({ price, change, changePct, source: 'Yahoo Finance' });
  } catch (e) {
    console.error(`[yf/quote] ${symbol}:`, e.message);
    return res.json({ error: true });
  }
});

// ── Route: GET /api/nse/indices ───────────────────────────────────────────────
// NSE India official allIndices — Nifty 50, Bank Nifty (authoritative, no delay)
// Returns { nifty50: {price, changePct, open, high, low, prev}, niftyBank: {...} }
app.get('/api/nse/indices', async (req, res) => {
  try {
    const json = await nseFetch('https://www.nseindia.com/api/allIndices');
    const data = json?.data || [];

    const pick = (name) => {
      const item = data.find(x => x.indexSymbol === name);
      if (!item) return null;
      return {
        price:     item.last,
        change:    item.last - item.previousClose,
        changePct: item.percentChange / 100,
        open:      item.open,
        high:      item.high,
        low:       item.low,
        prev:      item.previousClose,
        source:    'NSE India',
      };
    };

    return res.json({
      nifty50:   pick('NIFTY 50'),
      niftyBank: pick('NIFTY BANK'),
      indiavix:  pick('INDIA VIX'),
    });
  } catch (e) {
    console.error('[nse/indices]:', e.message);
    return res.json({ error: true });
  }
});

// ── Route: GET /api/nse/giftnifty ─────────────────────────────────────────────
// NSE India official Gift Nifty futures price (from marketStatus)
// Returns { price, changePct, expiry, timestamp, source }
app.get('/api/nse/giftnifty', async (req, res) => {
  try {
    const json = await nseFetch('https://www.nseindia.com/api/marketStatus');
    const gn   = json?.giftnifty;
    if (!gn || !gn.LASTPRICE) { console.warn('[nse/giftnifty] No data'); return res.json({ error: true }); }

    return res.json({
      price:     gn.LASTPRICE,
      changePct: gn.PERCHANGE / 100,
      change:    gn.DAYCHANGE,
      expiry:    gn.EXPIRYDATE,
      timestamp: gn.TIMESTMP,
      source:    'NSE India (GIFT City)',
    });
  } catch (e) {
    console.error('[nse/giftnifty]:', e.message);
    return res.json({ error: true });
  }
});

// ── Route: GET /api/ohlc/:symbol ──────────────────────────────────────────────
// Yahoo Finance daily OHLC for pivot level calculations
// Returns { H, L, C } of most recent complete trading day
app.get('/api/ohlc/:symbol', async (req, res) => {
  const symbol  = req.params.symbol;
  const encoded = encodeURIComponent(symbol);
  const url     = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`;

  try {
    const json  = await yfFetch(url);
    const chart = json?.chart?.result?.[0];
    if (!chart) { console.warn(`[ohlc] No chart for ${symbol}`); return res.json({ error: true }); }

    const quotes = chart.indicators?.quote?.[0];
    const ts     = chart.timestamp || [];

    if (!quotes || ts.length < 1) { return res.json({ error: true }); }

    for (let i = ts.length - 1; i >= 0; i--) {
      const O = quotes.open?.[i];
      const H = quotes.high[i];
      const L = quotes.low[i];
      const C = quotes.close[i];
      if (H != null && L != null && C != null && H > 0 && L > 0 && C > 0) {
        return res.json({ O: O || null, H, L, C });
      }
    }

    return res.json({ error: true });
  } catch (e) {
    console.error(`[ohlc] ${symbol}:`, e.message);
    return res.json({ error: true });
  }
});

// ── Momentum calculation helpers ──────────────────────────────────────────────

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 == null || ema26 == null) return null;
  const macdLine = ema12 - ema26;
  // Signal line = 9-period EMA of MACD — approximate with last 9 MACD values
  const macdValues = [];
  for (let i = Math.max(26, closes.length - 35); i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const e12 = calcEMA(slice, 12);
    const e26 = calcEMA(slice, 26);
    if (e12 != null && e26 != null) macdValues.push(e12 - e26);
  }
  const signalLine = macdValues.length >= 9
    ? calcEMA(macdValues, 9)
    : macdValues[macdValues.length - 1];
  return { macd: macdLine, signal: signalLine, hist: macdLine - (signalLine || 0) };
}

function calcADX(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trueRanges = [], dmPlus = [], dmMinus = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    dmPlus.push(Math.max(highs[i] - highs[i - 1], 0) > Math.max(lows[i - 1] - lows[i], 0)
      ? Math.max(highs[i] - highs[i - 1], 0) : 0);
    dmMinus.push(Math.max(lows[i - 1] - lows[i], 0) > Math.max(highs[i] - highs[i - 1], 0)
      ? Math.max(lows[i - 1] - lows[i], 0) : 0);
  }
  const atr  = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  const pDI  = (dmPlus.slice(-period).reduce((a, b) => a + b, 0) / period) / atr * 100;
  const mDI  = (dmMinus.slice(-period).reduce((a, b) => a + b, 0) / period) / atr * 100;
  const dx   = Math.abs(pDI - mDI) / (pDI + mDI) * 100;
  return { adx: dx, pdi: pDI, mdi: mDI };
}

function calc52WeekPosition(closes) {
  if (closes.length < 52) return null;
  const slice = closes.slice(-252);
  const high52 = Math.max(...slice);
  const low52  = Math.min(...slice);
  const curr   = closes[closes.length - 1];
  return (curr - low52) / (high52 - low52); // 0 = at 52wk low, 1 = at 52wk high
}

function calcVolumeScore(volumes) {
  if (volumes.length < 20) return 50;
  const avgVol = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
  const lastVol = volumes[volumes.length - 1];
  const ratio = lastVol / avgVol;
  // ratio > 1.5 = above avg volume, score 60-70; ratio < 0.5 = weak, 35-45
  return Math.min(70, Math.max(30, 50 + (ratio - 1) * 20));
}

function calcMomentumScore(closes, highs, lows, volumes) {
  const scores = {};
  const curr = closes[closes.length - 1];

  // RSI (weight 20) — mild stretch: RSI 50→50, RSI 30→26, RSI 70→74
  const rsi = calcRSI(closes);
  if (rsi != null) {
    const rsiNorm = (rsi - 50) * 1.2 + 50;
    scores.rsi = Math.min(100, Math.max(0, rsiNorm));
  } else { scores.rsi = 50; }

  // MACD (weight 15) — use pct of price to normalize, floor/ceil at 20/80
  const macd = calcMACD(closes);
  if (macd != null) {
    const histPct = (macd.hist / curr) * 1000;
    scores.macd = Math.min(80, Math.max(20, 50 + histPct * 10));
  } else { scores.macd = 50; }

  // ADX (weight 15) — direction-weighted by +DI/-DI ratio, floor at 20
  const adx = calcADX(highs, lows, closes);
  if (adx != null) {
    const diRatio = (adx.pdi - adx.mdi) / (adx.pdi + adx.mdi + 0.001); // -1 to +1
    const trendConf = Math.min(1, adx.adx / 40); // ADX 40+ = full confidence
    scores.adx = Math.min(80, Math.max(20, 50 + diRatio * trendConf * 30));
  } else { scores.adx = 50; }

  // Price vs SMA20 (weight 10) — ±5% range maps to 20-80
  const sma20 = calcSMA(closes, 20);
  scores.sma20 = sma20 != null
    ? Math.min(80, Math.max(20, 50 + ((curr - sma20) / sma20) * 600))
    : 50;

  // Price vs SMA50 (weight 10) — ±8% range maps to 20-80
  const sma50 = calcSMA(closes, 50);
  scores.sma50 = sma50 != null
    ? Math.min(80, Math.max(20, 50 + ((curr - sma50) / sma50) * 375))
    : 50;

  // Price vs SMA200 (weight 10) — ±15% range maps to 20-80
  const sma200 = calcSMA(closes, 200);
  scores.sma200 = sma200 != null
    ? Math.min(80, Math.max(20, 50 + ((curr - sma200) / sma200) * 200))
    : 50;

  // 52-week position (weight 10) — compress to 20-80 range
  const pos52 = calc52WeekPosition(closes);
  scores.week52 = pos52 != null
    ? Math.min(80, Math.max(20, pos52 * 60 + 20))
    : 50;

  // Volume trend (weight 10)
  scores.volume = calcVolumeScore(volumes);

  // Weighted composite
  const total =
    scores.rsi    * 0.20 +
    scores.macd   * 0.15 +
    scores.adx    * 0.15 +
    scores.sma20  * 0.10 +
    scores.sma50  * 0.10 +
    scores.sma200 * 0.10 +
    scores.week52 * 0.10 +
    scores.volume * 0.10;

  // Components already floored at 20-30, so raw total sits in ~25-70 range
  // Linear map: raw 25→33, raw 50→55, raw 65→67 matches Trendlyne observations
  const compressed = total * 0.85 + 12;
  const score = Math.round(compressed * 10) / 10;

  let label;
  if      (score >= 55) label = 'Technically Bullish';
  else if (score >= 38) label = 'Technically Neutral';
  else                  label = 'Technically Bearish';

  return { score, label, components: scores };
}

// ── Route: GET /api/momentum/:symbol ─────────────────────────────────────────
// Fetches 1yr daily OHLCV from Yahoo, calculates momentum score in-house
// Replaces Trendlyne scrape — fully reliable on Railway
// Server-cached 60 min (score is EOD)

const momentumCache = {};
const MOMENTUM_TTL  = 60 * 60 * 1000;

app.get('/api/momentum/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const now    = Date.now();

  if (momentumCache[symbol] && (now - momentumCache[symbol].at) < MOMENTUM_TTL) {
    return res.json(momentumCache[symbol].data);
  }

  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=2y`;

  try {
    const json  = await yfFetch(url);
    const chart = json?.chart?.result?.[0];
    if (!chart) return res.json({ error: true });

    const q = chart.indicators?.quote?.[0];
    if (!q) return res.json({ error: true });

    // Build clean arrays (filter nulls)
    const closes  = [], highs = [], lows = [], volumes = [];
    const rawC = q.close || [], rawH = q.high || [], rawL = q.low || [], rawV = q.volume || [];

    for (let i = 0; i < rawC.length; i++) {
      if (rawC[i] != null && rawH[i] != null && rawL[i] != null) {
        closes.push(rawC[i]);
        highs.push(rawH[i]);
        lows.push(rawL[i]);
        volumes.push(rawV[i] || 0);
      }
    }

    if (closes.length < 30) return res.json({ error: true });

    const result = calcMomentumScore(closes, highs, lows, volumes);
    const data = { ...result, source: 'Calculated · Yahoo Finance' };
    momentumCache[symbol] = { data, at: now };
    return res.json(data);
  } catch (e) {
    console.error(`[momentum] ${symbol}:`, e.message);
    if (momentumCache[symbol]) return res.json(momentumCache[symbol].data);
    return res.json({ error: true });
  }
});

// ── News helpers ──────────────────────────────────────────────────────────────

const rssParser = new RssParser({
  timeout: 8000,
  headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
});

// Keyword → category mapping (checked against title)
const NEWS_RULES = [
  { pattern: /\b(nifty\s*50|nifty\s+bank|bank\s*nifty|sensex|bse|nse|nifty|gift\s*nifty|sgx\s*nifty)\b/i,  category: 'India'      },
  { pattern: /\b(crude|brent|wti|opec|oil\s+price|petroleum|energy)\b/i,                                     category: 'Energy'     },
  { pattern: /\b(s&p|nasdaq|dow|nyse|federal\s*reserve|fed\s*rate|us\s+market|wall\s+street|futures)\b/i,    category: 'US Markets' },
  { pattern: /\b(rupee|usd.?inr|dollar.?rupee|rbi|forex|exchange\s+rate|currency)\b/i,                       category: 'Forex'      },
  { pattern: /\b(inflation|cpi|gdp|fiscal|monetary|budget|interest\s+rate|rbi|economy)\b/i,                  category: 'Macro'      },
  { pattern: /\b(gold|silver|commodity|commodities|metal)\b/i,                                               category: 'Commodities'},
  { pattern: /\b(ipo|fii|dii|fpi|block\s+deal|stock|equity|earnings|results|quarter)\b/i,                   category: 'Equities'   },
];

function categorise(title) {
  for (const rule of NEWS_RULES) {
    if (rule.pattern.test(title)) return rule.category;
  }
  return 'Markets';
}

// RSS feeds — no API key, server-side only (no CORS)
const RSS_FEEDS = [
  { url: 'https://www.livemint.com/rss/news',                                     source: 'Mint'           },
  { url: 'https://www.livemint.com/rss/markets',                                  source: 'Mint Markets'   },
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',  source: 'ET Markets'     },
  { url: 'https://pulse.zerodha.com/feed.xml',                                    source: 'Zerodha Pulse'  },
];

// Simple in-memory cache so RSS isn't hammered on every client refresh
let newsCache   = [];
let newsCacheAt = 0;
const NEWS_TTL  = 2 * 60 * 1000; // 2 minutes

// Topics that are off-dashboard — filter these out from general feeds
const OFF_TOPIC = /\b(cricket|football|ipl|bollywood|film|movie|election|politics|parliament|covid|cancer|health|recipe|fashion|lifestyle|travel|science|space|nasa|climate|weather|education|school|college|exam|sports|olympic|tennis|badminton|golf|hockey|wrestling|army|military|war|conflict|ukraine|israel|china|pakistan|trump|modi|bjp|congress|aam\s*aadmi)\b/i;

async function fetchAllNews() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(f => rssParser.parseURL(f.url).then(feed => ({ feed, source: f.source })))
  );

  const seen     = new Set();
  const articles = [];

  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const { feed, source } = r.value;
    (feed.items || []).forEach(item => {
      const title = (item.title || '').trim();
      const link  = item.link || item.guid || '';
      if (!title || !link || seen.has(link)) return;

      // Skip off-topic articles from general feeds
      if (OFF_TOPIC.test(title)) return;

      seen.add(link);

      const pubDate = item.pubDate || item.isoDate || '';
      const ts      = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
      const category = categorise(title);

      articles.push({
        title,
        publisher:   source,
        link,
        publishedAt: ts,
        category,
      });
    });
  });

  articles.sort((a, b) => b.publishedAt - a.publishedAt);
  return articles.slice(0, 30);
}

// ── Route: GET /api/trendlyne/momentum/:symbol ────────────────────────────────
// Scrapes Trendlyne equity page for Momentum Score (server-rendered, no auth needed)
// Returns { score, label, source }
// Cached 15 min per symbol — score updates end-of-day only

const trendlyneCache = {};
const TL_TTL = 15 * 60 * 1000;

app.get('/api/trendlyne/momentum/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const now    = Date.now();

  if (trendlyneCache[symbol] && (now - trendlyneCache[symbol].at) < TL_TTL) {
    return res.json(trendlyneCache[symbol].data);
  }

  const url = `https://trendlyne.com/equity/${symbol}/summary/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    const mStart = html.indexOf('momentum-block');
    if (mStart === -1) throw new Error('momentum-block not found');
    const section = html.slice(mStart, mStart + 2000);

    const scoreMatch = section.match(/real-score[^>]*>([\d.]+)</);
    const labelMatch = section.match(/insight\s+shrink-text[^>]*>([\s\S]*?)<\/span>/);
    if (!scoreMatch) throw new Error('score not found');

    const data = {
      score:  parseFloat(scoreMatch[1]),
      label:  labelMatch ? labelMatch[1].trim() : null,
      source: 'Trendlyne',
    };
    trendlyneCache[symbol] = { data, at: now };
    return res.json(data);
  } catch (e) {
    console.error(`[trendlyne] ${symbol}:`, e.message);
    if (trendlyneCache[symbol]) return res.json(trendlyneCache[symbol].data);
    return res.json({ error: true });
  }
});

// ── Route: GET /api/nse/search ────────────────────────────────────────────────
// NSE autocomplete — returns [{symbol, name}] filtered to active equities only
app.get('/api/nse/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json([]);
  try {
    const json = await nseFetch(`https://www.nseindia.com/api/search/autocomplete?q=${encodeURIComponent(q)}`);
    const symbols = (json?.symbols || [])
      .filter(s => s.result_sub_type === 'equity' && Array.isArray(s.activeSeries) && s.activeSeries.length > 0)
      .slice(0, 15)
      .map(s => ({ symbol: s.symbol, name: s.symbol_info || s.symbol }));
    return res.json(symbols);
  } catch (e) {
    console.error('[nse/search]:', e.message);
    return res.json([]);
  }
});

// ── Route: GET /api/news ──────────────────────────────────────────────────────
// RSS-based curated news for dashboard instruments
// Returns [{ title, publisher, link, publishedAt, category }]
app.get('/api/news', async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache.length > 0 && (now - newsCacheAt) < NEWS_TTL) {
      return res.json(newsCache);
    }
    const articles = await fetchAllNews();
    if (articles.length > 0) {
      newsCache   = articles;
      newsCacheAt = now;
    }
    return res.json(newsCache);
  } catch (e) {
    console.error('[news]:', e.message);
    return res.json(newsCache); // return stale cache on error
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Warm Yahoo Finance session before first client request
getYFSession().catch(() => {});

app.listen(PORT, () => {
  console.log(`\nSN Institutional Terminal → http://localhost:${PORT}\n`);
  console.log('Routes:');
  console.log('  /api/quote/:symbol    Yahoo Finance (US futures, Sensex, FX, commodities)');
  console.log('  /api/nse/indices      NSE India (Nifty 50, Bank Nifty — official)');
  console.log('  /api/nse/giftnifty    NSE India (Gift Nifty futures — official)');
  console.log('  /api/nse/search       NSE autocomplete search');
  console.log('  /api/ohlc/:symbol     Yahoo Finance daily OHLC (pivot calculations)');
  console.log('  /api/news             RSS feeds (ET Markets, Business Standard, Reuters)\n');
});
