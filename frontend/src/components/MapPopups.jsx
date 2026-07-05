// src/components/MapPopups.jsx — hover-popups (steg 2.6, I1+I2 låst 05.07)
// ---------------------------------------------------------
// Eier hover-tilstanden LOKALT (useState — S2-logikken: ingen legacy-
// lesere, flyktig UI-tilstand hører ikke hjemme i reduceren) og rendrer
// popup-innholdet via createPortal inn i containere som er koblet til
// MapLibre-popupene med setDOMContent (I2 valg A). Innholdet er dermed
// en ren funksjon av (hoveredFeature, currentIndex, todayPrices, ...) og
// re-rendres automatisk hver slider-frame — frossen-popup-buggen fra
// 05.07-notatet kan ikke lenger eksistere.
//
// Arbeidsdeling per mousemove (I1-presiseringen):
//   - IMPERATIVT i handleren: setLngLat (posisjon) + cursor. Fyrer per
//     piksel, rører aldri React.
//   - DEKLARATIVT via setState: kun feature-IDENTITETEN (zoneName /
//     flow-id / plant-navn). Funksjonell setState returnerer prev når
//     identiteten er uendret → null re-renders under vanlig musføring
//     innenfor samme feature.
//
// Lytter-strategi: ÉN map-nivå mousemove + queryRenderedFeatures mot
// eksisterende lag (samme defensive filter som handleMapClick) i stedet
// for delegerte per-lag-lyttere. Det løser lag-timing-problemet (lyttere
// kan bindes ved mount, før lagene finnes) og bevarer dagens oppførsel
// der sone- og kabel-popup kan vises samtidig (separate popup-singletons).
// Skjulte lag returneres ikke av queryRenderedFeatures → toggles virker.
//
// Containerne får display:contents så DOM-strukturen inne i
// .maplibregl-popup-content er layoutmessig identisk med gamle setHTML.
// ---------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { map, zonePopup, flowPopup, plantPopup } from '../js/map.js';
import { state as legacyState } from '../js/state.js';
import { ZONE_COLORS, ZONE_NAMES, FLOW_COLORS, CABLE_SPECS, PLANT_COLORS, PLANT_TYPE_LABEL } from '../js/config.js';
import { priceColor, buildSnapshot } from '../js/layers/prices.js';
import { useAppState } from '../store.jsx';

const HOVER_LAYERS = ['zones-fill', 'flows-hit', 'plants-layer'];
const EMPTY = { zone: null, flow: null, plant: null };
const DIR_LABEL = { export: 'Eksport', import: 'Import', internal: 'Internflyt' };

function makeContainer() {
  const el = document.createElement('div');
  el.style.display = 'contents'; // usynlig for layout — popup-content ser samme barn som før
  return el;
}

// Identitetsvakt: behold prev-objektet når nøkkelen er uendret (referanse-
// likhet → setHovered kan returnere prev → ingen re-render per piksel).
function pick(prev, nextProps, key) {
  if (!nextProps) return null;
  if (prev && prev[key] === nextProps[key]) return prev;
  return nextProps;
}

export function MapPopups() {
  const { timeAxis, currentIndex, nowIndex, todayPrices, currentPrices, flowsIsStale } = useAppState();
  const [hovered, setHovered] = useState(EMPTY);

  // Stabile portal-containere — opprettes én gang per komponent-instans.
  const containers = useRef(null);
  if (!containers.current) {
    containers.current = { zone: makeContainer(), flow: makeContainer(), plant: makeContainer() };
  }

  // --- Lytter-effekt: bindes ved mount, ryddes ved unmount (StrictMode-trygg) ---
  useEffect(() => {
    const onMove = (e) => {
      if (window.innerWidth <= 768) return; // Desktop kun (legacy-troskap)
      if (!legacyState.mapLoaded) return;   // queryRenderedFeatures før style-load er meningsløst
      const layers = HOVER_LAYERS.filter(id => map.getLayer(id));
      const feats = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      const zoneF = feats.find(f => f.layer.id === 'zones-fill');
      const flowF = feats.find(f => f.layer.id === 'flows-hit');
      const plantF = feats.find(f => f.layer.id === 'plants-layer');

      map.getCanvas().style.cursor = feats.length ? 'pointer' : '';
      // Posisjon er imperativ og følger pekeren per piksel — aldri via state.
      if (zoneF) zonePopup.setLngLat(e.lngLat);
      if (flowF) flowPopup.setLngLat(e.lngLat);
      if (plantF) plantPopup.setLngLat(e.lngLat);

      setHovered(prev => {
        const zone = pick(prev.zone, zoneF && zoneF.properties, 'zoneName');
        const flow = pick(prev.flow, flowF && flowF.properties, 'id');
        const plant = pick(prev.plant, plantF && plantF.properties, 'name');
        if (zone === prev.zone && flow === prev.flow && plant === prev.plant) return prev;
        return { zone, flow, plant };
      });
    };
    const onOut = () => {
      if (window.innerWidth <= 768) return;
      map.getCanvas().style.cursor = '';
      setHovered(prev => (prev.zone || prev.flow || prev.plant) ? EMPTY : prev);
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => { map.off('mousemove', onMove); map.off('mouseout', onOut); };
  }, []);

  // --- Popup-livssyklus: addTo/remove følger hover-identiteten ---
  // setDOMContent er idempotent; remove() på fjernet popup er ufarlig.
  useEffect(() => {
    if (hovered.zone) { zonePopup.setDOMContent(containers.current.zone); zonePopup.addTo(map); }
    else zonePopup.remove();
  }, [hovered.zone]);
  useEffect(() => {
    if (hovered.flow) { flowPopup.setDOMContent(containers.current.flow); flowPopup.addTo(map); }
    else flowPopup.remove();
  }, [hovered.flow]);
  useEffect(() => {
    if (hovered.plant) { plantPopup.setDOMContent(containers.current.plant); plantPopup.addTo(map); }
    else plantPopup.remove();
  }, [hovered.plant]);

  // Snapshot = f(todayPrices, currentIndex) — samme rene hjelper som
  // reduceren og PricesPanel bruker; bølge 1-fallback til currentPrices
  // (identisk kaskade som renderPriceLayer i main.js).
  const snapshot = useMemo(
    () => (timeAxis.length ? buildSnapshot(todayPrices, currentIndex) : (currentPrices || {})),
    [timeAxis, todayPrices, currentIndex, currentPrices]
  );

  return (
    <>
      {createPortal(
        hovered.zone
          ? <ZonePopupContent p={hovered.zone} snap={snapshot[hovered.zone.zoneName]}
              series={todayPrices[hovered.zone.zoneName]}
              currentIndex={currentIndex} nowIndex={nowIndex} hasAxis={timeAxis.length > 0} />
          : null,
        containers.current.zone
      )}
      {createPortal(
        hovered.flow ? <FlowPopupContent p={hovered.flow} isStale={flowsIsStale} /> : null,
        containers.current.flow
      )}
      {createPortal(
        hovered.plant ? <PlantPopupContent p={hovered.plant} /> : null,
        containers.current.plant
      )}
    </>
  );
}

// ---------------------------------------------------------
// Innholdskomponenter — private, replikerer legacy-HTML klasse for klasse
// ---------------------------------------------------------

function ZonePopupContent({ p, snap, series, currentIndex, nowIndex, hasAxis }) {
  const accent = ZONE_COLORS[p.zoneName] || '#6b7280';
  const region = ZONE_NAMES[p.zoneName] || '';
  // Pris/tid leses fra snapshotet (lever med slideren), med feature-props
  // som siste fallback — de er populert fra samme snapshot, så verdiene
  // kan aldri sprike; fallbacken dekker kun randtilfeller før setData.
  const src = snap || p;
  const ore = src.price_ore_kwh;
  const eur = src.price_eur_mwh;
  const timeStr = src.timestamp
    ? new Date(src.timestamp).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' })
    : '';
  const atNow = currentIndex === nowIndex;

  return (
    <>
      <div className="popup-accent" style={{ background: accent }} />
      <div className="popup-body">
        <div className="popup-region">{region}</div>
        <div className="popup-zone">{p.zoneName}</div>
        <div className="popup-price" style={{ color: priceColor(ore) }}>
          {ore != null ? Number(ore).toFixed(1) : '—'}<span className="unit">øre/kWh</span>
        </div>
        {eur != null && <div className="popup-subprice">{Number(eur).toFixed(2)} EUR/MWh</div>}
        <Sparkline series={series} accent={accent} selectedIdx={hasAxis ? currentIndex : null} />
        {timeStr && <div className="popup-meta">{atNow ? 'Nå · ' : ''}{timeStr}</div>}
      </div>
    </>
  );
}

function FlowPopupContent({ p, isStale }) {
  const color = FLOW_COLORS[p.direction] || FLOW_COLORS.internal;
  const dirLbl = DIR_LABEL[p.direction] || 'Flyt';
  // Tekniske data for HVDC-sjøkabler (slås opp på cable-navnet). Interne
  // AC-forbindelser har cable=null → ingen spec → uendret popup.
  const spec = CABLE_SPECS[p.cable];
  const load = spec ? (Number(p.mw) / spec.capacity_mw) * 100 : null;

  return (
    <>
      <div className="popup-accent" style={{ background: color }} />
      <div className="popup-body">
        {isStale && <div className="popup-stale">⚠ Bufret data</div>}
        {p.cable && <div className="popup-region">{p.cable}</div>}
        <div className="popup-zone">{p.from} → {p.to}</div>
        <div className="popup-price" style={{ color }}>{Number(p.mw).toFixed(0)}<span className="unit">MW</span></div>
        <div className="popup-subprice">{dirLbl}</div>
        {spec && (
          <>
            <div className="popup-meta">Kapasitet: {spec.capacity} · {spec.voltage}</div>
            <div className="popup-meta">Belastning: {load.toFixed(1)} %</div>
          </>
        )}
      </div>
    </>
  );
}

function PlantPopupContent({ p }) {
  const color = PLANT_COLORS[p.type] || '#9b91b8';
  const typeLbl = PLANT_TYPE_LABEL[p.type] || 'Kraftverk';

  return (
    <>
      <div className="popup-accent" style={{ background: color }} />
      <div className="popup-body">
        <div className="popup-region">{p.name}</div>
        <div className="popup-zone">{typeLbl} · {p.zone}</div>
        <div className="popup-price" style={{ color }}>{Number(p.mw).toFixed(0)}<span className="unit">MW</span></div>
        {p.gwh != null && <div className="popup-subprice">{Number(p.gwh).toLocaleString('nb-NO')} GWh/år</div>}
        {p.municipality && <div className="popup-meta">{p.municipality}</div>}
        {p.owner && <div className="popup-meta">{p.owner}</div>}
        {p.members && <div className="popup-meta">Slått sammen av: {p.members}</div>}
      </div>
    </>
  );
}

// Sparkline — matematikken portert byte-tro fra legacy renderSparkline;
// playheaden er nå JSX og følger currentIndex automatisk via re-render.
function Sparkline({ series, accent, selectedIdx }) {
  if (!series || !series.prices || series.prices.length < 2) return null;
  const W = 200, H = 40, padX = 2, padY = 4;
  const times = series.prices.map(d => new Date(d.timestamp).getTime());
  const prices = series.prices.map(d => d.price_ore_kwh);
  const tMin = times[0], tMax = times[times.length - 1];
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const pRange = (pMax - pMin) || 1, tRange = (tMax - tMin) || 1;
  const xOf = t => padX + ((t - tMin) / tRange) * (W - padX * 2);
  const yOf = p => padY + (1 - (p - pMin) / pRange) * (H - padY * 2);

  let line = '';
  series.prices.forEach((d, i) => { line += (i === 0 ? 'M' : 'L') + xOf(times[i]).toFixed(1) + ',' + yOf(prices[i]).toFixed(1) + ' '; });
  const bY = (H - padY).toFixed(1);
  const area = line + `L${xOf(times[times.length - 1]).toFixed(1)},${bY} L${xOf(times[0]).toFixed(1)},${bY} Z`;

  const showPlayhead = selectedIdx != null && selectedIdx >= 0 && selectedIdx < series.prices.length;
  const px = showPlayhead ? xOf(times[selectedIdx]).toFixed(1) : null;
  const py = showPlayhead ? yOf(prices[selectedIdx]).toFixed(1) : null;

  return (
    <svg className="popup-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={area} fill={accent} fillOpacity="0.18" />
      <path d={line} stroke={accent} strokeWidth="1.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {showPlayhead && (
        <>
          <line x1={px} y1={padY} x2={px} y2={H - padY} stroke="#ffffff" strokeWidth="1" strokeOpacity="0.55" />
          <circle cx={px} cy={py} r="3" fill="#ffffff" stroke={accent} strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}
