import { map } from '../map.js';
import { state } from '../state.js';
import { ZONE_CENTROIDS, ZONE_NAMES } from '../config.js';

export function addReservoirLayer() {
  if (!state.reservoirsData) return;
  const features = [];
  for (const [zoneCode, info] of Object.entries(state.reservoirsData)) {
    const coords = ZONE_CENTROIDS[zoneCode];
    if (!coords || info.fill_percent == null) continue;
    const bucket = Math.round(info.fill_percent / 5) * 5;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { zone: zoneCode, fill_percent: info.fill_percent, bucket, icon: `battery-${bucket}` } });
  }
  const geojson = { type: 'FeatureCollection', features };
  
  const src = map.getSource('reservoirs');
  if (src) src.setData(geojson); else map.addSource('reservoirs', { type: 'geojson', data: geojson });
  const beforeId = map.getLayer('cities-dot') ? 'cities-dot' : undefined;
  if (!map.getLayer('reservoirs-layer')) map.addLayer({ id: 'reservoirs-layer', type: 'symbol', source: 'reservoirs', layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, beforeId);
}

export function renderReservoirSection(zoneKey) {
  // Speiler renderBalanceSection-mønsteret: én funksjon rendrer i alle
  // .reservoir-section-containere (mobil-sheet + desktop-panel).
  const sections = document.querySelectorAll('.reservoir-section');
  if (!sections.length) return;

  // Vises kun når reservoir er aktivt valgt (batteri-tap).
  const hide = !zoneKey || state.selectedView !== 'reservoir';
  const r = state.reservoirsData && zoneKey ? state.reservoirsData[zoneKey] : null;
  const haveData = r != null;

  sections.forEach(section => {
    if (hide) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    const subEl = section.querySelector('.reservoir-subtitle');
    const headlineEl = section.querySelector('.reservoir-headline');
    const envEl = section.querySelector('.reservoir-envelope');
    const envMetaEl = section.querySelector('.reservoir-envelope-meta');
    const topListEl = section.querySelector('.reservoir-top-list');
    const metaEl = section.querySelector('.reservoir-meta');

    if (!haveData) {
      if (subEl) subEl.textContent = '—';
      if (headlineEl) headlineEl.innerHTML = '<span class="pct">—</span>';
      if (envEl) envEl.innerHTML = '';
      if (envMetaEl) envMetaEl.innerHTML = '';
      if (topListEl) topListEl.innerHTML = '';
      if (metaEl) metaEl.textContent = '';
      return;
    }

    // --- Subtitle: region + uke ---
    if (subEl) {
      const region = ZONE_NAMES[zoneKey.replace('_', '')] || zoneKey;
      subEl.textContent = `${region} (${zoneKey.replace('_', '')}) · Uke ${r.week}`;
    }

    // --- Headline: % + endring siste uke ---
    const change = r.change_percent;
    const changeClass = change == null ? '' : (change >= 0 ? 'pos' : 'neg');
    const changeSign = change == null ? '' : (change >= 0 ? '+' : '');
    const pctTxt = r.fill_percent != null ? r.fill_percent.toFixed(1) : '—';
    if (headlineEl) {
      headlineEl.innerHTML = `
        <span class="pct">${pctTxt} %</span>
        ${change != null ? `<span class="delta ${changeClass}">${changeSign}${change.toFixed(1)} %-poeng siste uke</span>` : ''}
      `;
    }

    // --- Envelope: historisk min/median/max-skala med nå-markør ---
    const hist = r.historical;
    if (hist && envEl && envMetaEl) {
      const min = hist.min_percent, max = hist.max_percent, median = hist.median_percent;
      const range = max - min;
      // Pad skalaen 5 % på hver side så markøren ikke kollapser i kantene
      // hvis nå-verdien sammenfaller med min eller max.
      const pad = range > 0 ? range * 0.08 : 5;
      const scaleMin = min - pad, scaleMax = max + pad, scaleRange = scaleMax - scaleMin;
      const pos = v => ((v - scaleMin) / scaleRange) * 100;

      const medianPos = pos(median).toFixed(1);
      const now = r.fill_percent;
      const nowPos = now != null ? Math.max(0, Math.min(100, pos(now))).toFixed(1) : null;

      envEl.innerHTML = `
        <div class="track"></div>
        <div class="median-tick" style="left: ${medianPos}%;" title="Median: ${median.toFixed(1)} %"></div>
        ${nowPos != null ? `<div class="now-marker" style="left: ${nowPos}%;" title="Nå: ${now.toFixed(1)} %"></div>` : ''}
      `;
      envMetaEl.innerHTML = `
        <span>${Math.round(min)} % min</span>
        <span>${Math.round(median)} % median</span>
        <span>${Math.round(max)} % max</span>
      `;
    } else if (envEl) {
      envEl.innerHTML = '';
      if (envMetaEl) envMetaEl.innerHTML = '';
    }

    // --- Topp 5 magasin ---
    if (topListEl) {
      if (r.top_reservoirs && r.top_reservoirs.length) {
        topListEl.innerHTML = r.top_reservoirs.map(m => `
          <div class="item">
            <div class="row">
              <span class="name">${m.name}</span>
              <span class="volume">${m.volume_mill_m3.toLocaleString('nb-NO')} mill. m³</span>
            </div>
            ${m.note ? `<div class="note">${m.note}</div>` : ''}
          </div>
        `).join('');
      } else {
        topListEl.innerHTML = '';
      }
    }

    // --- Meta: referanseperiode + neste publisering ---
    if (metaEl) {
      const parts = [];
      if (hist) parts.push(`Referanse: ${hist.reference_period} (${hist.years_in_sample} år)`);
      if (r.measurement_date) {
        const d = new Date(r.measurement_date);
        parts.push(`Måling ${d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' })}`);
      }
      if (r.next_publication) {
        const d = new Date(r.next_publication);
        parts.push(`Neste publisering ${d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' })}`);
      }
      metaEl.textContent = parts.join(' · ');
    }
  });
}
