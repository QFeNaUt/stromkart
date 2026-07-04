// src/components/HelpOverlay.jsx — Forklaringslag («Slik leser du kartet»)
// ---------------------------------------------------------
// Første ekte React-komponent (steg 2.2). Erstatter js/ui/help.js OG
// help-markupen i index.html — komponenten eier nå både innhold og
// tilstand (helpOpen/helpFocusKey i reduceren, funn 4).
//
// Ider og klasser er identiske med den gamle markupen → null CSS-diff.
// config.js er urørt (H3): swatch-strengene i KEY_ITEMS er kuratert,
// frossen HTML og rendres via dangerouslySetInnerHTML; alt annet er JSX.
//
// Overgangsbro (H2): data-concept-/data-help-open-knappene bor fortsatt
// i statisk HTML (Controls, Legend, Sheet) til de komponentene migreres.
// En document-delegert klikk-effekt (med cleanup) oversetter dem til
// dispatches — samme mønster som gamle initHelp, men StrictMode-trygt.
// Lukking (✕, bakteppe, Escape) er derimot ekte React-handlere.
//
// DOM-koreografi (H3): <details>-åpning, flash og scrollIntoView er
// bevisst imperative i en effekt via ref — det er koreografi, ikke
// tilstand. <details>-elementene rendres ukontrollert, så brukerens
// egne åpne/lukk-klikk fungerer nativt uten at React blander seg.
// ---------------------------------------------------------

import { useEffect, useRef } from 'react';
import { FLOW_COLORS, KEY_ITEMS, CONCEPT_ORDER, CONCEPTS, HELP_SEEN_KEY } from '../js/config.js';
import { useAppState, useAppDispatch } from '../store.jsx';

// Flyt-prikkene i tegnforklaringen (gamle buildKey sin flowDots-streng).
function FlowDots() {
  return (
    <div className="key-dots">
      <span className="d"><i style={{ background: FLOW_COLORS.export }} />Eksport</span>
      <span className="d"><i style={{ background: FLOW_COLORS.import }} />Import</span>
      <span className="d"><i style={{ background: FLOW_COLORS.internal }} />Internt</span>
    </div>
  );
}

export function HelpOverlay() {
  const { helpOpen, helpFocusKey } = useAppState();
  const dispatch = useAppDispatch();
  const overlayRef = useRef(null);

  // --- Effekt 1: overgangsbroen (H2) — delegert klikk for umigrerte triggere.
  // Fanger [data-concept]-badges og [data-help-open]-knapper i statisk HTML.
  // Key-item-knappene i JSX-en under har IKKE data-concept-attributt (de
  // dispatcher direkte via onClick), så broen dobbeltfyrer aldri.
  useEffect(() => {
    const onDocClick = (e) => {
      const badge = e.target.closest('[data-concept]');
      if (badge) {
        e.preventDefault();
        dispatch({ type: 'openHelp', focusKey: badge.getAttribute('data-concept'), ts: Date.now() });
        return;
      }
      if (e.target.closest('[data-help-open]')) dispatch({ type: 'openHelp' });
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [dispatch]);

  // --- Effekt 2: Escape lukker (kun festet mens overlayet er åpent).
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') dispatch({ type: 'closeHelp' }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [helpOpen, dispatch]);

  // --- Effekt 3: DOM-koreografien fra gamle openHelp (H3).
  // helpFocusKey er { key, ts } — ts gir nytt objekt per klikk, så to klikk
  // på samme begrep re-kjører effekten (re-flash + re-scroll, som i dag).
  useEffect(() => {
    if (!helpOpen) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    let flashTimer = null;

    if (helpFocusKey && CONCEPTS[helpFocusKey.key]) {
      const key = helpFocusKey.key;
      overlay.querySelectorAll('.gloss').forEach(d => { d.open = (d.id === `gloss-${key}`); });
      const target = overlay.querySelector(`#gloss-${key}`);
      if (target) {
        target.classList.add('flash');
        flashTimer = setTimeout(() => target.classList.remove('flash'), 1400);
        requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
    }
    const closeBtn = overlay.querySelector('.help-close');
    if (closeBtn) closeBtn.focus();

    return () => { if (flashTimer) clearTimeout(flashTimer); };
  }, [helpOpen, helpFocusKey]);

  // --- Effekt 4: førstegangsvisning (H4-fiksen).
  // localStorage-flagget settes INNE i timeout-callbacken, ikke ved mount:
  // under StrictMode-dobbeltkjøring rydder cleanup runde 1s timeout FØR
  // flagget er satt, så runde 2 planlegger på nytt og auto-visningen fyrer
  // nøyaktig én gang — også i dev. (Gamle koden satte flagget først og
  // ville aldri auto-åpnet ved ekte førstebesøk i dev.)
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) {}
    if (seen) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (e) {}
      dispatch({ type: 'openHelp' });
    }, 700);
    return () => clearTimeout(t);
  }, [dispatch]);

  return (
    <div
      id="help-overlay"
      ref={overlayRef}
      className={helpOpen ? 'open' : ''}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      aria-hidden={!helpOpen}
      onClick={(e) => { if (e.target === e.currentTarget) dispatch({ type: 'closeHelp' }); }}
    >
      <div className="help-modal" role="document">
        <div className="help-head">
          <h2 id="help-title">Slik leser du kartet</h2>
          <button
            className="help-close"
            type="button"
            aria-label="Lukk"
            onClick={() => dispatch({ type: 'closeHelp' })}
          >✕</button>
        </div>
        <div className="help-body">
          <p className="help-intro">Kartet viser hva strøm koster i engrosmarkedet akkurat nå, hvor den flyter, og hvor mye vann vi har spart i magasinene. Trykk på et punkt under for en kort forklaring.</p>

          <div className="help-subhead">Tegnforklaring</div>
          <div id="help-key">
            {KEY_ITEMS.map(it => (
              <button
                key={it.label}
                className="key-item"
                type="button"
                disabled={!it.concept}
                onClick={it.concept
                  ? () => dispatch({ type: 'openHelp', focusKey: it.concept, ts: Date.now() })
                  : undefined}
              >
                <span className="key-swatch" dangerouslySetInnerHTML={{ __html: it.swatch }} />
                <span className="key-text">
                  <span className="key-label">{it.label}</span>
                  <span className="key-desc">{it.desc}</span>
                  {it.dots ? <FlowDots /> : null}
                </span>
              </button>
            ))}
          </div>

          <div className="help-subhead">Ordliste</div>
          <div id="help-glossary">
            {CONCEPT_ORDER.map(key => (
              <details className="gloss" id={`gloss-${key}`} key={key}>
                <summary>{CONCEPTS[key].label}</summary>
                <div className="gloss-body">{CONCEPTS[key].body}</div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
