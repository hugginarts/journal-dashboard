"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  TrendingUp, ShieldAlert, Activity, Upload, Award,
  Clock, BarChart3, X, Zap, ArrowUpRight, Brain,
  BookOpen, TrendingDown, CheckCircle2, XCircle, Layout,
  Filter, Search, Calendar, ChevronDown, RefreshCw, LineChart,
  Trash2, Edit3, Save, AlertTriangle, ChevronLeft, ChevronRight,
  Download, Target, Flame
} from 'lucide-react';

// ─── Storage helpers ───────────────────────────────────────────────────────────
const STORAGE_KEY = 'sml-trades-v2';
const NOTES_KEY   = 'sml-notes-v2';
const ACCOUNTS_KEY = 'sml-accounts-v1';
const SETTINGS_KEY = 'sml-settings-v1';

async function saveTrades(trades) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(trades)); } catch (_) {}
}
async function loadTrades() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : [];
  } catch (_) { return []; }
}
async function saveNotes(notes) {
  try { await window.storage.set(NOTES_KEY, JSON.stringify(notes)); } catch (_) {}
}
async function loadNotes() {
  try {
    const r = await window.storage.get(NOTES_KEY);
    return r ? JSON.parse(r.value) : {};
  } catch (_) { return {}; }
}
async function saveAccounts(accounts) {
  try { await window.storage.set(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch (_) {}
}
async function loadAccounts() {
  try {
    const r = await window.storage.get(ACCOUNTS_KEY);
    return r ? JSON.parse(r.value) : [];
  } catch (_) { return []; }
}
async function saveSettings(settings) {
  try { await window.storage.set(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}
async function loadSettings() {
  try {
    const r = await window.storage.get(SETTINGS_KEY);
    return r ? JSON.parse(r.value) : { commissionPerContract: 0 };
  } catch (_) { return { commissionPerContract: 0 }; }
}

// ─── Reglas de fondeo Apex Trader Funding (EOD, 2026) ─────────────────────────
// Evaluación EOD — valores oficiales del Help Center de Apex (verificar siempre en apextraderfunding.com)
const EVAL_PRESETS = {
  '25K':  { startingBalance: 25000,  profitTarget: 1500, maxDrawdown: 1000, dll: 500,  maxContracts: 4  },
  '50K':  { startingBalance: 50000,  profitTarget: 3000, maxDrawdown: 2000, dll: 1000, maxContracts: 6  },
  '100K': { startingBalance: 100000, profitTarget: 6000, maxDrawdown: 3000, dll: 1500, maxContracts: 8  },
  '150K': { startingBalance: 150000, profitTarget: 9000, maxDrawdown: 4000, dll: 2000, maxContracts: 12 },
};
// Cuenta Fondeada (Performance Account) EOD — valores de referencia pública, pueden variar por escalado de tramos.
const PA_PRESETS = {
  '25K':  { startingBalance: 25000,  maxDrawdown: 1000, dll: 500,  maxContracts: 4,  minDailyProfit: 100 },
  '50K':  { startingBalance: 50000,  maxDrawdown: 2000, dll: 1000, maxContracts: 6,  minDailyProfit: 250 },
  '100K': { startingBalance: 100000, maxDrawdown: 3000, dll: 1750, maxContracts: 8,  minDailyProfit: 300 },
  '150K': { startingBalance: 150000, maxDrawdown: 4000, dll: 2500, maxContracts: 12, minDailyProfit: 350 },
};

// ─── CSV format auto-detection ────────────────────────────────────────────────
function detectAndMapHeaders(headers) {
  const h = headers.map(x => x.toLowerCase().trim());
  const find = (...candidates) => {
    for (const c of candidates) {
      const i = h.findIndex(x => x.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    symbol: find('symbol', 'instrument', 'ticker', 'contract', 'market'),
    pnl:    find('pnl', 'profit', 'net profit', 'realized', 'gain', 'p&l', 'p/l'),
    qty:    find('qty', 'quantity', 'size', 'contracts', 'shares', 'volume', 'pos'),
    // Columna de fecha explícita (cuando viene SEPARADA de la hora)
    date:   find('date', 'fecha'),
    // Columna de hora, o de timestamp combinado fecha+hora
    time:   find('soldtimestamp', 'exit time', 'close time', 'timestamp', 'closedtime', 'time', 'hora'),
    side:   find('side', 'direction', 'type', 'action', 'trade type'),
    setup:  find('setup', 'strategy', 'estrategia'),
    risk:   find('planned risk', 'risk amount', 'riesgo', 'risk'),
  };
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#10b981', height = 40, width = 120 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Equity Curve ─────────────────────────────────────────────────────────────
function EquityCurve({ trades }) {
  if (!trades.length) return (
    <div style={{ color: '#4b5563', textAlign: 'center', padding: '40px 0', fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', fontStyle: 'italic' }}>
      NO DATA — IMPORTA UN CSV
    </div>
  );
  const cumulative = [];
  let acc = 0;
  trades.forEach(t => { acc += t.pnl; cumulative.push(acc); });

  const W = 560, H = 160;
  const min = Math.min(0, ...cumulative);
  const max = Math.max(0, ...cumulative);
  const range = max - min || 1;
  const pad = { l: 60, r: 20, t: 16, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const pts = cumulative.map((v, i) => {
    const x = pad.l + (i / (cumulative.length - 1)) * iw;
    const y = pad.t + (1 - (v - min) / range) * ih;
    return [x, y];
  });

  const zero_y = pad.t + (1 - (0 - min) / range) * ih;
  const polyline = pts.map(p => p.join(',')).join(' ');

  const areaPos = pts.map(([x, y]) => [x, Math.min(y, zero_y)]);
  const areaNeg = pts.map(([x, y]) => [x, Math.max(y, zero_y)]);
  const areaPolyPos = [[pad.l, zero_y], ...areaPos, [pts[pts.length-1][0], zero_y]].map(p=>p.join(',')).join(' ');
  const areaPolyNeg = [[pad.l, zero_y], ...areaNeg, [pts[pts.length-1][0], zero_y]].map(p=>p.join(',')).join(' ');

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const val = min + (i / tickCount) * range;
    const y = pad.t + (1 - (val - min) / range) * ih;
    return { val, y };
  });

  const last = cumulative[cumulative.length - 1];
  const isProfit = last >= 0;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {yTicks.map(({ val, y }, i) => (
        <g key={i}>
          <line x1={pad.l - 4} y1={y} x2={W - pad.r} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <text x={pad.l - 8} y={y + 4} textAnchor="end" fill="#4b5563" fontSize="10" fontWeight="700" fontStyle="italic">
            {val >= 0 ? '' : '-'}${Math.abs(val).toFixed(0)}
          </text>
        </g>
      ))}
      <line x1={pad.l} y1={zero_y} x2={W - pad.r} y2={zero_y} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />
      <polygon points={areaPolyPos} fill="rgba(16,185,129,0.12)" />
      <polygon points={areaPolyNeg} fill="rgba(239,68,68,0.12)" />
      <polyline points={polyline} fill="none" stroke={isProfit ? '#10b981' : '#ef4444'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="4" fill={isProfit ? '#10b981' : '#ef4444'} />
      <text x={pad.l} y={H - 4} fill="#4b5563" fontSize="10" fontWeight="700" fontStyle="italic">T1</text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" fill="#4b5563" fontSize="10" fontWeight="700" fontStyle="italic">T{trades.length}</text>
    </svg>
  );
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────
function BarChart({ values, color }) {
  if (!values.length) return null;
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
      {values.slice(-18).map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${(Math.abs(v) / max) * 100}%`, background: color, borderRadius: '4px 4px 0 0', opacity: 0.7, minWidth: 4, transition: 'opacity 0.2s' }} title={`$${v.toFixed(2)}`} />
      ))}
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ pct, color }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden', marginTop: 10 }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: color, borderRadius: 8, transition: 'width 0.3s' }} />
    </div>
  );
}

// ─── Heatmap Calendar (con navegación de mes) ─────────────────────────────────
function HeatmapCalendar({ trades }) {
  // Mes más reciente que tenga trades (en vez de tomar el primer trade del array)
  const defaultYearMonth = useMemo(() => {
    let latest = "";
    trades.forEach(t => {
      if (t.date && t.date.includes('-')) {
        const ym = t.date.slice(0, 7);
        if (ym > latest) latest = ym;
      }
    });
    if (!latest) {
      const now = new Date();
      latest = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return latest;
  }, [trades]);

  const [currentYearMonth, setCurrentYearMonth] = useState(defaultYearMonth);

  // Cuando se importa un CSV nuevo, saltar al mes más reciente automáticamente
  useEffect(() => {
    setCurrentYearMonth(defaultYearMonth);
  }, [defaultYearMonth]);

  const dataMap = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      if (!t.date) return;
      if (!map[t.date]) map[t.date] = { pnl: 0, count: 0 };
      map[t.date].pnl += t.pnl;
      map[t.date].count++;
    });
    return map;
  }, [trades]);

  const calendarGrid = useMemo(() => {
    if (!currentYearMonth) return [];
    const [year, month] = currentYearMonth.split('-').map(Number);

    const firstDayInstance = new Date(year, month - 1, 1);
    const lastDayInstance = new Date(year, month, 0);

    const totalDays = lastDayInstance.getDate();
    const startDayOfWeek = firstDayInstance.getDay();

    const grid = [];
    for (let i = 0; i < startDayOfWeek; i++) grid.push(null);
    for (let d = 1; d <= totalDays; d++) {
      const dayStr = String(d).padStart(2, '0');
      const monthStr = String(month).padStart(2, '0');
      const dateKey = `${year}-${monthStr}-${dayStr}`;
      grid.push({ dayNum: d, dateKey });
    }
    return grid;
  }, [currentYearMonth]);

  const monthLabel = useMemo(() => {
    if (!currentYearMonth) return "";
    const [y, m] = currentYearMonth.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
  }, [currentYearMonth]);

  const goPrevMonth = () => {
    const [y, m] = currentYearMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const goNextMonth = () => {
    const [y, m] = currentYearMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (!trades.length) return <div style={{ color: '#4b5563', fontStyle: 'italic', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin datos de fecha disponibles</div>;

  const daysOfWeekLabels = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cabecera del Mes con navegación */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#10b981' }}>●</span> {monthLabel}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={goPrevMonth} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '8px 10px', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}>
            <ChevronLeft size={16} />
          </button>
          <button onClick={goNextMonth} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '8px 10px', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Contenedor Grid Principal */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#030303', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 16, overflow: 'hidden' }}>

        {/* Encabezado Días */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          {daysOfWeekLabels.map(lbl => (
            <div key={lbl} style={{ padding: '12px 0', fontSize: 10, fontWeight: 800, color: '#4b5563', textAlign: 'center', letterSpacing: '0.1em' }}>
              {lbl}
            </div>
          ))}
        </div>

        {/* Celdas del Calendario */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#050505' }}>
          {calendarGrid.map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} style={{ borderRight: '1px solid rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.02)', minHeight: 85, background: '#020202' }} />;
            }

            const dayData = dataMap[cell.dateKey];
            const hasOps = !!dayData;
            const pnl = hasOps ? dayData.pnl : 0;
            const count = hasOps ? dayData.count : 0;
            const isWinDay = pnl > 0;

            // Fondos y bordes claramente diferenciados: VERDE = día ganador, ROJO = día perdedor
            let bg = 'transparent';
            let borderColor = 'rgba(255,255,255,0.03)';
            if (hasOps) {
              bg = isWinDay
                ? 'rgba(16, 185, 129, 0.22)'   // Verde sólido y visible
                : 'rgba(239, 68, 68, 0.20)';    // Rojo sólido y visible
              borderColor = isWinDay ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.45)';
            }

            return (
              <div
                key={cell.dateKey}
                style={{
                  borderRight: '1px solid rgba(255,255,255,0.03)',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  boxShadow: hasOps ? `inset 0 0 0 1px ${borderColor}` : 'none',
                  minHeight: 85,
                  padding: 8,
                  background: bg,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => hasOps && (e.currentTarget.style.background = isWinDay ? 'rgba(16, 185, 129, 0.32)' : 'rgba(239, 68, 68, 0.30)')}
                onMouseLeave={e => (e.currentTarget.style.background = bg)}
              >
                {/* Número del día */}
                <span style={{ fontSize: 11, color: hasOps ? 'rgba(255,255,255,0.85)' : '#4b5563', fontWeight: 800 }}>
                  {cell.dayNum}
                </span>

                {/* Métricas del día */}
                {hasOps ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0' }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: isWinDay ? '#10b981' : '#ef4444', fontStyle: 'italic' }}>
                      {isWinDay ? '+' : ''}${pnl.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>
                      {count} {count === 1 ? 'Trade' : 'Trades'}
                    </span>
                  </div>
                ) : (
                  <div style={{ flex: 1 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0a0a0a', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 24, padding: 32, maxWidth: 360, width: '90%', textAlign: 'center' }}>
        <AlertTriangle size={36} style={{ color: '#ef4444', marginBottom: 16 }} />
        <p style={{ color: '#fff', fontWeight: 800, fontStyle: 'italic', fontSize: 16, marginBottom: 8 }}>{message}</p>
        <p style={{ color: '#4b5563', fontSize: 12, marginBottom: 24 }}>Esta acción no se puede deshacer.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onCancel} style={{ padding: '10px 24px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>Cancelar</button>
          <button onClick={onConfirm} style={{ padding: '10px 24px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12, letterSpacing: '0.1em' }}>ELIMINAR</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Trade Modal ─────────────────────────────────────────────────────────
function EditTradeModal({ trade, index, accounts, onSave, onClose }) {
  const [form, setForm] = useState({ ...trade });
  const inputStyle = { width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', fontStyle: 'italic' };
  const labelStyle = { display: 'block', fontSize: 10, fontWeight: 800, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4, fontStyle: 'italic' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: '20px 0' }}>
      <div style={{ background: '#0a0a0a', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 24, padding: 32, maxWidth: 400, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <span style={{ color: '#10b981', fontWeight: 900, fontSize: 16, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Editar Trade</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        {[
          { key: 'pair', label: 'Símbolo' },
          { key: 'pnl', label: 'PnL', type: 'number' },
          { key: 'qty', label: 'Qty', type: 'number' },
          { key: 'date', label: 'Fecha' },
          { key: 'time', label: 'Hora' },
          { key: 'side', label: 'Side' },
          { key: 'setup', label: 'Setup / Estrategia' },
          { key: 'risk', label: 'Riesgo Planeado ($)', type: 'number' },
          { key: 'grossPnl', label: 'PnL Bruto (sin comisión, $)', type: 'number' },
          { key: 'commission', label: 'Comisión ($)', type: 'number' },
        ].map(({ key, label, type }) => (
          <div key={key} style={{ marginBottom: 14 }}>
            <label style={labelStyle}>{label}</label>
            <input
              type={type || 'text'}
              value={form[key] || ''}
              onChange={e => setForm(prev => ({ ...prev, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
              style={inputStyle}
            />
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Cuenta de Fondeo</label>
          <select
            value={form.account || ''}
            onChange={e => setForm(prev => ({ ...prev, account: e.target.value || null }))}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">Sin cuenta asignada</option>
            {(accounts || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>Cancelar</button>
          <button onClick={() => onSave(index, form)} style={{ flex: 1, padding: '10px', borderRadius: 20, border: 'none', background: '#10b981', color: '#000', cursor: 'pointer', fontWeight: 900, fontSize: 12, letterSpacing: '0.1em' }}>GUARDAR</button>
        </div>
      </div>
    </div>
  );
}

// ─── Account Modal (crear / editar cuenta de fondeo) ──────────────────────────
function AccountModal({ account, onSave, onClose }) {
  const isEdit = !!account;
  const [form, setForm] = useState(account || {
    id: 'acc_' + Date.now(),
    name: '',
    phase: 'eval',
    size: '50K',
    startingBalance: EVAL_PRESETS['50K'].startingBalance,
    profitTarget: EVAL_PRESETS['50K'].profitTarget,
    maxDrawdown: EVAL_PRESETS['50K'].maxDrawdown,
    dll: EVAL_PRESETS['50K'].dll,
    maxContracts: EVAL_PRESETS['50K'].maxContracts,
    minDailyProfit: PA_PRESETS['50K'].minDailyProfit,
    consistencyPct: 50,
    startDate: new Date().toISOString().split('T')[0],
  });

  const inputStyle = { width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', fontStyle: 'italic' };
  const labelStyle = { display: 'block', fontSize: 10, fontWeight: 800, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4, fontStyle: 'italic' };

  const applyPreset = (phase, size) => {
    setForm(prev => {
      if (size === 'custom') return { ...prev, phase, size };
      const preset = phase === 'pa' ? PA_PRESETS[size] : EVAL_PRESETS[size];
      if (!preset) return { ...prev, phase, size };
      return {
        ...prev,
        phase, size,
        startingBalance: preset.startingBalance,
        profitTarget: phase === 'eval' ? EVAL_PRESETS[size].profitTarget : prev.profitTarget,
        maxDrawdown: preset.maxDrawdown,
        dll: preset.dll,
        maxContracts: preset.maxContracts,
        minDailyProfit: phase === 'pa' ? PA_PRESETS[size].minDailyProfit : prev.minDailyProfit,
      };
    });
  };

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const numField = (key, label) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      <input type="number" value={form[key]} onChange={e => setField(key, parseFloat(e.target.value) || 0)} style={inputStyle} />
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: '20px 0' }}>
      <div style={{ background: '#0a0a0a', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 24, padding: 32, maxWidth: 420, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: '#10b981', fontWeight: 900, fontSize: 16, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{isEdit ? 'Editar Cuenta' : 'Nueva Cuenta de Fondeo'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Nombre de la cuenta</label>
          <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Ej: Apex 50K Eval #1" style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Fase</label>
            <select value={form.phase} onChange={e => applyPreset(e.target.value, form.size)} style={{ ...inputStyle, cursor: 'pointer', fontSize: 12 }}>
              <option value="eval">Evaluación</option>
              <option value="pa">Fondeada (PA)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tamaño</label>
            <select value={form.size} onChange={e => applyPreset(form.phase, e.target.value)} style={{ ...inputStyle, cursor: 'pointer', fontSize: 12 }}>
              <option value="25K">25K</option>
              <option value="50K">50K</option>
              <option value="100K">100K</option>
              <option value="150K">150K</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Fecha de inicio</label>
          <input type="date" value={form.startDate} onChange={e => setField('startDate', e.target.value)} style={inputStyle} />
        </div>

        {numField('startingBalance', 'Balance Inicial ($)')}
        {form.phase === 'eval' && numField('profitTarget', 'Meta de Ganancia ($)')}
        {numField('maxDrawdown', 'Max Drawdown EOD ($)')}
        {numField('dll', 'Daily Loss Limit ($)')}
        {numField('maxContracts', 'Máx. Contratos')}
        {form.phase === 'pa' && numField('minDailyProfit', 'Ganancia Mínima Diaria Calificada ($)')}
        {form.phase === 'pa' && numField('consistencyPct', '% Regla de Consistencia')}

        <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 12, padding: '10px 14px', fontSize: 10, color: '#4b5563', fontWeight: 700, lineHeight: 1.6, marginBottom: 10 }}>
          Valores precargados según las reglas públicas de Apex Trader Funding (cuentas EOD, 2026). Puedes editarlos libremente. Verifica siempre las reglas vigentes en apextraderfunding.com antes de operar.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>Cancelar</button>
          <button
            onClick={() => form.name.trim() && onSave(form)}
            disabled={!form.name.trim()}
            style={{ flex: 1, padding: '10px', borderRadius: 20, border: 'none', background: form.name.trim() ? '#10b981' : 'rgba(16,185,129,0.3)', color: '#000', cursor: form.name.trim() ? 'pointer' : 'not-allowed', fontWeight: 900, fontSize: 12, letterSpacing: '0.1em' }}
          >GUARDAR</button>
        </div>
      </div>
    </div>
  );
}

// ─── Funded Account Panel ──────────────────────────────────────────────────────
function FundedAccountPanel({ account, trades }) {
  const stats = useMemo(() => {
    const accTrades = trades.filter(t => t.account === account.id).slice().sort((a, b) => {
      const da = `${a.date || ''} ${a.time || ''}`;
      const db = `${b.date || ''} ${b.time || ''}`;
      return da.localeCompare(db);
    });

    const byDay = {};
    accTrades.forEach(t => {
      const d = t.date || 'sin-fecha';
      byDay[d] = (byDay[d] || 0) + t.pnl;
    });
    const dayOrder = Object.keys(byDay).filter(d => d !== 'sin-fecha').sort();

    let bal = account.startingBalance;
    let peak = account.startingBalance;
    const dayRows = dayOrder.map(d => {
      bal += byDay[d];
      peak = Math.max(peak, bal);
      const threshold = peak - account.maxDrawdown;
      return { date: d, pnl: byDay[d], balance: bal, threshold };
    });

    const currentBalance = bal;
    const netProfit = currentBalance - account.startingBalance;
    const initialThreshold = account.startingBalance - account.maxDrawdown;
    const activeThreshold = dayRows.length >= 2 ? dayRows[dayRows.length - 2].threshold : initialThreshold;
    const nextThreshold = dayRows.length >= 1 ? dayRows[dayRows.length - 1].threshold : initialThreshold;
    const buffer = currentBalance - activeThreshold;
    const bufferPct = account.maxDrawdown > 0 ? (buffer / account.maxDrawdown) * 100 : 0;

    const today = dayRows.length ? dayRows[dayRows.length - 1] : null;
    const todayPnl = today ? today.pnl : 0;
    const dllUsed = todayPnl < 0 ? Math.abs(todayPnl) : 0;
    const dllRemaining = account.dll - dllUsed;
    const dllPct = account.dll > 0 ? (dllRemaining / account.dll) * 100 : 100;

    const targetProgress = (account.phase === 'eval' && account.profitTarget) ? (netProfit / account.profitTarget) * 100 : null;
    const remainingToTarget = (account.phase === 'eval' && account.profitTarget) ? Math.max(0, account.profitTarget - netProfit) : null;

    const qualifyingDays = account.phase === 'pa' ? dayRows.filter(r => r.pnl >= (account.minDailyProfit || 0)).length : null;

    const bestDayPnl = dayRows.length ? Math.max(...dayRows.map(r => r.pnl)) : 0;
    const consistencyRatio = (account.phase === 'pa' && netProfit > 0) ? (bestDayPnl / netProfit) * 100 : null;

    const safetyNet = account.phase === 'pa' ? account.startingBalance + account.maxDrawdown + 100 : null;

    return {
      accTrades, dayRows, currentBalance, netProfit, initialThreshold, activeThreshold,
      nextThreshold, buffer, bufferPct, todayPnl, dllUsed, dllRemaining, dllPct,
      targetProgress, remainingToTarget, qualifyingDays, bestDayPnl, consistencyRatio, safetyNet,
    };
  }, [account, trades]);

  const semColor = (pct) => pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444';
  const card = { background: '#080808', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 24, padding: '20px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' };
  const label = { fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', fontStyle: 'italic', marginBottom: 6, display: 'block' };

  return (
    <div>
      {stats.bufferPct < 20 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 16, padding: '14px 18px', marginBottom: 16 }}>
          <ShieldAlert size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', fontStyle: 'italic' }}>
            Tu buffer frente al umbral de drawdown está por debajo del 20%. Reduce el riesgo por operación.
          </span>
        </div>
      )}
      {stats.dllPct < 20 && stats.todayPnl < 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 16, padding: '14px 18px', marginBottom: 16 }}>
          <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', fontStyle: 'italic' }}>
            Estás cerca de tu Daily Loss Limit de hoy. Considera detener la operativa por hoy.
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <span style={{ ...label, color: '#60a5fa' }}>Balance Actual</span>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', fontStyle: 'italic' }}>${stats.currentBalance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          <div style={{ fontSize: 11, color: stats.netProfit >= 0 ? '#10b981' : '#ef4444', marginTop: 5, fontWeight: 700 }}>
            {stats.netProfit >= 0 ? '+' : ''}${stats.netProfit.toFixed(2)} desde el inicio (${account.startingBalance.toLocaleString()})
          </div>
        </div>

        {account.phase === 'eval' ? (
          <div style={card}>
            <span style={{ ...label, color: '#10b981' }}>Progreso a la Meta de Fondeo</span>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#10b981', fontStyle: 'italic' }}>{Math.max(0, stats.targetProgress || 0).toFixed(0)}%</div>
            <ProgressBar pct={stats.targetProgress || 0} color="#10b981" />
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8, fontWeight: 700 }}>
              {account.profitTarget ? `Faltan $${(stats.remainingToTarget || 0).toFixed(2)} de $${account.profitTarget.toLocaleString()}` : 'Define una meta de ganancia en la configuración'}
            </div>
          </div>
        ) : (
          <div style={card}>
            <span style={{ ...label, color: '#a78bfa' }}>Safety Net (Piso de Retiro)</span>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#a78bfa', fontStyle: 'italic' }}>${stats.safetyNet.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: stats.currentBalance >= stats.safetyNet ? '#10b981' : '#4b5563', marginTop: 8, fontWeight: 700 }}>
              {stats.currentBalance >= stats.safetyNet ? 'Por encima del piso — elegible para payout' : `Faltan $${(stats.safetyNet - stats.currentBalance).toFixed(2)} para el piso`}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <span style={{ ...label, color: semColor(stats.bufferPct) }}>Buffer al Umbral EOD (Trailing DD)</span>
          <div style={{ fontSize: 30, fontWeight: 900, color: semColor(stats.bufferPct), fontStyle: 'italic' }}>${stats.buffer.toFixed(2)}</div>
          <ProgressBar pct={stats.bufferPct} color={semColor(stats.bufferPct)} />
          <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8, fontWeight: 700 }}>
            Umbral activo: ${stats.activeThreshold.toFixed(2)} · Próxima sesión: ${stats.nextThreshold.toFixed(2)}
          </div>
        </div>
        <div style={card}>
          <span style={{ ...label, color: semColor(stats.dllPct) }}>Daily Loss Limit — Hoy</span>
          <div style={{ fontSize: 30, fontWeight: 900, color: semColor(stats.dllPct), fontStyle: 'italic' }}>${Math.max(0, stats.dllRemaining).toFixed(2)}</div>
          <ProgressBar pct={stats.dllPct} color={semColor(stats.dllPct)} />
          <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8, fontWeight: 700 }}>
            Usado hoy: ${stats.dllUsed.toFixed(2)} de ${account.dll.toLocaleString()}
          </div>
        </div>
      </div>

      {account.phase === 'pa' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
          <div style={card}>
            <span style={{ ...label, color: '#f59e0b' }}>Días Calificados para Payout</span>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', fontStyle: 'italic' }}>{stats.qualifyingDays} / 5</div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8, fontWeight: 700 }}>Días con ganancia ≥ ${account.minDailyProfit}</div>
          </div>
          <div style={card}>
            <span style={{ ...label, color: stats.consistencyRatio > account.consistencyPct ? '#ef4444' : '#10b981' }}>Regla de Consistencia</span>
            <div style={{ fontSize: 30, fontWeight: 900, color: stats.consistencyRatio > account.consistencyPct ? '#ef4444' : '#10b981', fontStyle: 'italic' }}>
              {stats.consistencyRatio !== null ? stats.consistencyRatio.toFixed(0) : 0}%
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8, fontWeight: 700 }}>
              Límite: {account.consistencyPct}% · Mejor día: ${stats.bestDayPnl.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ ...label, color: '#94a3b8', marginBottom: 0 }}>Historial diario — Balance vs. Umbral EOD</span>
        </div>
        {stats.dayRows.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#4b5563', fontSize: 12, fontWeight: 700, fontStyle: 'italic' }}>Sin trades asignados a esta cuenta todavía. Asigna trades al importar el CSV o editando cada trade.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
              <tr>
                {['Fecha','PnL Día','Balance','Umbral EOD','Buffer'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.15em', fontStyle: 'italic', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.dayRows.slice().reverse().slice(0, 20).map(r => (
                <tr key={r.date}>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>{r.date}</td>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 900, color: r.pnl >= 0 ? '#10b981' : '#ef4444', fontStyle: 'italic', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>{r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}</td>
                  <td style={{ padding: '12px 16px', color: '#fff', fontSize: 13, fontWeight: 800, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>${r.balance.toFixed(2)}</td>
                  <td style={{ padding: '12px 16px', color: '#f59e0b', fontSize: 13, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>${r.threshold.toFixed(2)}</td>
                  <td style={{ padding: '12px 16px', color: (r.balance - r.threshold) > account.maxDrawdown * 0.2 ? '#10b981' : '#ef4444', fontSize: 13, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>${(r.balance - r.threshold).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 10, color: '#4b5563', marginTop: 12, lineHeight: 1.6 }}>
        Cálculo aproximado basado en la fecha de cierre de cada operación (agrupación por día calendario). El día de trading de Apex se reinicia a las 6:00 PM ET, así que operaciones cercanas a ese horario pueden contarse en un día distinto al real de tu cuenta. Verifica siempre tu dashboard oficial de Apex antes de tomar decisiones de riesgo.
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

export default function SMLMasterTerminal() {
  const [trades, setTrades]             = useState([]);
  const [mounted, setMounted]           = useState(false);
  const [activeView, setActiveView]     = useState('main');
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterResult, setFilterResult] = useState('all');
  const [filterAccount, setFilterAccount] = useState('');
  const [sortBy, setSortBy]             = useState('time');
  const [storageReady, setStorageReady] = useState(false);
  const [noteMap, setNoteMap]           = useState({});
  const [page, setPage]                 = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // index
  const [editTrade, setEditTrade]       = useState(null);   // { trade, index }
  const [csvError, setCsvError]         = useState('');
  const fileRef = useRef();

  // ── Cuentas de fondeo ──
  const [accounts, setAccounts]                       = useState([]);
  const [importAccountId, setImportAccountId]         = useState('');
  const [selectedFundingAccountId, setSelectedFundingAccountId] = useState('');
  const [editingAccount, setEditingAccount]           = useState(null); // null cerrado | 'new' | objeto cuenta
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(null); // id
  const [commissionPerContract, setCommissionPerContract] = useState(0);

  useEffect(() => {
    setMounted(true);
    Promise.all([loadTrades(), loadNotes(), loadAccounts(), loadSettings()]).then(([savedTrades, savedNotes, savedAccounts, savedSettings]) => {
      if (savedTrades.length) setTrades(savedTrades);
      if (savedNotes && Object.keys(savedNotes).length) setNoteMap(savedNotes);
      if (savedAccounts && savedAccounts.length) {
        setAccounts(savedAccounts);
        setSelectedFundingAccountId(savedAccounts[0].id);
      }
      if (savedSettings && typeof savedSettings.commissionPerContract === 'number') {
        setCommissionPerContract(savedSettings.commissionPerContract);
      }
      setStorageReady(true);
    });
  }, []);

  // ── Persist notes / accounts / settings on change ──
  useEffect(() => {
    if (storageReady) saveNotes(noteMap);
  }, [noteMap, storageReady]);

  useEffect(() => {
    if (storageReady) saveAccounts(accounts);
  }, [accounts, storageReady]);

  useEffect(() => {
    if (storageReady) saveSettings({ commissionPerContract });
  }, [commissionPerContract, storageReady]);

  // ── CSV Import with auto-detection ──
  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvError('');
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) { setCsvError('CSV vacío o sin trades.'); return; }

        const headers = lines[0].split(',').map(h => h.trim());
        const idx = detectAndMapHeaders(headers);

        if (idx.pnl < 0) { setCsvError(`No se encontró columna PnL. Columnas detectadas: ${headers.join(', ')}`); return; }

        const imported = lines.slice(1).map(row => {
          const cols = row.split(',').map(c => c.replace(/"/g, '').trim());
          if (cols.length < 2) return null;
          let rawPnl = (cols[idx.pnl] || '0').replace(/\$/g, '').replace(/,/g, '').trim();
          if (rawPnl.includes('(')) rawPnl = '-' + rawPnl.replace(/\(|\)/g, '');
          const pnl = parseFloat(rawPnl) || 0;
          const rawDateCol = idx.date >= 0 ? (cols[idx.date] || '').trim() : '';
          const rawTimeCol = idx.time >= 0 ? (cols[idx.time] || '').trim() : '';

          const looksLikeDate = (str) => /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(str);
          const looksLikeTime = (str) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(str);

          // Normaliza cualquier formato de fecha detectado a "YYYY-MM-DD"
          // (formato que usa internamente el calendario / agrupaciones por día).
          const normalizeDate = (str) => {
            if (!str) return '';
            // YYYY-MM-DD o YYYY/MM/DD
            let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
            if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
            // MM/DD/YYYY o MM-DD-YYYY (formato más común en brokers/plataformas US)
            m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
            if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
            return str;
          };

          let datePart = '';
          let timePart = '--:--:--';

          // 1) Si hay una columna de fecha separada y explícita, úsala primero.
          if (rawDateCol && looksLikeDate(rawDateCol)) {
            datePart = normalizeDate(rawDateCol);
          }

          // 2) Procesa la columna de "hora", que puede ser solo hora o un
          //    timestamp combinado de fecha+hora (separado por espacio o "T").
          if (rawTimeCol) {
            const normalized = rawTimeCol.replace('T', ' ');
            const parts = normalized.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
              const first = parts[0];
              const second = parts[1];
              if (looksLikeDate(first)) { if (!datePart) datePart = normalizeDate(first); timePart = second; }
              else if (looksLikeDate(second)) { if (!datePart) datePart = normalizeDate(second); timePart = first; }
              else { timePart = second; if (!datePart) datePart = normalizeDate(first); }
            } else if (parts.length === 1) {
              const only = parts[0];
              if (looksLikeTime(only) && !looksLikeDate(only)) {
                timePart = only;
              } else if (looksLikeDate(only)) {
                if (!datePart) datePart = normalizeDate(only);
              }
            }
          }

          const qtyVal = Math.abs(parseInt((idx.qty >= 0 ? cols[idx.qty] : '1') || '1')) || 1;
          const commission = qtyVal * (commissionPerContract || 0);
          return {
            pair: (idx.symbol >= 0 ? cols[idx.symbol] : 'UNKNOWN') || 'UNKNOWN',
            grossPnl: pnl,
            commission,
            pnl: pnl - commission,
            qty: qtyVal,
            time: timePart,
            date: datePart,
            side: idx.side >= 0 ? cols[idx.side] : '',
            setup: idx.setup >= 0 ? (cols[idx.setup] || '') : '',
            risk: idx.risk >= 0 ? (parseFloat((cols[idx.risk] || '0').replace(/[$,]/g, '')) || 0) : 0,
            account: importAccountId || null,
          };
        }).filter(t => t && !isNaN(t.pnl));

        if (!imported.length) { setCsvError('No se importaron trades válidos. Revisa el formato.'); return; }

        setTrades(imported);
        setPage(1);
        await saveTrades(imported);
      } catch (err) {
        setCsvError('Error procesando CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const clearData = async () => {
    setTrades([]);
    setNoteMap({});
    setConfirmClear(false);
    await saveTrades([]);
    await saveNotes({});
  };

  const deleteTrade = async (index) => {
    const updated = trades.filter((_, i) => i !== index);
    const newNotes = {};
    Object.entries(noteMap).forEach(([k, v]) => {
      const ki = parseInt(k);
      if (ki < index) newNotes[ki] = v;
      else if (ki > index) newNotes[ki - 1] = v;
    });
    setTrades(updated);
    setNoteMap(newNotes);
    setConfirmDelete(null);
    await saveTrades(updated);
    await saveNotes(newNotes);
  };

  const saveEditedTrade = async (index, updated) => {
    const newTrades = trades.map((t, i) => i === index ? { ...t, ...updated } : t);
    setTrades(newTrades);
    setEditTrade(null);
    await saveTrades(newTrades);
  };

  // ── Cuentas de fondeo: CRUD ──
  const handleSaveAccount = (data) => {
    setAccounts(prev => {
      const exists = prev.some(a => a.id === data.id);
      return exists ? prev.map(a => a.id === data.id ? data : a) : [...prev, data];
    });
    if (!selectedFundingAccountId) setSelectedFundingAccountId(data.id);
    setEditingAccount(null);
  };

  const deleteAccountById = async (id) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
    const updatedTrades = trades.map(t => t.account === id ? { ...t, account: null } : t);
    setTrades(updatedTrades);
    await saveTrades(updatedTrades);
    if (importAccountId === id) setImportAccountId('');
    if (selectedFundingAccountId === id) setSelectedFundingAccountId('');
    setConfirmDeleteAccount(null);
  };

  const assignUnassignedTradesToAccount = async (accountId) => {
    const updatedTrades = trades.map(t => (!t.account) ? { ...t, account: accountId } : t);
    setTrades(updatedTrades);
    await saveTrades(updatedTrades);
  };

  // Recalcula el PnL neto de TODOS los trades usando la comisión por contrato actual.
  // Si un trade no tiene grossPnl guardado (importado antes de esta función), asume
  // que su pnl actual es el bruto y a partir de ahí resta la comisión nueva.
  const recalcCommissions = async () => {
    const updatedTrades = trades.map(t => {
      const gross = (typeof t.grossPnl === 'number') ? t.grossPnl : (t.pnl + (t.commission || 0));
      const commission = t.qty * (commissionPerContract || 0);
      return { ...t, grossPnl: gross, commission, pnl: gross - commission };
    });
    setTrades(updatedTrades);
    await saveTrades(updatedTrades);
  };

  // ── Export CSV ──
  const exportCSV = () => {
    const headers = ['symbol','date','time','qty','pnl_neto','pnl_bruto','comision','side','setup','risk','account','nota'];
    const rows = trades.map((t, i) => [
      t.pair, t.date, t.time, t.qty, t.pnl.toFixed(2), (typeof t.grossPnl === 'number' ? t.grossPnl.toFixed(2) : t.pnl.toFixed(2)), (t.commission || 0).toFixed(2), t.side, t.setup || '', t.risk || 0, t.account || '', (noteMap[i] || '').replace(/,/g, ';')
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `sml-journal-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    let filtered = [...trades];
    if (filterSymbol) filtered = filtered.filter(t => t.pair === filterSymbol);
    if (filterResult === 'win')  filtered = filtered.filter(t => t.pnl > 0);
    if (filterResult === 'loss') filtered = filtered.filter(t => t.pnl < 0);
    if (filterAccount === '__none__') filtered = filtered.filter(t => !t.account);
    else if (filterAccount) filtered = filtered.filter(t => t.account === filterAccount);
    if (sortBy === 'pnl') filtered.sort((a, b) => b.pnl - a.pnl);

    const wins   = filtered.filter(t => t.pnl > 0);
    const losses = filtered.filter(t => t.pnl < 0);
    const gp = wins.reduce((a, t) => a + t.pnl, 0);
    const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const aw = wins.length ? gp / wins.length : 0;
    const al = losses.length ? gl / losses.length : 0;
    const wr = filtered.length ? wins.length / filtered.length : 0;
    const expectancy = wr * aw - (1 - wr) * al;

    // Max Drawdown
    let eq = 0, peak = 0, maxDD = 0;
    trades.forEach(t => { eq += t.pnl; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; });
    const netAll = trades.reduce((a, t) => a + t.pnl, 0);
    const calmar = maxDD > 0 ? (netAll / maxDD).toFixed(2) : '∞';

    // Equity curve data
    let acc = 0;
    const equityData = trades.map(t => { acc += t.pnl; return acc; });

    // Streak analysis
    let streak = 0, streakType = '', maxWStreak = 0, maxLStreak = 0, cur = 0, curType = '';
    for (let i = 0; i < trades.length; i++) {
      const isW = trades[i].pnl > 0;
      if (i === 0) { curType = isW ? 'W' : 'L'; cur = 1; }
      else if ((isW && curType === 'W') || (!isW && curType === 'L')) cur++;
      else { if (curType === 'W' && cur > maxWStreak) maxWStreak = cur; if (curType === 'L' && cur > maxLStreak) maxLStreak = cur; curType = isW ? 'W' : 'L'; cur = 1; }
    }
    if (curType === 'W' && cur > maxWStreak) maxWStreak = cur;
    if (curType === 'L' && cur > maxLStreak) maxLStreak = cur;
    for (let i = trades.length - 1; i >= 0; i--) {
      const isW = trades[i].pnl > 0;
      if (i === trades.length - 1) { streakType = isW ? 'W' : 'L'; streak = 1; }
      else if ((isW && streakType === 'W') || (!isW && streakType === 'L')) streak++;
      else break;
    }

    // By day of week
    const dowMap = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
    const byDow = {};
    trades.forEach(t => {
      if (!t.date) return;
      try { const d = new Date(t.date + 'T12:00:00'); const k = dowMap[d.getDay()]; byDow[k] = (byDow[k] || 0) + t.pnl; } catch (_) {}
    });

    // By hour
    const byHour = {};
    trades.forEach(t => {
      if (!t.time || t.time === '--:--:--') return;
      const h = t.time.split(':')[0] + ':00';
      byHour[h] = (byHour[h] || 0) + t.pnl;
    });

    const syms = [...new Set(trades.map(t => t.pair))].sort();

    // ── R-múltiplos (basado en riesgo planeado por trade) ──
    const rBasis = filtered.filter(t => t.risk && t.risk > 0);
    const rValues = rBasis.map(t => t.pnl / t.risk);
    const avgR = rValues.length ? (rValues.reduce((a, v) => a + v, 0) / rValues.length) : 0;
    const bestR = rValues.length ? Math.max(...rValues) : 0;
    const worstR = rValues.length ? Math.min(...rValues) : 0;
    const rBuckets = { '≤ -2R': 0, '-2R a -1R': 0, '-1R a 0R': 0, '0R a 1R': 0, '1R a 2R': 0, '2R a 3R': 0, '> 3R': 0 };
    rValues.forEach(r => {
      if (r <= -2) rBuckets['≤ -2R']++;
      else if (r <= -1) rBuckets['-2R a -1R']++;
      else if (r < 0) rBuckets['-1R a 0R']++;
      else if (r < 1) rBuckets['0R a 1R']++;
      else if (r < 2) rBuckets['1R a 2R']++;
      else if (r < 3) rBuckets['2R a 3R']++;
      else rBuckets['> 3R']++;
    });

    // ── Rendimiento por Setup / Estrategia ──
    const bySetup = {};
    filtered.forEach(t => {
      const key = (t.setup && t.setup.trim()) ? t.setup.trim() : 'Sin Setup';
      if (!bySetup[key]) bySetup[key] = { count: 0, pnl: 0, wins: 0, gp: 0, gl: 0, rSum: 0, rCount: 0 };
      const b = bySetup[key];
      b.count++; b.pnl += t.pnl;
      if (t.pnl > 0) { b.wins++; b.gp += t.pnl; } else { b.gl += Math.abs(t.pnl); }
      if (t.risk > 0) { b.rSum += t.pnl / t.risk; b.rCount++; }
    });
    Object.values(bySetup).forEach(b => {
      b.winRate = b.count ? (b.wins / b.count * 100) : 0;
      b.pf = b.gl > 0 ? (b.gp / b.gl) : (b.gp > 0 ? Infinity : 0);
      b.avgR = b.rCount ? (b.rSum / b.rCount) : null;
    });

    // ── Regla de consistencia global (mejor día vs. profit total) ──
    const byDayAll = {};
    trades.forEach(t => { if (t.date) byDayAll[t.date] = (byDayAll[t.date] || 0) + t.pnl; });
    const dayValsAll = Object.values(byDayAll);
    const bestDayAll = dayValsAll.length ? Math.max(...dayValsAll) : 0;
    const consistencyGlobalPct = netAll > 0 ? (bestDayAll / netAll * 100) : 0;

    return {
      filteredTrades: filtered,
      totalTrades: filtered.length,
      netProfit: filtered.reduce((a, t) => a + t.pnl, 0),
      winningTrades: wins, losingTrades: losses,
      grossProfit: gp, grossLoss: gl,
      winRate: filtered.length ? ((wins.length / filtered.length) * 100).toFixed(1) : '0.0',
      profitFactor: gl > 0 ? (gp / gl).toFixed(2) : gp > 0 ? '∞' : '0.00',
      avgWin: aw, avgLoss: al,
      rr: al > 0 ? (aw / al).toFixed(2) : '∞',
      expectancy: expectancy.toFixed(2),
      maxDD: maxDD.toFixed(2),
      calmar,
      symbols: syms,
      equityData,
      winPnls: wins.map(t => t.pnl),
      lossPnls: losses.map(t => Math.abs(t.pnl)),
      maxWin:  wins.length   ? Math.max(...wins.map(t => t.pnl))         : 0,
      maxLoss: losses.length ? Math.max(...losses.map(t => Math.abs(t.pnl))) : 0,
      streak: { count: streak, type: streakType },
      maxWStreak, maxLStreak,
      byDow, byHour,
      rValues, avgR, bestR, worstR, rBuckets, bySetup,
      consistencyGlobalPct, bestDayAll,
    };
  }, [trades, filterSymbol, filterResult, filterAccount, sortBy]);

  const { filteredTrades, totalTrades, netProfit, winningTrades, losingTrades,
    grossProfit, grossLoss, winRate, profitFactor, avgWin, avgLoss, rr,
    expectancy, maxDD, calmar, symbols, equityData, winPnls, lossPnls,
    maxWin, maxLoss, streak, maxWStreak, maxLStreak, byDow, byHour,
    rValues, avgR, bestR, worstR, rBuckets, bySetup, consistencyGlobalPct, bestDayAll } = metrics;

  const totalPages = Math.ceil(filteredTrades.length / PAGE_SIZE);
  const pagedTrades = filteredTrades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectedFundingAccount = accounts.find(a => a.id === selectedFundingAccountId) || accounts[0] || null;

  if (!mounted) return null;

  // ─── Styles ───────────────────────────────────────────────────────────────────
  const s = {
    root: { display: 'flex', height: '100vh', background: '#020202', color: '#cbd5e1', fontFamily: '"DM Sans", "Helvetica Neue", sans-serif', overflow: 'hidden', fontStyle: 'italic' },
    sidebar: { width: 290, borderRight: '1px solid rgba(255,255,255,0.04)', background: '#050505', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, overflowY: 'auto' },
    logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 },
    logoIcon: { width: 44, height: 44, background: '#10b981', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', boxShadow: '0 0 40px rgba(16,185,129,0.3)', flexShrink: 0 },
    sideBtn: (active) => ({
      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
      borderRadius: 20, border: active ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.06)',
      background: active ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.02)',
      color: active ? '#10b981' : '#94a3b8', cursor: 'pointer', width: '100%',
      fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontStyle: 'italic',
      transition: 'all 0.2s',
    }),
    uploadBtn: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 20, border: '1px dashed rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.04)', color: '#10b981', cursor: 'pointer', width: '100%', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontStyle: 'italic' },
    effBox: { marginTop: 'auto', padding: '20px', borderRadius: 24, background: '#080808', border: '1px solid rgba(255,255,255,0.04)' },
    main: { flex: 1, padding: '28px 32px', overflowY: 'auto', background: 'radial-gradient(circle at top right, rgba(16,185,129,0.02), transparent 40%)' },
    card: { background: '#080808', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 24, padding: '20px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.4)', transition: 'transform 0.2s' },
    label: { fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', fontStyle: 'italic', marginBottom: 6, display: 'block' },
    filterRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
    filterBtn: (active) => ({
      padding: '7px 16px', borderRadius: 20, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', fontStyle: 'italic',
      background: active ? '#10b981' : 'rgba(255,255,255,0.05)', color: active ? '#000' : '#64748b', transition: 'all 0.15s',
    }),
    select: { background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#94a3b8', fontSize: 11, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', fontStyle: 'italic', outline: 'none' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '12px 16px', fontSize: 10, fontWeight: 800, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.18em', fontStyle: 'italic', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.04)' },
    td: { padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)', verticalAlign: 'middle' },
    badge: (isWin) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontStyle: 'italic', background: isWin ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: isWin ? '#10b981' : '#ef4444', border: `1px solid ${isWin ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }),
  };

  const MetricCard = ({ label, value, color = '#fff', sub, icon }) => (
    <div style={s.card}>
      <span style={{ ...s.label, color: color }}>{icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}</span>
      <div style={{ fontSize: 34, fontWeight: 900, color, fontStyle: 'italic', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 5, fontWeight: 700 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={s.root}>
      {/* Modals */}
      {confirmClear && <ConfirmDialog message="¿Eliminar TODOS los trades?" onConfirm={clearData} onCancel={() => setConfirmClear(false)} />}
      {confirmDelete !== null && <ConfirmDialog message={`¿Eliminar trade #${confirmDelete + 1}?`} onConfirm={() => deleteTrade(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}
      {editTrade && <EditTradeModal trade={editTrade.trade} index={editTrade.index} accounts={accounts} onSave={saveEditedTrade} onClose={() => setEditTrade(null)} />}
      {editingAccount !== null && (
        <AccountModal
          account={editingAccount === 'new' ? null : editingAccount}
          onSave={handleSaveAccount}
          onClose={() => setEditingAccount(null)}
        />
      )}
      {confirmDeleteAccount && (
        <ConfirmDialog
          message={`¿Eliminar la cuenta "${accounts.find(a => a.id === confirmDeleteAccount)?.name || ''}"?`}
          onConfirm={() => deleteAccountById(confirmDeleteAccount)}
          onCancel={() => setConfirmDeleteAccount(null)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <div style={s.logoIcon}><Zap size={22} fill="currentColor" /></div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1 }}>SML Master</div>
            <div style={{ fontSize: 9, color: '#10b981', fontWeight: 800, letterSpacing: '0.3em', marginTop: 2 }}>TRADING JOURNAL</div>
          </div>
        </div>

        <label style={s.uploadBtn}>
          <Upload size={16} />
          <span>Sincronizar CSV</span>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVImport} />
        </label>

        {accounts.length > 0 && (
          <select value={importAccountId} onChange={e => setImportAccountId(e.target.value)} style={{ ...s.select, width: '100%' }}>
            <option value="">Importar sin asignar cuenta</option>
            {accounts.map(a => <option key={a.id} value={a.id}>Asignar a: {a.name}</option>)}
          </select>
        )}

        {csvError && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '10px 14px', fontSize: 10, color: '#ef4444', fontWeight: 700, lineHeight: 1.5 }}>
            ⚠ {csvError}
          </div>
        )}

        <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 16, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Comisión por contrato ($)</div>
          <input
            type="number"
            step="0.01"
            value={commissionPerContract}
            onChange={e => setCommissionPerContract(parseFloat(e.target.value) || 0)}
            placeholder="Ej: 1.02"
            style={{ width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, padding: '7px 10px', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
          />
          {trades.length > 0 && (
            <button onClick={recalcCommissions} style={{ width: '100%', padding: '8px', borderRadius: 12, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Recalcular en todos los trades
            </button>
          )}
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 8, lineHeight: 1.5 }}>
            Se resta por contrato (round turn) del PnL bruto de cada import. Nuevos imports la aplican automático; usa "Recalcular" para aplicarla a trades ya cargados.
          </div>
        </div>

        {trades.length > 0 && (
          <>
            <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 20, border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(96,165,250,0.05)', color: '#60a5fa', cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontStyle: 'italic', width: '100%' }}>
              <Download size={14} /> Exportar CSV
            </button>
            <button onClick={() => setConfirmClear(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 20, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontStyle: 'italic', width: '100%' }}>
              <RefreshCw size={14} /> Limpiar datos
            </button>
          </>
        )}

        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '8px 0' }} />

        {[
          { id: 'main',       label: 'Journal',      icon: <Activity size={16} /> },
          { id: 'funding',    label: 'Fondeo',       icon: <Target size={16} /> },
          { id: 'equity',     label: 'Equity Curve',  icon: <LineChart size={16} /> },
          { id: 'advanced',   label: 'Analytics',     icon: <BarChart3 size={16} /> },
          { id: 'calendar',   label: 'Calendario',    icon: <Calendar size={16} /> },
          { id: 'benchmarks', label: 'Benchmarks',    icon: <BookOpen size={16} /> },
        ].map(({ id, label, icon }) => (
          <button key={id} style={s.sideBtn(activeView === id)} onClick={() => setActiveView(id)}>
            {icon}{label}
            {activeView !== id && <ArrowUpRight size={12} style={{ marginLeft: 'auto', opacity: 0.4 }} />}
          </button>
        ))}

        <div style={s.effBox}>
          <div style={{ ...s.label, color: '#4b5563' }}>Efficiency Score</div>
          <div style={{ fontSize: 44, fontWeight: 900, color: parseFloat(winRate) >= 60 ? '#10b981' : parseFloat(winRate) >= 45 ? '#f59e0b' : '#ef4444', fontStyle: 'italic', lineHeight: 1 }}>{winRate}%</div>
          {streak.count > 1 && (
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, color: streak.type === 'W' ? '#10b981' : '#ef4444', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Flame size={13} /> {streak.count} {streak.type === 'W' ? 'WIN' : 'LOSS'} STREAK
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 10, color: '#4b5563', fontWeight: 700 }}>
            Max W: {maxWStreak} · Max L: {maxLStreak}
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <main style={s.main}>

        {/* ══ JOURNAL VIEW ══════════════════════════════════════════════════════ */}
        {activeView === 'main' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: 54, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, margin: 0 }}>Journal</h1>
              <p style={{ color: '#4b5563', fontSize: 10, fontWeight: 800, letterSpacing: '0.35em', marginTop: 6, textTransform: 'uppercase' }}>
                {storageReady ? '● DATOS GUARDADOS LOCALMENTE' : '○ CARGANDO...'} • {trades.length} TRADES TOTALES
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <MetricCard label="Net PnL" value={`$${netProfit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`} color={netProfit >= 0 ? '#10b981' : '#ef4444'} />
              <MetricCard label="Gross Loss" value={`-$${grossLoss.toLocaleString(undefined,{minimumFractionDigits:2})}`} color="#ef4444" />
              <MetricCard label="Profit Factor" value={profitFactor} color="#60a5fa" sub={parseFloat(profitFactor) >= 2 ? 'NIVEL PROFESIONAL' : parseFloat(profitFactor) >= 1.5 ? 'SÓLIDO' : 'MEJORAR'} />
              <MetricCard label="Trades" value={totalTrades} color="#fff" sub={`${winningTrades.length}W / ${losingTrades.length}L`} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
              <MetricCard label="Avg Win" value={`$${avgWin.toFixed(2)}`} color="#10b981" />
              <MetricCard label="Avg Loss" value={`-$${avgLoss.toFixed(2)}`} color="#ef4444" />
              <MetricCard label="Risk/Reward" value={rr} color="#a78bfa" sub="Avg W / Avg L" />
              <MetricCard label="Expectancy" value={`$${expectancy}`} color={parseFloat(expectancy) >= 0 ? '#10b981' : '#ef4444'} sub="Por trade" />
            </div>

            {/* Filters */}
            <div style={s.filterRow}>
              <Filter size={14} style={{ color: '#4b5563' }} />
              {['all','win','loss'].map(f => (
                <button key={f} style={s.filterBtn(filterResult === f)} onClick={() => { setFilterResult(f); setPage(1); }}>
                  {f === 'all' ? 'Todos' : f === 'win' ? 'Wins' : 'Losses'}
                </button>
              ))}
              <select style={s.select} value={filterSymbol} onChange={e => { setFilterSymbol(e.target.value); setPage(1); }}>
                <option value="">Todos los símbolos</option>
                {symbols.map(sym => <option key={sym} value={sym}>{sym}</option>)}
              </select>
              {accounts.length > 0 && (
                <select style={s.select} value={filterAccount} onChange={e => { setFilterAccount(e.target.value); setPage(1); }}>
                  <option value="">Todas las cuentas</option>
                  <option value="__none__">Sin cuenta</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <select style={s.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="time">Ordenar: Tiempo</option>
                <option value="pnl">Ordenar: PnL</option>
              </select>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4b5563', fontWeight: 700 }}>
                {filteredTrades.length} trades · pág. {page}/{totalPages || 1}
              </span>
            </div>

            {/* Trade table */}
            <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
              {pagedTrades.length === 0 ? (
                <div style={{ padding: '48px 0', textAlign: 'center', color: '#4b5563', fontSize: 13, fontWeight: 800, letterSpacing: '0.2em', fontStyle: 'italic' }}>
                  {trades.length === 0 ? '— IMPORTA UN CSV PARA COMENZAR —' : '— SIN RESULTADOS CON ESTOS FILTROS —'}
                </div>
              ) : (
                <table style={s.table}>
                  <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <tr>
                      {['#','Instrumento','Fecha','Hora','Qty','PnL Real','Resultado','Nota','Acciones'].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrades.map((t, pi) => {
                      const globalIdx = trades.indexOf(t);
                      const isWin = t.pnl > 0;
                      return (
                        <tr key={pi} style={{ transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.01)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ ...s.td, color: '#2d3748', fontSize: 11, fontWeight: 700 }}>{(page-1)*PAGE_SIZE + pi + 1}</td>
                          <td style={s.td}>
                            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontStyle: 'italic', letterSpacing: '-0.02em' }}>{t.pair}</span>
                          </td>
                          <td style={{ ...s.td, color: '#4b5563', fontSize: 12, fontWeight: 700 }}>{t.date || '—'}</td>
                          <td style={{ ...s.td, color: '#4b5563', fontSize: 12, fontWeight: 700 }}>{t.time}</td>
                          <td style={{ ...s.td, color: '#94a3b8', fontSize: 14, fontWeight: 700 }}>×{t.qty}</td>
                          <td style={{ ...s.td, fontSize: 20, fontWeight: 900, color: isWin ? '#10b981' : '#ef4444', fontStyle: 'italic' }}>
                            {isWin ? '+' : ''}{t.pnl.toFixed(2)}
                          </td>
                          <td style={s.td}><span style={s.badge(isWin)}>{isWin ? 'WIN' : 'LOSS'}</span></td>
                          <td style={s.td}>
                            <input
                              type="text"
                              placeholder="Nota psicológica..."
                              value={noteMap[globalIdx] || ''}
                              onChange={e => setNoteMap(prev => ({ ...prev, [globalIdx]: e.target.value }))}
                              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#64748b', fontSize: 11, fontWeight: 700, fontStyle: 'italic', outline: 'none', width: '100%', minWidth: 120, padding: '2px 0', letterSpacing: '0.05em' }}
                            />
                          </td>
                          <td style={s.td}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setEditTrade({ trade: t, index: globalIdx })} style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: '#60a5fa', display: 'flex', alignItems: 'center' }} title="Editar">
                                <Edit3 size={13} />
                              </button>
                              <button onClick={() => setConfirmDelete(globalIdx)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center' }} title="Eliminar">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 16 }}>
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '8px 14px', cursor: page === 1 ? 'not-allowed' : 'pointer', color: page === 1 ? '#2d3748' : '#94a3b8', display: 'flex', alignItems: 'center' }}>
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i+1).map(p => (
                  <button key={p} onClick={() => setPage(p)} style={{ background: p === page ? '#10b981' : 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', color: p === page ? '#000' : '#64748b', fontWeight: 900, fontSize: 12, fontStyle: 'italic' }}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '8px 14px', cursor: page === totalPages ? 'not-allowed' : 'pointer', color: page === totalPages ? '#2d3748' : '#94a3b8', display: 'flex', alignItems: 'center' }}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══ FONDEO ══════════════════════════════════════════════════════════════ */}
        {activeView === 'funding' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 20 }}>
              <h2 style={{ fontSize: 44, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', margin: 0 }}>Cuentas de Fondeo</h2>
              <button onClick={() => setActiveView('main')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', padding: 10, cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={20} /></button>
            </div>

            {accounts.length === 0 ? (
              <div style={{ ...s.card, textAlign: 'center', padding: '48px 24px' }}>
                <Target size={40} style={{ color: '#10b981', marginBottom: 16 }} />
                <p style={{ color: '#fff', fontWeight: 800, fontStyle: 'italic', fontSize: 18, marginBottom: 8 }}>Aún no tienes cuentas de fondeo configuradas</p>
                <p style={{ color: '#4b5563', fontSize: 12, marginBottom: 24, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
                  Crea una cuenta (25K, 50K, 100K o 150K, Evaluación o Fondeada) con las reglas de Apex Trader Funding precargadas y monitorea tu progreso hacia la meta.
                </p>
                <button onClick={() => setEditingAccount('new')} style={{ padding: '12px 28px', borderRadius: 20, border: 'none', background: '#10b981', color: '#000', cursor: 'pointer', fontWeight: 900, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>+ Crear Primera Cuenta</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                  <select value={selectedFundingAccountId} onChange={e => setSelectedFundingAccountId(e.target.value)} style={{ ...s.select, fontSize: 13, padding: '10px 16px' }}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {a.size} ({a.phase === 'eval' ? 'Evaluación' : 'Fondeada'})</option>)}
                  </select>
                  <button onClick={() => setEditingAccount(selectedFundingAccount)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 16, border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(96,165,250,0.05)', color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
                    <Edit3 size={13} /> Editar
                  </button>
                  <button onClick={() => setConfirmDeleteAccount(selectedFundingAccountId)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 16, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
                    <Trash2 size={13} /> Eliminar
                  </button>
                  {trades.some(t => !t.account) && (
                    <button
                      onClick={() => assignUnassignedTradesToAccount(selectedFundingAccountId)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 16, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)', color: '#f59e0b', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}
                    >
                      <Upload size={13} /> Asignar Trades Sin Cuenta ({trades.filter(t => !t.account).length})
                    </button>
                  )}
                  <button onClick={() => setEditingAccount('new')} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 16, border: '1px dashed rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)', color: '#10b981', cursor: 'pointer', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
                    + Nueva Cuenta
                  </button>
                </div>
                {trades.some(t => !t.account) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 16, padding: '12px 18px', marginBottom: 16 }}>
                    <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', fontStyle: 'italic' }}>
                      Tienes {trades.filter(t => !t.account).length} trades sin cuenta asignada (probablemente importados antes de crear esta cuenta). Usa el botón "Asignar Trades Sin Cuenta" para vincularlos a "{selectedFundingAccount?.name}".
                    </span>
                  </div>
                )}
                {selectedFundingAccount && <FundedAccountPanel account={selectedFundingAccount} trades={trades} />}
              </>
            )}
          </div>
        )}

        {/* ══ EQUITY CURVE ═══════════════════════════════════════════════════════ */}
        {activeView === 'equity' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 20 }}>
              <h2 style={{ fontSize: 44, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', margin: 0 }}>Equity Curve</h2>
              <button onClick={() => setActiveView('main')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', padding: 10, cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={20} /></button>
            </div>
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={{ ...s.label, color: '#60a5fa' }}>PnL Acumulado — Todos los trades</div>
              <EquityCurve trades={trades} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <MetricCard label="Net PnL Total" value={`$${trades.reduce((a,t)=>a+t.pnl,0).toFixed(2)}`} color={trades.reduce((a,t)=>a+t.pnl,0)>=0?'#10b981':'#ef4444'} />
              <MetricCard label="Mejor Trade" value={`+$${maxWin.toFixed(2)}`} color="#10b981" />
              <MetricCard label="Peor Trade" value={`-$${maxLoss.toFixed(2)}`} color="#ef4444" />
              <MetricCard label="Max Drawdown" value={`-$${maxDD}`} color="#f59e0b" sub="Desde el pico" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 16 }}>
              <MetricCard label="Calmar Ratio" value={calmar} color="#a78bfa" sub="Net PnL / Max Drawdown" />
              <MetricCard label="Expectancy/Trade" value={`$${expectancy}`} color={parseFloat(expectancy)>=0?'#10b981':'#ef4444'} sub="(WR × AvgW) − (LR × AvgL)" />
            </div>
            {symbols.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
                {symbols.map(sym => {
                  const symTrades = trades.filter(t => t.pair === sym);
                  let acc = 0;
                  const eq = symTrades.map(t => { acc += t.pnl; return acc; });
                  const total = symTrades.reduce((a,t)=>a+t.pnl,0);
                  return (
                    <div key={sym} style={s.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontStyle: 'italic' }}>{sym}</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: total>=0?'#10b981':'#ef4444', fontStyle: 'italic' }}>${total.toFixed(2)}</span>
                      </div>
                      <Sparkline data={eq} color={total>=0?'#10b981':'#ef4444'} width={220} height={40} />
                      <div style={{ fontSize: 10, color: '#4b5563', marginTop: 6, fontWeight: 700, letterSpacing: '0.12em' }}>{symTrades.length} TRADES</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ ADVANCED ANALYTICS ════════════════════════════════════════════════ */}
        {activeView === 'advanced' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 20 }}>
              <h2 style={{ fontSize: 44, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', margin: 0 }}>Performance Report</h2>
              <button onClick={() => setActiveView('main')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', padding: 10, cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <MetricCard label="Net PnL" value={`$${netProfit.toFixed(2)}`} color={netProfit>=0?'#10b981':'#ef4444'} />
              <MetricCard label="Gross Profit" value={`$${grossProfit.toFixed(2)}`} color="#fff" />
              <MetricCard label="Gross Loss" value={`-$${grossLoss.toFixed(2)}`} color="#ef4444" />
              <MetricCard label="Profit Factor" value={profitFactor} color="#60a5fa" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <MetricCard label="Max Drawdown" value={`-$${maxDD}`} color="#f59e0b" sub="Desde el pico de equity" />
              <MetricCard label="Calmar Ratio" value={calmar} color="#a78bfa" sub="Net / Max DD" />
              <MetricCard label="Expectancy" value={`$${expectancy}`} color={parseFloat(expectancy)>=0?'#10b981':'#ef4444'} sub="Por trade esperado" />
              <MetricCard label="Concentración Mejor Día" value={`${consistencyGlobalPct.toFixed(0)}%`} color={consistencyGlobalPct > 50 ? '#ef4444' : '#10b981'} sub={`Mejor día: $${bestDayAll.toFixed(2)}`} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900, color: '#10b981', fontStyle: 'italic', textTransform: 'uppercase' }}><CheckCircle2 size={18} /> Wins</span>
                  <span style={{ fontSize: 36, fontWeight: 900, color: '#fff' }}>{winningTrades.length}</span>
                </div>
                <BarChart values={winPnls} color="rgba(16,185,129,0.6)" />
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 8, fontWeight: 700, letterSpacing: '0.12em' }}>AVG WIN: ${avgWin.toFixed(2)} — MEJOR: ${maxWin.toFixed(2)}</div>
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900, color: '#ef4444', fontStyle: 'italic', textTransform: 'uppercase' }}><XCircle size={18} /> Losses</span>
                  <span style={{ fontSize: 36, fontWeight: 900, color: '#fff' }}>{losingTrades.length}</span>
                </div>
                <BarChart values={lossPnls} color="rgba(239,68,68,0.5)" />
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 8, fontWeight: 700, letterSpacing: '0.12em' }}>AVG LOSS: -${avgLoss.toFixed(2)} — PEOR: -${maxLoss.toFixed(2)}</div>
              </div>
            </div>

            {/* R-Múltiplos */}
            {rValues.length > 0 && (
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ ...s.label, color: '#60a5fa', marginBottom: 16 }}>Distribución de R-Múltiplos (riesgo real vs. resultado)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(rBuckets).map(([bucket, count]) => {
                    const isNeg = bucket.includes('-') || bucket.startsWith('≤');
                    return (
                      <div key={bucket} style={{ flex: '1 1 100px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#4b5563', fontWeight: 800, marginBottom: 4, letterSpacing: '0.05em' }}>{bucket}</div>
                        <div style={{ background: isNeg ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${isNeg ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, borderRadius: 10, padding: '10px 4px' }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: isNeg ? '#ef4444' : '#10b981', fontStyle: 'italic' }}>{count}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 12, fontWeight: 700, letterSpacing: '0.08em' }}>
                  PROMEDIO: {avgR.toFixed(2)}R — MEJOR: {bestR.toFixed(2)}R — PEOR: {worstR.toFixed(2)}R — BASADO EN {rValues.length} TRADES CON RIESGO DEFINIDO
                </div>
              </div>
            )}

            {/* Rendimiento por Setup */}
            {Object.keys(bySetup).length > 0 && (
              <div style={{ ...s.card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px' }}>
                  <span style={{ ...s.label, color: '#a78bfa', marginBottom: 0 }}>Rendimiento por Setup / Estrategia</span>
                </div>
                <table style={s.table}>
                  <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <tr>
                      {['Setup','Trades','Win Rate','Net PnL','Avg R','Profit Factor'].map(h => <th key={h} style={s.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(bySetup).sort(([,a],[,b]) => b.pnl - a.pnl).map(([name, b]) => (
                      <tr key={name}>
                        <td style={{ ...s.td, color: '#fff', fontSize: 14, fontWeight: 800, fontStyle: 'italic' }}>{name}</td>
                        <td style={{ ...s.td, color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>{b.count}</td>
                        <td style={{ ...s.td, color: b.winRate >= 50 ? '#10b981' : '#ef4444', fontSize: 13, fontWeight: 800 }}>{b.winRate.toFixed(1)}%</td>
                        <td style={{ ...s.td, color: b.pnl >= 0 ? '#10b981' : '#ef4444', fontSize: 15, fontWeight: 900, fontStyle: 'italic' }}>{b.pnl >= 0 ? '+' : ''}${b.pnl.toFixed(2)}</td>
                        <td style={{ ...s.td, color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>{b.avgR !== null ? `${b.avgR.toFixed(2)}R` : '—'}</td>
                        <td style={{ ...s.td, color: '#60a5fa', fontSize: 13, fontWeight: 700 }}>{b.pf === Infinity ? '∞' : b.pf.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* PnL by Day of Week */}
            {Object.keys(byDow).length > 0 && (
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ ...s.label, color: '#f59e0b', marginBottom: 16 }}>PnL por Día de la Semana</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].filter(d => byDow[d] !== undefined).map(d => {
                    const val = byDow[d] || 0;
                    const isPos = val >= 0;
                    return (
                      <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#4b5563', fontWeight: 800, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d}</div>
                        <div style={{ background: isPos ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${isPos ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 12, padding: '10px 4px' }}>
                          <div style={{ fontSize: 14, fontWeight: 900, color: isPos ? '#10b981' : '#ef4444', fontStyle: 'italic' }}>{isPos ? '+' : ''}${val.toFixed(0)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* PnL by Hour */}
            {Object.keys(byHour).length > 0 && (
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ ...s.label, color: '#a78bfa', marginBottom: 16 }}>PnL por Hora de Sesión</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(byHour).sort(([a],[b]) => a.localeCompare(b)).map(([hour, val]) => {
                    const isPos = val >= 0;
                    return (
                      <div key={hour} style={{ textAlign: 'center', minWidth: 56 }}>
                        <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 800, marginBottom: 4 }}>{hour}</div>
                        <div style={{ background: isPos ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderRadius: 10, padding: '8px 4px' }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: isPos ? '#10b981' : '#ef4444', fontStyle: 'italic' }}>{isPos ? '+' : ''}${val.toFixed(0)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Win rate donut + grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div style={{ ...s.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(239,68,68,0.15)" strokeWidth="12" />
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#10b981" strokeWidth="12"
                    strokeDasharray={`${(parseFloat(winRate)/100)*314} 314`}
                    strokeDashoffset="78.5" strokeLinecap="round" transform="rotate(-90 60 60)" />
                  <text x="60" y="65" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="900" fontStyle="italic">{winRate}%</text>
                </svg>
                <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Win Rate</span>
              </div>
              <div style={{ ...s.card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Avg Win',     value: `$${avgWin.toFixed(2)}`,   color: '#10b981' },
                  { label: 'Avg Loss',    value: `-$${avgLoss.toFixed(2)}`,  color: '#ef4444' },
                  { label: 'Risk/Reward', value: rr,                         color: '#a78bfa' },
                  { label: 'Total Trades',value: totalTrades,                color: '#fff' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ ...s.label, color: '#4b5563' }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color, fontStyle: 'italic' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ CALENDARIO / HEATMAP ════════════════════════════════════════════════ */}
        {activeView === 'calendar' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 20 }}>
              <h2 style={{ fontSize: 44, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', margin: 0 }}>Calendario Operativo</h2>
              <button onClick={() => setActiveView('main')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', padding: 10, cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
              {(() => {
                const byDay = {};
                trades.forEach(t => { if (t.date) byDay[t.date] = (byDay[t.date]||0)+t.pnl; });
                const vals = Object.values(byDay);
                const profDays = vals.filter(v=>v>0).length;
                const lossDays = vals.filter(v=>v<0).length;
                const bestDay = vals.length ? Math.max(...vals) : 0;
                const worstDay = vals.length ? Math.min(...vals) : 0;
                return (
                  <>
                    <MetricCard label="Días Rentables" value={profDays} color="#10b981" sub={`de ${vals.length} días`} />
                    <MetricCard label="Mejor Día" value={`+$${bestDay.toFixed(2)}`} color="#10b981" />
                    <MetricCard label="Peor Día" value={`$${worstDay.toFixed(2)}`} color="#ef4444" />
                  </>
                );
              })()}
            </div>

            {/* Componente del Calendario Rediseñado */}
            <div style={{ ...s.card, padding: '24px' }}>
              <HeatmapCalendar trades={trades} />
            </div>

            {/* Table by day */}
            {(() => {
              const byDay = {};
              trades.forEach(t => {
                if (!t.date) return;
                if (!byDay[t.date]) byDay[t.date] = { pnl: 0, count: 0 };
                byDay[t.date].pnl += t.pnl;
                byDay[t.date].count++;
              });
              const sorted = Object.entries(byDay).sort(([a],[b]) => b.localeCompare(a)).slice(0,15);
              if (!sorted.length) return null;
              return (
                <div style={{ ...s.card, marginTop: 16, padding: 0, overflow: 'hidden' }}>
                  <table style={s.table}>
                    <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <tr>
                        {['Fecha','PnL del Día','Trades','Resultado'].map(h => <th key={h} style={s.th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(([date, { pnl, count }]) => (
                        <tr key={date}>
                          <td style={{ ...s.td, color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>{date}</td>
                          <td style={{ ...s.td, fontSize: 18, fontWeight: 900, color: pnl>=0?'#10b981':'#ef4444', fontStyle: 'italic' }}>{pnl>=0?'+':''}${pnl.toFixed(2)}</td>
                          <td style={{ ...s.td, color: '#64748b', fontSize: 13, fontWeight: 700 }}>{count} trades</td>
                          <td style={s.td}><span style={s.badge(pnl>=0)}>{pnl>=0?'GANADOR':'PERDEDOR'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══ BENCHMARKS ══════════════════════════════════════════════════════════ */}
        {activeView === 'benchmarks' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 20 }}>
              <h2 style={{ fontSize: 44, fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', margin: 0 }}>Performance Scales</h2>
              <button onClick={() => setActiveView('main')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '50%', padding: 10, cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={20} /></button>
            </div>

            <div style={{ ...s.card, marginBottom: 16, borderColor: 'rgba(16,185,129,0.1)' }}>
              <div style={{ ...s.label, color: '#10b981' }}>Tu posición actual</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
                {[
                  { label: 'Profit Factor', val: profitFactor, thresholds: [1,1.5,2.1,3], labels: ['Pérdida','Frágil','Sólido','Pro','ÉLITE'] },
                  { label: 'Win Rate',      val: winRate+'%',  thresholds: [40,55,75,90],  labels: ['Inconsistente','Mercado','Alta eficiencia','Superior','GOD MODE'] },
                  { label: 'Risk/Reward',   val: rr,           thresholds: [1,1.5,2,3],    labels: ['Negativo','Break-even','Aceptable','Bueno','ÉLITE'] },
                ].map(({ label, val, thresholds, labels }) => {
                  const numVal = parseFloat(val) || 0;
                  let tier = 0;
                  thresholds.forEach((t,i) => { if (numVal >= t) tier = i+1; });
                  const colors = ['#ef4444','#f97316','#eab308','#10b981','#10b981'];
                  return (
                    <div key={label}>
                      <div style={{ ...s.label, color: '#4b5563' }}>{label}</div>
                      <div style={{ fontSize: 30, fontWeight: 900, color: colors[tier], fontStyle: 'italic' }}>{val}</div>
                      <div style={{ fontSize: 11, color: colors[tier], fontWeight: 800, letterSpacing: '0.1em', marginTop: 2 }}>{labels[tier]}</div>
                      <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                        {labels.map((l,i) => <div key={i} style={{ flex:1, height: 3, borderRadius: 2, background: i<=tier ? colors[tier] : 'rgba(255,255,255,0.06)' }} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={s.card}>
                <div style={{ ...s.label, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><TrendingUp size={14} /> Profit Factor Scale</div>
                {[
                  { range: '< 1.0',    name: 'ZONA DE PÉRDIDA',    color: '#ef4444' },
                  { range: '1.0–1.4',  name: 'RENTABLE FRÁGIL',    color: '#f97316' },
                  { range: '1.5–2.0',  name: 'ESTRATEGIA SÓLIDA',  color: '#eab308' },
                  { range: '2.1–3.0',  name: 'NIVEL PROFESIONAL',  color: '#10b981' },
                  { range: '> 3.0',    name: 'SML MASTER ÉLITE',   color: '#10b981', highlight: true },
                ].map(({ range, name, color, highlight }) => (
                  <div key={range} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: highlight ? '8px 10px' : '6px 0', marginBottom: 4, borderBottom: highlight ? 'none' : '1px solid rgba(255,255,255,0.04)', background: highlight ? 'rgba(16,185,129,0.06)' : 'transparent', borderRadius: highlight ? 8 : 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color, fontStyle: 'italic' }}>{range}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#4b5563', letterSpacing: '0.12em' }}>{name}</span>
                  </div>
                ))}
              </div>
              <div style={s.card}>
                <div style={{ ...s.label, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><Award size={14} /> Efficiency (Win Rate)</div>
                {[
                  { range: '< 40%',    name: 'INCONSISTENTE',       color: '#ef4444' },
                  { range: '45%–55%',  name: 'MEDIA DE MERCADO',     color: '#64748b' },
                  { range: '60%–75%',  name: 'ALTA EFICIENCIA',      color: '#10b981' },
                  { range: '80%–90%',  name: 'PRECISIÓN SUPERIOR',   color: '#10b981' },
                  { range: '> 90%',    name: 'GOD MODE EXECUTION',   color: '#10b981', highlight: true },
                ].map(({ range, name, color, highlight }) => (
                  <div key={range} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: highlight ? '8px 10px' : '6px 0', marginBottom: 4, borderBottom: highlight ? 'none' : '1px solid rgba(255,255,255,0.04)', background: highlight ? 'rgba(16,185,129,0.06)' : 'transparent', borderRadius: highlight ? 8 : 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color, fontStyle: 'italic' }}>{range}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#4b5563', letterSpacing: '0.12em' }}>{name}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...s.card, gridColumn: '1 / -1' }}>
                <div style={{ ...s.label, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}><Layout size={14} /> PnL & Risk Benchmarks</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
                  {[
                    { title: 'Gross Profit Ratio', value: '3:1 o superior',         color: '#fff',     desc: 'Gana 3 veces más de lo que pierdes por trade.' },
                    { title: 'Max Drawdown',        value: '< 10% del Balance',      color: '#ef4444',  desc: 'Protege tu cuenta de caídas masivas.' },
                    { title: 'Net Profit Target',   value: 'Positivo Semanal',        color: '#10b981',  desc: 'La consistencia se mide en cierres semanales.' },
                  ].map(({ title, value, color, desc }) => (
                    <div key={title}>
                      <div style={{ ...s.label, color: '#4b5563' }}>{title}</div>
                      <div style={{ fontSize: 17, fontWeight: 900, color, fontStyle: 'italic', marginBottom: 4 }}>{value}</div>
                      <p style={{ fontSize: 10, color: '#4b5563', margin: 0, lineHeight: 1.6 }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}