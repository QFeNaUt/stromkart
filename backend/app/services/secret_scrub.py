"""
secret_scrub.py — fjerner hemmeligheter fra tekst før logging/retur.

ENTSO-E-token sendes som ?securityToken=... i URL-en, og en HTTP-feil fra
requests/entsoe-py (401/429/5xx) får med seg hele upstream-URL-en — altså
tokenet i klartekst. Brukes av alle tjenester som logger eller returnerer
ENTSO-E-feilmeldinger (entsoe_service, balance_service, flow_service), så
den ene skrubbe-logikken bor ett sted i stedet for tre kopier.
"""
import os
import re

_SECURITY_TOKEN_RE = re.compile(r"(securityToken=)[^&\s]+", re.IGNORECASE)


def scrub_secrets(text) -> str:
    """
    Fjern ENTSO-E-token fra tekst før den logges eller returneres.

    Redger både ?securityToken=...-query-parameteren og den rå tokenverdien
    fra miljøet (i tilfelle den dukker opp utenfor en URL). Returnerer alltid
    en streng — tom inn gir tom ut, så en `or "..."`-fallback hos kalleren er
    intakt.
    """
    s = str(text)
    s = _SECURITY_TOKEN_RE.sub(r"\1***", s)
    token = os.getenv("ENTSOE_API_TOKEN")
    if token and token not in ("", "din_token_her"):
        s = s.replace(token, "***")
    return s
