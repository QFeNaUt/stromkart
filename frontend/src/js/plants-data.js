// plants-data.js — de største vann- og vindkraftverkene i Norge
//
// GENERERT FIL — ikke rediger for hånd. Regenereres med:
//   python hent_kraftverk_kandidater.py   (hent attributter)
//   python hent_koordinater.py            (fyll koordinater via OSM)
//   python generer_plants_data.py         (denne — kuratering + sammenslåing)
//
// Kilde: NVE (api.nve.no, NLOD) + OpenStreetMap (ODbL). Generert: 2026-07-02
//
// type: 'magasin' | 'elv' | 'vind'   (styrer hvilket ikon markøren får)
// mw:   installert effekt (sum for sammenslåtte klynger)
// gwh:  midlere årsproduksjon (sum for sammenslåtte klynger)
// coord: [lon, lat] (WGS84) — for klynger: største anleggs posisjon
// members: kildeanleggene bak en sammenslått markør (utelatt for enkeltanlegg)

export const POWER_PLANTS = Object.freeze([
  {"id": "kvilldal", "name": "Kvilldal", "type": "magasin", "mw": 1240.0, "gwh": 3231, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Suldal", "coord": [6.65884, 59.526996]},
  {"id": "sima", "name": "Sima", "type": "magasin", "mw": 1120.0, "gwh": 2890, "zone": "NO5", "owner": "STATKRAFT ENERGI AS", "municipality": "Eidfjord", "coord": [7.140822, 60.507122], "members": ["Sy-Sima", "Lang-Sima"]},
  {"id": "tonstad", "name": "Tonstad", "type": "magasin", "mw": 960.0, "gwh": 4058, "zone": "NO2", "owner": "SIRA KVINA KRAFTSELSKAP", "municipality": "Sirdal", "coord": [6.728764, 58.658435]},
  {"id": "aurland-1", "name": "Aurland 1", "type": "magasin", "mw": 840.0, "gwh": 2099, "zone": "NO5", "owner": "HAFSLUND KRAFT AS", "municipality": "Aurland", "coord": [7.300772, 60.852477]},
  {"id": "saurdal", "name": "Saurdal", "type": "magasin", "mw": 640.0, "gwh": 1064, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Suldal", "coord": [6.691061, 59.480776]},
  {"id": "svartisen", "name": "Svartisen", "type": "magasin", "mw": 600.0, "gwh": 2424, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Meløy", "coord": [13.931334, 66.724522]},
  {"id": "rana", "name": "Rana", "type": "magasin", "mw": 500.0, "gwh": 2224, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Rana", "coord": [14.270375, 66.295093]},
  {"id": "tokke", "name": "Tokke", "type": "magasin", "mw": 430.0, "gwh": 2396, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Tokke", "coord": [8.040321, 59.445573]},
  {"id": "holen", "name": "Holen", "type": "magasin", "mw": 390.0, "gwh": 1024, "zone": "NO2", "owner": "OTRA KRAFT DA", "municipality": "Bykle", "coord": [7.248001, 59.353104], "members": ["Holen I-II", "Holen III"]},
  {"id": "tyin", "name": "Tyin", "type": "magasin", "mw": 374.0, "gwh": 1462, "zone": "NO5", "owner": "HYDRO ENERGI AS", "municipality": "Årdal", "coord": [7.849978, 61.297121]},
  {"id": "lysebotn-ii", "name": "Lysebotn II", "type": "magasin", "mw": 370.0, "gwh": 1476, "zone": "NO2", "owner": "LYSE KRAFT DA", "municipality": "Sandnes", "coord": [6.632268, 59.065339]},
  {"id": "nedre-rossaga", "name": "Nedre Røssåga", "type": "magasin", "mw": 350.0, "gwh": 2050, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Hemnes", "coord": [13.773489, 66.05216]},
  {"id": "brokke", "name": "Brokke", "type": "magasin", "mw": 330.0, "gwh": 1601, "zone": "NO2", "owner": "OTRA KRAFT DA", "municipality": "Valle", "coord": [7.506284, 59.124732]},
  {"id": "evanger", "name": "Evanger", "type": "magasin", "mw": 330.0, "gwh": 1303, "zone": "NO5", "owner": "EVINY FORNYBAR AS", "municipality": "Voss", "coord": [6.118656, 60.662184]},
  {"id": "matre", "name": "Matre", "type": "magasin", "mw": 330.0, "gwh": 1451, "zone": "NO5", "owner": "EVINY FORNYBAR AS", "municipality": "Masfjorden", "coord": [5.596914, 60.870082], "members": ["Matre H", "Matre M"]},
  {"id": "suldal", "name": "Suldal", "type": "magasin", "mw": 330.0, "gwh": 1825, "zone": "NO2", "owner": "LYSE KRAFT DA", "municipality": "Suldal", "coord": [6.821646, 59.652459], "members": ["Suldal I", "Suldal II"]},
  {"id": "nedre-vinstra", "name": "Nedre Vinstra", "type": "magasin", "mw": 308.0, "gwh": 1177, "zone": "NO1", "owner": "HAFSLUND KRAFT AS", "municipality": "Nord-Fron", "coord": [9.792883, 61.564573]},
  {"id": "kobbelv", "name": "Kobbelv", "type": "magasin", "mw": 300.0, "gwh": 766, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Sørfold", "coord": [16.007076, 67.621621]},
  {"id": "skjomen", "name": "Skjomen", "type": "magasin", "mw": 300.0, "gwh": 1341, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Narvik", "coord": [17.365844, 68.201084]},
  {"id": "vinje", "name": "Vinje", "type": "magasin", "mw": 300.0, "gwh": 1105, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Vinje", "coord": [7.85391, 59.625558]},
  {"id": "aura", "name": "Aura", "type": "magasin", "mw": 290.0, "gwh": 1754, "zone": "NO3", "owner": "STATKRAFT ENERGI AS", "municipality": "Sunndal", "coord": [8.514705, 62.664099]},
  {"id": "jostedal", "name": "Jostedal", "type": "magasin", "mw": 288.0, "gwh": 932, "zone": "NO5", "owner": "STATKRAFT ENERGI AS", "municipality": "Luster", "coord": [7.30862, 61.520844]},
  {"id": "aurland-3", "name": "Aurland 3", "type": "magasin", "mw": 270.0, "gwh": 94, "zone": "NO5", "owner": "HAFSLUND KRAFT AS", "municipality": "Aurland", "coord": [7.571414, 60.798119]},
  {"id": "skagen", "name": "Skagen", "type": "magasin", "mw": 270.0, "gwh": 1448, "zone": "NO5", "owner": "HYDRO ENERGI AS", "municipality": "Luster", "coord": [7.706695, 61.50462]},
  {"id": "mauranger", "name": "Mauranger", "type": "magasin", "mw": 250.0, "gwh": 1345, "zone": "NO5", "owner": "STATKRAFT ENERGI AS", "municipality": "Kvinnherad", "coord": [6.337446, 60.127566]},
  {"id": "nes", "name": "Nes", "type": "magasin", "mw": 250.0, "gwh": 1421, "zone": "NO5", "owner": "HAFSLUND KRAFT AS", "municipality": "Nesbyen", "coord": [9.064855, 60.603383]},
  {"id": "blafalli-vik", "name": "Blåfalli Vik", "type": "magasin", "mw": 230.0, "gwh": 807, "zone": "NO2", "owner": "SUNNHORDLAND KRAFTLAG AS", "municipality": "Kvinnherad", "coord": [5.994158, 59.844033]},
  {"id": "tysso-ii", "name": "Tysso II", "type": "magasin", "mw": 224.0, "gwh": 1118, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Ullensvang", "coord": [6.641975, 60.129893]},
  {"id": "sonna-h", "name": "Sønnå H", "type": "magasin", "mw": 212.4, "gwh": 1032, "zone": "NO2", "owner": "Aktieselskabet Saudefaldene", "municipality": "Sauda", "coord": [6.378893, 59.639788]},
  {"id": "borgund", "name": "Borgund", "type": "magasin", "mw": 212.0, "gwh": 1069, "zone": "NO5", "owner": "ØSTFOLD ENERGI AS", "municipality": "Lærdal", "coord": [7.83285, 61.058573]},
  {"id": "skjerka", "name": "Skjerka", "type": "magasin", "mw": 206.6, "gwh": 765, "zone": "NO2", "owner": "Å ENERGI VANNKRAFT AS", "municipality": "Åseral", "coord": [7.367315, 58.55809]},
  {"id": "nore-i", "name": "Nore I", "type": "magasin", "mw": 206.0, "gwh": 1165, "zone": "NO5", "owner": "STATKRAFT ENERGI AS", "municipality": "Nore og Uvdal", "coord": [8.960341, 60.267063]},
  {"id": "oksla", "name": "Oksla", "type": "magasin", "mw": 206.0, "gwh": 1082, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Ullensvang", "coord": [6.568891, 60.125869]},
  {"id": "usta", "name": "Usta", "type": "magasin", "mw": 205.22, "gwh": 897, "zone": "NO5", "owner": "HAFSLUND KRAFT AS", "municipality": "Ål", "coord": [8.410292, 60.567355]},
  {"id": "vemork", "name": "Vemork", "type": "magasin", "mw": 204.0, "gwh": 1280, "zone": "NO2", "owner": "HYDRO ENERGI AS", "municipality": "Tinn", "coord": [8.493688, 59.869473]},
  {"id": "duge", "name": "Duge", "type": "magasin", "mw": 200.0, "gwh": 206, "zone": "NO2", "owner": "SIRA KVINA KRAFTSELSKAP", "municipality": "Sandnes", "coord": [6.892182, 59.128898]},
  {"id": "solhom", "name": "Solhom", "type": "magasin", "mw": 200.0, "gwh": 730, "zone": "NO2", "owner": "SIRA KVINA KRAFTSELSKAP", "municipality": "Kvinesdal", "coord": [7.012966, 58.775694]},
  {"id": "saheim", "name": "Såheim", "type": "magasin", "mw": 189.0, "gwh": 1121, "zone": "NO2", "owner": "HYDRO ENERGI AS", "municipality": "Tinn", "coord": [8.592999, 59.87662]},
  {"id": "mar", "name": "Mår", "type": "magasin", "mw": 180.0, "gwh": 1146, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Tinn", "coord": [8.673882, 59.885353]},
  {"id": "siso", "name": "Siso", "type": "magasin", "mw": 180.0, "gwh": 935, "zone": "NO4", "owner": "SISO ENERGI AS", "municipality": "Sørfold", "coord": [15.722386, 67.323136]},
  {"id": "tunnsjodal", "name": "Tunnsjødal", "type": "magasin", "mw": 176.0, "gwh": 840, "zone": "NO4", "owner": "NTE ENERGI AS", "municipality": "Namsskogan", "coord": [12.837529, 64.702632]},
  {"id": "nea", "name": "Nea", "type": "magasin", "mw": 175.0, "gwh": 663, "zone": "NO3", "owner": "STATKRAFT ENERGI AS", "municipality": "Tydal", "coord": [11.703233, 63.032077]},
  {"id": "ovre-rossaga", "name": "Øvre Røssåga", "type": "magasin", "mw": 175.0, "gwh": 989, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Hemnes", "coord": [13.800971, 65.886342]},
  {"id": "steinsland", "name": "Steinsland", "type": "magasin", "mw": 170.0, "gwh": 803, "zone": "NO5", "owner": "EVINY FORNYBAR AS", "municipality": "Modalen", "coord": [5.985186, 60.923337]},
  {"id": "roldal", "name": "Røldal", "type": "magasin", "mw": 166.0, "gwh": 889, "zone": "NO2", "owner": "LYSE KRAFT DA", "municipality": "Ullensvang", "coord": [6.818589, 59.818548]},
  {"id": "hylen", "name": "Hylen", "type": "magasin", "mw": 160.0, "gwh": 624, "zone": "NO2", "owner": "STATKRAFT ENERGI AS", "municipality": "Suldal", "coord": [6.602348, 59.557856]},
  {"id": "alta", "name": "Alta", "type": "magasin", "mw": 153.0, "gwh": 738, "zone": "NO4", "owner": "STATKRAFT ENERGI AS", "municipality": "Alta", "coord": [23.795685, 69.717929]},
  {"id": "torpa", "name": "Torpa", "type": "magasin", "mw": 150.0, "gwh": 421, "zone": "NO1", "owner": "HAFSLUND KRAFT AS", "municipality": "Nordre Land", "coord": [10.031805, 61.006583]},
  {"id": "ana-sira", "name": "Åna-Sira", "type": "magasin", "mw": 150.0, "gwh": 642, "zone": "NO2", "owner": "SIRA KVINA KRAFTSELSKAP", "municipality": "Flekkefjord", "coord": [6.453224, 58.293747]},
  {"id": "vamma", "name": "Vamma", "type": "elv", "mw": 344.0, "gwh": 1565, "zone": "NO1", "owner": "HAFSLUND KRAFT AS", "municipality": "Indre Østfold", "coord": [11.171058, 59.541475]},
  {"id": "fellesanlegget-kykkelsrud-fossumfoss", "name": "Fellesanlegget Kykkelsrud-Fossumfoss", "type": "elv", "mw": 230.0, "gwh": 1233, "zone": "NO1", "owner": "HAFSLUND KRAFT AS", "municipality": "Indre Østfold", "coord": [11.101026, 59.579875]},
  {"id": "solbergfoss", "name": "Solbergfoss", "type": "elv", "mw": 201.0, "gwh": 1048, "zone": "NO1", "owner": "HAFSLUND KRAFT AS", "municipality": "Indre Østfold", "coord": [11.155106, 59.636604]},
  {"id": "oyfjellet", "name": "Øyfjellet", "type": "vind", "mw": 400.0, "gwh": 1321, "zone": "NO4", "owner": "ØYFJELLET WIND AS", "municipality": "Vefsn", "coord": [13.013234, 65.853836]},
  {"id": "bjerkreim", "name": "Bjerkreim", "type": "vind", "mw": 294.0, "gwh": 982, "zone": "NO2", "owner": "BJERKREIM VIND AS", "municipality": "Bjerkreim", "coord": [5.909388, 58.584847], "members": ["Bjerkreim", "Skinansfjellet og Gravdal"]},
  {"id": "storheia", "name": "Storheia", "type": "vind", "mw": 288.0, "gwh": 901, "zone": "NO3", "owner": "FOSEN VIND DA", "municipality": "Ørland, Åfjord", "coord": [10.145516, 63.880964]},
  {"id": "roan", "name": "Roan", "type": "vind", "mw": 255.6, "gwh": 760, "zone": "NO3", "owner": "ROAN VIND DA", "municipality": "Åfjord", "coord": [10.338424, 64.145432]},
  {"id": "tonstad-flekkefjord-sirdal", "name": "Tonstad", "type": "vind", "mw": 208.3, "gwh": 660, "zone": "NO2", "owner": "TONSTAD VINDKRAFT AS", "municipality": "Flekkefjord, Sirdal", "coord": [6.789329, 58.540192]},
  {"id": "guleslettene", "name": "Guleslettene", "type": "vind", "mw": 197.4, "gwh": 705, "zone": "NO3", "owner": "GULESLETTENE VINDKRAFT AS", "municipality": "Kinn, Bremanger", "coord": [5.104668, 61.679416]},
  {"id": "kvitfjell", "name": "Kvitfjell", "type": "vind", "mw": 197.4, "gwh": 631, "zone": "NO4", "owner": "TROMSØ VIND AS", "municipality": "Tromsø", "coord": [18.15393, 69.588307]},
  {"id": "geitfjellet", "name": "Geitfjellet", "type": "vind", "mw": 180.6, "gwh": 537, "zone": "NO3", "owner": "FOSEN VIND DA", "municipality": "Heim, Orkland", "coord": [9.494031, 63.354863]},
  {"id": "odal", "name": "Odal", "type": "vind", "mw": 163.2, "gwh": 530, "zone": "NO1", "owner": "ODAL VINDKRAFTVERK AS", "municipality": "Nord-Odal", "coord": [11.463415, 60.369943]},
  {"id": "tellenes", "name": "Tellenes", "type": "vind", "mw": 160.0, "gwh": 548, "zone": "NO2", "owner": "TELLENES VINDPARK AS", "municipality": "Sokndal, Lund", "coord": [6.461521, 58.339909]},
  {"id": "midtfjellet", "name": "Midtfjellet", "type": "vind", "mw": 149.6, "gwh": 396, "zone": "NO2", "owner": "MIDTFJELLET VINDKRAFT AS", "municipality": "Fitjar", "coord": [5.374429, 59.930346]},
  {"id": "smola", "name": "Smøla", "type": "vind", "mw": 145.8, "gwh": 317, "zone": "NO3", "owner": "SMØLA VIND 2 AS", "municipality": "Smøla", "coord": [7.919455, 63.405972]},
  {"id": "sormarkfjellet", "name": "Sørmarkfjellet", "type": "vind", "mw": 130.2, "gwh": 384, "zone": "NO3", "owner": "SØRMARKFJELLET AS", "municipality": "Osen, Flatanger", "coord": [10.695862, 64.392179]},
  {"id": "harbaksfjellet", "name": "Harbaksfjellet", "type": "vind", "mw": 126.0, "gwh": 394, "zone": "NO3", "owner": "FOSEN VIND DA", "municipality": "Åfjord", "coord": [10.081154, 64.075981]},
  {"id": "kvenndalsfjellet", "name": "Kvenndalsfjellet", "type": "vind", "mw": 113.4, "gwh": 357, "zone": "NO3", "owner": "FOSEN VIND DA", "municipality": "Åfjord", "coord": [10.120379, 64.007162]},
  {"id": "egersund", "name": "Egersund", "type": "vind", "mw": 112.2, "gwh": 355, "zone": "NO2", "owner": "EGERSUND VIND AS", "municipality": "Eigersund", "coord": [6.095567, 58.433966]},
  {"id": "raskiftet", "name": "Raskiftet", "type": "vind", "mw": 111.6, "gwh": 316, "zone": "NO1", "owner": "AUSTRI RASKIFTET DA", "municipality": "Trysil, Åmot", "coord": [11.789679, 61.189807]}
]);
