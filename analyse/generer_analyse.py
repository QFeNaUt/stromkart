"""
generer_analyse.py — Lag B: daglig markedsanalyse. Kjøres på PC-en (G1=A).

KJEDEN (hele Lag A + B i rekkefølge — kjør disse FØR denne, de er resumbare
og henter kun det nye):
    python analyse\\bygg_historikk.py      (pris/last/vind — nytt siden sist)
    python analyse\\hent_magasin.py        (NVE, hele serien, idempotent)
    python analyse\\bygg_utveksling.py     (flyt per grense — nytt siden sist)
    python analyse\\bygg_regime_base.py    (regime_dogn.parquet på nytt)
    python analyse\\generer_analyse.py     (denne: tall -> norsk -> POST)

HVA DEN GJØR, PER SONE (feilisolert — én sone feiler, resten leveres):
  1. Leser SISTE komplette døgn i regime-basen = dagens regime-etiketter.
  2. Velger historisk mønster via PRIORITERT KASKADE av betingelser: den mest
     spesifikke spørringen som består N>=30-vakten vinner. Ingen celle under
     30 slipper gjennom — heller en bredere, ærlig påstand.
  3. Ollama (lokalt) kler de ferdige tallene i 2-4 setninger norsk prosa.
     Modellen FÅR ALDRI regne eller hente — den omformulerer kun.
  4. POST-er samlet JSON til api.stromkart.no med Bearer-token.

Flagg:
    --torrkjor   generer og print, men ikke POST (test)
    --uten-llm   hopp over ollama, tekst = maskinformulert fallback (test)

.env letes opp i denne rekkefølgen: backend/.env, deretter repo-rot/.env.
    ANALYSE_TOKEN=<hex>  og valgfritt
    ANALYSE_URL=https://api.stromkart.no/api/analysis
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import pandas as pd

MODELL = "qwen3:14b"          # står allerede installert fra RAG-demoene
TEMPERATUR = 0.2
STANDARD_URL = "https://api.stromkart.no/api/analysis"
SONER = ["NO_1", "NO_2", "NO_3", "NO_4", "NO_5"]
SONE_NAVN = {"NO_1": "Østlandet (NO1)", "NO_2": "Sørlandet (NO2)",
             "NO_3": "Midt-Norge (NO3)", "NO_4": "Nord-Norge (NO4)",
             "NO_5": "Vestlandet (NO5)"}

# Kaskaden: mest spesifikk først; første spørring med N>=30 vinner.
# Betingelser med manglende dagsetikett (f.eks. vind i NO5) hoppes over.
KASKADE = [
    ["sesong", "b_last", "b_vind", "mettet"],
    ["sesong", "b_last", "b_vind"],
    ["sesong", "b_last", "b_magasin"],
    ["sesong", "b_magasin"],
    ["sesong", "b_last"],
    ["sesong"],
]


def finn(navn: str) -> str | None:
    for k in [os.path.join(os.path.dirname(__file__), "..", "data", navn),
              os.path.join(os.path.dirname(__file__), "..", navn), navn]:
        if os.path.exists(k):
            return k
    return None


def finn_env() -> str | None:
    """.env bor i backend/ på PC-en, men i repo-rot på CT105 (bevisst avvik
    — systemd-tjenesten peker dit). Første treff vinner; ingen stille
    fallback: finner vi ingenting returneres None og kalleren feiler høyt."""
    her = os.path.dirname(__file__)
    for k in [os.path.join(her, "..", "backend", ".env"),
              os.path.join(her, "..", ".env")]:
        if os.path.exists(k):
            return k
    return None


def les_token_og_url() -> tuple[str | None, str]:
    sti = finn_env()
    if sti:
        try:
            from dotenv import load_dotenv
            load_dotenv(sti)
        except ImportError:
            pass
    return os.environ.get("ANALYSE_TOKEN"), os.environ.get("ANALYSE_URL", STANDARD_URL)


# --- Steg 1+2: dagens regime og mønstervalg (ren pandas, testbart) -----------

def dagens_rad(base: pd.DataFrame, sone: str) -> pd.Series | None:
    """Siste KOMPLETTE døgn: day-ahead-prisen finnes et døgn før faktisk
    last/vind (målinger henger etter marked). Uten last-kravet ville raden
    alltid manglet de fysiske etikettene og sultet kaskaden."""
    d = base[(base["sone"] == sone) & base["pris"].notna() & base["last"].notna()]
    return None if d.empty else d.sort_values("dato").iloc[-1]

def velg_monster(base: pd.DataFrame, sone: str, dag: pd.Series):
    """Kaskaden: bygg betingelser fra dagens etiketter, første N>=30 vinner."""
    from bygg_regime_base import hent_monster        # gjenbruk, én sannhet
    for kolonner in KASKADE:
        if any(pd.isna(dag.get(k)) for k in kolonner):
            continue                                  # etikett mangler i dag
        bet = {k: dag[k] for k in kolonner}
        r = hent_monster(base, sone, bet)
        if r["svar"] is not None:
            return r
    return None


ETIKETT_NAVN = {"last": "forbruk", "vind": "vindkraft",
                "magasin": "magasinfylling", "netto_posisjon": "nettoeksport",
                "mettet": "kabelsituasjon"}

# Boolske betingelser trenger ferdig norsk ordlyd. Uten dette lakk
# str(False) -> "False" inn i faktapakken, og modellen matte gjette hva
# den betydde — samme feil som netto_posisjon-lekkasjen.
KABEL_ORDLYD = {True: "Minst én kabel er belastet fullt ut",
                False: "Ingen kabler er belastet fullt ut"}


def _bet_verdi(kort: str, v) -> str:
    """Betingelsesverdi -> norsk visningstekst. Tersil-etikettene (Lav/
    Normal/Høy) og sesong er norske fra Lag A; kun de boolske trenger kart."""
    return KABEL_ORDLYD[bool(v)] if kort == "mettet" else str(v)


def _situasjon(dag_mult: float, monster_mult: float) -> str:
    """Deterministisk dom over dag-mot-mønster — modellen skal ALDRI felle
    denne selv. Terskler i forholdet mellom de to multiplene."""
    f = dag_mult / monster_mult
    if f >= 1.30:
        return "klart over"
    if f >= 1.15:
        return "noe over"
    if f > 0.87:
        return "på linje med"
    if f > 0.70:
        return "noe under"
    return "klart under"


def bygg_fakta(dag: pd.Series, monster) -> dict:
    """Faktapakken — ALT modellen får se, og alt frontend kan vise som kilde.
    Alle vurderinger (situasjon, utvalgsstørrelse) er FERDIG FELT her; kun
    norske, menneskelige navn slipper gjennom til språklaget."""
    etiketter = {navn: str(dag[f"b_{v}"]) for v, navn in ETIKETT_NAVN.items()
                 if pd.notna(dag.get(f"b_{v}"))}
    fakta = {
        "dato": str(pd.Timestamp(dag["dato"]).date()),
        "pris_eur_mwh": round(float(dag["pris"]), 1),
        "framing": dag.get("framing"),
        "sesong": str(dag.get("sesong")),
        "dagens_forhold": etiketter,
        "minst_en_kabel_full": (None if pd.isna(dag.get("mettet"))
                                else bool(dag["mettet"])),
    }
    if fakta["framing"] == "relativ" and pd.notna(dag.get("rel_pris")):
        fakta["multiplum_i_dag"] = round(float(dag["rel_pris"]), 2)
    if monster is not None:
        m = monster["svar"]
        fakta["monster"] = {
            "betingelser": {ETIKETT_NAVN.get(k.removeprefix("b_"), k):
                            _bet_verdi(k.removeprefix("b_"), v)
                            for k, v in monster["betingelser"].items()},
            "n": monster["n"],
            "utvalg": ("et begrenset utvalg" if monster["n"] < 50
                       else "et solid utvalg") + f" ({monster['n']} døgn)",
            **m,
        }
        if fakta["framing"] == "absolutt":
            # Multipler villeder når normalen har kollapset (R5-vakten):
            # sammenlign absolutte priser i stedet, og fell dommen her.
            fakta["monster"].pop("median_multiplum", None)
            fakta["monster"]["framing"] = "absolutt"
            if m.get("median_pris_eur"):
                fakta["situasjon"] = (
                    f"dagens pris ligger "
                    f"{_situasjon(fakta['pris_eur_mwh'], m['median_pris_eur'])} "
                    f"prisene på lignende dager")
        elif (m.get("framing") == "relativ"
                and "multiplum_i_dag" in fakta):
            fakta["situasjon"] = (f"dagens pris ligger "
                                  f"{_situasjon(fakta['multiplum_i_dag'], m['median_multiplum'])} "
                                  f"det historiske mønsteret")
    return fakta


# --- Steg 3: språkdrakt ------------------------------------------------------

def maskinformulering(sone: str, f: dict) -> str:
    """LLM-fri fallback (--uten-llm, eller når ollama feiler). Stiv men sann."""
    deler = [f"{SONE_NAVN[sone]}: spotprisen er {f['pris_eur_mwh']} EUR/MWh."]
    m = f.get("monster")
    if m:
        if m.get("framing") == "relativ":
            deler.append(f"Under lignende forhold ({m['n']} historiske døgn) har "
                         f"prisen ligget rundt {m['median_multiplum']}x "
                         f"sesongnormalen.")
        else:
            deler.append(f"Under lignende forhold ({m['n']} historiske døgn) har "
                         f"medianprisen vært {m['median_pris_eur']} EUR/MWh.")
    return " ".join(deler)


PROMPT_MAL = """Du omformulerer ferdige tall til en kort markedskommentar for et norsk folkeopplysningskart om strøm. Du skal IKKE vurdere eller konkludere selv — alle vurderinger står ferdig i faktaene.

STRUKTUR (2-4 setninger, i denne rekkefølgen):
1. Dagens spotpris og hva slags dag det er (bruk «dagens_forhold»-etikettene).
2. Hva prisen har pleid å være under lignende forhold (bruk «monster»: utvalgs-
   beskrivelsen og median-tallet).
3. Hvis feltet «situasjon» finnes: gjengi den vurderingen med egne ord.

REGLER (absolutte):
- KUN tall og vurderinger som står i faktaene. Aldri egne tall, aldri egne
  konklusjoner om høyt/lavt — det står i «situasjon» hvis det skal sies.
- Samvariasjon («har historisk ligget», «henger sammen med») — ALDRI årsak
  («fører til», «på grunn av», «skyldes»).
- Bruk nøyaktig de norske ordene slik de står i faktaene. Aldri tekniske
  navn med understrek, aldri egne synonymer.
- Frasen «svært lavt prisnivå» er KUN tillatt når framing er «absolutt».
- Nøkternt norsk, ingen utropstegn, ingen råd om strømforbruk.

EKSEMPEL (annen sone, annen dag — kun for stil):
Fakta: pris 100.3, sesong Vinter, forbruk Høy, vindkraft Lav, monster: et
solid utvalg (75 døgn), median_multiplum 1.44, situasjon: «dagens pris ligger
på linje med det historiske mønsteret».
Tekst: «Spotprisen er 100,3 EUR/MWh på en vinterdag med høyt forbruk og lite
vindkraft. På lignende dager — et solid utvalg på 75 døgn — har prisen
historisk ligget rundt 1,4 ganger sesongnormalen. Dagens pris er på linje med
det mønsteret.»

FAKTA ({sone_navn}):
{fakta_json}

Skriv kun selve kommentaren, ingen overskrift."""


def llm_tekst(sone: str, fakta: dict) -> str:
    import ollama
    prompt = PROMPT_MAL.format(sone_navn=SONE_NAVN[sone],
                               fakta_json=json.dumps(fakta, ensure_ascii=False,
                                                     indent=2))
    svar = ollama.generate(model=MODELL, prompt=prompt,
                           options={"temperature": TEMPERATUR})
    tekst = svar["response"].strip()
    if not (20 <= len(tekst) <= 1200):        # sanity — ellers fallback
        raise ValueError(f"LLM-tekst utenfor lengdegrenser ({len(tekst)} tegn)")
    return tekst


# --- Steg 4: POST ------------------------------------------------------------

def post_payload(payload: dict, token: str, url: str) -> None:
    import requests
    r = requests.post(url, json=payload, timeout=60,
                      headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    print(f"POST OK -> {url} ({r.status_code})")


# --- Hovedløp ----------------------------------------------------------------

def kjor(torrkjor: bool, uten_llm: bool) -> int:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # Token FØR LLM-runden: en config-feil skal aldri koste fem qwen-kall.
    # --torrkjor skal fortsatt virke uten token (uendret oppførsel).
    token, url = (None, STANDARD_URL) if torrkjor else les_token_og_url()
    if not torrkjor and not token:
        sys.exit("ANALYSE_TOKEN ikke funnet (lette i backend/.env og "
                 "repo-rot/.env) — avbryter FØR LLM-runden.")

    sti = finn("regime_dogn.parquet")
    if not sti:
        sys.exit("Fant ikke regime_dogn.parquet — kjør bygg_regime_base.py først.")
    base = pd.read_parquet(sti)
    base["dato"] = pd.to_datetime(base["dato"])

    soner_ut, feil = {}, 0
    for sone in SONER:
        try:                                   # per-sone feilisolasjon
            dag = dagens_rad(base, sone)
            if dag is None:
                raise ValueError("ingen komplett dagsrad")
            fakta = bygg_fakta(dag, velg_monster(base, sone, dag))
            if uten_llm:
                tekst = maskinformulering(sone, fakta)
            else:
                try:
                    tekst = llm_tekst(sone, fakta)
                except Exception as e:         # ollama nede -> stiv fallback
                    print(f"  ! {sone}: LLM feilet ({e}) — bruker fallback")
                    tekst = maskinformulering(sone, fakta)
            soner_ut[sone] = {"tekst": tekst, "fakta": fakta}
            print(f"  {sone}: OK")
        except Exception as e:
            feil += 1
            print(f"  ! {sone}: HOPPET OVER ({e})")

    if not soner_ut:
        sys.exit("Ingen soner lyktes — ingenting å publisere.")
    payload = {"generert_utc": datetime.now(timezone.utc).isoformat(),
               "soner": soner_ut}

    if torrkjor:
        print("\n--- TØRRKJØRING (ingen POST) ---")
        for s, inn in soner_ut.items():
            print(f"\n[{s}] {inn['tekst']}")
        print("\n--- Full payload ---")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    post_payload(payload, token, url)
    return 0 if feil == 0 else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--torrkjor", action="store_true")
    p.add_argument("--uten-llm", action="store_true")
    a = p.parse_args()
    sys.exit(kjor(a.torrkjor, a.uten_llm))
