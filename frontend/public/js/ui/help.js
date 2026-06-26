// ---------------------------------------------------------
// ui/help.js — Forklaringslag («Slik leser du kartet» + ordliste)
// ---------------------------------------------------------
// UI-chrome som ligger oppå datalagene: tegnforklaring (Del A) +
// ordliste (Del B), inline «i»-knapper og førstegangsvisning. Rører
// hverken handleMapClick eller render-funksjonene — lav regresjonsrisiko.
//
// Near-leaf: importerer kun frosne konstanter fra config (FLOW_COLORS for
// flyt-prikkene i tegnforklaringen, KEY_ITEMS/CONCEPT_ORDER/CONCEPTS for
// innholdet, HELP_SEEN_KEY for localStorage-flagget). Ingen map/state.
//
// Eksporterer kun initHelp (bootstrap). Alt annet er privat. Document-
// lytterne (klikk-delegering + Escape) festes inni initHelp, konsistent
// med initSheet/initSlider — eksplisitt oppstart styrt av orkestratoren.
// ---------------------------------------------------------

import { FLOW_COLORS, KEY_ITEMS, CONCEPT_ORDER, CONCEPTS, HELP_SEEN_KEY } from '../config.js';

const helpOverlay = document.getElementById('help-overlay');

function buildKey() {
  const flowDots = `<div class="key-dots">`
    + `<span class="d"><i style="background:${FLOW_COLORS.export}"></i>Eksport</span>`
    + `<span class="d"><i style="background:${FLOW_COLORS.import}"></i>Import</span>`
    + `<span class="d"><i style="background:${FLOW_COLORS.internal}"></i>Internt</span>`
    + `</div>`;
  const html = KEY_ITEMS.map(it => {
    const attrs = it.concept ? `data-concept="${it.concept}"` : 'disabled';
    const dots = it.dots ? flowDots : '';
    return `<button class="key-item" type="button" ${attrs}>`
      + `<span class="key-swatch">${it.swatch}</span>`
      + `<span class="key-text"><span class="key-label">${it.label}</span>`
      + `<span class="key-desc">${it.desc}</span>${dots}</span>`
      + `</button>`;
  }).join('');
  document.getElementById('help-key').innerHTML = html;
}

function buildGlossary() {
  const html = CONCEPT_ORDER.map(key => {
    const c = CONCEPTS[key];
    return `<details class="gloss" id="gloss-${key}">`
      + `<summary>${c.label}</summary>`
      + `<div class="gloss-body">${c.body}</div>`
      + `</details>`;
  }).join('');
  document.getElementById('help-glossary').innerHTML = html;
}

function openHelp(focusKey) {
  helpOverlay.classList.add('open');
  helpOverlay.setAttribute('aria-hidden', 'false');
  if (focusKey && CONCEPTS[focusKey]) {
    helpOverlay.querySelectorAll('.gloss').forEach(d => { d.open = (d.id === `gloss-${focusKey}`); });
    const target = document.getElementById(`gloss-${focusKey}`);
    if (target) {
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1400);
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }
  const closeBtn = helpOverlay.querySelector('.help-close');
  if (closeBtn) closeBtn.focus();
}

function closeHelp() {
  helpOverlay.classList.remove('open');
  helpOverlay.setAttribute('aria-hidden', 'true');
}

// Auto-visning kun første besøk; knappen er alltid tilgjengelig etterpå.
function maybeAutoOpenHelp() {
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) {}
  if (seen) return;
  try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (e) {}
  setTimeout(() => openHelp(), 700);
}

export function initHelp() {
  buildKey();
  buildGlossary();

  document.addEventListener('click', (e) => {
    const badge = e.target.closest('[data-concept]');
    if (badge) { e.preventDefault(); openHelp(badge.getAttribute('data-concept')); return; }
    if (e.target.closest('[data-help-open]')) { openHelp(); return; }
    if (e.target.closest('[data-help-close]')) { closeHelp(); return; }
    if (e.target === helpOverlay) { closeHelp(); } // klikk på bakteppe
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpOverlay.classList.contains('open')) closeHelp();
  });

  maybeAutoOpenHelp();
}
