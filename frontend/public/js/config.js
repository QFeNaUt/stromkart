// ---------------------------------------------------------
// config.js — frosne konstanter og statiske data
// ---------------------------------------------------------
// Ren data, ingen oppførsel: ingen avhengighet til kart-instans,
// delt tilstand eller DOM. Importeres fritt av alle moduler.
//
// Andre steg i ES-modul-migreringen. priceColor() (funksjon) og
// DOM-oppslag som helpOverlay ble bevisst IKKE flyttet hit — de
// er oppførsel/DOM, ikke data, og hører til sine respektive lag.
//
// MERK: ZONE_LINE_PAINT refererer ZONE_COLORS, så ZONE_COLORS må
// stå definert foran den i denne fila.
// ---------------------------------------------------------

// API
export const API_BASE = 'https://api.stromkart.no';

// Soner — farger, navn, sentroider, kant-styling
export const ZONE_COLORS = { NO1: '#7cc4e8', NO2: '#7c8ee8', NO3: '#a07ce8', NO4: '#d67ce8', NO5: '#e87cc4' };
export const ZONE_NAMES = { NO1: 'Øst-Norge', NO2: 'Sør-Norge', NO3: 'Midt-Norge', NO4: 'Nord-Norge', NO5: 'Vest-Norge' };
export const ZONE_CENTROIDS = { 'NO_1': [10.5, 60.5], 'NO_2': [7.5, 58.8], 'NO_3': [10.5, 63.5], 'NO_4': [18.0, 68.5], 'NO_5': [6.5, 60.5] };
export const ZONE_LINE_PAINT = [
  'match', ['get', 'zoneName'],
  'NO1', ZONE_COLORS.NO1, 'NO2', ZONE_COLORS.NO2, 'NO3', ZONE_COLORS.NO3, 'NO4', ZONE_COLORS.NO4, 'NO5', ZONE_COLORS.NO5,
  '#6b7280',
];

// Pris-styling (fyll-gradient i øre/kWh)
export const PRICE_PAINT = [
  'interpolate', ['linear'], ['coalesce', ['get', 'price_ore_kwh'], -1],
  -1, '#374151', 0, '#10b981', 50, '#eab308', 100, '#f97316', 150, '#dc2626',
];

// Byer (vises som markører)
export const CITIES = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Oslo' },         geometry: { type: 'Point', coordinates: [10.7522, 59.9139] } },
    { type: 'Feature', properties: { name: 'Bergen' },       geometry: { type: 'Point', coordinates: [ 5.3221, 60.3913] } },
    { type: 'Feature', properties: { name: 'Trondheim' },    geometry: { type: 'Point', coordinates: [10.3951, 63.4305] } },
    { type: 'Feature', properties: { name: 'Stavanger' },    geometry: { type: 'Point', coordinates: [ 5.7331, 58.9700] } },
    { type: 'Feature', properties: { name: 'Tromsø' },       geometry: { type: 'Point', coordinates: [18.9560, 69.6492] } },
    { type: 'Feature', properties: { name: 'Kristiansand' }, geometry: { type: 'Point', coordinates: [ 7.9956, 58.1599] } },
  ],
};

// Kraftflyt-styling
export const FLOW_COLORS = { export: '#f97316', import: '#06b6d4', internal: '#9b91b8' };
export const FLOW_WIDTH = [
  'interpolate', ['linear'], ['coalesce', ['get', 'mw'], 0],
  0, 1.0, 50, 1.5, 400, 3.0, 1000, 5.0, 1400, 6.5,
];
export const FLOW_OPACITY = ['case', ['==', ['get', 'direction'], 'internal'], 0.55, 0.90];
export const FLOW_OPACITY_STALE = ['case', ['==', ['get', 'direction'], 'internal'], 0.35, 0.50];

// Produksjonsmiks — ENTSO-E PSR-koder → norske navn og bøtter
export const PSR_NAME_NO = {
  'Hydro Water Reservoir':           'Vannmagasin',
  'Hydro Run-of-river and poundage': 'Elvekraft',
  'Hydro Pumped Storage':            'Pumpekraft',
  'Wind Onshore':                    'Vindkraft (land)',
  'Wind Offshore':                   'Vindkraft (hav)',
  'Solar':                           'Solkraft',
  'Biomass':                         'Biomasse',
  'Waste':                           'Avfall',
  'Fossil Gas':                      'Fossil gass',
  'Fossil Hard coal':                'Steinkull',
  'Fossil Brown coal/Lignite':       'Brunkull',
  'Fossil Oil':                      'Fossil olje',
  'Fossil Oil shale':                'Oljeskifer',
  'Fossil Peat':                     'Torv',
  'Fossil Coal-derived gas':         'Kullgass',
  'Geothermal':                      'Geotermisk',
  'Marine':                          'Tidevann/bølge',
  'Nuclear':                         'Kjernekraft',
  'Other renewable':                 'Annet fornybart',
  'Other':                           'Annet',
};
export const PSR_NAME_TO_BUCKET = {
  'Hydro Water Reservoir':           'vann',
  'Hydro Run-of-river and poundage': 'vann',
  'Hydro Pumped Storage':            'vann',
  'Wind Onshore':                    'vind',
  'Wind Offshore':                   'vind',
  'Solar':                           'sol',
  'Biomass':                         'termisk',
  'Waste':                           'termisk',
  'Fossil Gas':                      'fossile',
  'Fossil Hard coal':                'fossile',
  'Fossil Brown coal/Lignite':       'fossile',
  'Fossil Oil':                      'fossile',
  'Fossil Oil shale':                'fossile',
  'Fossil Peat':                     'fossile',
  'Fossil Coal-derived gas':         'fossile',
};
export const BUCKET_HEX = {
  vann: '#3b82f6', vind: '#22c55e', sol: '#eab308',
  termisk: '#f97316', fossile: '#8F5342', annet: '#737373',
};
export const BUCKET_ORDER = ['vann', 'vind', 'sol', 'termisk', 'fossile', 'annet'];

// Tidslinje
export const PLAY_SPEED_MS = 200;  // ~19 sek per døgn, ~38 sek for 2 døgn

// Forklaringslag — kuratert faktasett for inline «i», Del A og Del B
export const CONCEPT_ORDER = ['spotpris', 'prissone', 'kraftflyt', 'hvdc', 'magasinfylling', 'mtu', 'ore_kwh', 'eks_mva'];
export const CONCEPTS = {
  spotpris: {
    label: 'Spotpris',
    body: 'Strømmens råvarepris. Den fastsettes på den nordiske kraftbørsen Nord Pool dagen i forveien og endres gjennom døgnet. Dette er prisen før nettleie, avgifter, mva og strømstøtte er lagt til – så den er alltid lavere enn det du faktisk betaler på strømregningen din.'
  },
  prissone: {
    label: 'Prissone (NO1–NO5)',
    body: 'Norge er delt i fem prisområder fordi strømnettet har begrenset kapasitet til å flytte kraft mellom landsdeler. Når en flaskehals hindrer transport, kan prisen bli ulik på hver side — derfor kan naboer i to soner betale helt forskjellig.'
  },
  kraftflyt: {
    label: 'Kraftflyt',
    body: 'Strømmen flyter fysisk mellom landsdeler og over landegrensene. Pilene på kartet viser hvilken vei strømmen går akkurat nå, og tykkelsen viser hvor mye energi som overføres. Strømmen søker seg automatisk fra områder med lav pris til områder med høy pris. Når en forbindelse når maks kapasitet, stopper denne utjevningen, og prisforskjellen mellom områdene blir stående.'
  },
  hvdc: {
    label: 'HVDC',
    body: '«Høyspent likestrøm» (high-voltage direct current): teknologien i de lange sjøkablene som knytter Norge til utlandet — NordLink til Tyskland, NorNed til Nederland, North Sea Link til Storbritannia og Skagerrak til Danmark. Over så lange avstander under vann taper likestrøm mindre energi enn vekselstrøm. Disse kablene er en viktig grunn til at prisen i Sør-Norge henger sammen med været på kontinentet.'
  },
  magasinfylling: {
    label: 'Magasinfylling',
    body: 'Hvor mye vann som er lagret i vannkraftmagasinene, målt i prosent av full kapasitet. I et vannkraftland som Norge er lagret vann det samme som lagret strøm – det er batteriet vårt. Fyllingsgraden endrer seg med årstidene: magasinene fylles opp av regn og smeltet snø om våren og sommeren, og tømmes gjennom vinteren. Derfor sier prosenten lite alene – 50 % fylling kan være kritisk lavt i november, men helt normalt i mai. Appen sammenligner derfor alltid dagens nivå med hva som er historisk normalt for akkurat denne uken.'
  },
  mtu: {
    label: 'MTU',
    body: '«Market Time Unit», tidsoppløsningen prisene settes i. Fra 2025 settes nordiske strømpriser i 15-minutters intervaller i stedet for hele timer — altså 96 priser i døgnet. Finere oppløsning betyr at prisen kan svinge raskere og fange opp kortere topper og bunner gjennom dagen.'
  },
  ore_kwh: {
    label: 'øre/kWh',
    body: 'Enheten du kjenner fra strømregninga: øre per kilowattime. Kraftbørsen oppgir prisen i euro per megawattime (EUR/MWh), så kartet regner det om ved å gange med dagens eurokurs fra Norges Bank og dele på 10. En kilowattime er omtrent det en vaskemaskin bruker på én vask — en håndgripelig enhet for hverdagsforbruk.'
  },
  eks_mva: {
    label: 'Eks. mva og avgifter',
    body: 'Tallene på kartet er ren spotpris — selve råvaren — uten det som kommer i tillegg på regninga: nettleie, elavgift, mva og eventuelt påslag fra strømleverandøren. Strømstøtte trekker derimot ned. Kartet viser markedet, ikke sluttsummen du betaler — så ikke les tallene her som «hva strømmen koster meg».'
  }
};

// Del A — tegnforklaring. Hver rad kan peke til et begrep i ordlista.
export const KEY_ITEMS = [
  {
    concept: 'spotpris', swatch: '<div class="sw-grad"></div>',
    label: 'Sonefarge',
    desc: 'Fargen i hver sone viser spotprisnivået — grønn (lav) til rød (høy), i øre/kWh.'
  },
  {
    concept: 'prissone', swatch: '<div class="sw-zones"></div>',
    label: 'Sonegrenser (prissoner)',
    desc: 'Hvert prisområde har sin egen unike kantfarge. Det gjør det lett å se hvor grensene går mellom de fem norske prissonene (NO1–NO5) og våre naboland.'
  },
  {
    concept: 'kraftflyt', swatch: '<div class="sw-arrow">➜</div>',
    label: 'Piler (kraftflyt)',
    desc: 'Viser strømmen som flyttes akkurat nå. Pilens retning viser veien strømmen går, og tykkelsen viser hvor store mengder som overføres.',
    dots: true
  },
  {
    concept: 'magasinfylling', swatch: '<div class="sw-battery"><span></span></div>',
    label: 'Batteri-ikoner (magasinfylling)',
    desc: 'Vises som batterier for å illustrere sonens lagrede energi. Høyden på det blå feltet viser hvor fulle magasinene er i prosent. De er bevisst farget nøytralt blå – i stedet for rød, gul eller grønn – fordi et lavt nivå om våren kan være like normalt som et høyt nivå om høsten.'
  },
  {
    concept: 'hvdc', swatch: '<div class="sw-flag"><i style="height:50%;background:#cf2e2e"></i><i style="height:50%;background:#3b6fb0"></i></div>',
    label: 'Flagg ved kabler',
    desc: 'Et flagg viser hvilket land en utenlandskabel går til. Trykk for mer om sjøkablene (HVDC).'
  },
  {
    concept: 'mtu', swatch: '<div class="sw-slider"></div>',
    label: 'Tidslinje',
    desc: 'Spol gjennom det siste døgnet og morgendagens prognose, i 15-minutters steg.'
  },
  {
    concept: null, swatch: '<div class="sw-tap"></div>',
    label: 'Trykk for detaljer',
    desc: 'Sone → forbruk og produksjon. Batteri → magasindetalj. Pil → kraftflyt.'
  },
  {
    concept: null, swatch: '<div class="sw-warn">⚠</div>',
    label: 'Bufret data',
    desc: 'Dempede farger og et gult «⚠ Bufret data»-merke betyr at vi viser sist kjente verdi mens ny data hentes.'
  }
];

// Hjelp
export const HELP_SEEN_KEY = 'stromkart_help_seen_v1';
