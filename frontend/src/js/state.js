// ---------------------------------------------------------
// state.js — delt, muterbar tilstand på tvers av moduler
// ---------------------------------------------------------
// KUN kryssgående tilstand (lest/skrevet av flere moduler) hører
// hjemme her. Modul-lokal tilstand (sheet-drag, slider-avspilling,
// init-flagg) blir værende i sin egen modul.
//
// Ett delt objekt med direkte mutasjon (state.todayPrices = ...).
// Valgt framfor setter-funksjoner: minst boilerplate, nærmest dagens
// delte scope, og objekt-egenskaper muteres fritt på tvers av moduler
// (i motsetning til en importert `let`, som er read-only hos importøren).
//
// Tredje steg i ES-modul-migreringen.
// ---------------------------------------------------------

export const state = {
  // Kart-beredskap (settes true i map.on('load'))
  mapLoaded: false,

  // Datacacher (loadData skriver, render-funksjonene leser)
  todayPrices: {},
  zonesData: null,
  flowsData: null,
  flowsFlagsData: null,
  reservoirsData: null,

  // Synlighetsflagg — REACT_OWNED-speil (reduceren skriver synkront,
  // updateOverlayVisibility/lag-koden leser)
  spotPriceVisible: true,
  flowsVisible: true,
  flowsIsStale: false,
  reservoirsVisible: true,
  balanceVisible: true,
  plantsVisible: false,   // Kraftverk-laget er av som standard (69 markører — opt-in)

  // Time-slider-akse — REACT_OWNED-speil (reduceren skriver synkront,
  // renderPriceLayer leser ved bølge 1-fyllet)
  timeAxis: [],         // Date[] — kanonisk tidsakse (lengste sone-serie)
  currentIndex: 0,      // hvilken 15-min-slot vises akkurat nå
  nowIndex: 0,          // hvor i timeAxis "nå" befinner seg
  userPinned: false,    // true når brukeren har dratt slideren bort fra "nå"
};
