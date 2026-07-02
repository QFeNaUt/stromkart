// ---------------------------------------------------------
// ui/slider.js — Time-slider (96 prispunkter / 48 t)
// ---------------------------------------------------------
// Scrubber gjennom pris-tidsaksen og committer valgt indeks til kart +
// pristabell via renderAtIndex (helprivat — ingen ekstern kaller).
//
// Avhengighetsregel (lagdelt): ui/ importerer NEDOVER fra layers/
// (prices), map, state og config — aldri sidelengs eller oppover.
// renderAtIndex -> prices/map er en enveis, asyklisk kant.
//
// Eksporterer kun det orkestratoren trenger: initSlider (bootstrap),
// updateSliderUI og toggleSliderVisibility (begge kalt av loadData).
// ---------------------------------------------------------

import { state } from '../state.js';
import { map } from '../map.js';
import { PLAY_SPEED_MS } from '../config.js';
import { buildSnapshot, renderTable, computeNowIndex } from '../layers/prices.js';

// Modul-lokal tilstand (kryssgår ikke — blir her, ikke i state.js)
let isPlaying = false;
let playInterval = null;
let sliderCollapsed = false; // minimert tidslinje (sesjons-state, ikke persistent)

function renderAtIndex(idx) {
  if (!state.timeAxis.length) return;
  state.currentIndex = Math.max(0, Math.min(idx, state.timeAxis.length - 1));

  const snapshot = buildSnapshot(state.currentIndex);

  // Oppdater zone features og dytt nytt data til kilden — MapLibre re-tegner fyllene
  if (state.zonesData) {
    for (const f of state.zonesData.features) {
      const p = snapshot[f.properties.zoneName];
      if (p) {
        f.properties.price_ore_kwh = p.price_ore_kwh;
        f.properties.price_eur_mwh = p.price_eur_mwh;
        f.properties.timestamp = p.timestamp;
      }
    }
    const src = map.getSource('zones');
    if (src) src.setData(state.zonesData);
  }

  renderTable(snapshot);
  updateSliderUI();
}

function findDayBoundaryIndex() {
  // Returnerer indeksen der vi krysser fra dag N til dag N+1, eller -1 hvis aksen er innen ett døgn
  if (state.timeAxis.length < 2) return -1;
  const firstDay = state.timeAxis[0].toDateString();
  for (let i = 1; i < state.timeAxis.length; i++) {
    if (state.timeAxis[i].toDateString() !== firstDay) return i;
  }
  return -1;
}

function formatTimeLabel() {
  if (!state.timeAxis.length) return '—';
  const t = state.timeAxis[state.currentIndex];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const timeStr = t.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

  let prefix;
  if (state.currentIndex === state.nowIndex) {
    prefix = '<span class="live-dot"></span>Nå';
  } else if (t.toDateString() === now.toDateString()) {
    prefix = 'I dag';
  } else if (t.toDateString() === tomorrow.toDateString()) {
    prefix = 'I morgen';
  } else {
    prefix = t.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return `${prefix} · ${timeStr}`;
}

export function updateSliderUI() {
  if (!state.timeAxis.length) return;
  const maxIdx = state.timeAxis.length - 1;

  // Tidslabel (både i full UI og kompakt pille)
  const label = formatTimeLabel();
  document.querySelectorAll('.time-slider-label, .collapsed-time-label').forEach(el => { el.innerHTML = label; });

  // Range-input max + value
  document.querySelectorAll('.time-slider-range').forEach(el => {
    if (parseInt(el.max, 10) !== maxIdx) el.max = String(maxIdx);
    if (parseInt(el.value, 10) !== state.currentIndex) el.value = String(state.currentIndex);
  });

  // "Nå"-markør på sliderspor
  const nowPct = maxIdx > 0 ? (state.nowIndex / maxIdx) * 100 : 0;
  document.querySelectorAll('.time-slider-now-marker').forEach(el => {
    el.style.left = `${nowPct}%`;
    el.classList.add('visible');
  });

  // Døgnskille-markør (kun synlig hvis vi har 2 døgn)
  const boundaryIdx = findDayBoundaryIndex();
  const boundaryPct = boundaryIdx > 0 ? (boundaryIdx / maxIdx) * 100 : 0;
  document.querySelectorAll('.time-slider-day-marker').forEach(el => {
    if (boundaryIdx > 0) {
      el.style.left = `${boundaryPct}%`;
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  });

  // "Nå"-knapp dimmes når vi allerede er på nå
  const atNow = (state.currentIndex === state.nowIndex);
  document.querySelectorAll('.time-slider-now').forEach(el => {
    el.classList.toggle('at-now', atNow);
  });
}

export function toggleSliderVisibility(visible) {
  document.querySelectorAll('#time-slider-desktop, #time-slider-mobile').forEach(el => {
    el.classList.toggle('hidden', !visible);
  });
}

function toggleSliderCollapse() {
  sliderCollapsed = !sliderCollapsed;
  document.querySelectorAll('#time-slider-desktop, #time-slider-mobile').forEach(el => {
    el.classList.toggle('collapsed', sliderCollapsed);
  });
  // Pause auto-play når brukeren minimerer (ellers ville den fortsatt usynlig animere)
  if (sliderCollapsed) pausePlay();
}

function startPlay() {
  if (!state.timeAxis.length || isPlaying) return;
  isPlaying = true;
  document.querySelectorAll('.time-slider-play').forEach(el => { el.textContent = '⏸'; });
  playInterval = setInterval(() => {
    let next = state.currentIndex + 1;
    if (next >= state.timeAxis.length) next = 0; // loop tilbake til start
    state.userPinned = true;
    renderAtIndex(next);
  }, PLAY_SPEED_MS);
}

function pausePlay() {
  if (!isPlaying) return;
  isPlaying = false;
  document.querySelectorAll('.time-slider-play').forEach(el => { el.textContent = '▶'; });
  if (playInterval) { clearInterval(playInterval); playInterval = null; }
}

function togglePlay() { isPlaying ? pausePlay() : startPlay(); }

function snapToNow() {
  pausePlay();
  state.userPinned = false;
  state.nowIndex = computeNowIndex();
  renderAtIndex(state.nowIndex);
}

export function initSlider() {
  document.querySelectorAll('.time-slider-range').forEach(range => {
    // 'pointerdown' pauser umiddelbart når brukeren griper slideren,
    // selv før noen bevegelse skjer. Dekker både mus og touch.
    range.addEventListener('pointerdown', () => {
      pausePlay();
      state.userPinned = true;
    });
    // 'input' fyrer kontinuerlig under drag (smooth animasjon)
    range.addEventListener('input', (e) => {
      state.userPinned = true;
      renderAtIndex(parseInt(e.target.value, 10));
    });
  });
  document.querySelectorAll('.time-slider-play').forEach(btn => {
    btn.addEventListener('click', togglePlay);
  });
  document.querySelectorAll('.time-slider-now').forEach(btn => {
    btn.addEventListener('click', snapToNow);
  });
  // Minimer/maksimer: separate knapper med ulike ARIA-labels,
  // men begge toggler samme state.
  document.querySelectorAll('.time-slider-collapse, .time-slider-expand').forEach(btn => {
    btn.addEventListener('click', toggleSliderCollapse);
  });
}
