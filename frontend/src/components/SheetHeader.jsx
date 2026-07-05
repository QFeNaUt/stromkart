// src/components/SheetHeader.jsx — sheet-kontekstoverskriften (steg 2.6)
// ---------------------------------------------------------
// Løser Funn 2 (store.jsx-notatene): tittel/desc var skjult tilstand i
// DOM-en, skrevet imperativt av handleMapClick. Nå deriveres begge av
// selection-feltet og rendres som portal-tvillinger inn i de to statiske
// legacy-elementene (#sheet-context-title / #sheet-context-desc) —
// samme container-mønster som TimeSlider (S1).
//
// Sone-descens spotpris deriveres LIVE av (todayPrices, currentIndex) med
// samme snapshot-hjelper som resten av appen — den følger dermed slideren
// i stedet for å fryse på klikkøyeblikkets verdi (samme oppgradering som
// popup-fixen, samme rene funksjon).
// ---------------------------------------------------------

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ZONE_NAMES, PLANT_TYPE_LABEL } from '../js/config.js';
import { buildSnapshot } from '../js/layers/prices.js';
import { useAppState } from '../store.jsx';

const DEFAULT_TITLE = 'Strømkart Norge';
const DEFAULT_DESC = 'Velg et område i kartet, eller dra opp';
const DIR_LABEL = { export: 'Eksport', import: 'Import', internal: 'Internflyt' };

export function SheetHeader() {
  const { selection, timeAxis, currentIndex, todayPrices, currentPrices, reservoirsData } = useAppState();

  const snapshot = useMemo(
    () => (timeAxis.length ? buildSnapshot(todayPrices, currentIndex) : (currentPrices || {})),
    [timeAxis, todayPrices, currentIndex, currentPrices]
  );

  let title = DEFAULT_TITLE;
  let desc = DEFAULT_DESC;

  if (selection) {
    const p = selection.props;
    if (selection.kind === 'zone') {
      const zone = p.zoneName;
      const region = ZONE_NAMES[zone] || '';
      const src = snapshot[zone] || p;
      const priceOre = src.price_ore_kwh != null ? Number(src.price_ore_kwh).toFixed(1) : '—';
      const zoneKey = `NO_${zone.slice(2)}`; // "NO2" -> "NO_2"
      const resInfo = reservoirsData ? reservoirsData[zoneKey] : null;
      const resTxt = resInfo && resInfo.fill_percent != null ? ` • Magasin: ${resInfo.fill_percent.toFixed(1)}%` : '';
      title = `${region} (${zone})`;
      desc = `Spotpris: ${priceOre} øre/kWh${resTxt}`;
    } else if (selection.kind === 'flow') {
      const dirLbl = DIR_LABEL[p.direction] || 'Flyt';
      title = `Kraftflyt: ${p.from} → ${p.to}`;
      desc = `${Math.round(p.mw)} MW ${dirLbl}${p.cable ? ` via ${p.cable}` : ''}`;
    } else if (selection.kind === 'plant') {
      const typeLbl = PLANT_TYPE_LABEL[p.type] || 'Kraftverk';
      const gwhTxt = p.gwh != null ? ` · ${Number(p.gwh).toLocaleString('nb-NO')} GWh/år` : '';
      title = p.name;
      desc = `${typeLbl} · ${Math.round(p.mw)} MW${gwhTxt}${p.zone ? ` · ${p.zone}` : ''}`;
    } else if (selection.kind === 'reservoir') {
      const shortZone = p.zone.replace('_', '');
      const region = ZONE_NAMES[shortZone] || '';
      title = `Magasin: ${region} (${shortZone})`;
      desc = `${Number(p.fill_percent).toFixed(1)}% fyllingsgrad`;
    }
  }

  // Elementene er statiske i index.html og finnes før React monterer.
  const titleEl = document.getElementById('sheet-context-title');
  const descEl = document.getElementById('sheet-context-desc');
  if (!titleEl || !descEl) return null;

  return (
    <>
      {createPortal(title, titleEl)}
      {createPortal(desc, descEl)}
    </>
  );
}
