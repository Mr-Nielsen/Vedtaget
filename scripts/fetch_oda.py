#!/usr/bin/env python3
"""Henter vedtagne sager fra Folketingets Åbne Data (ODA) og skriver data/sager.json.

Kun standardbiblioteket bruges, så GitHub Actions ikke skal installere noget.

Logik:
  0. Slå typernes id'er op ud fra deres navne (Sagstype, Afstemningstype,
     Stemmetype), så intet afhænger af hårdkodede numre.
  1. Hent afstemninger af typen "Endelig vedtagelse", nyeste først,
     med tilhørende sagstrin, sag og møde (for datoen).
  2. Behold dem, hvor forslaget blev vedtaget, og som ligger inden for DAYS_BACK.
  3. Find hvert partis stemme. Først fra afstemningens konklusionstekst, som
     lister partierne for/imod/hverken. Lykkes det ikke, tælles medlemmernes
     individuelle stemmer op pr. parti (flertallet i partiet).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://oda.ft.dk/api/"
DAYS_BACK = int(os.environ.get("DAYS_BACK", "400"))
OUT = Path(__file__).resolve().parent.parent / "data" / "sager.json"
USER_AGENT = "vedtaget-app/1.0 (privat hobbyprojekt)"

# Udfyldes af indlaes_typer() ud fra ODA's egne klassifikationstabeller.
AFSTEMNINGSTYPE_ENDELIG: int | None = None
STEMMETYPE: dict[int, str] = {}
SAGSTYPE: dict[int, str] = {}
SAGSTYPE_STI = {"Lovforslag": "lovforslag", "Beslutningsforslag": "beslutningsforslag"}
_STEMME_NAVNE = {"for": "for", "imod": "imod", "fravær": "fravaer", "hverken for eller imod": "hverken"}


def indlaes_typer() -> None:
    """Find id'er ud fra navne, og stop højlydt hvis et forventet navn mangler."""
    global AFSTEMNINGSTYPE_ENDELIG
    navne = lambda tabel: {t["id"]: (t.get("type") or "").strip() for t in get(tabel).get("value", [])}

    for i, n in navne("Afstemningstype").items():
        if n.lower() == "endelig vedtagelse":
            AFSTEMNINGSTYPE_ENDELIG = i
    for i, n in navne("Sagstype").items():
        if n in SAGSTYPE_STI:
            SAGSTYPE[i] = n
    for i, n in navne("Stemmetype").items():
        if n.lower() in _STEMME_NAVNE:
            STEMMETYPE[i] = _STEMME_NAVNE[n.lower()]

    mangler = []
    if AFSTEMNINGSTYPE_ENDELIG is None:
        mangler.append("Afstemningstype 'Endelig vedtagelse'")
    if set(SAGSTYPE.values()) != set(SAGSTYPE_STI):
        mangler.append(f"Sagstype {set(SAGSTYPE_STI) - set(SAGSTYPE.values())}")
    if set(STEMMETYPE.values()) != set(_STEMME_NAVNE.values()):
        mangler.append(f"Stemmetype {set(_STEMME_NAVNE.values()) - set(STEMMETYPE.values())}")
    if mangler:
        raise RuntimeError("ODA's typetabeller har ændret sig, mangler: " + ", ".join(mangler))
    print(f"Typer: endelig vedtagelse={AFSTEMNINGSTYPE_ENDELIG}, sager={SAGSTYPE}, stemmer={STEMMETYPE}")


def get(path: str, params: dict | None = None, retries: int = 3) -> dict:
    url = path if path.startswith("http") else BASE + path
    if params:
        # ODA kræver %24 i stedet for $ i parameternavne.
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe=',/()')}"
            for k, v in params.items()
        )
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise RuntimeError(f"Fejl ved {url}: {e}") from e
            time.sleep(2 * (attempt + 1))
    raise AssertionError


def pages(path: str, params: dict):
    data = get(path, params)
    while True:
        yield from data.get("value", [])
        nxt = data.get("odata.nextLink")
        if not nxt:
            return
        data = get(nxt)


def parse_dato(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:26], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# --- Partistemmer fra konklusionsteksten --------------------------------------

# To formater forekommer:
#   nyt:    "For stemte 57 (V, DF, Jacob Harris (UFG) og RV), imod stemte 0, hverken for eller imod stemte 52 (S, SF)"
#   ældre:  "90 stemmer for forslaget (S, V)  15 stemmer imod forslaget (EL)  0 stemmer hverken for eller imod forslaget"
_KONKL = {
    "hverken": [re.compile(r"hverken\s+for\s+eller\s+imod\s+stemte\s+(\d+)", re.I),
                re.compile(r"(\d+)\s+stemmer?\s+hverken\s+for\s+eller\s+imod\s+forslaget", re.I)],
    "for": [re.compile(r"(?<![a-zæøå])for\s+stemte\s+(\d+)", re.I),
            re.compile(r"(\d+)\s+stemmer?\s+for\s+forslaget", re.I)],
    "imod": [re.compile(r"(?<!eller )imod\s+stemte\s+(\d+)", re.I),
             re.compile(r"(\d+)\s+stemmer?\s+imod\s+forslaget", re.I)],
}
_PERSON_RX = re.compile(r"^(.+?)\s*\(([^()]+)\)$")


def _parentes_efter(tekst: str, pos: int) -> str:
    """Indholdet af en balanceret parentes, der starter lige efter pos (ellers "")."""
    i = pos
    while i < len(tekst) and tekst[i] in " \t\n":
        i += 1
    if i >= len(tekst) or tekst[i] != "(":
        return ""
    dybde, start = 0, i
    for j in range(i, len(tekst)):
        if tekst[j] == "(":
            dybde += 1
        elif tekst[j] == ")":
            dybde -= 1
            if dybde == 0:
                return tekst[start + 1 : j]
    return ""


def _split_top(liste: str) -> list[str]:
    """Del på komma og ' og ' uden for parenteser."""
    dele, buf, dybde, i = [], "", 0, 0
    while i < len(liste):
        c = liste[i]
        if c == "(":
            dybde += 1
        elif c == ")":
            dybde -= 1
        if dybde == 0 and (c == "," or liste.startswith(" og ", i)):
            dele.append(buf)
            buf = ""
            i += 1 if c == "," else 4
            continue
        buf += c
        i += 1
    dele.append(buf)
    return [d.strip() for d in dele if d.strip()]


def parse_konklusion(tekst: str | None) -> tuple[dict, dict] | None:
    """Returnerer (optælling, partier) eller None, hvis teksten ikke kan læses.

    Partier nævnt som parti tæller direkte. Enkeltmedlemmer, fx "Navn (EL)",
    bruges kun for partier, der ikke er nævnt samlet; så afgør flertallet af
    partiets enkeltmedlemmer.
    """
    if not tekst:
        return None
    tal, partier = {}, {}
    enkelte: dict[str, Counter] = defaultdict(Counter)
    for valg, regexer in _KONKL.items():
        for rx in regexer:
            m = rx.search(tekst)
            if not m:
                continue
            tal[valg] = int(m.group(1))
            for del_ in _split_top(_parentes_efter(tekst, m.end())):
                pm = _PERSON_RX.match(del_)
                if pm:
                    enkelte[pm.group(2).strip()][valg] += 1
                elif len(del_) <= 6:  # partiforkortelse
                    partier[del_] = valg
            break
    if "for" not in tal or "imod" not in tal:
        return None
    tal.setdefault("hverken", 0)
    for parti, c in enkelte.items():
        if parti not in partier:
            partier[parti] = c.most_common(1)[0][0]
    return tal, partier


# --- Fallback: tæl medlemmernes stemmer op pr. parti ---------------------------

_aktor_parti: dict[int, str | None] = {}
_PARTI_RX = re.compile(
    r"<partyShortname>\s*([^<]+?)\s*</partyShortname>|<title>[^<]*\(([^()<]+)\)\s*</title>", re.I
)


def parti_for_aktor(aktor: dict) -> str | None:
    aid = aktor["id"]
    if aid not in _aktor_parti:
        m = _PARTI_RX.search(aktor.get("biografi") or "")
        _aktor_parti[aid] = (m.group(1) or m.group(2)).strip() if m else None
    return _aktor_parti[aid]


def partier_fra_stemmer(afstemning_id: int) -> tuple[dict, dict]:
    tal: Counter = Counter()
    pr_parti: dict[str, Counter] = defaultdict(Counter)
    for s in pages(
        "Stemme",
        {"%24filter": f"afstemningid eq {afstemning_id}", "%24expand": "Aktør"},
    ):
        valg = STEMMETYPE.get(s.get("typeid"))
        if not valg:
            continue
        if valg != "fravaer":
            tal[valg] += 1
        parti = parti_for_aktor(s["Aktør"]) if s.get("Aktør") else None
        if parti and valg != "fravaer":
            pr_parti[parti][valg] += 1
    partier = {p: c.most_common(1)[0][0] for p, c in pr_parti.items() if c}
    return {"for": tal["for"], "imod": tal["imod"], "hverken": tal["hverken"]}, partier


# --- Samlingskoder (til link til ft.dk) ----------------------------------------

_perioder: dict[int, str | None] = {}


def samling(periode_id: int | None) -> str | None:
    if periode_id is None:
        return None
    if periode_id not in _perioder:
        try:
            _perioder[periode_id] = get(f"Periode({periode_id})").get("kode")
        except RuntimeError:
            _perioder[periode_id] = None
    return _perioder[periode_id]


def ft_link(sag: dict) -> str | None:
    kode = samling(sag.get("periodeid"))
    sti = SAGSTYPE_STI.get(SAGSTYPE.get(sag.get("typeid"), ""))
    nummer = (sag.get("nummer") or "").replace(" ", "")
    if kode and sti and nummer:
        return f"https://www.ft.dk/samling/{kode}/{sti}/{nummer}/index.htm"
    return None


def main() -> int:
    indlaes_typer()
    graense = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    sager = []
    sete_sager = set()

    afstemninger = pages(
        "Afstemning",
        {
            "%24filter": f"typeid eq {AFSTEMNINGSTYPE_ENDELIG}",
            "%24orderby": "id desc",
            "%24expand": "Sagstrin/Sag,Møde",
        },
    )
    for n, a in enumerate(afstemninger):
        if a.get("typeid") != AFSTEMNINGSTYPE_ENDELIG or "Sagstrin" not in a:
            raise RuntimeError(
                f"ODA ignorerede filteret eller udvidelsen (afstemning {a.get('id')} har typeid "
                f"{a.get('typeid')}). Stopper i stedet for at gemme forkerte data."
            )
        if n == 0 and a.get("Møde") is None:
            raise RuntimeError("Mødedato mangler - udvidelsen med Møde virkede ikke.")
        dato = parse_dato((a.get("Møde") or {}).get("dato"))
        if dato and dato < graense:
            break
        if not a.get("vedtaget"):
            continue
        sag = (a.get("Sagstrin") or {}).get("Sag")
        if not sag or sag.get("typeid") not in SAGSTYPE or sag["id"] in sete_sager:
            continue
        sete_sager.add(sag["id"])

        parsed = parse_konklusion(a.get("konklusion"))
        kilde = "konklusion"
        if parsed is None or not parsed[1]:
            parsed = partier_fra_stemmer(a["id"])
            kilde = "stemmer"
        tal, partier = parsed

        sager.append(
            {
                "id": sag["id"],
                "afstemningId": a["id"],
                "nummer": sag.get("nummer"),
                "type": SAGSTYPE[sag["typeid"]],
                "titel": sag.get("titel"),
                "titelkort": sag.get("titelkort"),
                "resume": sag.get("resume"),
                "dato": dato.date().isoformat() if dato else None,
                "url": ft_link(sag),
                "resultat": tal,
                "partier": partier,
                "partikilde": kilde,
            }
        )
        print(f"  {sag.get('nummer'):>8}  {dato.date() if dato else '?'}  {sag.get('titelkort')}")

    if not sager:
        print("Ingen sager fundet - lader den eksisterende fil være.", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "genereret": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kilde": "Folketingets Åbne Data (oda.ft.dk)",
        "sager": sager,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Skrev {len(sager)} sager til {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
