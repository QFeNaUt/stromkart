// src/store.jsx — AppState: useReducer + Context (arkitekturvalg B1)
// ---------------------------------------------------------
// Reduceren speiler klasse 1+2 fra js/state.js, eier de React-nye
// feltene (selection, help, currentPrices), og deriverer fra og med
// steg 2.5 tidsakse-tilstanden selv fra rådata. Klasse 3 (zonesData,
// flowsData, flowsFlagsData, mapLoaded) blir VÆRENDE i det muterbare
// legacy-objektet — kun imperativ kartkode konsumerer dem (reducer-
// opsjon C, låst 04.07).
//
// Eierskaps-modellen (F3, låst 04.07):
//   - Reduceren er KILDEN for feltene i REACT_OWNED. Broen speiler dem
//     énveis React → legacy, så umigrert imperativ kode leser ferske
//     verdier uten å vite at React finnes.
//   - Felt UTENFOR REACT_OWNED eies fortsatt av legacy-skriverne
//     (f.eks. api.js → todayPrices). Broen rører dem IKKE — ellers
//     ville en urelatert dispatch overskrevet legacy-verdien med
//     reducerens utdaterte kopi. Det er driftfellen i praksis.
//   - Hvert felt bytter eier i ÉN commit: skrivingen blir dispatch,
//     og feltet legges til REACT_OWNED i samme diff. Aldri to aktive
//     kilder samtidig.
//
// VIKTIG lese-regel for legacy: dispatch er IKKE synkron — reduceren
// (og dermed speilingen) kjører først ved neste React-render. Legacy
// kan derfor aldri dispatche og lese speilet i samme tick. Lesing av
// speilet fra en SENERE hendelse (poll, mousemove, click) er trygt.
// ---------------------------------------------------------

import { createContext, useContext, useEffect, useReducer } from 'react';
import { state as legacyState } from './js/state.js';
import { setAppDispatch } from './js/bridge.js';
import { buildTimeAxis, computeNowIndex } from './js/layers/prices.js';

// Felt reduceren eier. Vokser med én linje per migrert komponent-commit.
// Kun felt som OGSÅ finnes i legacy state.js trenger speiling; de
// React-nye feltene (selection, helpOpen, currentPrices, ...) har
// ingen legacy-lesere.
export const REACT_OWNED = [
  // Controls (steg 2.4) — synlighetsflaggene. Eneste tidligere skriver
  // (bindToggle) er pensjonert; legacy-lesere (updateOverlayVisibility,
  // panel-/lag-modulene) betjenes av det synkrone speilet i reduceren.
  'spotPriceVisible',
  'flowsVisible',
  'reservoirsVisible',
  'balanceVisible',
  'plantsVisible',
  // TimeSlider (steg 2.5) — tidsakse-tilstanden. Tidligere skrivere
  // (renderPriceLayer i main.js, renderAtIndex i slider.js) er hhv.
  // omskrevet til dispatch og pensjonert. Legacy-leseren er sparkline-
  // popupen i interaction.js — betjenes av speilet frem til
  // interaksjonsmigreringen.
  'timeAxis',
  'currentIndex',
  'nowIndex',
  'userPinned',
  // Interaction (steg 2.6) — selection-derivatene. Tidligere skriver
  // (handleMapClick/clearMobileSelection i interaction.js) er omskrevet
  // til dispatch. Legacy-lesere er balance-/reservoir-renderne
  // (state.selectedView) og addOverlays (state.selectedZone) — betjenes
  // av speilet frem til panelmigreringen. Kilden er selection-feltet;
  // disse to deriveres av select-/backToBalance-actionene.
  'selectedZone',
  'selectedView',
];

export const initialState = {
  // --- Klasse 1: UI-tilstand (speiler js/state.js 1:1) ---
  spotPriceVisible: true,
  flowsVisible: true,
  reservoirsVisible: true,
  balanceVisible: true,
  plantsVisible: false,   // Kraftverk av som standard (69 markører — opt-in)

  selectedZone: null,     // aktiv sone i panel-konteksten ("NO_x")
  selectedView: null,     // 'balance' | 'reservoir' | null

  timeAxis: [],           // Date[] — kanonisk tidsakse (lengste sone-serie)
  currentIndex: 0,        // hvilken 15-min-slot som vises
  nowIndex: 0,            // hvor i timeAxis "nå" befinner seg
  userPinned: false,      // true når brukeren har dratt slideren bort fra "nå"

  // --- Klasse 2: datacacher som React-paneler leser ---
  // todayPrices: dual-kopi fra main.js (todayPricesLoaded) — legacy-
  // lageret (skrevet av api.js) er fortsatt kilden for synkrone lesere
  // (sparkline). IKKE i REACT_OWNED, samme regel som reservoirsData.
  todayPrices: {},
  reservoirsData: null,   // strippet til .areas (jf. datakontrakten)
  balanceData: null,      // FULL wrapper { zones, fetched_at, is_stale }
  flowsIsStale: false,

  // --- React-nye felt (fantes ikke i state.js) ---
  // Bølge 1-fallback for pristabellen: /api/prices/current-objektet slik
  // fetchCore leverte det. null → «Laster…»-raden. PricesPanel deriverer
  // snapshot = f(todayPrices, currentIndex) og faller tilbake hit når
  // tidsaksen ennå ikke finnes. (Erstattet snapshot-stillaset
  // priceSnapshot, slettet i steg 2.5.)
  currentPrices: null,
  // Funn 2: sheet-tittel/desc var skjult tilstand i DOM-en. Nå deriveres
  // de av selection: { kind: 'zone'|'flow'|'plant'|'reservoir', props: {...} }
  // AKTIVT fra steg 2.6: skrives av select/clearSelection, konsumeres av
  // <SheetHeader/> og MapCanvas' selection-effekt. selectedZone/selectedView
  // (over) deriveres av dette feltet i select-actionen.
  selection: null,
  // Funn 4: help må kunne åpnes fra hele treet (badges i Controls/Legend/Sheet).
  // helpFocusKey: null | { key, ts } — ts settes av dispatch-stedet (Date.now()),
  // så to klikk på samme begrep gir nytt objekt og flash/scroll-effekten
  // re-kjører (tro mot dagens re-flash-oppførsel). Reduceren forblir ren.
  helpOpen: false,
  helpFocusKey: null,
  // isPlaying/sliderCollapsed bor IKKE her (S2, låst 05.07): ekte lokal
  // UI-tilstand uten legacy-lesere — useState i <TimeSlider/>, delt av
  // begge portal-instansene via felles forelder.
};

// Engangs-speiling ved modul-last: legacy-defaults og initialState er
// definert identisk, men invarianten skal ikke hvile på disiplin alene.
for (const key of REACT_OWNED) legacyState[key] = initialState[key];

// ---------------------------------------------------------
// Reducer med synkront legacy-speil (revidert C1, låst 04.07)
// ---------------------------------------------------------
// Speilingen skjer HER — ikke i en effekt — fordi effekter kjører etter
// paint: en MapLibre-hendelse i vinduet mellom commit og effekt-flush
// ville lest utdatert speil. transition() er den rene tilstandsmaskinen;
// reducer() er bevisst «uren» på ett kontrollert punkt: den skriver
// REACT_OWNED-feltene til legacy-objektet før retur. Trygt fordi
// tilordningen er idempotent (StrictModes dobbeltkjøring er ufarlig) og
// React kjører reduceren med korrekt prev-state også ved batchede
// dispatches — speilet konvergerer alltid til sluttilstanden.
export function reducer(state, action) {
  const next = transition(state, action);
  if (next !== state) {
    for (const key of REACT_OWNED) legacyState[key] = next[key];
  }
  return next;
}

function transition(state, action) {
  switch (action.type) {
    // --- HelpOverlay (steg 2.2) ---
    case 'openHelp':
      // focusKey (valgfri): begrep som skal åpnes + flashes i ordlista.
      // ts kommer fra dispatch-stedet — se helpFocusKey-noten i initialState.
      return {
        ...state,
        helpOpen: true,
        helpFocusKey: action.focusKey ? { key: action.focusKey, ts: action.ts ?? 0 } : null,
      };
    case 'closeHelp':
      return { ...state, helpOpen: false };

    // --- Controls (steg 2.4) ---
    case 'setLayerVisible': {
      // Whitelist: lag-navnene i dispatch-kallene er kompileringstids-
      // konstanter — et ukjent navn er en programmeringsfeil og skal dø
      // i første røyktest, ikke overleve som en stille død toggle.
      const ALLOWED = ['spotPriceVisible', 'flowsVisible', 'reservoirsVisible', 'balanceVisible', 'plantsVisible'];
      if (!ALLOWED.includes(action.field)) {
        throw new Error(`setLayerVisible: ukjent lag-felt '${action.field}'`);
      }
      return { ...state, [action.field]: action.visible };
    }

    // --- PricesPanel (steg 2.3) ---
    case 'setReservoirs':
      // Dual-skriv-kopi fra api.js: legacy-lageret er fortsatt kilden for
      // synkrone lesere (addOverlays-stien samme tick); denne kopien driver
      // React-re-render (magasin-subprisen). Feltet skal IKKE i REACT_OWNED —
      // broen må ikke speile den tilbake over legacy-skriverens verdi.
      return { ...state, reservoirsData: action.reservoirs };

    // --- TimeSlider (steg 2.5) — datainngang fra loadData ---
    case 'currentPricesLoaded':
      // Bølge 1: /api/prices/current — fallback-snapshot til tidsaksen finnes.
      return { ...state, currentPrices: action.prices };
    case 'todayPricesLoaded': {
      // Bølge 2: today-seriene har landet (dual-kopi, legacy-kilde: api.js).
      // Reduceren deriverer tidsakse-tilstanden SELV med de rene
      // prices.js-hjelperne (S3, låst 05.07). Kjøres på nytt ved hver
      // poll: upinnet slider følger «nå», pinnet slider beholder (klampet)
      // posisjon — identisk med gamle renderPriceLayer-logikken.
      const timeAxis = buildTimeAxis(action.todayPrices);
      const nowIndex = computeNowIndex(timeAxis);
      const currentIndex = state.userPinned
        ? Math.min(state.currentIndex, Math.max(0, timeAxis.length - 1))
        : nowIndex;
      return { ...state, todayPrices: action.todayPrices, timeAxis, nowIndex, currentIndex };
    }

    // --- TimeSlider (steg 2.5) — brukerinteraksjon ---
    case 'scrubTo': {
      // input-hendelsen under drag. Klamping her (ikke i komponenten):
      // reduceren er eneste sted som kjenner gyldig indeksrom.
      if (!state.timeAxis.length) return state;
      const idx = Math.max(0, Math.min(action.index, state.timeAxis.length - 1));
      return { ...state, currentIndex: idx, userPinned: true };
    }
    case 'playTick': {
      // Avspilling: neste slot, loop tilbake til start (legacy-troskap).
      if (!state.timeAxis.length) return state;
      const next = state.currentIndex + 1 >= state.timeAxis.length ? 0 : state.currentIndex + 1;
      return { ...state, currentIndex: next, userPinned: true };
    }
    case 'snapToNow': {
      // «Nå»-knappen: re-beregner nowIndex (klokka har gått siden sist).
      if (!state.timeAxis.length) return state;
      const nowIndex = computeNowIndex(state.timeAxis);
      return { ...state, nowIndex, currentIndex: nowIndex, userPinned: false };
    }
    case 'pinUser':
      // pointerdown på slideren: pinner FØR noen bevegelse skjer, så
      // neste poll ikke rykker slideren tilbake til «nå» (legacy-troskap).
      return state.userPinned ? state : { ...state, userPinned: true };

    // --- Interaction (steg 2.6) ---
    case 'select': {
      // Klikk/tap på et kart-objekt. selectedZone/selectedView DERIVERES
      // her (samme mønster som tidsakse-derivasjonen i S3): sone-tap gir
      // balance-visning, batteri-tap gir reservoir-visning (sone og
      // batteri deler NO_x-nøkkelen), flyt/kraftverk gir ingen panel.
      const { kind, props } = action;
      let selectedZone = null, selectedView = null;
      if (kind === 'zone') {
        selectedZone = `NO_${props.zoneName.slice(2)}`; // "NO2" -> "NO_2"
        selectedView = 'balance';
      } else if (kind === 'reservoir') {
        selectedZone = props.zone; // allerede "NO_x"-format
        selectedView = 'reservoir';
      }
      return { ...state, selection: { kind, props }, selectedZone, selectedView };
    }
    case 'clearSelection':
      // Tomt kart-tap eller sheet-dismiss (onPeek). No-op når ingenting
      // er valgt — da skal heller ikke selection-effekten re-kjøre.
      if (!state.selection && !state.selectedZone) return state;
      return { ...state, selection: null, selectedZone: null, selectedView: null };
    case 'backToBalance':
      // Tilbakeknappen i reservoir-panelet. selection beholdes (sheet-
      // tittelen skal fortsatt vise magasinet — legacy-troskap: gamle
      // koden rørte heller ikke tittelen her), kun visningen byttes.
      if (!state.selectedZone) return state;
      return { ...state, selectedView: 'balance' };

    default:
      // Ukjent action er en feil i migreringsrekkefølgen — fail-fast,
      // ikke stille ignorering.
      throw new Error(`Ukjent action i AppState-reducer: ${action.type}`);
  }
}

// ---------------------------------------------------------
// Dispatch-broen (F3, siste ledd) bor i src/js/bridge.js (ren JS):
// legacy-moduler importerer appDispatch derfra og rører aldri .jsx.
// Provideren setter referansen ved mount via setAppDispatch (under).
// ---------------------------------------------------------

// ---------------------------------------------------------
// Provider + hooks
// ---------------------------------------------------------
// To contexts (state / dispatch) er standardmønsteret: komponenter som
// kun dispatcher (toggles, knapper) re-rendres ikke når state endres.
const StateContext = createContext(null);
const DispatchContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Eksponer dispatch for imperativ kode via broen. Idempotent og
  // StrictMode-trygg: dispatch-identiteten fra useReducer er stabil.
  useEffect(() => {
    setAppDispatch(dispatch);
  }, [dispatch]);

  // Broen (F3): énveis React → legacy for felt reduceren eier. Kjøres
  // etter hver state-endring; assign er billig (håndfull nøkler).
  useEffect(() => {
    for (const key of REACT_OWNED) {
      legacyState[key] = state[key];
    }
  }, [state]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(StateContext);
  if (ctx === null) throw new Error('useAppState må brukes innenfor <AppStateProvider>');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(DispatchContext);
  if (ctx === null) throw new Error('useAppDispatch må brukes innenfor <AppStateProvider>');
  return ctx;
}
