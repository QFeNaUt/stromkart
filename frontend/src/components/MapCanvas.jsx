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
import { initApp } from '../js/main.js';

// StrictMode-vakt: beskytter KUN legacy-koden. Modul-lokal (ikke ref)
// med vilje — den skal overleve en eventuell remount av komponenten,
// akkurat som modul-tilstanden i legacy-filene gjør.
let legacyBooted = false;

export function MapCanvas() {
  useEffect(() => {
    if (legacyBooted) return;
    legacyBooted = true;
    initApp();
  }, []);

  return null;
}
