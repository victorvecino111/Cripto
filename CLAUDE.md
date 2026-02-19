# CLAUDE.md — AI Assistant Reference for Cripto

## Project Overview

**Cripto** is a Python-based ML-driven cryptocurrency portfolio allocation system (TPI model). It fetches historical OHLCV price data from multiple providers, applies machine-learning models and risk overlays to compute portfolio weights, runs a backtest, and generates a detailed performance report.

The project is currently **partially implemented**. The data-fetching layer is complete, but the ML, optimization, backtesting, and reporting components are stubs that still need to be written.

---

## Repository Structure

```
/home/user/Cripto/
├── README.md      # Contains the source code (478 lines of Python)
├── CLAUDE.md      # This file
└── .git/
```

> **Note:** All application code lives inside `README.md`. There are no separate `.py` source files, no `requirements.txt`, no `setup.py`, and no CI/CD configuration. When adding new code, continue placing it in `README.md` unless the user explicitly requests a refactor into proper Python modules.

---

## Technology Stack

| Category | Libraries |
|---|---|
| Language | Python 3.9+ |
| Data | `pandas`, `numpy` |
| ML | `scikit-learn` (`RandomForestRegressor`, `StackingRegressor`, `LinearRegression`, `TimeSeriesSplit`, `Pipeline`, `StandardScaler`, `LedoitWolf`) |
| Optimization | `scipy.optimize.minimize` |
| Price data (optional) | `yfinance`, `requests` |
| CLI | `argparse` |
| Logging | `logging` (stdlib) |

Both `yfinance` and `requests` are imported with `try/except`, so the code gracefully degrades if they are not installed.

---

## Key Conventions

### Python Style
- **f-strings** everywhere — no `%`-format or `.format()`.
- **Type hints** on all function signatures (`Dict`, `List`, `Optional`, `Tuple` from `typing`; `list[...]` inline for Python 3.9+).
- **`@dataclass`** for configuration — the `Config` dataclass holds all runtime parameters.
- **Logging** via `logging.info/warning/error` — never `print()` for operational messages.
- Log format: `%(asctime)s %(levelname)s: %(message)s`
- Module-level docstring at the top of the file describes enhancements and scope.

### Naming
- Private/internal helpers are prefixed with `_` (e.g., `_read_cache`, `_cg_session`, `_binance_fetch_klines`).
- Provider-specific loaders follow the pattern `load_prices_<provider>`.
- Crypto symbol lookups use lower-case keys internally.

### Error Handling
- Use `raise RuntimeError(...)` with descriptive messages for provider failures, missing data, and config errors.
- Retry loops use exponential backoff with jitter: `sleep = backoff * 2^(attempt-1) + uniform(0, jitter)`.
- Log a `WARNING` before each retry so the user can see what is happening.

---

## Architecture

### Data Flow (implemented)

```
CLI args / Config
      │
      ▼
load_prices()          ← dispatcher, selects provider
      │
      ├── load_prices_yf()        ← Yahoo Finance via yfinance
      ├── load_prices_coingecko() ← CoinGecko REST API (chunked, 90-day windows)
      ├── load_prices_binance()   ← Binance REST API (klines, paginated)
      └── load_prices_csv()       ← Local CSV files (offline fallback)
            │
            ▼
      pd.DataFrame (dates × tickers, Close prices)
            │
            ▼
      [cache read/write via _read_cache / _write_cache]
```

**Auto-provider fallback order:** yfinance → CoinGecko → Binance → CSV

### ML & Portfolio Pipeline (stub — not yet implemented)

The comment at `README.md:423-425` marks where the following functions belong:

| Function | Purpose |
|---|---|
| `compute_features(prices)` | Build ML feature matrix from price series |
| `make_model()` | Construct `StackingRegressor` pipeline |
| `walk_forward_predict(prices, features, cfg)` | Rolling TimeSeriesSplit training and prediction |
| `simple_regime_filter(...)` | Suppress positions in adverse market regimes |
| `_rolling_slope(series, window)` | Linear regression slope over rolling window |
| `compute_trend_strength(prices)` | Summarise directional momentum |
| `classify_strength(score)` | Discretise trend score to label |
| `max_sharpe(returns, cov)` | Mean–variance optimisation (SciPy minimize) |
| `backtest(weights, prices, cfg)` | Simulate rebalanced portfolio over history |
| `portfolio_metrics(returns)` | Sharpe, Sortino, max drawdown, CAGR |
| `generate_detailed_report(...)` | Print/save full analysis |
| `Config` | `@dataclass` holding all CLI-mapped parameters |
| `run(cfg)` | Orchestrates the full pipeline |
| `_run_tests()` | Built-in fast sanity tests (invoked by `--run_tests`) |

When implementing these, insert them between `README.md:425` and `README.md:427` (before `parse_args`).

---

## CLI Reference

The script is invoked as:

```bash
python README.md [OPTIONS]
```

### Key Arguments

| Argument | Default | Description |
|---|---|---|
| `--tickers` | `BTC-USD ETH-USD SOL-USD HYPE-USD LINK-USD XRP-USD` | Space-separated tickers |
| `--start` | `2019-01-01` | History start date (YYYY-MM-DD) |
| `--end` | Today | History end date |
| `--provider` | `auto` | `auto` \| `yfinance` \| `coingecko` \| `binance` \| `csv` |
| `--csv_dir` | None | Directory with `<TICKER>.csv` files |
| `--cache_dir` | None | Directory for price cache files |
| `--cache_ttl_days` | `3` | Days before cached prices expire |
| `--id_override` | None | CoinGecko ID overrides, e.g. `BTC=bitcoin,ETH=ethereum` |
| `--coingecko_api_key` | None | Pro API key (or set `COINGECKO_API_KEY` env var) |
| `--cash_buffer` | `0.10` | Fraction of portfolio kept as cash (10%) |
| `--tc_bps` | `5.0` | Transaction costs in basis points per rebalance |
| `--rebalance_w` | `1` | Rebalance every N weeks |
| `--n_splits` | `5` | TimeSeriesSplit cross-validation folds |
| `--run_tests` | flag | Run built-in tests and exit |

### Ticker Format

- Yahoo Finance: `BTC-USD`, `ETH-USD`
- CoinGecko: mapped via `_DEFAULT_ID_MAP` or `--id_override`
- Binance: auto-converted (e.g. `BTC-USD` → `BTCUSDT`)

---

## Data Provider Details

### CoinGecko
- Endpoint: `GET /api/v3/coins/{id}/market_chart/range`
- Fetched in **90-day chunks** to avoid API limits.
- Rate-limit HTTP codes handled: `401`, `403`, `429`.
- Pro API key supported via header `x-cg-pro-api-key`.

### Binance
- Endpoint: `GET /api/v3/klines` (1-day candles, `Close` = index 4).
- Paginated via `startTime`/`endTime`; up to 1000 candles per request.
- Rate-limit HTTP codes handled: `418`, `429`.
- Base URL overridable via `BINANCE_BASE_URL` environment variable.

### Cache
- Files stored as `{provider}_{ticker}_{start}_{end}.csv` in `--cache_dir`.
- Cache is invalidated after `--cache_ttl_days` days (mtime-based).
- CSV format: columns `Date`, `Close`.

---

## Cryptocurrency ID Mapping

The `_DEFAULT_ID_MAP` dict maps lowercase base symbols to CoinGecko IDs:

```python
btc → bitcoin     eth → ethereum    sol → solana
ada → cardano     bnb → binancecoin xrp → ripple
dot → polkadot   matic → matic-network  avax → avalanche-2
ltc → litecoin   doge → dogecoin   link → chainlink
hype → hyperverse
```

To override any mapping at runtime use `--id_override BTC=bitcoin,HYPE=hyperliquid`.

---

## Development Workflow

Since there is no build system, the workflow is straightforward:

1. **Edit** `README.md` directly.
2. **Run** with `python README.md --run_tests` to execute built-in tests (once implemented).
3. **Run** a full pipeline with `python README.md --provider auto`.
4. **Commit** with descriptive messages.
5. **Push** to the active feature branch.

### Installing Dependencies (manual)

```bash
pip install numpy pandas scikit-learn scipy yfinance requests
```

There is no `requirements.txt`; create one if the project grows beyond a single file.

---

## Known Incomplete Sections

| Location | Missing |
|---|---|
| `README.md:423-425` | All ML, optimization, backtest, and reporting functions (see stub comment) |
| `parse_args` → `Config(...)` | `Config` dataclass is referenced but not defined yet |
| `if __name__ == "__main__"` | `_run_tests()` and `run()` are called but not defined |

Any implementation added must be inserted **before** the `parse_args` function at line 427 so the script remains executable.

---

## Git Information

- **Remote:** `http://local_proxy@127.0.0.1:20054/git/victorvecino111/Cripto`
- **Primary branch:** `master` / `main`
- **Active feature branch:** `claude/add-claude-documentation-4ZqiL`
- **Commit history:** 2 commits (Initial commit + README update, both 2025-08-29)
- **Author:** victorvecino111
