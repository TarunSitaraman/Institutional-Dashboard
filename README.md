# Institutional Dashboard

A personal market intelligence terminal built for institutional-grade trading data. Displays live Indian and US market prices, standard pivot levels, in-house momentum scores, and a curated financial news feed — with per-user accounts and customisable watchlists stored in Supabase.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML / CSS / JS |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway (auto-deploy from GitHub) |
| Data | NSE India official API, Yahoo Finance v8, RSS feeds |

---

## Features

### Global Market Summary
- **US Futures** — S&P 500, Nasdaq 100, Dow Jones (price + points + % change, ~15 min delay via Yahoo Finance)
- **Futures & Volatility** — Gift Nifty (live NSE IFSC), India VIX (live NSE, inverted colour scale)
- **Indian Indices** — Nifty 50, Bank Nifty (live NSE), Sensex (Yahoo Finance)
- **Currency** — Dynamic forex card; add/remove pairs from 10 available options (USD/INR, EUR/INR, GBP/INR, JPY/INR, EUR/USD, GBP/USD, AUD/USD, USD/JPY, USD/CHF, USD/SGD). Persisted per-device via localStorage.

### Energy & Commodities
- Dynamic commodity card; add/remove from 9 options: Brent Crude, WTI Crude, Gold, Silver, Copper, Natural Gas, Wheat, Corn, Aluminium
- Visual % change bar per commodity
- Persisted per-device via localStorage

### Market Lens (Watchlist)
- Add/remove NSE symbols by ticker or company name search
- **OHLC table** — daily Open, High, Low, Close (previous session) from Yahoo Finance
- **Standard Pivot Levels** — S3, S2, S1, Pivot, R1, R2, R3 calculated from previous day OHLC
  - Formula: `P = (H+L+C)/3`, supports and resistances derived from range
  - Cached in localStorage, refreshes on date change
- **Momentum Score** — in-house composite score (0–100) calculated from 2 years of daily data via Yahoo Finance
  - Indicators: RSI(14) · MACD · ADX(14) · Price vs SMA20/50/200 · 52-week position · Volume trend
  - Signals: Technically Bullish / Technically Neutral / Technically Bearish
  - Server-cached 60 min; refreshes at market open (09:15 IST) and close (15:30 IST)

### Live Intelligence (News Sidebar)
- Curated headlines from ET Markets, Livemint, and Zerodha Pulse via RSS
- Auto-tagged by category: Earnings, Economy, Policy, Global, Commodities, IPO, Results
- Refreshes every 2 minutes

### Account System
- Register / login with email and password (bcrypt hashed, 10 rounds)
- HTTP-only session cookie (`sn-session`, 7-day TTL) stored in Supabase
- Protected routes — unauthenticated requests redirect to `/login.html`
- Sign out clears the session

### UI
- Light and dark theme with toggle; preference saved to localStorage
- Auto-refreshing market data (2 second interval during market hours)
- Responsive layout — news sidebar collapses on smaller screens
- Flash animations on price changes (green up, red down)

---

## Running Locally

1. Clone the repo and install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the project root:
   ```
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_KEY=your_supabase_service_role_key
   PORT=8080
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open `http://localhost:8080` in your browser.

---

## Deployment

Deployed on **Railway** with auto-deploy on push to `main`.

- Environment variables (`SUPABASE_URL`, `SUPABASE_KEY`) set in Railway project dashboard
- `Procfile` defines start command: `web: node server.js`
- Supabase hosts the PostgreSQL database (always-on free tier)

---

## Database Schema (Supabase)

```sql
users     (id, email, name, password_hash, created_at)
sessions  (id, token, user_id, expires_at, created_at)
```

---

## API Routes

| Route | Returns | Source |
|---|---|---|
| `GET /api/quote/:symbol` | `{ price, change, changePct }` | Yahoo Finance v8 |
| `GET /api/nse/indices` | `{ nifty50, niftyBank, indiavix }` | NSE India official |
| `GET /api/nse/giftnifty` | `{ price, changePct, expiry, timestamp }` | NSE India official |
| `GET /api/ohlc/:symbol` | `{ O, H, L, C }` previous session | Yahoo Finance v8 |
| `GET /api/momentum/:symbol` | `{ score, label, components }` | Calculated from Yahoo Finance 2yr data |
| `GET /api/news` | `[{ title, publisher, link, publishedAt, category }]` | RSS — ET Markets, Livemint, Zerodha Pulse |
| `POST /api/auth/register` | `{ ok }` | Supabase |
| `POST /api/auth/login` | Sets session cookie | Supabase |
| `POST /api/auth/logout` | Clears session cookie | Supabase |
| `GET /api/auth/me` | `{ email, name }` | Supabase |

---

## Data Sources

| Instrument | Source | Latency |
|---|---|---|
| Nifty 50, Bank Nifty, India VIX | NSE India official (`allIndices`) | Live |
| Gift Nifty | NSE India official (`marketStatus`) | Live |
| S&P 500, Nasdaq, Dow Jones futures | Yahoo Finance v8 | ~15 min delay |
| Sensex | Yahoo Finance v8 (`^BSESN`) | ~15 min delay |
| Forex pairs | Yahoo Finance v8 | Near real-time |
| Commodities | Yahoo Finance v8 | ~15 min delay |
| OHLC (pivots) | Yahoo Finance v8 | End of day |
| Momentum score | Calculated in-house from Yahoo Finance 2yr daily OHLC | End of day, server-cached 60 min |
| News | ET Markets, Livemint, Zerodha Pulse RSS | Refreshes every 2 min |