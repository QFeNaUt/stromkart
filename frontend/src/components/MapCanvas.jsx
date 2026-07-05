// src/components/MapCanvas.jsx — A2-escape-hatchen rundt MapLibre
// ---------------------------------------------------------
// Kartet + all lag-kode forblir imperativ bak denne ene komponenten.
// React re-rendrer aldri kartets WebGL-canvas: #map-diven er statisk i
// index.html (den må finnes når js/map.js evalueres ved modul-import),
// og komponenten rendrer null. Det den EIER er kartets livssyklus- og
// side-effekter — fra og med TimeSlider-migreringen kommer effektene
// som oversetter reducer-tilstand til kart-kall hit (setData ved
// currentIndex-endring, setLayoutProperty ved toggle-endring,
// setFilter ved selection-endring).
//
// F2 (valg B, låst 04.07): StrictMode dobbeltkjører effekter i dev for
// å avsløre manglende cleanup — riktig disiplin for alle NYE komponenter.
// Legacy-bootstrapen (initApp) er derimot ikke idempotent (doble
// sheet-/slider-lyttere ved re-kjøring), så den skjermes med en
// modul-lokal vakt. Vakten fjernes når initApp er ferdig demontert.
// ---------------------------------------------------------

import { useEffect, useRef } from 'react';
import { initApp, updateOverlayVisibility } from '../js/main.js';
import { state as legacyState } from '../js/state.js';
import { map, zonePopup, flowPopup, plantPopup } from '../js/map.js';
import { renderBalanceSection } from '../js/layers/balance.js';
import { renderReservoirSection } from '../js/layers/reservoirs.js';
import { buildSnapshot } from '../js/layers/prices.js';
import { setSheetState } from '../js/ui/sheet.js';
import { useAppState } from '../store.jsx';

// StrictMode-vakt: beskytter KUN legacy-koden. Modul-lokal (ikke ref)
// med vilje — den skal overleve en eventuell remount av komponenten,
// akkurat som modul-tilstanden i legacy-filene gjør.
let legacyBooted = false;

export function MapCanvas() {
  const {
    spotPriceVisible, flowsVisible, reservoirsVisible,
    balanceVisible, plantsVisible,
    timeAxis, currentIndex, todayPrices,
    selection, selectedZone, selectedView,
  } = useAppState();

  // Forrige selection — brukes av sheet-delen i selection-effekten for å
  // skille identitetsendring (snap half/peek) fra rene re-derivasjoner
  // (backToBalance, balance-toggle) der sheetet skal stå urørt.
  const prevSelection = useRef(null);

  useEffect(() => {
    if (legacyBooted) return;
    legacyBooted = true;
    initApp();
  }, []);

  // --- Kart-effekt 1 (steg 2.4): lag-synlighet + popup-opprydding ---
  // Oversetter reducer-tilstand til kart-kall. updateOverlayVisibility
  // leser legacy-speilet — ferskt synkront takket være speilingen i
  // reduceren — og er getLayer-vaktet, så den er trygg også før kartet
  // er ferdig lastet (no-op). Popup-fjerning når et lag skrus av er
  // idempotent (remove() på fjernet popup er ufarlig), så det er greit
  // at effekten kjører på alle fem deps.
  useEffect(() => {
    updateOverlayVisibility();
    if (!spotPriceVisible) zonePopup.remove();
    if (!flowsVisible) flowPopup.remove();
    if (!plantsVisible) plantPopup.remove();
  }, [spotPriceVisible, flowsVisible, reservoirsVisible, balanceVisible, plantsVisible]);

  // --- Kart-effekt 2 (revidert steg 2.6): selection → alle bivirkninger ---
  // Arvtakeren til bivirkningsklumpen i gamle handleMapClick/
  // clearMobileSelection, sentralisert her (I3, låst 05.07). Absorberer
  // også 2.4-versjonens balance-toggle-respons (balanceVisible i deps).
  // Fire ansvar, alle idempotente:
  //   1) Highlight-filtre: derivert av selection-kind. getLayer-vaktet —
  //      selection kan uansett ikke settes før lagene finnes (krever klikk).
  //   2) Panel-render: balance/reservoir leser selectedView fra legacy-
  //      speilet, som reducerens synkrone speiling har gjort ferskt FØR
  //      denne effekten kjører (hele poenget med revidert C1).
  //   3) Sheet-state (mobil): half ved ny selection, peek ved dismiss —
  //      men KUN når selection-identiteten faktisk endres (prev-ref-
  //      vakten), så backToBalance/toggles ikke rykker et manuelt dratt
  //      sheet, og initial mount (null→null) aldri rører geometrien.
  useEffect(() => {
    if (map.getLayer('zones-highlight')) {
      const z = selection?.kind === 'zone' ? selection.props.zoneName
        : selection?.kind === 'reservoir' ? selection.props.zone.replace('_', '')
        : '';
      map.setFilter('zones-highlight', ['==', ['get', 'zoneName'], z]);
    }
    if (map.getLayer('flows-highlight')) {
      const fid = selection?.kind === 'flow' ? selection.props.id : '';
      map.setFilter('flows-highlight', ['==', ['get', 'id'], fid]);
    }

    renderBalanceSection(selectedZone);
    renderReservoirSection(selectedZone);

    if (window.innerWidth <= 768 && selection !== prevSelection.current) {
      if (selection) setSheetState('half');
      else if (prevSelection.current) setSheetState('peek');
    }
    prevSelection.current = selection;
  }, [selection, selectedZone, selectedView, balanceVisible]);

  // --- Kart-effekt 3 (steg 2.5): sone-fyll følger tidsindeksen ---
  // Arvtakeren til kart-halvdelen av renderAtIndex (slider.js, pensjonert):
  // bygger snapshot for valgt indeks, muterer sone-properties i legacy-eid
  // zonesData (klasse 3 — imperativ kartdata) og dytter setData. MapLibre
  // re-tegner fyllene. Vaktet på tidsakse + at data/kilde finnes; kjører
  // effekten før kartet er lastet er en ren no-op (getSource → undefined).
  // Idempotent og StrictMode-trygg: dobbelt setData med samme data er
  // ufarlig. Den INITIELLE bølge 1-populeringen skjer fortsatt i
  // renderPriceLayer (main.js) — addOverlays leser price_ore_kwh idet
  // kilden opprettes; denne effekten tar alle endringer etterpå (S4).
  useEffect(() => {
    if (!timeAxis.length || !legacyState.zonesData) return;
    const snapshot = buildSnapshot(todayPrices, currentIndex);
    for (const f of legacyState.zonesData.features) {
      const p = snapshot[f.properties.zoneName];
      if (p) {
        f.properties.price_ore_kwh = p.price_ore_kwh;
        f.properties.price_eur_mwh = p.price_eur_mwh;
        f.properties.timestamp = p.timestamp;
      }
    }
    const src = map.getSource('zones');
    if (src) src.setData(legacyState.zonesData);
  }, [timeAxis, currentIndex, todayPrices]);

  return null;
}
