# CLAUDE.md — Cripto Project Guide

This file provides context for AI assistants working on the Cripto codebase.

## Project Overview

**Cripto** is an ML-driven cryptocurrency portfolio allocation and optimization tool. It uses ensemble machine learning models, Modern Portfolio Theory (MPT), and a risk overlay to produce time-series-validated portfolio weights for a configurable set of cryptocurrencies.

Full description: "Crypto Allocation with ML & Risk Overlay (Enhanced)"

## Unconventional File Structure

> **Critical:** The entire Python application lives in `README.md`, not in a `.py` file.

```
/home/user/Cripto/
├── README.md    ← The Python source code (478 lines)
└── CLAUDE.md    ← This file
```

The file starts with a markdown heading (`# Cripto`) and immediately transitions into Python code. It is executable as a Python script:

```bash
python README.md
```

This is intentional and should be preserved unless explicitly asked to refactor the file layout.

## Tech Stack

| Component | Library |
|-----------|---------|
| Data manipulation | `pandas`, `numpy` |
| Machine learning | `scikit-learn` |
| Portfolio optimization | `scipy.optimize.minimize` |
| Data fetching (optional) | `yfinance`, `requests` |

**Required:** `numpy`, `pandas`, `scikit-learn`, `scipy`
**Optional:** `yfinance` (Yahoo Finance), `requests` (CoinGecko / Binance APIs)

Both optional dependencies are imported with graceful fallbacks:
```python
try:
    import yfinance
except ImportError:
    yfinance = None
```

## Running the Project

### Basic usage (auto provider)
```bash
python README.md
```

### With specific provider
```bash
python README.md --provider coingecko --cache_dir ./cache
python README.md --provider binance --cache_dir ./cache
python README.md --provider yfinance
python README.md --provider csv --csv_dir ./data
```

### Run built-in tests
```bash
python README.md --run_tests
```

### Custom tickers and date range
```bash
python README.md --tickers BTC-USD ETH-USD SOL-USD --start 2021-01-01 --end 2024-12-31
```

## CLI Arguments Reference

| Argument | Default | Description |
|----------|---------|-------------|
| `--tickers` | `BTC-USD ETH-USD SOL-USD HYPE-USD LINK-USD XRP-USD` | Cryptocurrency tickers |
| `--start` | `2019-01-01` | Start date (YYYY-MM-DD) |
| `--end` | today | End date (YYYY-MM-DD) |
| `--cash_buffer` | `0.10` | Cash buffer fraction (10%) |
| `--tc_bps` | `5.0` | Transaction costs in basis points |
| `--rebalance_w` | `1` | Rebalance every N weeks |
| `--n_splits` | `5` | `TimeSeriesSplit` cross-validation folds |
| `--provider` | `auto` | Data provider: `auto\|yfinance\|coingecko\|binance\|csv` |
| `--csv_dir` | None | Directory with `<TICKER>.csv` files |
| `--id_override` | None | CoinGecko ID overrides, e.g. `'BTC=bitcoin,ETH=ethereum'` |
| `--cache_dir` | None | Directory to cache fetched price CSVs |
| `--cache_ttl_days` | `3` | Days before cached data expires |
| `--coingecko_api_key` | None | CoinGecko Pro API key (also: `COINGECKO_API_KEY` env var) |
| `--coingecko_max_retries` | `4` | Max retries for CoinGecko |
| `--coingecko_backoff_secs` | `2.0` | Initial backoff for CoinGecko rate limits |
| `--coingecko_jitter_secs` | `0.25` | Jitter for CoinGecko backoff |
| `--binance_max_retries` | `4` | Max retries for Binance |
| `--binance_backoff_secs` | `1.5` | Initial backoff for Binance rate limits |
| `--binance_jitter_secs` | `0.2` | Jitter for Binance backoff |
| `--run_tests` | `False` | Run built-in tests and exit |

## Architecture and Key Functions

### Entry Point

```python
if __name__ == "__main__":
    cfg = parse_args()
    if cfg.run_tests:
        _run_tests()
    else:
        run(cfg)
```

### Data Loading Pipeline

`load_prices()` is the main dispatcher with automatic provider fallback:

```
auto mode: yfinance → CoinGecko → Binance → CSV → RuntimeError
```

**Price loading functions:**
- `load_prices(tickers, start, end, provider, ...)` — main entry, handles provider selection and fallback
- `load_prices_yf(...)` — Yahoo Finance via `yfinance.download()`
- `load_prices_coingecko(...)` — CoinGecko REST API with chunked 90-day requests
- `load_prices_binance(...)` — Binance klines API with pagination
- `load_prices_csv(tickers, csv_dir, start, end)` — CSV fallback (expects `<TICKER>.csv` files)

All loaders return a `pd.DataFrame` with DatetimeIndex and ticker columns containing daily close prices.

### Caching System

**Cache functions:**
- `_cache_path(cache_dir, provider, ticker, start, end)` — generates path: `{cache_dir}/{provider}_{ticker}_{start}_{end}.csv`
- `_read_cache(...)` — reads cache if exists and within TTL; returns `pd.Series` or `None`
- `_write_cache(...)` — writes `pd.Series` as CSV with `Date` and `Close` columns

Cache is file-based CSV. Each (provider, ticker, date range) combination gets its own file. TTL is checked against file modification time.

### Symbol Conversion

- `_symbol_to_binance(symbol)` — converts `BTC-USD` → `BTCUSDT`
- `_symbol_to_cg_id(symbol, override)` — converts `BTC-USD` → `bitcoin` using `_DEFAULT_ID_MAP` or overrides
- `_parse_id_override(s)` — parses `'BTC=bitcoin,ETH=ethereum'` string into dict

### API Utilities

- `_cg_session(api_key)` — creates `requests.Session` with CoinGecko headers; adds Pro API key header if provided
- `_coingecko_fetch_series(...)` — fetches price series in 90-day chunks with retry/backoff
- `_binance_base_url()` — returns base URL from `BINANCE_BASE_URL` env var or default
- `_binance_fetch_klines(...)` — fetches kline data with pagination and retry/backoff

### Functions Referenced but Truncated in README

The comment at line 423 notes these functions exist but are not shown:
- `compute_features()` — feature engineering
- `make_model()` — constructs ML ensemble model
- `walk_forward_predict()` — walk-forward time series prediction
- `simple_regime_filter()` — market regime detection
- `_rolling_slope()` — rolling linear regression slope
- `compute_trend_strength()` — trend analysis
- `classify_strength()` — strength classification
- `max_sharpe()` — Sharpe ratio maximization (scipy optimizer)
- `backtest()` — backtesting engine
- `portfolio_metrics()` — performance metrics calculation
- `generate_detailed_report()` — reporting and output
- `Config` — dataclass holding all configuration
- `run(cfg)` — main execution pipeline
- `_run_tests()` — built-in test runner

## Code Conventions

### Naming

- **Private/internal functions:** prefixed with `_` (e.g., `_cache_path`, `_cg_session`, `_binance_base_url`)
- **Constants:** `ALL_CAPS` with underscore (e.g., `_DEFAULT_ID_MAP`, `essential_usdt`)
- **Functions:** `snake_case`
- **Type hints:** used throughout with `Optional`, `List`, `Dict`, `Tuple` from `typing`

### Error Handling

- Use `try/except Exception` blocks for graceful provider fallback
- Log warnings with `logging.warning(f"[WARN] ...")` for non-fatal failures
- Raise `RuntimeError` with clear messages for fatal errors
- Skip individual failing tickers with a warning (Binance provider) rather than aborting all

### Retry / Rate Limiting

Exponential backoff with jitter:
```python
sleep_s = backoff_secs * (2 ** (attempt - 1)) + np.random.uniform(0, jitter_secs)
```

- CoinGecko: handles HTTP 401, 403, 429
- Binance: handles HTTP 418, 429

### Logging

```python
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
```

Use `logging.info()` for normal operations, `logging.warning()` for recoverable issues.

### String Formatting

Use f-strings consistently (not `%` or `.format()`).

### Data Conventions

- Date index: `pd.DatetimeIndex`, normalized to midnight UTC
- Price DataFrames: rows = dates, columns = tickers (strings like `"BTC-USD"`)
- Ticker format: `BASE-QUOTE` (e.g., `BTC-USD`, `ETH-USD`)

## Default Asset Universe

The default ticker set (6 assets):
```
BTC-USD  (Bitcoin)
ETH-USD  (Ethereum)
SOL-USD  (Solana)
HYPE-USD (Hyperverse)
LINK-USD (Chainlink)
XRP-USD  (Ripple/XRP)
```

CoinGecko ID map (`_DEFAULT_ID_MAP`) covers a broader set:
`btc`, `eth`, `sol`, `ada`, `bnb`, `xrp`, `dot`, `matic`, `avax`, `ltc`, `doge`, `link`, `hype`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `COINGECKO_API_KEY` | CoinGecko Pro API key (alternative to `--coingecko_api_key`) |
| `BINANCE_BASE_URL` | Override Binance base URL (default: `https://api.binance.com`) |

## CSV File Format

For `--provider csv`, place files at `{csv_dir}/{TICKER}.csv`. Required columns:
- A date column named `Date`, `Timestamp`, or `Datetime` (case-insensitive)
- A `Close` column (case-insensitive), OR a single numeric column

## Git Workflow

**Active branch:** `claude/add-claude-documentation-2UZb3`

```bash
git checkout claude/add-claude-documentation-2UZb3
git push -u origin claude/add-claude-documentation-2UZb3
```

Remote: `http://local_proxy@127.0.0.1:24368/git/victorvecino111/Cripto`

## Development Notes

- There is **no CI/CD pipeline** and **no test framework** beyond the built-in `_run_tests()` function.
- There is **no `requirements.txt`**, `setup.py`, or `pyproject.toml`. Dependencies must be installed manually.
- The project is a **standalone script** — no package structure, no modules, no imports from within the repo.
- Code comments within README include Spanish (project originated in Spanish-language context). Both Spanish and English comments are acceptable.
- The truncated section at line 423 (`# (Resto de funciones idénticas a la versión anterior...)`) is a placeholder comment — the actual ML, backtesting, and reporting functions are not present in the current file and would need to be added for the script to run end-to-end.

## Installing Dependencies

```bash
pip install numpy pandas scikit-learn scipy

# Optional providers:
pip install yfinance        # Yahoo Finance
pip install requests        # CoinGecko and Binance APIs
```
