import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ====== Crypto via CoinGecko (gratis, sin key) ======
async function fetchCryptoPrices(symbols) {
  if (symbols.length === 0) return {};
  const symbolsParam = symbols.map((s) => s.toLowerCase()).join(',');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&symbols=${encodeURIComponent(symbolsParam)}&per_page=250&order=market_cap_desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  // Si un símbolo tiene varias monedas, nos quedamos con la de mayor market cap (vienen ordenadas).
  const out = {};
  for (const coin of data) {
    const sym = coin.symbol?.toUpperCase();
    if (sym && symbols.includes(sym) && !out[sym] && typeof coin.current_price === 'number') {
      out[sym] = coin.current_price;
    }
  }
  return out;
}

// ====== FX via Frankfurter (BCE, gratis, sin key) ======
async function fetchFxRates(currencies) {
  const filtered = [...new Set(currencies.filter((c) => c && c !== 'EUR'))];
  if (filtered.length === 0) return {};
  const url = `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${encodeURIComponent(filtered.join(','))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const data = await res.json();
  const rates = data.rates || {};
  const out = {};
  for (const [k, v] of Object.entries(rates)) {
    if (typeof v === 'number' && v > 0) out[k] = v;
  }
  return out;
}

// ====== Stocks via Yahoo Finance (gratis, sin key) ======
// Mapeo de sufijos amistosos → sufijos Yahoo
const SUFFIX_MAP = { '.UK': '.L' };
function toYahooTicker(t) {
  for (const [from, to] of Object.entries(SUFFIX_MAP)) {
    if (t.endsWith(from)) return t.slice(0, -from.length) + to;
  }
  return t;
}

async function fetchStockPrice(ticker) {
  const yahooTicker = toYahooTicker(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (PortfolioTracker)' } });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number' || price <= 0) return null;
  return { price, currency: meta.currency || 'USD' };
}

async function fetchAllStocks(tickers) {
  if (tickers.length === 0) return {};
  const results = await Promise.all(
    tickers.map(async (t) => {
      try {
        const data = await fetchStockPrice(t);
        return [t, data];
      } catch {
        return [t, null];
      }
    })
  );
  const out = {};
  for (const [t, data] of results) {
    if (data) out[t] = data;
  }
  return out;
}

// ====== Endpoint principal ======
app.post('/api/refresh-prices', async (req, res) => {
  try {
    const { cryptoSymbols = [], stockTickers = [], fxNeeded = [] } = req.body;
    const [crypto, stocks, fx] = await Promise.all([
      fetchCryptoPrices(cryptoSymbols).catch((e) => {
        console.error('Crypto error:', e.message);
        return {};
      }),
      fetchAllStocks(stockTickers),
      fetchFxRates(fxNeeded).catch((e) => {
        console.error('FX error:', e.message);
        return {};
      }),
    ]);
    res.json({ crypto, stocks, fx });
  } catch (err) {
    console.error('Error refresh-prices:', err);
    res.status(500).json({ error: err.message || 'Error desconocido' });
  }
});

// Servir frontend en producción
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Backend escuchando en http://localhost:${PORT}`);
  console.log('  Fuentes: CoinGecko (cripto) · Yahoo Finance (acciones) · Frankfurter (FX)');
});
