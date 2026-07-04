import { state } from '../state.js';

/**
 * Returnerer fargekode for en gitt pris (øre/kWh).
 */
export function priceColor(p) {
  if (p == null) return '#374151';
  if (p <= 50)  return '#10b981';
  if (p <= 100) return '#eab308';
  if (p <= 150) return '#f97316';
  return '#dc2626';
}

/**
 * Bygger felles tidsakse basert på lengste tilgjengelige soneserie.
 */
export function buildTimeAxis() {
  let longest = [];
  for (const zone of ['NO1', 'NO2', 'NO3', 'NO4', 'NO5']) {
    const series = state.todayPrices[zone]?.prices;
    if (series && series.length > longest.length) longest = series;
  }
  state.timeAxis = longest.map(d => new Date(d.timestamp));
}

/**
 * Finner indeksen i tidsaksen som tilsvarer nåtid (eller rett før).
 */
export function computeNowIndex() {
  if (!state.timeAxis.length) return 0;
  const now = Date.now();
  let idx = 0;
  for (let i = 0; i < state.timeAxis.length; i++) {
    if (state.timeAxis[i].getTime() <= now) idx = i;
    else break;
  }
  return idx;
}

/**
 * Bygger et prissnapshot for alle soner på en gitt tidsindeks.
 */
export function buildSnapshot(idx) {
  const snap = {};
  for (const zone of ['NO1', 'NO2', 'NO3', 'NO4', 'NO5']) {
    const series = state.todayPrices[zone]?.prices;
    if (series && series[idx]) {
      snap[zone] = {
        price_ore_kwh: series[idx].price_ore_kwh,
        price_eur_mwh: series[idx].price_eur_mwh,
        timestamp: series[idx].timestamp,
      };
    } else {
      snap[zone] = { price_ore_kwh: null, price_eur_mwh: null, timestamp: null };
    }
  }
  return snap;
}
