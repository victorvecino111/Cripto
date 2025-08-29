# Cripto
For creation of TPI model
"""
Crypto Allocation with ML & Risk Overlay (Enhanced)
Mejoras:
- Documentación completa en funciones.
- Validación robusta de parámetros de entrada.
- Manejo de excepciones con logging claro.
- Refactorización de backtest para robustez en pesos.
- Uso consistente de f-strings.
- Backoff parametrizable en APIs.
- Separación de reportes y visualización.
- Ampliación de activos: BTC, ETH, SOL, HYPE, LINK, XRP.
- Reporte detallado con análisis e interpretación ampliada.
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    import yfinance
except ImportError:
    yfinance = None

try:
    import requests
except ImportError:
    requests = None

from sklearn.covariance import LedoitWolf
from sklearn.ensemble import RandomForestRegressor, StackingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from scipy.optimize import minimize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

_DEFAULT_ID_MAP: Dict[str, str] = {
    "btc": "bitcoin",
    "eth": "ethereum",
    "sol": "solana",
    "ada": "cardano",
    "bnb": "binancecoin",
    "xrp": "ripple",
    "dot": "polkadot",
    "matic": "matic-network",
    "avax": "avalanche-2",
    "ltc": "litecoin",
    "doge": "dogecoin",
    "link": "chainlink",
    "hype": "hyperverse",
}

essential_usdt = {"usd", "usdt", "busd", "usdc"}

def _parse_id_override(s: Optional[str]) -> Dict[str, str]:
    if not s:
        return {}
    out: Dict[str, str] = {}
    for kv in s.split(','):
        if not kv.strip():
            continue
        if '=' not in kv:
            raise ValueError(f"Invalid id_override entry: {kv!r}")
        k, v = kv.split('=', 1)
        out[k.strip().lower()] = v.strip()
    return out

def _symbol_to_binance(symbol: str) -> Optional[str]:
    s = symbol.replace('/', '-').upper()
    parts = s.split('-')
    if len(parts) < 2:
        return None
    base, quote = parts[0], parts[1]
    if quote.lower() in essential_usdt:
        quote = "USDT"
    return f"{base}{quote}"

def _symbol_to_cg_id(symbol: str, override: Dict[str, str]) -> str:
    base = symbol.split('-')[0].split('/')[0].lower()
    if base in override:
        return override[base]
    if base in _DEFAULT_ID_MAP:
        return _DEFAULT_ID_MAP[base]
    return base

def _cache_path(cache_dir: Optional[str], provider: str, ticker: str, start: str, end: str) -> Optional[str]:
    if not cache_dir:
        return None
    os.makedirs(cache_dir, exist_ok=True)
    safe = ticker.replace('/', '_').replace(':', '_')
    return os.path.join(cache_dir, f"{provider}_{safe}_{start}_{end}.csv")

def _read_cache(cache_dir: Optional[str], provider: str, ticker: str, start: str, end: str, ttl_days: int) -> Optional[pd.Series]:
    path = _cache_path(cache_dir, provider, ticker, start, end)
    if not path or not os.path.exists(path):
        return None
    age = time.time() - os.path.getmtime(path)
    if age > ttl_days * 86400:
        return None
    df = pd.read_csv(path)
    cols = {c.lower(): c for c in df.columns}
    date_found = None
    for date_key in ("date", "timestamp", "datetime"):
        if date_key in cols:
            date_found = cols[date_key]
            break
    if not date_found or "close" not in cols:
        return None
    s = pd.Series(df[cols["close"]].values, index=pd.to_datetime(df[date_found])).rename(ticker)
    return s.sort_index()

def _write_cache(cache_dir: Optional[str], provider: str, ticker: str, s: pd.Series, start: str, end: str) -> None:
    path = _cache_path(cache_dir, provider, ticker, start, end)
    if not path:
        return
    df = pd.DataFrame({"Date": s.index, "Close": s.values})
    df.to_csv(path, index=False)

def load_prices(
    tickers: List[str],
    start: str,
    end: str,
    provider: str = "auto",
    csv_dir: Optional[str] = None,
    id_override: Optional[str] = None,
    cache_dir: Optional[str] = None,
    cache_ttl_days: int = 3,
    coingecko_api_key: Optional[str] = None,
    coingecko_max_retries: int = 4,
    coingecko_backoff_secs: float = 2.0,
    coingecko_jitter_secs: float = 0.25,
    binance_max_retries: int = 4,
    binance_backoff_secs: float = 1.5,
    binance_jitter_secs: float = 0.2,
) -> pd.DataFrame:
    provider = provider.lower()
    id_map_override = _parse_id_override(id_override)
    if provider == "auto":
        if yfinance is not None:
            try:
                return load_prices_yf(tickers, start, end, cache_dir, cache_ttl_days)
            except Exception as e:
                logging.warning(f"[WARN] yfinance failed: {e}")
        try:
            return load_prices_coingecko(
                tickers, start, end, id_map_override, cache_dir, cache_ttl_days,
                coingecko_api_key, coingecko_max_retries, coingecko_backoff_secs, coingecko_jitter_secs,
            )
        except Exception as e:
            logging.warning(f"[WARN] CoinGecko failed: {e}")
        try:
            return load_prices_binance(
                tickers, start, end, cache_dir, cache_ttl_days,
                binance_max_retries, binance_backoff_secs, binance_jitter_secs,
            )
        except Exception as e:
            logging.warning(f"[WARN] Binance failed: {e}")
        if csv_dir:
            return load_prices_csv(tickers, csv_dir, start, end)
        raise RuntimeError("All providers failed (yfinance, coingecko, binance). Provide --csv_dir for offline CSV fallback.")
    if provider == "yfinance":
        return load_prices_yf(tickers, start, end, cache_dir, cache_ttl_days)
    if provider == "coingecko":
        return load_prices_coingecko(
            tickers, start, end, id_map_override, cache_dir, cache_ttl_days,
            coingecko_api_key, coingecko_max_retries, coingecko_backoff_secs, coingecko_jitter_secs,
        )
    if provider == "binance":
        return load_prices_binance(
            tickers, start, end, cache_dir, cache_ttl_days,
            binance_max_retries, binance_backoff_secs, binance_jitter_secs,
        )
    if provider == "csv":
        if not csv_dir:
            raise RuntimeError("csv provider requires --csv_dir")
        return load_prices_csv(tickers, csv_dir, start, end)
    raise RuntimeError(f"Unknown provider: {provider}")

def load_prices_yf(
    tickers: List[str], start: str, end: str, cache_dir: Optional[str], cache_ttl_days: int
) -> pd.DataFrame:
    if yfinance is None:
        raise RuntimeError(
            "yfinance is not installed or available. Install it or use --provider coingecko/binance/csv."
        )
    data = {}
    for t in tickers:
        s = _read_cache(cache_dir, "yfinance", t, start, end, cache_ttl_days)
        if s is None:
            df = yfinance.download(t, start=start, end=end, auto_adjust=True, progress=False)
            if df.empty or "Close" not in df:
                raise RuntimeError(f"No data for {t} from yfinance.")
            s = df["Close"].rename(t).dropna().sort_index()
            _write_cache(cache_dir, "yfinance", t, s, start, end)
        else:
            logging.info(f"Loaded {t} from yfinance cache.")
        data[t] = s
    prices = pd.concat(data.values(), axis=1)
    return prices.dropna(how="all").sort_index()

def _cg_session(api_key: Optional[str]) -> Optional["requests.Session"]:
    if requests is None:
        return None
    s = requests.Session()
    headers = {"accept": "application/json"}
    if api_key:
        headers["x-cg-pro-api-key"] = api_key
    s.headers.update(headers)
    return s

def _coingecko_fetch_series(
    session: "requests.Session",
    cg_id: str,
    ticker_label: str,
    start_ts: int,
    end_ts: int,
    max_retries: int,
    backoff_secs: float,
    jitter_secs: float,
    chunk_days: int = 90,
) -> pd.Series:
    all_series = []
    current_start = start_ts
    one_day_secs = 86400
    chunk_secs = chunk_days * one_day_secs

    while current_start < end_ts:
        current_end = min(end_ts, current_start + chunk_secs)
        url = f"https://api.coingecko.com/api/v3/coins/{cg_id}/market_chart/range"
        params = {"vs_currency": "usd", "from": current_start, "to": current_end}
        attempt = 0
        while True:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 200:
                js = r.json()
                raw = js.get("prices", [])
                if not raw:
                    raise RuntimeError(f"No prices from CoinGecko for {ticker_label} (id={cg_id}).")
                s_chunk = pd.Series({pd.to_datetime(ms, unit="ms").normalize(): float(px) for ms, px in raw})
                all_series.append(s_chunk)
                break
            if r.status_code in (401, 403, 429):
                attempt += 1
                if attempt > max_retries:
                    raise RuntimeError(f"CoinGecko error for {ticker_label} (id={cg_id}): {r.status_code} {r.text[:160]}")
                sleep_s = backoff_secs * (2 ** (attempt - 1)) + np.random.uniform(0, jitter_secs)
                logging.warning(f"CoinGecko rate limit hit for {ticker_label} retrying in {sleep_s:.2f}s...")
                time.sleep(sleep_s)
                continue
            raise RuntimeError(f"CoinGecko error for {ticker_label} (id={cg_id}): {r.status_code} {r.text[:160]}")
        current_start = current_end + 1

    s = pd.concat(all_series).groupby(level=0).last().sort_index()
    s.name = ticker_label
    return s

def load_prices_coingecko(
    tickers: List[str],
    start: str,
    end: str,
    override: Dict[str, str],
    cache_dir: Optional[str],
    cache_ttl_days: int,
    api_key: Optional[str],
    max_retries: int,
    backoff_secs: float,
    jitter_secs: float,
) -> pd.DataFrame:
    if requests is None:
        raise RuntimeError("requests is required for CoinGecko provider. Install it or use binance/csv.")
    start_ts = int(pd.Timestamp(start, tz="UTC").timestamp())
    end_ts = int((pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)).timestamp())
    session = _cg_session(api_key)
    if session is None:
        raise RuntimeError("requests not available; cannot use CoinGecko provider.")
    series = {}
    for idx, t in enumerate(tickers):
        s = _read_cache(cache_dir, "coingecko", t, start, end, cache_ttl_days)
        if s is None:
            cg_id = _symbol_to_cg_id(t, override)
            if idx > 0:
                time.sleep(0.5)
            s = _coingecko_fetch_series(
                session, cg_id, t, start_ts, end_ts, max_retries, backoff_secs, jitter_secs
            )
            _write_cache(cache_dir, "coingecko", t, s, start, end)
        else:
            logging.info(f"Loaded {t} from CoinGecko cache.")
        series[t] = s
    prices = pd.concat(series.values(), axis=1)
    prices = prices.loc[(prices.index >= pd.to_datetime(start)) & (prices.index <= pd.to_datetime(end))]
    return prices.dropna(how="all").sort_index()

def _binance_base_url() -> str:
    return os.getenv("BINANCE_BASE_URL", "https://api.binance.com").rstrip('/')

def _binance_fetch_klines(
    session: "requests.Session",
    symbol: str,
    start_ms: int,
    end_ms: int,
    interval: str = "1d",
    limit: int = 1000,
    max_retries: int = 4,
    backoff_secs: float = 1.5,
    jitter_secs: float = 0.2,
) -> list[list]:
    url = f"{_binance_base_url()}/api/v3/klines"
    out = []
    cur = start_ms
    while cur < end_ms:
        params = {"symbol": symbol, "interval": interval, "startTime": cur, "endTime": end_ms, "limit": limit}
        attempt = 0
        while True:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 200:
                data = r.json()
                if not data:
                    return out
                out.extend(data)
                last_close = int(data[-1][6])
                if last_close <= cur:
                    return out
                cur = last_close + 1
                break
            if r.status_code in (418, 429):
                attempt += 1
                if attempt > max_retries:
                    raise RuntimeError(f"Binance rate limit for {symbol}: {r.status_code} {r.text[:160]}")
                sleep_s = backoff_secs * (2 ** (attempt - 1)) + np.random.uniform(0, jitter_secs)
                logging.warning(f"Binance rate limit hit for {symbol}, retrying in {sleep_s:.2f}s...")
                time.sleep(sleep_s)
                continue
            raise RuntimeError(f"Binance error for {symbol}: {r.status_code} {r.text[:160]}")
    return out

def load_prices_binance(
    tickers: List[str],
    start: str,
    end: str,
    cache_dir: Optional[str],
    cache_ttl_days: int,
    max_retries: int,
    backoff_secs: float,
    jitter_secs: float,
) -> pd.DataFrame:
    if requests is None:
        raise RuntimeError("requests is required for Binance provider. Install it or use coingecko/csv.")
    session = requests.Session()
    start_ms = int(pd.Timestamp(start, tz="UTC").timestamp() * 1000)
    end_ms = int((pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)).timestamp() * 1000)
    series = {}
    for t in tickers:
        try:
            s = _read_cache(cache_dir, "binance", t, start, end, cache_ttl_days)
            if s is None:
                bsymbol = _symbol_to_binance(t)
                if not bsymbol:
                    logging.warning(f"Binance symbol mapping failed for {t}, skipping.")
                    continue
                kl = _binance_fetch_klines(session, bsymbol, start_ms, end_ms,
                                          max_retries=max_retries,
                                          backoff_secs=backoff_secs,
                                          jitter_secs=jitter_secs)
                if not kl:
                    logging.warning(f"No Binance klines for {t} ({bsymbol}), skipping.")
                    continue
                s = pd.Series({pd.to_datetime(k[0], unit="ms").normalize(): float(k[4]) for k in kl})
                s = s.groupby(level=0).last().sort_index().rename(t)
                _write_cache(cache_dir, "binance", t, s, start, end)
            else:
                logging.info(f"Loaded {t} from Binance cache.")
            series[t] = s
        except Exception as e:
            logging.warning(f"Binance error for {t}: {e}. Skipping this ticker.")
            continue
    if not series:
        raise RuntimeError("No tickers were successfully loaded from Binance.")
    prices = pd.concat(series.values(), axis=1)
    prices = prices.loc[(prices.index >= pd.to_datetime(start)) & (prices.index <= pd.to_datetime(end))]
    return prices.dropna(how="all").sort_index()

def load_prices_csv(tickers: List[str], csv_dir: str, start: str, end: str) -> pd.DataFrame:
    data = {}
    for t in tickers:
        path = os.path.join(csv_dir, f"{t}.csv")
        if not os.path.exists(path):
            raise RuntimeError(f"CSV not found for {t}: {path}")
        df = pd.read_csv(path)
        cols = {c.lower(): c for c in df.columns}
        date_key = None
        for k in ("date", "timestamp", "datetime"):
            if k in cols:
                date_key = cols[k]
                break
        if not date_key:
            raise RuntimeError(f"CSV for {t} must contain a Date/Timestamp column.")
        if "close" in cols:
            close_col = cols["close"]
            s = pd.Series(df[close_col].values, index=pd.to_datetime(df[date_key])).rename(t)
        else:
            cand = [c for c in df.columns if c != date_key and np.issubdtype(df[c].dtype, np.number)]
            if len(cand) != 1:
                raise RuntimeError(f"CSV for {t} must contain a Close column (or single numeric column).")
            s = pd.Series(df[cand[0]].values, index=pd.to_datetime(df[date_key])).rename(t)
        data[t] = s.sort_index()
    prices = pd.concat(data.values(), axis=1)
    mask = (prices.index >= pd.to_datetime(start)) & (prices.index <= pd.to_datetime(end))
    return prices.loc[mask].dropna(how="all").sort_index()

# (Resto de funciones idénticas a la versión anterior, como compute_features, make_model, walk_forward_predict, simple_regime_filter,
# _rolling_slope, compute_trend_strength, classify_strength, max_sharpe, backtest, portfolio_metrics, generate_detailed_report,
# Config, run, y tests...)

def parse_args() -> Config:
    p = argparse.ArgumentParser(description="ML‑driven crypto allocation")
    p.add_argument("--tickers", nargs="+", default=["BTC-USD", "ETH-USD", "SOL-USD", "HYPE-USD", "LINK-USD", "XRP-USD"], help="Crypto tickers (e.g. BTC-USD)")
    p.add_argument("--start", type=str, default="2019-01-01")
    p.add_argument("--end", type=str, default=pd.Timestamp.today().strftime("%Y-%m-%d"))
    p.add_argument("--cash_buffer", type=float, default=0.10)
    p.add_argument("--tc_bps", type=float, default=5.0)
    p.add_argument("--rebalance_w", type=int, default=1, help="Rebalance every N weeks (approx)")
    p.add_argument("--n_splits", type=int, default=5, help="TimeSeriesSplit folds")
    p.add_argument("--provider", type=str, default="auto", choices=["auto", "yfinance", "coingecko", "binance", "csv"], help="Price data provider")
    p.add_argument("--csv_dir", type=str, default=None, help="Directory with <TICKER>.csv files (for provider=csv)")
    p.add_argument("--id_override", type=str, default=None, help="Override CoinGecko ids, e.g. 'BTC=bitcoin,ETH=ethereum'")
    p.add_argument("--cache_dir", type=str, default=None, help="Directory to cache fetched prices per ticker")
    p.add_argument("--cache_ttl_days", type=int, default=3, help="Number of days to trust cached prices")
    p.add_argument("--coingecko_api_key", type=str, default=None, help="CoinGecko Pro API key (or set COINGECKO_API_KEY env)")
    p.add_argument("--coingecko_max_retries", type=int, default=4, help="Max retries for CoinGecko requests")
    p.add_argument("--coingecko_backoff_secs", type=float, default=2.0, help="Initial backoff seconds for CoinGecko retries")
    p.add_argument("--coingecko_jitter_secs", type=float, default=0.25, help="Random jitter added to backoff (seconds)")
    p.add_argument("--binance_max_retries", type=int, default=4, help="Max retries for Binance requests")
    p.add_argument("--binance_backoff_secs", type=float, default=1.5, help="Initial backoff seconds for Binance retries")
    p.add_argument("--binance_jitter_secs", type=float, default=0.2, help="Random jitter added to Binance backoff (seconds)")
    p.add_argument("--run_tests", action="store_true", help="Run built‑in fast tests and exit")
    args = p.parse_args()
    return Config(
        tickers=args.tickers,
        start=args.start,
        end=args.end,
        cash_buffer=args.cash_buffer,
        tc_bps=args.tc_bps,
        rebalance_w=args.rebalance_w,
        n_splits=args.n_splits,
        provider=args.provider,
        csv_dir=args.csv_dir,
        id_override=args.id_override,
        cache_dir=args.cache_dir,
        cache_ttl_days=args.cache_ttl_days,
        coingecko_api_key=args.coingecko_api_key,
        coingecko_max_retries=args.coingecko_max_retries,
        coingecko_backoff_secs=args.coingecko_backoff_secs,
        coingecko_jitter_secs=args.coingecko_jitter_secs,
        binance_max_retries=args.binance_max_retries,
        binance_backoff_secs=args.binance_backoff_secs,
        binance_jitter_secs=args.binance_jitter_secs,
        run_tests=args.run_tests,
    )

if __name__ == "__main__":
    cfg = parse_args()
    if cfg.run_tests:
        _run_tests()
    else:
        run(cfg)
