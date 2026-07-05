// src/components/Controls.jsx — Kartlag-toggles (steg 2.4)
// ---------------------------------------------------------
// Første ekte REACT_OWNED-eierskifte: de fem synlighetsfeltene eies nå
// av reduceren, og bindToggle/syncToggle i main.js er pensjonert.
// Desktop↔mobil-synkroniseringen er strukturelt garantert — begge
// instansene rendres fra samme reducer-felt.
//
// Portal-mønsteret fra 2.3: én komponent, to instanser — desktop inn i
// den tømte #controls-diven (CSS-posisjoneringen sitter på iden), mobil
// inn i #controls-slot-m (sheet-seksjonen, klassen beholdt for spacing).
//
// i-badgene og help-triggeren dispatcher direkte via onClick og har
// BEVISST IKKE data-concept-/data-help-open-attributter — ellers ville
// HelpOverlays delegeringsbro (for umigrerte triggere) dobbeltfyrt.
// Samme grep som key-items i 2.2.
//
// Kart-sideeffektene (updateOverlayVisibility, popup-fjerning) bor IKKE
// her — de eies av MapCanvas-effektene. Balansepanelet eier fra steg 2.7
// sin egen synlighet (<BalancePanel/> leser balanceVisible fra context).
// Controls er en ren dispatch-flate.
// ---------------------------------------------------------

import { createPortal } from 'react-dom';
import { useAppState, useAppDispatch } from '../store.jsx';

// Rekkefølge og tekster identiske med den gamle markupen.
// field-verdiene valideres mot whitelisten i reduceren (fail-fast).
const LAYERS = [
  { field: 'spotPriceVisible',  label: 'Spotpris',              concept: 'spotpris' },
  { field: 'flowsVisible',      label: 'Kraftflyt',             concept: 'kraftflyt' },
  { field: 'reservoirsVisible', label: 'Magasinfylling',        concept: 'magasinfylling' },
  { field: 'balanceVisible',    label: 'Forbruk og produksjon', concept: null },
  { field: 'plantsVisible',     label: 'Kraftverk',             concept: 'kraftverk' },
];

function ToggleList({ title, withHelpTrigger }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return (
    <>
      <div className="subtitle">{title}</div>
      {LAYERS.map(({ field, label, concept }) => (
        <div className="toggle-row" key={field}>
          <label className="layer-toggle">
            <input
              type="checkbox"
              checked={state[field]}
              onChange={(e) => dispatch({ type: 'setLayerVisible', field, visible: e.target.checked })}
            />
            {' '}<span>{label}</span>
          </label>
          {concept ? (
            <button
              className="info-badge"
              type="button"
              aria-label={`Forklar ${label.toLowerCase()}`}
              onClick={() => dispatch({ type: 'openHelp', focusKey: concept, ts: Date.now() })}
            >i</button>
          ) : null}
        </div>
      ))}
      {withHelpTrigger ? (
        <button
          className="help-trigger"
          type="button"
          onClick={() => dispatch({ type: 'openHelp' })}
        >
          <span className="q">?</span><span>Slik leser du kartet</span>
        </button>
      ) : null}
    </>
  );
}

export function Controls() {
  // Slot-ankrene er statiske i index.html (jf. PricesPanel-mønsteret).
  const desktopSlot = document.getElementById('controls');
  const mobileSlot = document.getElementById('controls-slot-m');

  return (
    <>
      {desktopSlot && createPortal(
        <ToggleList title="Lag" withHelpTrigger />, desktopSlot)}
      {mobileSlot && createPortal(
        <ToggleList title="Kartlag" withHelpTrigger={false} />, mobileSlot)}
    </>
  );
}
