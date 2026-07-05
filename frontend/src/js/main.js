// js/main.js
// Orkestrator: bootstrap + render-ryggrad. Toppen av lagdelingen — importerer
// oppover fra alle featurene (config/map/state, layers, ui, interaction) og
// binder dem sammen. <MapCanvas/> kaller initApp(); pollingen bor i App.jsx.

import { createArrowIcon, createFlagIcon, createBatteryIcon } from './icons.js';
import { PRICE_PAINT, ZONE_LINE_PAINT, CITIES } from './config.js';
import { map } from './map.js';
import { state } from './state.js';
import { fetchCore, fetchOptional } from './api.js';
import { buildTimeAxis, computeNowIndex, buildSnapshot } from './layers/prices.js'; // rene (steg 2.5)
import { appDispatch } from './bridge.js';
import { renderFlows, addFlowLayers } from './layers/flows.js';
import { addReservoirLayer } from './layers/reservoirs.js';
import { addPlantsLayer } from './layers/plants.js';
import { initSheet } from './ui/sheet.js';
import { handleMapClick } from './interaction.js';

// Modul-lokale init-flagg (kryssgående kun innen orkestratoren).
let overlayHandlersAttached = false;
let initialFitDone = false;


// ---------------------------------------------------------
// Pris-render (delt mellom bølge 1 og bølge 2)
// ---------------------------------------------------------
// Steg 2.5: funksjonen SKRIVER ikke lenger tidsakse-tilstand — den er
// REACT_OWNED (reduceren deriverer og speiler). To ansvar gjenstår her:
//   1) Populere sone-properties FØR renderMap()/addOverlays() (fyllet
//      leser price_ore_kwh idet kilden opprettes). Derivasjonen gjøres
//      lokalt med de rene prices.js-hjelperne — samme funksjoner som
//      reducerens transition() bruker, så de to aldri kan sprike.
//   2) Dispatche RÅDATAENE til reduceren (currentPricesLoaded +
//      todayPricesLoaded). Alt nedstrøms (pristabell, slider-UI,
//      kart-fyll ved indeksendring) er derivasjoner i React-verdenen.
// Merk lese-regelen: state.userPinned/currentIndex under er REACT_OWNED-
// speil, ferske fra forrige commit — vi leser dem i en NY hendelse
// (poll), aldri i samme tick som en dispatch. Idempotent, kjøres to
// ganger i den progressive lasten (bølge 1 uten today, bølge 2 med).
function renderPriceLayer(zones, prices) {
  const timeAxis = buildTimeAxis(state.todayPrices);
  const nowIndex = computeNowIndex(timeAxis);

  let snapshot;
  if (timeAxis.length > 0) {
    const idx = state.userPinned
      ? Math.min(state.currentIndex, timeAxis.length - 1)
      : nowIndex;
    snapshot = buildSnapshot(state.todayPrices, idx);
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

  // Rådata → reducer (S3, steg 2.5). Reduceren deriverer timeAxis/
  // nowIndex/currentIndex selv og speiler dem synkront til legacy —
  // sparkline-popupen (interaction.js) leser dermed ferske verdier.
  // PricesPanel deriverer snapshotet sitt selv; setPriceSnapshot-
  // stillaset er slettet. TimeSlider viser/skjuler seg selv på
  // timeAxis.length — toggleSliderVisibility/updateSliderUI er borte.
  appDispatch({ type: 'currentPricesLoaded', prices });
  if (Object.keys(state.todayPrices).length > 0) {
    appDispatch({ type: 'todayPricesLoaded', todayPrices: state.todayPrices });
  }
}


export async function loadData() {
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
        // Panelene (balance/reservoir) er React-eide (steg 2.7) og
        // re-rendres automatisk av balanceLoaded-/setReservoirs-dispatchene.
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

  if (!overlayHandlersAttached) {
    // Klikk (mobil + desktop) — tynn dispatch-trigger (steg 2.6).
    // Desktop-hover eies nå av React (<MapPopups/>): én map-nivå
    // mousemove-lytter bindes der ved mount; flows-hit-laget (konstant
    // bredde) er fortsatt treffgrunnlaget via queryRenderedFeatures.
    map.on('click', handleMapClick);
    overlayHandlersAttached = true;
  }
}

// ---------------------------------------------------------
// Lag-synlighet — kalles av addOverlays (legacy) og av MapCanvas'
// synlighetseffekt (React, steg 2.4). Leser legacy-speilet, som holdes
// synkront ferskt av reducerens REACT_OWNED-speiling.
// ---------------------------------------------------------
export function updateOverlayVisibility() {
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
  // egen tilstand (I4, låst 05.07 — forblir imperativ «dum» DOM).
  // onPeek kobler dismiss-gesten (dra helt ned) til clearSelection-
  // dispatchen; MapCanvas' selection-effekt tar opprydningen (filtre,
  // paneler), og <SheetHeader/> nullstiller tittelen. Gamle
  // clearMobileSelection er pensjonert.
  initSheet({ onPeek: () => appDispatch({ type: 'clearSelection' }) });
  // Time-slideren eies nå av React (<TimeSlider/>, steg 2.5): portal-
  // tvillinger inn i #time-slider-desktop/-mobile, avspilling som effekt,
  // indeks-endringer som dispatch (scrubTo/playTick/snapToNow/pinUser).
  // js/ui/slider.js er pensjonert.
  // Forklaringslaget eies nå av React (<HelpOverlay/>, steg 2.2) —
  // tegnforklaring, ordliste, triggere og førstegangsvisning bor der.
  // Interaksjon (js/interaction.js): kun handleMapClick igjen — festes
  // i addOverlays. Hover-popupene eies av <MapPopups/>, sheet-tittelen
  // av <SheetHeader/>, kart-bivirkningene av MapCanvas. Tilbakeknappen
  // bor nå som ren onClick i <ReservoirPanel/> (I5 fullført, steg 2.7).

  // Toggles eies nå av React (<Controls/>, steg 2.4): kontrollerte
  // checkboxes dispatcher setLayerVisible; kart-sideeffektene (lag-
  // synlighet, popup-fjerning, balansepanelet) bor i MapCanvas-effektene.

  // Datahenting + polling eies nå av App.jsx (useEffect med cleanup) —
  // loadData eksporteres over. initApp gjør kun kart- og DOM-bootstrap.
}
