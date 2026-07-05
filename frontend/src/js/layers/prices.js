// ---------------------------------------------------------
// layers/prices.js — rene pris-hjelpere (steg 2.5)
// ---------------------------------------------------------
// Alle funksjonene er RENE fra og med TimeSlider-migreringen: data inn
// som argumenter, verdier ut — null lesing/skriving av delt tilstand.
// Dermed kan de kalles trygt fra BEGGE verdener:
//   - legacy (main.js renderPriceLayer — wave-1-populering av sone-props)
//   - React (store.jsx transition(), PricesPanel useMemo, MapCanvas
//     fyll-effekten) — «lovlig nedover-kant», samme presedens som
//     priceColor i PricesPanel (2.3).
// Modulen har null imports — den kan aldri delta i en sykel.
// ---------------------------------------------------------

const ZONES = ['NO1', 'NO2', 'NO3', 'NO4', 'NO5'];

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
 * @param {object} todayPrices  { NO1..NO5: { prices: [{timestamp,...}] } }
 * @returns {Date[]}
 */
export function buildTimeAxis(todayPrices) {
  let longest = [];
  for (const zone of ZONES) {
    const series = todayPrices[zone]?.prices;
    if (series && series.length > longest.length) longest = series;
  }
  return longest.map(d => new Date(d.timestamp));
}

/**
 * Finner indeksen i tidsaksen som tilsvarer nåtid (eller rett før).
 * @param {Date[]} timeAxis
 * @returns {number}
 */
export function computeNowIndex(timeAxis) {
  if (!timeAxis.length) return 0;
  const now = Date.now();
  let idx = 0;
  for (let i = 0; i < timeAxis.length; i++) {
    if (timeAxis[i].getTime() <= now) idx = i;
    else break;
  }
  return idx;
}

/**
 * Bygger et prissnapshot for alle soner på en gitt tidsindeks.
 * @param {object} todayPrices
 * @param {number} idx
 * @returns {object} { NO1..NO5: { price_ore_kwh, price_eur_mwh, timestamp } }
 */
export function buildSnapshot(todayPrices, idx) {
  const snap = {};
  for (const zone of ZONES) {
    const series = todayPrices[zone]?.prices;
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
