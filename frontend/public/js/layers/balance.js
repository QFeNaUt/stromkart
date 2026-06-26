import { state } from '../state.js';
import { ZONE_NAMES, PSR_NAME_NO, PSR_NAME_TO_BUCKET, BUCKET_HEX, BUCKET_ORDER } from '../config.js';

function fmtMW(mw) {
  if (mw == null) return '—';
  // Tusenseparator med non-breaking space
  return Math.round(mw).toLocaleString('nb-NO').replace(/,/g, '\u00a0') + ' MW';
}

export function renderBalanceSection(zoneKey) {
  // Henter ALLE balance-section-containere (mobil-sheet + desktop-panel)
  // og rendrer det samme innholdet i hver. Bruker class-baserte selectors
  // innenfor hver container slik at vi ikke får duplicate-ID-problemer.
  const sections = document.querySelectorAll('.balance-section');
  if (!sections.length) return;

  // Felles tilstandsbestemmelse: skal seksjonen vises i det hele tatt?
  // Vises kun når balance er aktivt valgt (sone-tap) — ikke når brukeren
  // har tappet et batteri (da skal reservoir-panelet vises i stedet).
  const hide = !state.balanceVisible || !zoneKey || state.selectedView !== 'balance';
  const haveData = state.balanceData && state.balanceData.zones && zoneKey && state.balanceData.zones[zoneKey];

  sections.forEach(section => {
    if (hide) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    const numbersEl = section.querySelector('.balance-numbers');
    const barEl = section.querySelector('.balance-bar');
    const detailEl = section.querySelector('.balance-detail');
    const metaEl = section.querySelector('.balance-meta');
    const banner = section.querySelector('.balance-stale-banner');
    const subEl = section.querySelector('.balance-subtitle');

    // Ingen data for valgt sone
    if (!haveData) {
      if (numbersEl) numbersEl.innerHTML =
        '<div class="stat"><span class="label">Status</span><span class="value">Ingen data</span></div>';
      if (barEl) barEl.innerHTML = '';
      if (detailEl) detailEl.innerHTML = '';
      if (metaEl) metaEl.textContent = '';
      if (banner) banner.classList.remove('visible');
      if (subEl) subEl.textContent = '—';
      return;
    }

    const z = state.balanceData.zones[zoneKey];
    const isStale = state.balanceData.is_stale === true;
    if (banner) banner.classList.toggle('visible', isStale);

    // Subtitle på desktop-panelet viser hvilken sone som er aktiv
    if (subEl) {
      const region = ZONE_NAMES[zoneKey.replace('_', '')] || zoneKey;
      subEl.textContent = `${region} (${zoneKey.replace('_', '')})`;
    }

    // --- Nøkkeltall: Produksjon · Forbruk · Netto ---
    const prod = z.generation_mix ? z.generation_mix.total_mw : null;
    const load = z.load_mw;
    const net = z.net_balance_mw;
    const netClass = net == null ? '' : (net >= 0 ? 'pos' : 'neg');
    const netSign = net == null ? '' : (net >= 0 ? '+' : '');
    if (numbersEl) numbersEl.innerHTML = `
      <div class="stat"><span class="label">Produksjon</span><span class="value">${fmtMW(prod)}</span></div>
      <div class="stat"><span class="label">Forbruk</span><span class="value">${fmtMW(load)}</span></div>
      <div class="stat"><span class="label">Netto</span><span class="value ${netClass}">${net == null ? '—' : netSign + fmtMW(net)}</span></div>
    `;

    // --- Stablet søyle ---
    if (barEl) {
      if (z.generation_mix && z.generation_mix.total_mw > 0) {
        const total = z.generation_mix.total_mw;
        const summary = z.generation_mix.summary;
        barEl.innerHTML = BUCKET_ORDER
          .filter(b => (summary[b] || 0) > 0)
          .map(b => {
            const pct = (summary[b] / total) * 100;
            return `<div class="seg ${b}" style="width: ${pct.toFixed(2)}%;" title="${b}: ${pct.toFixed(1)}%"></div>`;
          }).join('');
      } else {
        barEl.innerHTML = '';
      }
    }

    // --- Detaljtabell (sortert synkende på MW) ---
    if (detailEl) {
      if (z.generation_mix && z.generation_mix.detailed) {
        const total = z.generation_mix.total_mw || 1;
        const rows = Object.entries(z.generation_mix.detailed)
          .filter(([, mw]) => mw > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([name, mw]) => {
            const bucket = PSR_NAME_TO_BUCKET[name] || 'annet';
            const color = BUCKET_HEX[bucket];
            const pct = ((mw / total) * 100).toFixed(1);
            const label = PSR_NAME_NO[name] || name;
            return `<div class="row">
              <span class="dot" style="background: ${color};"></span>
              <span class="name">${label}</span>
              <span class="mw">${fmtMW(mw)}</span>
              <span class="pct">${pct} %</span>
            </div>`;
          }).join('');
        detailEl.innerHTML = rows;
      } else {
        detailEl.innerHTML = '';
      }
    }

    // --- Metadata: tidsstempler ---
    if (metaEl) {
      const loadTs = z.load_timestamp ? new Date(z.load_timestamp) : null;
      const genTs = z.generation_timestamp ? new Date(z.generation_timestamp) : null;
      const fmtT = d => d ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '—';
      metaEl.textContent = `Forbruk kl ${fmtT(loadTs)} · produksjon kl ${fmtT(genTs)}`;
    }
  });
}
