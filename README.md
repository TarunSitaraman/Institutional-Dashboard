# Institutional Dashboard

A personal market intelligence terminal for institutional-grade trading data. Displays live Indian and US market prices, standard pivot levels, Trendlyne momentum scores, and a curated financial news feed — with per-user account settings stored in Supabase.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS
- **Database:** Supabase (PostgreSQL)
- **Data Sources:** NSE India (official), Yahoo Finance, Trendlyne, RSS feeds

## Features

- Live US futures (S&P 500, Nasdaq 100, Dow Jones) and Indian indices (Nifty 50, Bank Nifty, Gift Nifty, India VIX)
- Standard pivot levels (S3–R3) calculated from previous day OHLC
- Trendlyne momentum scores for watchlist stocks
- Curated news feed from ET Markets, Livemint, and Zerodha Pulse
- Account-based login with per-user watchlists and theme preferences
- Light and dark theme

## Running Locally

1. Clone the repo
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the root:
   ```
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_KEY=your_supabase_service_role_key
   PORT=8080
   ```
4. Start the server:
   ```
   npm run dev
   ```
5. Open `http://localhost:8080/login.html`

## Deployment

Deployed on Railway. Environment variables (`SUPABASE_URL`, `SUPABASE_KEY`) are set in the Railway project dashboard. The `Procfile` defines the start command.

## Data Sources

| Instrument | Source | Notes |
|---|---|---|
| Nifty 50, Bank Nifty, Gift Nifty, India VIX | NSE India official API | Live |
| S&P 500, Nasdaq, Dow Jones futures | Yahoo Finance v8 | ~15 min delay |
| Sensex, USD-INR, Brent, WTI | Yahoo Finance v8 | ~15 min delay |
| OHLC for pivots | Yahoo Finance v8 | End of day |
| Momentum scores | Trendlyne | End of day |
| News | ET Markets, Livemint, Zerodha Pulse RSS | Refreshes every 2 min |