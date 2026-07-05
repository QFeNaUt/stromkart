// src/components/BalancePanel.jsx — Forbruk og produksjon (steg 2.7)
// ---------------------------------------------------------
// Arvtakeren til renderBalanceSection (js/layers/balance.js, pensjonert):
// panelinnholdet er en ren funksjon av (balanceVisible, selectedZone,
// selectedView, balanceData) fra reduceren. Portal-tvillinger (S1) inn i
// de to legacy-containerne #desktop-balance og #sheet-balance — begge
// beholder ID + klasser i index.html fordi all CSS selekterer på dem.
//
// Synlighet styres av container-klasse-effekten (P3, låst 05.07):
// komponenten toggler .hidden på selve container-divene, siden de er
// .panel-bokser med egen bakgrunn som lever utenfor React-treet — å
// rendre null alene ville etterlatt tomme bokser på skjermen.
//
// balanceData landes via balanceLoaded-dispatchen i api.js (P1): panelet
// re-rendres automatisk når bølge 2 lander og ved hver poll — ingen
// manuelle render-kall fra main.js/MapCanvas lenger.
//
// Variantene (Funn 2): desktop har <h1>-tittel + sone-subtitle; sheetet
// har den statiske .subtitle-overskriften og hadde ALDRI sone-subtitle
// (.balance-subtitle fantes kun i desktop-markupen) — bevart tro.
// ---------------------------------------------------------

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../store.jsx';
import { ZONE_NAMES, PSR_NAME_NO, PSR_NAME_TO_BUCKET, BUCKET_HEX, BUCKET_ORDER } from '../js/config.js';

function fmtMW(mw) {
  if (mw == null) return '—';
  // Tusenseparator med non-breaking space (portert fra balance.js)
  return Math.round(mw).toLocaleString('nb-NO').replace(/,/g, '\u00a0') + ' MW';
}

// Kroppen når sonen finnes i payloaden. ENTSO-E publiserer forbruk (load)
// og produksjon (generation_mix) asymmetrisk: forbruk kommer raskt,
// produksjon henger ofte etter tidlig på morgenen. Tre tilstander bevart
// fra legacy: begge / kun forbruk («⏳ Venter på produksjonsdata») /
// ingen av delene («Venter på data»).
function BalanceBody({ z }) {
  const load = z.load_mw;
  const prod = z.generation_mix ? z.generation_mix.total_mw : null;
  const net = z.net_balance_mw;

  const hasLoad = load != null;
  const hasProd = prod != null && prod > 0;

  // Verken forbruk eller produksjon ennå (svært tidlig / utfall)
  if (!hasLoad && !hasProd) {
    return (
      <>
        <div className="balance-numbers">
          <div className="stat">
            <span className="label">Status</span>
            <span className="value" style={{ fontSize: '13px', fontWeight: 400 }}>Venter på data fra ENTSO-E</span>
          </div>
        </div>
        <div className="balance-bar"></div>
        <div className="balance-detail"></div>
        <div className="balance-meta">Oppdateres normalt litt senere på morgenen</div>
      </>
    );
  }

  const netClass = net == null ? '' : (net >= 0 ? 'pos' : 'neg');
  const netSign = net == null ? '' : (net >= 0 ? '+' : '');

  const loadTs = z.load_timestamp ? new Date(z.load_timestamp) : null;
  const genTs = z.generation_timestamp ? new Date(z.generation_timestamp) : null;
  const fmtT = d => d ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <>
      <div className="balance-numbers">
        <div className="stat"><span className="label">Produksjon</span><span className="value">{fmtMW(prod)}</span></div>
        <div className="stat"><span className="label">Forbruk</span><span className="value">{fmtMW(load)}</span></div>
        <div className="stat"><span className="label">Netto</span><span className={`value ${netClass}`}>{net == null ? '—' : netSign + fmtMW(net)}</span></div>
      </div>

      {!hasProd ? (
        // Forbruk finnes, men produksjon er ennå ikke publisert
        <>
          <div className="balance-bar"></div>
          <div className="balance-detail">
            <div style={{ padding: '12px 0', color: 'var(--text-dim)', fontSize: '12.5px', textAlign: 'center' }}>
              ⏳ Venter på produksjonsdata fra ENTSO-E — publiseres normalt utover formiddagen.
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Stablet søyle (full produksjonsmiks) */}
          <div className="balance-bar">
            {BUCKET_ORDER
              .filter(b => (z.generation_mix.summary[b] || 0) > 0)
              .map(b => {
                const pct = (z.generation_mix.summary[b] / prod) * 100;
                return <div key={b} className={`seg ${b}`} style={{ width: `${pct.toFixed(2)}%` }} title={`${b}: ${pct.toFixed(1)}%`}></div>;
              })}
          </div>
          {/* Detaljtabell (sortert synkende på MW) */}
          <div className="balance-detail">
            {z.generation_mix.detailed && Object.entries(z.generation_mix.detailed)
              .filter(([, mw]) => mw > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([name, mw]) => {
                const bucket = PSR_NAME_TO_BUCKET[name] || 'annet';
                return (
                  <div key={name} className="row">
                    <span className="dot" style={{ background: BUCKET_HEX[bucket] }}></span>
                    <span className="name">{PSR_NAME_NO[name] || name}</span>
                    <span className="mw">{fmtMW(mw)}</span>
                    <span className="pct">{((mw / prod) * 100).toFixed(1)} %</span>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {/* Metadata: tidsstempler (produksjon viser «—» når den ennå mangler) */}
      <div className="balance-meta">{`Forbruk kl ${fmtT(loadTs)} · produksjon kl ${fmtT(genTs)}`}</div>
    </>
  );
}

function BalanceContent({ variant, zoneKey, data }) {
  const haveData = !!(data && data.zones && zoneKey && data.zones[zoneKey]);
  const z = haveData ? data.zones[zoneKey] : null;
  // Banneret følger legacy: kun synlig når sonen finnes OG payloaden er stale.
  const isStale = haveData && data.is_stale === true;

  const region = zoneKey ? (ZONE_NAMES[zoneKey.replace('_', '')] || zoneKey) : null;

  return (
    <>
      <div className={'balance-stale-banner' + (isStale ? ' visible' : '')}>⚠ Bufret data</div>
      {variant === 'desktop' ? (
        <>
          <h1 className="balance-title">Forbruk og produksjon</h1>
          <div className="balance-subtitle subtitle">
            {haveData ? `${region} (${zoneKey.replace('_', '')})` : '—'}
          </div>
        </>
      ) : (
        <div className="subtitle">Forbruk og produksjon</div>
      )}
      {haveData ? (
        <BalanceBody z={z} />
      ) : (
        // Sone mangler helt (intet zone-objekt i payloaden)
        <>
          <div className="balance-numbers">
            <div className="stat"><span className="label">Status</span><span className="value">Ingen data</span></div>
          </div>
          <div className="balance-bar"></div>
          <div className="balance-detail"></div>
          <div className="balance-meta"></div>
        </>
      )}
    </>
  );
}

export function BalancePanel() {
  const { balanceVisible, selectedZone, selectedView, balanceData } = useAppState();

  // Samme hide-logikk som legacy: vises kun når balance er aktivt valgt
  // (sone-tap) — ikke når brukeren har tappet et batteri (reservoir-visning).
  const hide = !balanceVisible || !selectedZone || selectedView !== 'balance';

  // P3: container-klasse-effekten — .hidden på selve panel-divene.
  useEffect(() => {
    for (const id of ['desktop-balance', 'sheet-balance']) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', hide);
    }
  }, [hide]);

  if (hide) return null;

  const desktop = document.getElementById('desktop-balance');
  const sheet = document.getElementById('sheet-balance');
  return (
    <>
      {desktop && createPortal(<BalanceContent variant="desktop" zoneKey={selectedZone} data={balanceData} />, desktop)}
      {sheet && createPortal(<BalanceContent variant="sheet" zoneKey={selectedZone} data={balanceData} />, sheet)}
    </>
  );
}
