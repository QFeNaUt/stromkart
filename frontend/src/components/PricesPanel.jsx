// src/components/PricesPanel.jsx — Pristabellen (steg 2.3)
// ---------------------------------------------------------
// Første datalesende komponent, og beviset på portal-mønsteret:
// tabellene skal stå INNI umigrerte containere (desktop-panelet og
// sheet-seksjonen), så komponenten rendres to ganger via createPortal
// inn i anker-divene #prices-slot og #prices-slot-m i index.html.
// Samme mønster gjelder alle panel-komponenter frem til containerne
// selv blir React.
//
// Derivasjon in situ (steg 2.5, S3): snapshot-stillaset er SLETTET.
// Snapshotet er nå en ren useMemo-derivasjon av (todayPrices,
// currentIndex) med currentPrices (bølge 1) som fallback før tidsaksen
// finnes — samme prioritering som gamle renderPriceLayer. Tabellen
// følger dermed slideren automatisk, uten dispatch fra render-stedene.
//
// Markup-troskap mot gamle renderTable (js/layers/prices.js):
// identiske klasser (.prices-table/.zone/.swatch/.price/.unit/.subprice),
// og «Laster…»-raden ved snapshot === null speiler den gamle statiske
// placeholder-raden. priceColor importeres fra legacy-laget — React som
// leser en ren legacy-helper er en lovlig nedover-kant.
// ---------------------------------------------------------

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ZONE_COLORS } from '../js/config.js';
import { priceColor, buildSnapshot } from '../js/layers/prices.js';
import { useAppState } from '../store.jsx';

const ZONES = ['NO1', 'NO2', 'NO3', 'NO4', 'NO5'];

function PricesTable({ snapshot, reservoirs }) {
  return (
    <table className="prices-table">
      <tbody>
        {snapshot === null ? (
          <tr><td colSpan={2} style={{ color: 'var(--text-dim)' }}>Laster…</td></tr>
        ) : ZONES.map(z => {
          const p = snapshot[z];
          const priceOre = p?.price_ore_kwh != null ? p.price_ore_kwh : null;
          const resInfo = reservoirs ? reservoirs[`NO_${z.slice(2)}`] : null;
          return (
            <tr key={z}>
              <td className="zone">
                <span className="swatch" style={{ background: ZONE_COLORS[z] || '#6b7280' }} />
                {z}
              </td>
              <td className="price" style={{ color: priceColor(priceOre) }}>
                {priceOre != null ? priceOre.toFixed(1) : '—'}
                <span className="unit">øre/kWh</span>
                {resInfo?.fill_percent != null
                  ? <div className="subprice">Magasin: {resInfo.fill_percent.toFixed(1)} %</div>
                  : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PricesPanel() {
  const { todayPrices, timeAxis, currentIndex, currentPrices, reservoirsData } = useAppState();

  // Snapshotet: tidsakse-styrt når today-seriene finnes, ellers bølge 1-
  // fallbacken (/api/prices/current). null før første fetchCore →
  // «Laster…»-raden, som før.
  const snapshot = useMemo(() => {
    if (timeAxis.length > 0) return buildSnapshot(todayPrices, currentIndex);
    return currentPrices;
  }, [todayPrices, timeAxis, currentIndex, currentPrices]);

  // Slot-ankrene er statiske i index.html og finnes garantert før React
  // mounter (module scripts er deferred). Guardene er defensive vakter,
  // ikke forventede stier.
  const desktopSlot = document.getElementById('prices-slot');
  const mobileSlot = document.getElementById('prices-slot-m');

  return (
    <>
      {desktopSlot && createPortal(
        <PricesTable snapshot={snapshot} reservoirs={reservoirsData} />, desktopSlot)}
      {mobileSlot && createPortal(
        <PricesTable snapshot={snapshot} reservoirs={reservoirsData} />, mobileSlot)}
    </>
  );
}
