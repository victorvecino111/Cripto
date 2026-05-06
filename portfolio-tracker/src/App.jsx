import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Wallet, Landmark, Bitcoin, LineChart, Building2, Plus, Trash2, Edit2, RefreshCw, X, Save, Eye, EyeOff, PieChart as PieIcon, Activity, AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart as ReLineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const CATEGORIES = {
  cash: { label: 'Cash', icon: Wallet, color: '#10b981' },
  bank: { label: 'Cuentas bancarias', icon: Landmark, color: '#3b82f6' },
  crypto: { label: 'Criptomonedas', icon: Bitcoin, color: '#f59e0b' },
  stocks: { label: 'Acciones cotizadas', icon: LineChart, color: '#8b5cf6' },
  private: { label: 'Empresas privadas', icon: Building2, color: '#ec4899' },
};

const FIAT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
const FX_FALLBACK = { EUR: 1, USD: 1.08, GBP: 0.85, CHF: 0.95, JPY: 165, CAD: 1.48, AUD: 1.65 };

// ===== Helpers de localStorage =====
const storage = {
  get: (key) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const fmtEUR = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const fmtEURprecise = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const fmtPct = (n) => `${n >= 0 ? '+' : ''}${(n || 0).toFixed(2)}%`;
const fmtNum = (n, d = 2) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(n || 0);

export default function App() {
  const [positions, setPositions] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [fxRates, setFxRates] = useState(FX_FALLBACK);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showValues, setShowValues] = useState(true);
  const [activeView, setActiveView] = useState('dashboard');
  const [activeCategory, setActiveCategory] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const log = (msg, type = 'info') => {
    setLogs((l) => [...l.slice(-29), { time: new Date().toLocaleTimeString('es-ES'), msg, type }]);
  };

  // ===== Carga inicial =====
  useEffect(() => {
    const p = storage.get('positions');
    if (p) setPositions(p);
    const s = storage.get('snapshots');
    if (s) setSnapshots(s);
    const cached = storage.get('prices');
    if (cached) {
      setPrices(cached.prices || {});
      setFxRates(cached.fxRates || FX_FALLBACK);
      if (cached.lastUpdate) setLastUpdate(new Date(cached.lastUpdate));
    }
    setLoading(false);
  }, []);

  const savePositions = (next) => {
    setPositions(next);
    storage.set('positions', next);
  };

  const saveSnapshots = (next) => {
    setSnapshots(next);
    storage.set('snapshots', next);
  };

  const savePrices = (newPrices, newFx, when) => {
    storage.set('prices', { prices: newPrices, fxRates: newFx, lastUpdate: when?.toISOString() });
  };

  // ===== Refresh vía backend =====
  const refreshPrices = async () => {
    setRefreshing(true);
    setRefreshError(null);
    log('Iniciando actualización vía backend...');

    const cryptoSymbols = [...new Set(positions.filter((p) => p.category === 'crypto' && p.symbol).map((p) => p.symbol.toUpperCase()))];
    const stockTickers = [...new Set(positions.filter((p) => p.category === 'stocks' && p.symbol).map((p) => p.symbol.toUpperCase()))];
    const fxNeeded = [...new Set(positions.filter((p) => p.currency && p.currency !== 'EUR').map((p) => p.currency))];

    if (cryptoSymbols.length === 0 && stockTickers.length === 0 && fxNeeded.length === 0) {
      log('No hay activos con precio para actualizar', 'warn');
      setRefreshing(false);
      return;
    }

    log(`Buscando: ${cryptoSymbols.length} cripto, ${stockTickers.length} acciones, ${fxNeeded.length} divisas`);

    try {
      const response = await fetch('/api/refresh-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cryptoSymbols, stockTickers, fxNeeded }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const parsed = await response.json();
      const newPrices = { ...prices };
      const newFx = { EUR: 1, ...FX_FALLBACK, ...fxRates };

      if (parsed.fx) {
        Object.entries(parsed.fx).forEach(([curr, rate]) => {
          if (typeof rate === 'number' && rate > 0) {
            newFx[curr] = rate;
            log(`✓ FX ${curr}: ${rate}`, 'ok');
          }
        });
      }

      if (parsed.crypto) {
        Object.entries(parsed.crypto).forEach(([sym, price]) => {
          if (typeof price === 'number' && price > 0) {
            newPrices[`crypto_${sym.toUpperCase()}`] = { price, currency: 'EUR' };
            log(`✓ ${sym}: ${fmtEURprecise(price)}`, 'ok');
          }
        });
      }

      if (parsed.stocks) {
        Object.entries(parsed.stocks).forEach(([ticker, info]) => {
          if (info?.price && typeof info.price === 'number' && info.price > 0) {
            newPrices[`stock_${ticker.toUpperCase()}`] = {
              price: info.price,
              currency: info.currency || 'USD',
            };
            log(`✓ ${ticker}: ${info.price} ${info.currency || 'USD'}`, 'ok');
          }
        });
      }

      cryptoSymbols.forEach((s) => {
        if (!parsed.crypto?.[s]) log(`✗ ${s}: no encontrado`, 'warn');
      });
      stockTickers.forEach((t) => {
        if (!parsed.stocks?.[t]) log(`✗ ${t}: no encontrado`, 'warn');
      });

      const now = new Date();
      setPrices(newPrices);
      setFxRates(newFx);
      setLastUpdate(now);
      savePrices(newPrices, newFx, now);
      log('Actualización completada', 'ok');
    } catch (e) {
      log(`✗ Error: ${e.message}`, 'warn');
      setRefreshError(`No se pudieron actualizar los precios: ${e.message}. Comprueba que el backend está corriendo y la API key es válida.`);
    }

    setRefreshing(false);
  };

  // ===== Cálculos =====
  const enrichedPositions = useMemo(() => {
    return positions.map((p) => {
      let currentPriceEUR = 0;
      let currentValueEUR = 0;
      let priceSource = 'none';

      if (p.category === 'crypto') {
        const priceData = prices[`crypto_${p.symbol?.toUpperCase()}`];
        if (priceData?.price > 0) {
          currentPriceEUR = priceData.price;
          priceSource = 'auto';
        } else if (p.manualPrice > 0) {
          currentPriceEUR = p.manualPrice;
          priceSource = 'manual';
        }
        currentValueEUR = currentPriceEUR * (p.quantity || 0);
      } else if (p.category === 'stocks') {
        const priceData = prices[`stock_${p.symbol?.toUpperCase()}`];
        if (priceData?.price > 0) {
          const fxRate = fxRates[priceData.currency] || FX_FALLBACK[priceData.currency] || 1;
          currentPriceEUR = priceData.price / fxRate;
          priceSource = 'auto';
        } else if (p.manualPrice > 0) {
          currentPriceEUR = p.manualPrice;
          priceSource = 'manual';
        }
        currentValueEUR = currentPriceEUR * (p.quantity || 0);
      } else {
        const fxRate = fxRates[p.currency] || FX_FALLBACK[p.currency] || 1;
        currentValueEUR = (p.amount || 0) / fxRate;
        priceSource = p.currency === 'EUR' ? 'native' : 'fx';
      }

      const costEUR = p.costBasisEUR || 0;
      const pnlEUR = currentValueEUR - costEUR;
      const pnlPct = costEUR > 0 ? (pnlEUR / costEUR) * 100 : 0;

      return { ...p, currentPriceEUR, currentValueEUR, pnlEUR, pnlPct, priceSource };
    });
  }, [positions, prices, fxRates]);

  const totals = useMemo(() => {
    const total = enrichedPositions.reduce((s, p) => s + p.currentValueEUR, 0);
    const totalCost = enrichedPositions.reduce((s, p) => s + (p.costBasisEUR || 0), 0);
    const totalPnl = total - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const byCategory = Object.keys(CATEGORIES)
      .map((cat) => {
        const value = enrichedPositions.filter((p) => p.category === cat).reduce((s, p) => s + p.currentValueEUR, 0);
        return { category: cat, label: CATEGORIES[cat].label, value, color: CATEGORIES[cat].color, pct: total > 0 ? (value / total) * 100 : 0 };
      })
      .filter((c) => c.value > 0);
    return { total, totalCost, totalPnl, totalPnlPct, byCategory };
  }, [enrichedPositions]);

  const takeSnapshot = () => {
    const today = new Date().toISOString().split('T')[0];
    const filtered = snapshots.filter((s) => s.date !== today);
    const next = [
      ...filtered,
      {
        date: today,
        total: totals.total,
        byCategory: totals.byCategory.reduce((acc, c) => ({ ...acc, [c.category]: c.value }), {}),
      },
    ].sort((a, b) => a.date.localeCompare(b.date));
    saveSnapshots(next);
  };

  useEffect(() => {
    if (!loading && totals.total > 0) {
      const today = new Date().toISOString().split('T')[0];
      const hasToday = snapshots.some((s) => s.date === today);
      if (!hasToday) takeSnapshot();
    }
    // eslint-disable-next-line
  }, [loading, totals.total]);

  const openModal = (category, position = null) => {
    setEditing(position ? { ...position } : { category, id: `${Date.now()}_${Math.random()}`, currency: 'EUR' });
    setModalOpen(true);
  };

  const savePosition = () => {
    if (!editing) return;
    const exists = positions.find((p) => p.id === editing.id);
    const next = exists ? positions.map((p) => (p.id === editing.id ? editing : p)) : [...positions, editing];
    savePositions(next);
    setModalOpen(false);
    setEditing(null);
  };

  const deletePosition = (id) => {
    if (!confirm('¿Eliminar esta posición?')) return;
    savePositions(positions.filter((p) => p.id !== id));
  };

  const issues = enrichedPositions.filter((p) => {
    if (p.category === 'crypto' || p.category === 'stocks') {
      return p.currentValueEUR === 0 && p.quantity > 0;
    }
    return false;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Cargando…</div>
      </div>
    );
  }

  const filteredPositions = activeCategory === 'all' ? enrichedPositions : enrichedPositions.filter((p) => p.category === activeCategory);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Portfolio Tracker</h1>
              <p className="text-xs text-slate-500">{lastUpdate ? `Precios: ${lastUpdate.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Sin precios cargados'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDebug(!showDebug)} className={`p-2 rounded-lg transition ${showDebug ? 'bg-slate-800 text-emerald-400' : 'hover:bg-slate-800 text-slate-400'}`} title="Diagnóstico">
              <Info className="w-4 h-4" />
            </button>
            <button onClick={() => setShowValues(!showValues)} className="p-2 hover:bg-slate-800 rounded-lg transition" title={showValues ? 'Ocultar' : 'Mostrar'}>
              {showValues ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button onClick={refreshPrices} disabled={refreshing} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition flex items-center gap-1.5" title="Actualizar precios">
              {refreshing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span className="hidden sm:inline">{refreshing ? 'Buscando…' : 'Actualizar precios'}</span>
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 -mb-px overflow-x-auto">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: PieIcon },
            { id: 'positions', label: 'Posiciones', icon: LineChart },
            { id: 'history', label: 'Histórico', icon: Activity },
          ].map((t) => (
            <button key={t.id} onClick={() => setActiveView(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-2 ${activeView === t.id ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {refreshError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div className="bg-red-900/20 border border-red-800/50 text-red-200 px-4 py-3 rounded-lg text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium mb-0.5">Error actualizando precios</p>
              <p className="text-red-300/80 text-xs">{refreshError}</p>
            </div>
            <button onClick={() => setRefreshError(null)} className="text-red-300 hover:text-red-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {issues.length > 0 && !refreshError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div className="bg-amber-900/20 border border-amber-800/50 text-amber-200 px-4 py-3 rounded-lg text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium mb-1">{issues.length} {issues.length === 1 ? 'posición sin precio' : 'posiciones sin precio'}</p>
              <p className="text-amber-300/80 text-xs">
                Sin precio para: <strong>{issues.map((p) => p.symbol).join(', ')}</strong>. Pulsa "Actualizar precios" o edita la posición y añade un <strong>precio manual en EUR</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {showDebug && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Info className="w-4 h-4" />Diagnóstico</h3>
              <button onClick={() => setLogs([])} className="text-xs text-slate-400 hover:text-slate-200">Limpiar logs</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
              <div className="bg-slate-800/50 px-2.5 py-1.5 rounded flex items-center justify-between">
                <span className="text-slate-400">USD/EUR</span>
                <span className="text-slate-200">{fxRates.USD?.toFixed(4) || '—'}</span>
              </div>
              <div className="bg-slate-800/50 px-2.5 py-1.5 rounded flex items-center justify-between">
                <span className="text-slate-400">Posiciones</span>
                <span className="text-slate-200">{positions.length}</span>
              </div>
              <div className="bg-slate-800/50 px-2.5 py-1.5 rounded flex items-center justify-between">
                <span className="text-slate-400">Precios cargados</span>
                <span className="text-slate-200">{Object.keys(prices).length}</span>
              </div>
              <div className="bg-slate-800/50 px-2.5 py-1.5 rounded flex items-center justify-between">
                <span className="text-slate-400">Última act.</span>
                <span className="text-slate-200">{lastUpdate ? lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
            </div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-56 overflow-y-auto font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <p className="text-slate-600">Sin eventos. Pulsa "Actualizar precios".</p>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={l.type === 'ok' ? 'text-emerald-400' : l.type === 'warn' ? 'text-amber-400' : 'text-slate-400'}>
                    <span className="text-slate-600">{l.time}</span> {l.msg}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeView === 'dashboard' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-6 sm:p-8">
              <p className="text-slate-400 text-sm mb-2">Patrimonio total</p>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">{showValues ? fmtEUR(totals.total) : '••••••'}</h2>
              <div className="flex items-center gap-4 flex-wrap">
                <div className={`flex items-center gap-1.5 ${totals.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totals.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span className="font-semibold">{showValues ? fmtEUR(totals.totalPnl) : '••••'}</span>
                  <span className="text-sm">({fmtPct(totals.totalPnlPct)})</span>
                </div>
                <span className="text-slate-500 text-sm">desde coste de adquisición</span>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {Object.entries(CATEGORIES).map(([key, cat]) => {
                const catData = totals.byCategory.find((c) => c.category === key);
                const value = catData?.value || 0;
                const pct = catData?.pct || 0;
                const Icon = cat.icon;
                return (
                  <button key={key} onClick={() => { setActiveCategory(key); setActiveView('positions'); }} className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 text-left transition">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${cat.color}20` }}>
                        <Icon className="w-4 h-4" style={{ color: cat.color }} />
                      </div>
                      <span className="text-xs text-slate-500">{pct.toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-1">{cat.label}</p>
                    <p className="font-bold text-base sm:text-lg">{showValues ? fmtEUR(value) : '••••'}</p>
                  </button>
                );
              })}
            </div>

            {totals.total > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h3 className="font-semibold mb-4 flex items-center gap-2"><PieIcon className="w-4 h-4" />Distribución</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={totals.byCategory} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                        {totals.byCategory.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} formatter={(v) => (showValues ? fmtEUR(v) : '••••')} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {totals.byCategory.map((c) => (
                      <div key={c.category} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                          <span className="text-slate-300">{c.label}</span>
                        </div>
                        <span className="font-medium">{c.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4" />Evolución</h3>
                  {snapshots.length > 1 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ReLineChart data={snapshots}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                        <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} formatter={(v) => (showValues ? fmtEUR(v) : '••••')} />
                        <Line type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} dot={false} />
                      </ReLineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex flex-col items-center justify-center text-slate-500 text-sm text-center">
                      <Activity className="w-10 h-10 mb-2 opacity-30" />
                      <p>Snapshot diario automático.</p>
                      <p className="text-xs mt-1">El gráfico aparecerá tras varios días.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {totals.total === 0 && positions.length === 0 && (
              <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-12 text-center">
                <Wallet className="w-12 h-12 mx-auto text-slate-600 mb-3" />
                <h3 className="font-semibold mb-1">Empieza añadiendo posiciones</h3>
                <p className="text-slate-400 text-sm mb-4">Cash, cuentas bancarias, cripto, acciones o empresas privadas.</p>
                <button onClick={() => setActiveView('positions')} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition">Ir a posiciones</button>
              </div>
            )}
          </div>
        )}

        {activeView === 'positions' && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              <button onClick={() => setActiveCategory('all')} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${activeCategory === 'all' ? 'bg-emerald-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'}`}>Todas</button>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button key={key} onClick={() => setActiveCategory(key)} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-1.5 ${activeCategory === key ? 'bg-emerald-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'}`}>
                  <cat.icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => openModal(activeCategory === 'all' ? 'cash' : activeCategory)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition flex items-center gap-2">
                <Plus className="w-4 h-4" />Añadir posición
              </button>
            </div>

            {Object.entries(CATEGORIES).map(([catKey, cat]) => {
              if (activeCategory !== 'all' && activeCategory !== catKey) return null;
              const items = filteredPositions.filter((p) => p.category === catKey);
              if (items.length === 0 && activeCategory === 'all') return null;
              const Icon = cat.icon;
              const catTotal = items.reduce((s, p) => s + p.currentValueEUR, 0);

              return (
                <div key={catKey} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color: cat.color }} />
                      <h3 className="font-semibold">{cat.label}</h3>
                      <span className="text-xs text-slate-500">({items.length})</span>
                    </div>
                    <span className="text-sm font-medium">{showValues ? fmtEUR(catTotal) : '••••'}</span>
                  </div>

                  {items.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      <p>Sin posiciones en esta categoría</p>
                      <button onClick={() => openModal(catKey)} className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm">+ Añadir la primera</button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800">
                      {items.map((p) => (
                        <PositionRow key={p.id} p={p} showValues={showValues} onEdit={() => openModal(p.category, p)} onDelete={() => deletePosition(p.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeView === 'history' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Snapshots ({snapshots.length})</h3>
                <button onClick={takeSnapshot} className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition">Guardar snapshot ahora</button>
              </div>
              {snapshots.length === 0 ? (
                <p className="text-slate-500 text-sm py-8 text-center">Sin snapshots aún. Se guarda uno automáticamente cada día.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-800">
                        <th className="py-2 px-2 font-medium">Fecha</th>
                        <th className="py-2 px-2 font-medium text-right">Total</th>
                        <th className="py-2 px-2 font-medium text-right hidden sm:table-cell">Variación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...snapshots].reverse().map((s, i, arr) => {
                        const prev = arr[i + 1];
                        const diff = prev ? s.total - prev.total : 0;
                        const diffPct = prev && prev.total > 0 ? (diff / prev.total) * 100 : 0;
                        return (
                          <tr key={s.date} className="border-b border-slate-800/50">
                            <td className="py-2.5 px-2">{s.date}</td>
                            <td className="py-2.5 px-2 text-right font-medium">{showValues ? fmtEUR(s.total) : '••••'}</td>
                            <td className="py-2.5 px-2 text-right hidden sm:table-cell">
                              {prev ? (
                                <span className={diff >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {diff >= 0 ? '+' : ''}{showValues ? fmtEUR(diff) : '••'} ({fmtPct(diffPct)})
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {modalOpen && editing && (
        <PositionModal editing={editing} setEditing={setEditing} onSave={savePosition} onClose={() => { setModalOpen(false); setEditing(null); }} prices={prices} />
      )}
    </div>
  );
}

function PositionRow({ p, showValues, onEdit, onDelete }) {
  const isMarket = p.category === 'crypto' || p.category === 'stocks';
  const showPnl = p.costBasisEUR > 0;
  const hasIssue = isMarket && p.currentValueEUR === 0 && p.quantity > 0;

  return (
    <div className={`px-4 py-3 transition flex items-center gap-3 ${hasIssue ? 'bg-amber-950/20 hover:bg-amber-950/30' : 'hover:bg-slate-800/30'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{p.name || p.symbol || '—'}</span>
          {p.symbol && p.name && p.name !== p.symbol && <span className="text-xs text-slate-500 uppercase">{p.symbol}</span>}
          {p.currency && p.currency !== 'EUR' && !isMarket && <span className="text-xs px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">{p.currency}</span>}
          {p.priceSource === 'manual' && <span className="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded">manual</span>}
          {p.priceSource === 'auto' && <span className="text-xs px-1.5 py-0.5 bg-emerald-900/40 text-emerald-300 rounded">live</span>}
          {hasIssue && <span className="text-xs px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3" />sin precio</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {isMarket && <span>{fmtNum(p.quantity, 6)} unidades</span>}
          {isMarket && p.currentPriceEUR > 0 && <span>· {fmtEURprecise(p.currentPriceEUR)}/u</span>}
          {!isMarket && p.amount > 0 && <span>{fmtNum(p.amount, 2)} {p.currency || 'EUR'}</span>}
          {p.notes && <span className="truncate">· {p.notes}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-semibold ${hasIssue ? 'text-amber-400' : ''}`}>{showValues ? fmtEUR(p.currentValueEUR) : '••••'}</div>
        {showPnl && p.currentValueEUR > 0 && (
          <div className={`text-xs ${p.pnlEUR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {p.pnlEUR >= 0 ? '+' : ''}{showValues ? fmtEUR(p.pnlEUR) : '••'} ({fmtPct(p.pnlPct)})
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onEdit} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition"><Edit2 className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} className="p-1.5 hover:bg-red-900/40 rounded text-slate-400 hover:text-red-400 transition"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

function PositionModal({ editing, setEditing, onSave, onClose, prices }) {
  const cat = editing.category;
  const isMarket = cat === 'crypto' || cat === 'stocks';
  const update = (k, v) => setEditing({ ...editing, [k]: v });

  const canSave = isMarket ? editing.symbol && editing.quantity > 0 : editing.name && editing.amount > 0;

  const symbol = editing.symbol?.toUpperCase();
  const statusKey = isMarket ? `${cat === 'crypto' ? 'crypto' : 'stock'}_${symbol}` : null;
  const priceData = statusKey ? prices[statusKey] : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
          <h3 className="font-semibold">{editing.symbol || editing.name ? 'Editar' : 'Añadir'} · {CATEGORIES[cat].label}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Categoría">
            <select value={cat} onChange={(e) => update('category', e.target.value)} className="input">
              {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </Field>

          {isMarket ? (
            <>
              <Field label={cat === 'crypto' ? 'Símbolo cripto (BTC, ETH, SOL...)' : 'Ticker (AAPL, SAN.MC, VOD.UK...)'}>
                <input type="text" value={editing.symbol || ''} onChange={(e) => update('symbol', e.target.value.toUpperCase())} placeholder={cat === 'crypto' ? 'BTC' : 'AAPL'} className="input" />
                {symbol && priceData?.price > 0 && (
                  <div className="mt-2 text-xs flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Último precio: {priceData.price} {priceData.currency}
                  </div>
                )}
                {cat === 'stocks' && (
                  <p className="text-xs text-slate-500 mt-1">Mercados no-US: <code>.MC</code> Madrid · <code>.UK</code> Londres · <code>.DE</code> Frankfurt · <code>.PA</code> París</p>
                )}
              </Field>
              <Field label="Nombre (opcional)"><input type="text" value={editing.name || ''} onChange={(e) => update('name', e.target.value)} placeholder="Bitcoin, Apple Inc..." className="input" /></Field>
              <Field label="Cantidad"><input type="number" step="any" value={editing.quantity || ''} onChange={(e) => update('quantity', parseFloat(e.target.value) || 0)} className="input" /></Field>
              <Field label="Precio manual en EUR (fallback)">
                <input type="number" step="any" value={editing.manualPrice || ''} onChange={(e) => update('manualPrice', parseFloat(e.target.value) || 0)} placeholder="Ej: 90000" className="input" />
                <p className="text-xs text-slate-500 mt-1">Se usa si no hay precio automático.</p>
              </Field>
              <Field label="Coste total de adquisición en EUR"><input type="number" step="any" value={editing.costBasisEUR || ''} onChange={(e) => update('costBasisEUR', parseFloat(e.target.value) || 0)} placeholder="Para calcular rentabilidad" className="input" /></Field>
            </>
          ) : (
            <>
              <Field label={cat === 'private' ? 'Nombre de la empresa' : cat === 'bank' ? 'Banco / Cuenta' : 'Descripción'}>
                <input type="text" value={editing.name || ''} onChange={(e) => update('name', e.target.value)} placeholder={cat === 'private' ? 'Stoneshield Capital' : cat === 'bank' ? 'BBVA cuenta corriente' : 'Caja fuerte'} className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Importe"><input type="number" step="any" value={editing.amount || ''} onChange={(e) => update('amount', parseFloat(e.target.value) || 0)} className="input" /></Field>
                <Field label="Divisa">
                  <select value={editing.currency || 'EUR'} onChange={(e) => update('currency', e.target.value)} className="input">
                    {FIAT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              {cat === 'private' && (
                <Field label="Coste de adquisición en EUR (opcional)"><input type="number" step="any" value={editing.costBasisEUR || ''} onChange={(e) => update('costBasisEUR', parseFloat(e.target.value) || 0)} className="input" /></Field>
              )}
              <Field label="Notas"><input type="text" value={editing.notes || ''} onChange={(e) => update('notes', e.target.value)} placeholder="Opcional" className="input" /></Field>
            </>
          )}
        </div>
        <div className="p-5 border-t border-slate-800 flex gap-2 sticky bottom-0 bg-slate-900">
          <button onClick={onClose} className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition">Cancelar</button>
          <button onClick={onSave} disabled={!canSave} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition flex items-center justify-center gap-2">
            <Save className="w-4 h-4" />Guardar
          </button>
        </div>
        <style>{`
          .input { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 8px 12px; color: #f1f5f9; font-size: 14px; outline: none; }
          .input:focus { border-color: #10b981; }
          code { background: #1e293b; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
