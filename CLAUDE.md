# CLAUDE.md - AI Assistant Guide for Cripto

## Project Overview

**Cripto** is a Python-based cryptocurrency portfolio allocation system using machine learning and risk overlays. It implements an ML-driven strategy (referred to as "TPI model") for optimizing crypto portfolio allocations across BTC, ETH, SOL, HYPE, LINK, and XRP.

**Status:** Work-in-progress. The data fetching layer is implemented; core ML/backtest functions are referenced but not yet implemented (see "Incomplete Sections" below).

## Repository Structure

```
Cripto/
├── README.md      # Main source file (Python code, ~478 lines)
├── CLAUDE.md      # This file
└── .git/
```

**Important:** `README.md` is the primary Python source file, not documentation. It contains all application code.

## Language & Runtime

- **Python 3.7+** (uses `from __future__ import annotations`)
- Type hints throughout (`typing.Dict`, `typing.List`, `typing.Optional`, `typing.Tuple`)
- f-strings for string formatting

## Dependencies

No `requirements.txt` or `pyproject.toml` exists. Dependencies must be installed manually:

**Required:**
- `numpy`, `pandas` — data manipulation
- `scikit-learn` — ML models (`RandomForestRegressor`, `StackingRegressor`, `LedoitWolf`, `Pipeline`, etc.)
- `scipy` — optimization (`scipy.optimize.minimize`)

**Optional (with graceful fallback):**
- `yfinance` — Yahoo Finance data provider
- `requests` — HTTP client for CoinGecko and Binance APIs

## Architecture

### Data Provider Pattern

The system uses a strategy pattern for price data with automatic fallback:

1. **Yahoo Finance** (`yfinance`) — preferred when available
2. **CoinGecko API** — REST API with chunked requests (90-day windows)
3. **Binance API** — REST API with paginated klines
4. **CSV files** — offline fallback from local directory

Entry point: `load_prices()` with `provider="auto"` tries each in order.

### Caching Layer

- File-based CSV caching with configurable TTL (default: 3 days)
- Cache path format: `{provider}_{ticker}_{start}_{end}.csv`
- Flexible column detection (handles Date/Timestamp/Datetime headers)

### API Resilience

- Exponential backoff with jitter on rate-limit errors (429, 418, 401, 403)
- Configurable retry counts and backoff parameters per provider
- Graceful degradation: skips individual tickers on failure, continues with rest

### Symbol Mapping

- `_DEFAULT_ID_MAP` maps base symbols to CoinGecko IDs (e.g., `btc` -> `bitcoin`)
- `_symbol_to_binance()` converts ticker format (e.g., `BTC-USD` -> `BTCUSDT`)
- User-overridable via `--id_override` CLI flag

## CLI Usage

```bash
python README.md --tickers BTC-USD ETH-USD SOL-USD --start 2019-01-01 --provider auto
python README.md --run_tests
```

Key arguments:
- `--tickers` — crypto tickers (default: BTC-USD, ETH-USD, SOL-USD, HYPE-USD, LINK-USD, XRP-USD)
- `--provider` — data source: auto, yfinance, coingecko, binance, csv
- `--cache_dir` / `--cache_ttl_days` — caching config
- `--coingecko_api_key` — or set `COINGECKO_API_KEY` env var
- `--run_tests` — run built-in tests and exit

## Environment Variables

- `COINGECKO_API_KEY` — CoinGecko Pro API key
- `BINANCE_BASE_URL` — override default Binance API endpoint

## Code Conventions

- **Private functions:** `_leading_underscore` (e.g., `_cache_path`, `_parse_id_override`)
- **Public functions:** no underscore prefix (e.g., `load_prices`, `parse_args`)
- **Variables:** `snake_case`
- **Constants:** `UPPER_SNAKE_CASE` with leading underscore for module-private (e.g., `_DEFAULT_ID_MAP`)
- **Logging:** `logging.basicConfig` with INFO level; used for cache hits and rate-limit warnings
- **Error handling:** `RuntimeError` for recoverable failures; `ValueError` for input validation
- **Documentation language:** Spanish in module docstring, English in code comments and CLI help

## Incomplete Sections (Not Yet Implemented)

The following are referenced at line 423-425 but missing from the codebase:

- `compute_features()` — feature engineering for ML
- `make_model()` — ML model construction
- `walk_forward_predict()` — walk-forward prediction
- `simple_regime_filter()` — market regime detection
- `_rolling_slope()` / `compute_trend_strength()` / `classify_strength()` — trend analysis
- `max_sharpe()` — Sharpe ratio optimization
- `backtest()` — backtesting engine
- `portfolio_metrics()` — performance metrics
- `generate_detailed_report()` — reporting
- `Config` dataclass — configuration container (referenced by `parse_args()` but not defined)
- `run()` — main execution function
- `_run_tests()` — test suite

## Build & Test

- **No build system** — run directly with `python README.md`
- **No CI/CD** configured
- **No test framework** configured (built-in `--run_tests` flag exists but implementation is missing)
- **No linter/formatter** configured

## Git Workflow

- Default branch: `main`
- Commit messages: short imperative descriptions
- No branch protection or PR requirements configured

## Key Considerations for AI Assistants

1. The main source is `README.md` — be careful not to treat it as documentation or overwrite it with actual README content.
2. The `Config` dataclass is used in `parse_args()` but not defined — any new code must either define it or account for this.
3. When implementing missing functions, maintain the existing patterns: type hints, snake_case naming, logging for warnings, RuntimeError for failures.
4. The sklearn imports at the top are unused until the ML functions are implemented — do not remove them.
5. Optional dependencies (`yfinance`, `requests`) use try/except import guards — follow this pattern for any new optional deps.
