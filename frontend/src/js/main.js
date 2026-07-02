// js/main.js
// Orkestrator: bootstrap + render-ryggrad. Toppen av lagdelingen — importerer
// oppover fra alle featurene (config/map/state, layers, ui, interaction) og
// binder dem sammen. index.html laster KUN denne og kaller initApp().

import { createArrowIcon, createFlagIcon, createBatteryIcon } from './icons.js';
import { PRICE_PAINT, ZONE_LINE_PAINT, CITIES } from './config.js';
import { map, zonePopup, flowPopup, plantPopup } from './map.js';
import { state } from './state.js';
import { fetchCore, fetchOptional } from './api.js';
import { buildTimeAxis, computeNowIndex, buildSnapshot, renderTable } from './layers/prices.js';
import { renderFlows, addFlowLayers } from './layers/flows.js';
import { addReservoirLayer, renderReservoirSection } from './layers/reservoirs.js';
import { renderBalanceSection } from './layers/balance.js';
import { addPlantsLayer } from './layers/plants.js';
import { initSheet } from './ui/sheet.js';
import { initSlider, updateSliderUI, toggleSliderVisibility } from './ui/slider.js';
import { initHelp } from './ui/help.js';
import {
  handleZoneHover, handleZoneLeave, handleFlowHover, handleFlowLeave,
  handlePlantHover, handlePlantLeave,
  handleMapClick, clearMobileSelection, initInteraction,
} from './interaction.js';

// Modul-lokale init-flagg (kryssgående kun innen orkestratoren).
let overlayHandlersAttached = false;
let initialFitDone = false;


// ---------------------------------------------------------
// Pris-render (delt mellom bølge 1 og bølge 2)
// ---------------------------------------------------------
// Bygger tidsakse + snapshot, populerer sone-properties (så addOverlays får
// riktig fyll), og oppdaterer pristabell + slider. Idempotent og kjøres to ganger
// i den progressive lasten:
//   - Bølge 1: state.todayPrices er tom → timeAxis tom → snapshot = prices (current).
//   - Bølge 2: today har landet → timeAxis bygges → snapshot = buildSnapshot(index),
//     slideren vises, og fyllet re-deriveres fra valgt indeks.
// Sone-prop-populeringen MÅ skje før renderMap()/addOverlays() (fyllet leser
// price_ore_kwh), derfor kalles denne alltid før renderMap i loadData.
function renderPriceLayer(zones, prices) {
  // Bygg tidsakse fra dagens serie. Hvis vi har en tidsakse, dikteres
  // sone-prisene av (state.currentIndex i) den. Hvis ikke, fall tilbake til /api/prices/current.
  buildTimeAxis();
  state.nowIndex = computeNowIndex();

  let snapshot;
  if (state.timeAxis.length > 0) {
    if (!state.userPinned) {
      state.currentIndex = state.nowIndex;
    } else {
      state.currentIndex = Math.min(state.currentIndex, state.timeAxis.length - 1);
    }
    snapshot = buildSnapshot(state.currentIndex);
  } else {
    // Ingen today-data — bruk /api/prices/current direkte
    snapshot = prices;
  }

  // Populer initielle sone-properties slik at addOverlays() får riktig fyll
  for (const f of zones.features) {
    const p = snapshot[f.properties.zoneName];
    if (p && p.price_ore_kwh != null) {
      f.properties.price_ore_kwh = p.price_ore_kwh;
      f.properties.price_eur_mwh = p.price_eur_mwh;
      f.properties.timestamp = p.timestamp;
    }
  }

  renderTable(snapshot);

  // Slider-synlighet og UI-oppdatering (slideren vises først når today finnes)
  toggleSliderVisibility(state.timeAxis.length > 0);
  updateSliderUI();
}


async function loadData() {
  try {
    const errorDiv = document.getElementById('error'); errorDiv.textContent = '';

    // --- BØLGE 1: kjernekart (zones + prices/current) ---
    // Kaster hvis kjernen mangler → catch viser "Venter på nettverk...".
    // Males umiddelbart; venter IKKE på de fire valgfrie lagene.
    const { zones, prices } = await fetchCore();
    renderPriceLayer(zones, prices);
    renderMap(zones);

    // --- BØLGE 2: valgfrie lag (today, flows, reservoirs, balance) ---
    // Blokkerer IKKE kjernekartet. Ett tregt/dødt ENTSO-E-endepunkt kan ikke
    // lenger holde kartet på "Laster...". Hvert lag males inn når det er hentet.
    // fetchOptional() bruker allSettled internt og kaster aldri; .catch er en
    // defensiv vakt mot at en render-/lag-funksjon i .then skulle kaste.
    fetchOptional()
      .then(({ flows }) => {
        // today kan ha landet → bygg tidsakse + slider på nytt og re-deriver fyll.
        renderPriceLayer(zones, prices);
        // Flyt: bygg geojson + skriv state.flowsData (addFlowLayers skjer i addOverlays).
        renderFlows(flows);
        // Paneler re-rendres hvis en sone allerede er valgt.
        if (state.selectedZone) {
          renderBalanceSection(state.selectedZone);
          renderReservoirSection(state.selectedZone);
        }
        // B1: re-kjør addOverlays slik at flow-/reservoir-lagene attaches nå som
        // state har data. Idempotent — alle addLayer-kall er getLayer-vaktet, og
        // addReservoirLayer/addFlowLayers er gated på state.reservoirsData/flowsData.
        if (state.mapLoaded) addOverlays();
      })
      .catch(err => console.error('Valgfrie lag feilet:', err));
  } catch (err) {
    document.getElementById('error').textContent = 'Venter på nettverk...'; console.error(err);
  }
}

function renderMap(zones) {
  state.zonesData = zones;
  if (state.mapLoaded) addOverlays();
  if (!initialFitDone) {
    // Mobil får ekstra padding nederst så sheetets peek-state (~85px) ikke klemmer Sør-Norge
    const isMobile = window.innerWidth <= 768;
    const padding = isMobile ? { top: 60, bottom: 110, left: 30, right: 30 } : 60;
    map.fitBounds([[3.0, 57.5], [32.0, 71.5]], { padding, duration: 800 });
    initialFitDone = true;
  }
}

function addOverlays() {
  if (!state.zonesData) return;
  const zonesSrc = map.getSource('zones');
  if (zonesSrc) zonesSrc.setData(state.zonesData);
  else map.addSource('zones', { type: 'geojson', data: state.zonesData });

  if (!map.getLayer('zones-fill')) map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': PRICE_PAINT, 'fill-opacity': 0.55 } });

  // Highlight-layers for mobil klikk (hvite rammer)
  if (!map.getLayer('zones-highlight')) {
    map.addLayer({
      id: 'zones-highlight', type: 'line', source: 'zones',
      filter: ['==', ['get', 'zoneName'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.9 }
    });
  }
  if (!map.getLayer('zones-line')) map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ZONE_LINE_PAINT, 'line-opacity': 0.9, 'line-width': 1.5 } });

  if (!map.getSource('cities')) map.addSource('cities', { type: 'geojson', data: CITIES });
  if (!map.getLayer('cities-dot')) map.addLayer({ id: 'cities-dot', type: 'circle', source: 'cities', paint: { 'circle-radius': 3.5, 'circle-color': '#e6edf3', 'circle-stroke-color': '#0d1117', 'circle-stroke-width': 1.5 } });
  if (!map.getLayer('cities-label')) map.addLayer({ id: 'cities-label', type: 'symbol', source: 'cities', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold', 'Open Sans Regular'], 'text-size': 12, 'text-offset': [0.7, 0.15], 'text-anchor': 'left' }, paint: { 'text-color': '#f0f6fc', 'text-halo-color': '#0d1117', 'text-halo-width': 1.5 } });

  if (state.flowsData) addFlowLayers();
  if (state.reservoirsData) addReservoirLayer();
  addPlantsLayer();   // statiske data → alltid; idempotent (getLayer-vaktet)
  updateOverlayVisibility();
  if (state.selectedZone) {
    renderBalanceSection(state.selectedZone);
    renderReservoirSection(state.selectedZone);
  }

  if (!overlayHandlersAttached) {
    // Desktop Hover — bindes mot det usynlige flows-hit-laget (konstant bredde)
    // så også tynne, lavt lastede kabler er lette å treffe.
    map.on('mousemove', 'zones-fill', handleZoneHover);
    map.on('mouseleave', 'zones-fill', handleZoneLeave);
    map.on('mousemove', 'flows-hit', handleFlowHover);
    map.on('mouseleave', 'flows-hit', handleFlowLeave);
    map.on('mousemove', 'plants-layer', handlePlantHover);
    map.on('mouseleave', 'plants-layer', handlePlantLeave);

    // Mobile Click
    map.on('click', handleMapClick);
    overlayHandlersAttached = true;
  }
}

// ---------------------------------------------------------
// Toggles (Synkroniserer Desktop & Mobil)
// ---------------------------------------------------------
function updateOverlayVisibility() {
  const zV = state.spotPriceVisible ? 'visible' : 'none';
  if (map.getLayer('zones-fill')) map.setLayoutProperty('zones-fill', 'visibility', zV);
  if (map.getLayer('zones-line')) map.setLayoutProperty('zones-line', 'visibility', zV);
  if (map.getLayer('zones-highlight')) map.setLayoutProperty('zones-highlight', 'visibility', zV);

  const fV = state.flowsVisible ? 'visible' : 'none';
  if (map.getLayer('flows-line')) map.setLayoutProperty('flows-line', 'visibility', fV);
  if (map.getLayer('flows-arrow')) map.setLayoutProperty('flows-arrow', 'visibility', fV);
  if (map.getLayer('flows-flags-layer')) map.setLayoutProperty('flows-flags-layer', 'visibility', fV);
  if (map.getLayer('flows-highlight')) map.setLayoutProperty('flows-highlight', 'visibility', fV);
  // flows-hit må følge flyt-synligheten: ellers ville det usynlige treff-laget
  // fortsatt fange hover/klikk (og vise popup) mens flyt-laget er skrudd av.
  if (map.getLayer('flows-hit')) map.setLayoutProperty('flows-hit', 'visibility', fV);

  const rV = state.reservoirsVisible ? 'visible' : 'none';
  if (map.getLayer('reservoirs-layer')) map.setLayoutProperty('reservoirs-layer', 'visibility', rV);

  const pV = state.plantsVisible ? 'visible' : 'none';
  if (map.getLayer('plants-layer')) map.setLayoutProperty('plants-layer', 'visibility', pV);
}

function syncToggle(idBase, visible) {
  document.getElementById(`toggle-${idBase}`).checked = visible;
  document.getElementById(`toggle-${idBase}-m`).checked = visible;
}

function bindToggle(idBase, setter) {
  const handler = (e) => { const v = e.target.checked; setter(v); syncToggle(idBase, v); updateOverlayVisibility(); };
  document.getElementById(`toggle-${idBase}`).addEventListener('change', handler);
  document.getElementById(`toggle-${idBase}-m`).addEventListener('change', handler);
}

// ---------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------
export function initApp() {
  // 1) Kart — ikon-registrering + lag-oppbygging ved load
  map.on('load', () => {
    state.mapLoaded = true;
    if (!map.hasImage('flow-arrow')) map.addImage('flow-arrow', createArrowIcon(28));
    ['SE', 'FI', 'DK', 'DE', 'NL', 'GB'].forEach(code => {
      if (!map.hasImage(`flag-${code}`)) map.addImage(`flag-${code}`, createFlagIcon(code));
    });
    for (let pct = 0; pct <= 100; pct += 5) {
      const key = `battery-${pct}`;
      if (!map.hasImage(key)) map.addImage(key, createBatteryIcon(pct));
    }
    if (state.zonesData) addOverlays();
  });

  // ---------------------------------------------------------
  // 2) Mobile Bottom Sheet & Slider + forklaringslag — bootstrap
  // ---------------------------------------------------------
  // Sheet-modulen (js/ui/sheet.js) eier all drag-/snap-mekanikk og sin
  // egen tilstand. onPeek kobler dismiss-gesten (dra helt ned) til
  // clearMobileSelection — det bryter sheet↔interaksjon-sykelen uten at
  // sheeten importerer interaksjonslaget. clearMobileSelection importeres
  // nå fra interaction.js (orkestratoren ligger over interaksjonslaget).
  initSheet({ onPeek: clearMobileSelection });
  // Slider-modulen (js/ui/slider.js) fester sine egne event-lyttere.
  // Elementene finnes statisk i DOM, så kallet kan skje her i bootstrap.
  initSlider();
  // Forklaringslag (js/ui/help.js): bygger tegnforklaring + ordliste,
  // fester klikk-/Escape-lyttere, og auto-viser ved første besøk.
  initHelp();
  // Interaksjon (js/interaction.js): fester den delegerte tilbakeknapp-lytteren.
  initInteraction();

  // ---------------------------------------------------------
  // Toggles (synlighet) — wiring
  // ---------------------------------------------------------
  bindToggle('spotpris', v => { state.spotPriceVisible = v; if (!v) zonePopup.remove(); });
  bindToggle('flyt', v => { state.flowsVisible = v; if (!v) flowPopup.remove(); });
  bindToggle('magasin', v => { state.reservoirsVisible = v; });
  bindToggle('balance', v => {
    state.balanceVisible = v;
    // Re-render: viser/skjuler seksjonen basert på toggle + om sone er valgt.
    renderBalanceSection(state.selectedZone);
  });
  bindToggle('kraftverk', v => { state.plantsVisible = v; if (!v) plantPopup.remove(); });

  // Hent data + poll hvert 5. min
  loadData(); setInterval(loadData, 5 * 60 * 1000);
}
