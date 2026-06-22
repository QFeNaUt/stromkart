"""
Statisk kuratert liste over de 5 største vannmagasinene per elspotområde,
rangert etter nyttbart magasinvolum (mellom LRV og HRV).

Holdes adskilt fra nve_service.py fordi disse er menneskelig kuraterte
fakta som ikke endrer seg ofte og som ikke er knyttet til NVE-API-et.
Hvis vi senere kobler på faktisk fyllingsgrad per enkeltmagasin fra NVE,
kan dette utvides uten å røre live-tjenesten.

Volumtall i millioner kubikkmeter (mill. m³).
"""

TOP_RESERVOIRS = {
    "NO_1": [
        {
            "name": "Mjøsa",
            "volume_mill_m3": 1312,
            "note": "Reguleres 3,61 m. Norges 5. største kraftmagasin i nyttbart volum.",
        },
        {
            "name": "Strandavatnet",
            "volume_mill_m3": 554,
            "note": "Hol i Hallingdal. Utnyttes i Hol 1.",
        },
        {
            "name": "Randsfjorden",
            "volume_mill_m3": 408,
            "note": "Reguleres ca. 3,2 m.",
        },
        {
            "name": "Tunhovdfjorden",
            "volume_mill_m3": 352,
            "note": "Numedalslågen. Hovedmagasin for Nore I.",
        },
        {
            "name": "Bygdin",
            "volume_mill_m3": 336,
            "note": "Vinstravassdraget.",
        },
    ],
    "NO_2": [
        {
            "name": "Blåsjø",
            "volume_mill_m3": 3105,
            "note": "Ulla-Førre. Norges 2. største i volum, men størst i energiinnhold.",
        },
        {
            "name": "Svartevatnet",
            "volume_mill_m3": 1398,
            "note": "Sira-Kvina.",
        },
        {
            "name": "Vatndalsvatnet",
            "volume_mill_m3": 1150,
            "note": "Otra-vassdraget i Bykle. Reguleringshøyde 140 m.",
        },
        {
            "name": "Møsvatnet",
            "volume_mill_m3": 1064,
            "note": "Skiensvassdraget i Telemark.",
        },
        {
            "name": "Songavatnet",
            "volume_mill_m3": 640,
            "note": "Vest-Telemark.",
        },
    ],
    "NO_3": [
        {
            "name": "Nesjøen",
            "volume_mill_m3": 625,
            "note": "Nea-Nidelvvassdraget i Tydal.",
        },
        {
            "name": "Aursjøen",
            "volume_mill_m3": 561,
            "note": "Auravassdraget i Sunndal/Lesja.",
        },
        {
            "name": "Limingen",
            "volume_mill_m3": 490,
            "note": "Røyrvik/Lierne.",
        },
        {
            "name": "Namsvatnet",
            "volume_mill_m3": 458,
            "note": "Namsenvassdraget.",
        },
        {
            "name": "Selbusjøen",
            "volume_mill_m3": 348,
            "note": "Nea-Nidelvvassdraget.",
        },
    ],
    "NO_4": [
        {
            "name": "Storglomvatnet",
            "volume_mill_m3": 3506,
            "note": "Svartisen/Meløy. Norges desidert største reguleringsmagasin i fysisk volum (128 m reguleringssone).",
        },
        {
            "name": "Røssvatnet",
            "volume_mill_m3": 2363,
            "note": "Helgeland. Inkluderer Tustervatnet.",
        },
        {
            "name": "Akersvatnet",
            "volume_mill_m3": 1276,
            "note": "Rana.",
        },
        {
            "name": "Altevatnet",
            "volume_mill_m3": 1027,
            "note": "Bardu.",
        },
        {
            "name": "Kalvatnet",
            "volume_mill_m3": 706,
            "note": "Vefsn/Rana.",
        },
    ],
    "NO_5": [
        {
            "name": "Sysenvatnet",
            "volume_mill_m3": 450,
            "note": "Eidfjord. Hovedmagasin for Sy-Sima.",
        },
        {
            "name": "Nyhellermagasinet",
            "volume_mill_m3": 448,
            "note": "Aurlandsvassdraget.",
        },
        {
            "name": "Ringedalsvatnet",
            "volume_mill_m3": 418,
            "note": "Tyssedal/Ullensvang.",
        },
        {
            "name": "Styggevatnet",
            "volume_mill_m3": 250,
            "note": "Jostedal kraftverk.",
        },
        {
            "name": "Tyin",
            "volume_mill_m3": 215,
            "note": "Årdal.",
        },
    ],
}
