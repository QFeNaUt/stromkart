// js/interaction.js
// Interaksjonslag: alle hover-/klikk-handlere + den delegerte tilbakeknappen.
// Avhengighetsregel: importerer KUN nedover (config/map/state + layers/ui).
// Kaller aldri orkestratoren (loadData/renderMap/addOverlays) — main.js importerer
// derimot disse handlerne og binder dem i addOverlays. Kanten main → interaction
// er dermed enveis og asyklisk.

import { map, zonePopup, flowPopup } from './map.js';
import { state } from './state.js';
import { ZONE_COLORS, ZONE_NAMES, FLOW_COLORS } from './config.js';
import { priceColor } from './layers/prices.js';
import { renderBalanceSection } from './layers/balance.js';
import { renderReservoirSection } from './layers/reservoirs.js';
import { setSheetState } from './ui/sheet.js';

export function handleZoneHover(e) {
  if (window.innerWidth <= 768) return; // Desktop kun
  map.getCanvas().style.cursor = 'pointer';
  const f = e.features[0], p = f.properties;
  const accent = ZONE_COLORS[p.zoneName] || '#6b7280', region = ZONE_NAMES[p.zoneName] || '';
  const timeStr = p.timestamp ? new Date(p.timestamp).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const atNow = (state.currentIndex === state.nowIndex);

  zonePopup.setLngLat(e.lngLat).setHTML(`
    <div class="popup-accent" style="background:${accent}"></div>
    <div class="popup-body">
      <div class="popup-region">${region}</div><div class="popup-zone">${p.zoneName}</div>
      <div class="popup-price" style="color:${priceColor(p.price_ore_kwh)}">${p.price_ore_kwh != null ? p.price_ore_kwh.toFixed(1) : '—'}<span class="unit">øre/kWh</span></div>
      ${p.price_eur_mwh != null ? `<div class="popup-subprice">${p.price_eur_mwh.toFixed(2)} EUR/MWh</div>` : ''}
      ${renderSparkline(state.todayPrices[p.zoneName], accent, state.timeAxis.length > 0 ? state.currentIndex : null)}
      ${timeStr ? `<div class="popup-meta">${atNow ? 'Nå · ' : ''}${timeStr}</div>` : ''}
    </div>
  `).addTo(map);
}

export function handleZoneLeave() {
  if (window.innerWidth > 768) { map.getCanvas().style.cursor = ''; zonePopup.remove(); }
}

export function handleFlowHover(e) {
  if (window.innerWidth <= 768) return; // Desktop kun
  map.getCanvas().style.cursor = 'pointer';
  const p = e.features[0].properties;
  const color = FLOW_COLORS[p.direction] || FLOW_COLORS.internal;
  const dirLbl = { export: 'Eksport', import: 'Import', internal: 'Internflyt' }[p.direction] || 'Flyt';

  flowPopup.setLngLat(e.lngLat).setHTML(`
    <div class="popup-accent" style="background:${color}"></div>
    <div class="popup-body">
      ${state.flowsIsStale ? '<div class="popup-stale">⚠ Bufret data</div>' : ''}
      ${p.cable ? `<div class="popup-region">${p.cable}</div>` : ''}
      <div class="popup-zone">${p.from} → ${p.to}</div>
      <div class="popup-price" style="color:${color}">${Number(p.mw).toFixed(0)}<span class="unit">MW</span></div>
      <div class="popup-subprice">${dirLbl}</div>
    </div>
  `).addTo(map);
}

export function handleFlowLeave() {
  if (window.innerWidth > 768) { map.getCanvas().style.cursor = ''; flowPopup.remove(); }
}

// Klikk-håndtering (mobil + desktop)
export function handleMapClick(e) {
  // Defensiv filtrering: hvis brukeren tapper før alle lag er rendret,
  // unngå å sende lag-IDer som ikke finnes (MapLibre advarer / returnerer tomt).
  const candidateLayers = ['flows-arrow', 'flows-line', 'reservoirs-layer', 'zones-fill'];
  const layers = candidateLayers.filter(id => map.getLayer(id));
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(e.point, { layers });

  if (!features.length) { clearMobileSelection(); return; }

  const f = features[0], p = f.properties;
  const titleEl = document.getElementById('sheet-context-title');
  const descEl = document.getElementById('sheet-context-desc');

  if (f.layer.id === 'zones-fill') {
    const zone = p.zoneName, region = ZONE_NAMES[zone] || '';
    const priceOre = p.price_ore_kwh != null ? p.price_ore_kwh.toFixed(1) : '—';
    const zoneKey = `NO_${zone.slice(2)}`; // "NO2" -> "NO_2"
    const resInfo = state.reservoirsData ? state.reservoirsData[zoneKey] : null;
    const resTxt = resInfo && resInfo.fill_percent != null ? ` • Magasin: ${resInfo.fill_percent.toFixed(1)}%` : '';
    titleEl.textContent = `${region} (${zone})`;
    descEl.textContent = `Spotpris: ${priceOre} øre/kWh${resTxt}`;

    map.setFilter('zones-highlight', ['==', ['get', 'zoneName'], zone]);
    map.setFilter('flows-highlight', ['==', ['get', 'id'], '']);
    state.selectedZone = zoneKey;
    state.selectedView = 'balance';
    renderBalanceSection(zoneKey);
    renderReservoirSection(zoneKey);
  }
  else if (f.layer.id.startsWith('flows-')) {
    const dirLbl = { export: 'Eksport', import: 'Import', internal: 'Internflyt' }[p.direction] || 'Flyt';
    titleEl.textContent = `Kraftflyt: ${p.from} → ${p.to}`;
    descEl.textContent = `${Math.round(p.mw)} MW ${dirLbl}${p.cable ? ` via ${p.cable}` : ''}`;

    map.setFilter('flows-highlight', ['==', ['get', 'id'], p.id]);
    map.setFilter('zones-highlight', ['==', ['get', 'zoneName'], '']);
    state.selectedZone = null;
    state.selectedView = null;
    renderBalanceSection(null);
    renderReservoirSection(null);
  }
  else if (f.layer.id === 'reservoirs-layer') {
    const shortZone = p.zone.replace('_', ''), region = ZONE_NAMES[shortZone] || '';
    titleEl.textContent = `Magasin: ${region} (${shortZone})`;
    descEl.textContent = `${p.fill_percent.toFixed(1)}% fyllingsgrad`;

    map.setFilter('zones-highlight', ['==', ['get', 'zoneName'], shortZone]);
    map.setFilter('flows-highlight', ['==', ['get', 'id'], '']);
    // Magasin-tap aktiverer reservoir-detalj for sonen (sone og batteri deler NO_x).
    state.selectedZone = p.zone; // p.zone er allerede "NO_x"-format
    state.selectedView = 'reservoir';
    renderBalanceSection(p.zone);
    renderReservoirSection(p.zone);
  }

  if (window.innerWidth <= 768) setSheetState('half');
}

export function clearMobileSelection() {
  document.getElementById('sheet-context-title').textContent = 'Strømkart Norge';
  document.getElementById('sheet-context-desc').textContent = 'Velg et område i kartet, eller dra opp';
  if (map.getLayer('zones-highlight')) map.setFilter('zones-highlight', ['==', ['get', 'zoneName'], '']);
  if (map.getLayer('flows-highlight')) map.setFilter('flows-highlight', ['==', ['get', 'id'], '']);
  state.selectedZone = null;
  state.selectedView = null;
  renderBalanceSection(null);
  renderReservoirSection(null);
  if (window.innerWidth <= 768) setSheetState('peek');
}

// Privat funksjon (eksporteres ikke) — eneste kaller er handleZoneHover.
function renderSparkline(zoneSeries, accent, selectedIdx) {
  if (!zoneSeries || !zoneSeries.prices || zoneSeries.prices.length < 2) return '';
  const W = 200, H = 40, padX = 2, padY = 4, times = zoneSeries.prices.map(d => new Date(d.timestamp).getTime()), prices = zoneSeries.prices.map(d => d.price_ore_kwh);
  const tMin = times[0], tMax = times[times.length - 1], pMin = Math.min(...prices), pMax = Math.max(...prices);
  const pRange = (pMax - pMin) || 1, tRange = (tMax - tMin) || 1;
  const xOf = t => padX + ((t - tMin) / tRange) * (W - padX*2), yOf = p => padY + (1 - (p - pMin) / pRange) * (H - padY*2);

  let line = ''; zoneSeries.prices.forEach((d, i) => { line += (i===0?'M':'L') + xOf(times[i]).toFixed(1) + ',' + yOf(prices[i]).toFixed(1) + ' '; });
  const bY = (H - padY).toFixed(1), area = line + `L${xOf(times[times.length-1]).toFixed(1)},${bY} L${xOf(times[0]).toFixed(1)},${bY} Z`;

  // Playhead: hvit vertikal linje + ring der slideren står
  let playhead = '';
  if (selectedIdx != null && selectedIdx >= 0 && selectedIdx < zoneSeries.prices.length) {
    const px = xOf(times[selectedIdx]).toFixed(1);
    const py = yOf(prices[selectedIdx]).toFixed(1);
    playhead = `<line x1="${px}" y1="${padY}" x2="${px}" y2="${H-padY}" stroke="#ffffff" stroke-width="1" stroke-opacity="0.55"/><circle cx="${px}" cy="${py}" r="3" fill="#ffffff" stroke="${accent}" stroke-width="1.5"/>`;
  }

  return `<svg class="popup-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="${accent}" fill-opacity="0.18"/><path d="${line}" stroke="${accent}" stroke-width="1.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>${playhead}</svg>`;
}

// Fester den delegerte tilbakeknapp-lytteren (reservoir-panelet → balance-visning).
// Event delegation på document, så begge panel-instanser (desktop + mobil) dekkes
// av én lytter, og reservoir/balance-modulene slipper å kjenne hverandre.
export function initInteraction() {
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('reservoir-back')) {
      if (state.selectedZone) {
        state.selectedView = 'balance';
        renderBalanceSection(state.selectedZone);
        renderReservoirSection(state.selectedZone);
      }
    }
  });
}
