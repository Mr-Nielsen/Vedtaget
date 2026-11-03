#!/usr/bin/env python3
"""Udskriver eksempler på ODA-data, så filtrene i fetch_oda.py kan justeres."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_oda import get  # noqa: E402


def kort(obj, n=400):
    s = json.dumps(obj, ensure_ascii=False)
    return s[:n] + ("…" if len(s) > n else "")


print("== Afstemningstype ==")
for t in get("Afstemningstype").get("value", []):
    print(" ", kort(t))

print("== Sagstype (top 20) ==")
for t in get("Sagstype", {"%24top": 20}).get("value", []):
    print(" ", kort(t))

print("== Seneste 5 afstemninger, udvidet ==")
d = get("Afstemning", {"%24orderby": "id desc", "%24top": 5, "%24expand": "Sagstrin/Sag,Møde"})
for a in d.get("value", []):
    sag = (a.get("Sagstrin") or {}).get("Sag") or {}
    print("--- afstemning", a.get("id"))
    print("  nøgler:", sorted(a.keys()))
    print("  typeid:", a.get("typeid"), "vedtaget:", a.get("vedtaget"))
    print("  møde:", kort({k: (a.get("Møde") or {}).get(k) for k in ("id", "dato", "titel")}))
    print("  sagstrin nøgler:", sorted((a.get("Sagstrin") or {}).keys()))
    print("  sag:", kort({k: sag.get(k) for k in ("id", "typeid", "nummer", "titelkort", "periodeid")}))
    print("  konklusion:", repr((a.get("konklusion") or "")[:300]))
print("  nextLink:", d.get("odata.nextLink"))

print("== Seneste 3 stemmer med aktør ==")
for s in get("Stemme", {"%24orderby": "id desc", "%24top": 3, "%24expand": "Aktør"}).get("value", []):
    akt = s.get("Aktør") or {}
    print("  typeid:", s.get("typeid"), "aktør:", akt.get("navn"), "| biografi:", repr((akt.get("biografi") or "")[:300]))
