// src/components/ReservoirPanel.jsx — Magasinfylling (steg 2.7)
// ---------------------------------------------------------
// Arvtakeren til renderReservoirSection (js/layers/reservoirs.js —
// modulen lever videre med kun addReservoirLayer, som er imperativ
// kartkode og skal FORBLI, jf. A2). Panelinnholdet er en ren funksjon
// av (selectedZone, selectedView, reservoirsData). Portal-tvillinger
// (S1) inn i #desktop-reservoir og #sheet-reservoir; synlighet via
// container-klasse-effekten (P3), samme mønster som <BalancePanel/>.
//
// MERK (legacy-troskap): panelet er bevisst IKKE gated på
// reservoirsVisible — batteritoggelen styrer kartlaget, ikke panelet.
//
// I5 fullført: tilbakeknappen er nå en ren onClick-dispatch
// (backToBalance) her — den delegerte document-lytteren i
// interaction.js er pensjonert. Klassen .reservoir-back beholdes
// (CSS selekterer på den).
//
// P5: .reservoir-stale-banner er IKKE portert — den var død markup
// (aldri togglet av legacy, og stale-flagget finnes ikke i den
// strippede .areas-datakontrakten). Ekte stale-visning krever en
// datakontraktendring i api.js — parkert på horisont-lista.
// ---------------------------------------------------------

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppState, useAppDispatch } from '../store.jsx';
import { ZONE_NAMES } from '../js/config.js';

// Envelope: historisk min/median/max-skala med nå-markør (portert 1:1).
function Envelope({ r }) {
  const hist = r.historical;
  if (!hist) {
    return (
      <>
        <div className="reservoir-envelope"></div>
        <div className="reservoir-envelope-meta"></div>
      </>
    );
  }
  const min = hist.min_percent, max = hist.max_percent, median = hist.median_percent;
  const range = max - min;
  // Pad skalaen litt på hver side så markøren ikke kollapser i kantene
  // hvis nå-verdien sammenfaller med min eller max.
  const pad = range > 0 ? range * 0.08 : 5;
  const scaleMin = min - pad, scaleMax = max + pad, scaleRange = scaleMax - scaleMin;
  const pos = v => ((v - scaleMin) / scaleRange) * 100;

  const medianPos = pos(median).toFixed(1);
  const now = r.fill_percent;
  const nowPos = now != null ? Math.max(0, Math.min(100, pos(now))).toFixed(1) : null;

  return (
    <>
      <div className="reservoir-envelope">
        <div className="track"></div>
        <div className="median-tick" style={{ left: `${medianPos}%` }} title={`Median: ${median.toFixed(1)} %`}></div>
        {nowPos != null && (
          <div className="now-marker" style={{ left: `${nowPos}%` }} title={`Nå: ${now.toFixed(1)} %`}></div>
        )}
      </div>
      <div className="reservoir-envelope-meta">
        <span>{Math.round(min)} % min</span>
        <span>{Math.round(median)} % median</span>
        <span>{Math.round(max)} % max</span>
      </div>
    </>
  );
}

function ReservoirBody({ r }) {
  // Headline: % + endring siste uke
  const change = r.change_percent;
  const changeClass = change == null ? '' : (change >= 0 ? 'pos' : 'neg');
  const changeSign = change == null ? '' : (change >= 0 ? '+' : '');
  const pctTxt = r.fill_percent != null ? r.fill_percent.toFixed(1) : '—';

  // Meta: referanseperiode + neste publisering
  const metaParts = [];
  if (r.historical) metaParts.push(`Referanse: ${r.historical.reference_period} (${r.historical.years_in_sample} år)`);
  if (r.measurement_date) {
    const d = new Date(r.measurement_date);
    metaParts.push(`Måling ${d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' })}`);
  }
  if (r.next_publication) {
    const d = new Date(r.next_publication);
    metaParts.push(`Neste publisering ${d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' })}`);
  }

  return (
    <>
      <div className="reservoir-headline">
        <span className="pct">{pctTxt} %</span>
        {change != null && (
          <span className={`delta ${changeClass}`}>{changeSign}{change.toFixed(1)} %-poeng siste uke</span>
        )}
      </div>
      <Envelope r={r} />
      <div className="reservoir-top-title">Største magasin</div>
      <div className="reservoir-top-list">
        {r.top_reservoirs && r.top_reservoirs.length > 0 && r.top_reservoirs.map(m => (
          <div className="item" key={m.name}>
            <div className="row">
              <span className="name">{m.name}</span>
              <span className="volume">{m.volume_mill_m3.toLocaleString('nb-NO')} mill. m³</span>
            </div>
            {m.note && <div className="note">{m.note}</div>}
          </div>
        ))}
      </div>
      <div className="reservoir-meta">{metaParts.join(' · ')}</div>
    </>
  );
}

function ReservoirContent({ variant, zoneKey, r, onBack }) {
  const haveData = r != null;
  const region = zoneKey ? (ZONE_NAMES[zoneKey.replace('_', '')] || zoneKey) : null;
  const subtitle = haveData ? `${region} (${zoneKey.replace('_', '')}) · Uke ${r.week}` : '—';

  return (
    <>
      <button className="reservoir-back" type="button" onClick={onBack}>← Se forbruk og produksjon</button>
      {variant === 'desktop' ? (
        <>
          <h1 className="reservoir-title">Magasinfylling</h1>
          <div className="reservoir-subtitle subtitle">{subtitle}</div>
        </>
      ) : (
        <>
          <div className="subtitle">Magasinfylling</div>
          <div className="reservoir-subtitle subtitle" style={{ marginTop: '-8px' }}>{subtitle}</div>
        </>
      )}
      {haveData ? (
        <ReservoirBody r={r} />
      ) : (
        <>
          <div className="reservoir-headline"><span className="pct">—</span></div>
          <div className="reservoir-envelope"></div>
          <div className="reservoir-envelope-meta"></div>
          <div className="reservoir-top-title">Største magasin</div>
          <div className="reservoir-top-list"></div>
          <div className="reservoir-meta"></div>
        </>
      )}
    </>
  );
}

export function ReservoirPanel() {
  const { selectedZone, selectedView, reservoirsData } = useAppState();
  const dispatch = useAppDispatch();

  // Vises kun når reservoir er aktivt valgt (batteri-tap).
  const hide = !selectedZone || selectedView !== 'reservoir';
  const r = reservoirsData && selectedZone ? reservoirsData[selectedZone] : null;

  // P3: container-klasse-effekten — .hidden på selve panel-divene.
  useEffect(() => {
    for (const id of ['desktop-reservoir', 'sheet-reservoir']) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', hide);
    }
  }, [hide]);

  if (hide) return null;

  const onBack = () => dispatch({ type: 'backToBalance' });
  const desktop = document.getElementById('desktop-reservoir');
  const sheet = document.getElementById('sheet-reservoir');
  return (
    <>
      {desktop && createPortal(<ReservoirContent variant="desktop" zoneKey={selectedZone} r={r} onBack={onBack} />, desktop)}
      {sheet && createPortal(<ReservoirContent variant="sheet" zoneKey={selectedZone} r={r} onBack={onBack} />, sheet)}
    </>
  );
}
