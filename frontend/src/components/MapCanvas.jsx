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

import { useEffect } from 'react';
import { initApp, updateOverlayVisibility } from '../js/main.js';
import { state as legacyState } from '../js/state.js';
import { zonePopup, flowPopup, plantPopup } from '../js/map.js';
import { renderBalanceSection } from '../js/layers/balance.js';
import { useAppState } from '../store.jsx';

// StrictMode-vakt: beskytter KUN legacy-koden. Modul-lokal (ikke ref)
// med vilje — den skal overleve en eventuell remount av komponenten,
// akkurat som modul-tilstanden i legacy-filene gjør.
let legacyBooted = false;

export function MapCanvas() {
  const {
    spotPriceVisible, flowsVisible, reservoirsVisible,
    balanceVisible, plantsVisible,
  } = useAppState();

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

  // --- Kart-effekt 2 (steg 2.4): balansepanelets toggle-respons ---
  // Gamle bindToggle('balance')-sideeffekten: viser/skjuler seksjonen
  // basert på toggle + valgt sone. selectedZone er fortsatt legacy-eid
  // (interaction.js skriver den) — leses derfra til den migreres.
  useEffect(() => {
    renderBalanceSection(legacyState.selectedZone);
  }, [balanceVisible]);

  return null;
}
