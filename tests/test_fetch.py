"""Ende-til-ende-test af fetch_oda.main() mod opdigtede ODA-svar."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_oda as f  # noqa: E402

TYPER = {
    "Afstemningstype": {"value": [{"id": 1, "type": "Endelig vedtagelse"}, {"id": 2, "type": "Udvalgsindstilling"}]},
    "Sagstype": {"value": [{"id": 3, "type": "Lovforslag"}, {"id": 5, "type": "Beslutningsforslag"}, {"id": 9, "type": "Forslag til vedtagelse"}]},
    "Stemmetype": {"value": [{"id": 1, "type": "For"}, {"id": 2, "type": "Imod"}, {"id": 3, "type": "Fravær"}, {"id": 4, "type": "Hverken for eller imod"}]},
}


def afst(id_, sag, vedtaget=True, dato="2026-10-30T00:00:00", konklusion="", typeid=1):
    return {"id": id_, "typeid": typeid, "vedtaget": vedtaget, "konklusion": konklusion,
            "Møde": {"dato": dato}, "Sagstrin": {"Sag": sag}}


def koer(afstemninger, stemmer=()):
    data = dict(TYPER, Afstemning={"value": afstemninger}, Stemme={"value": list(stemmer)},
                **{"Periode(7)": {"kode": "20251"}})
    f.get = lambda path, params=None, retries=3: data[path]
    f.SAGSTYPE.clear(); f.STEMMETYPE.clear(); f.AFSTEMNINGSTYPE_ENDELIG = None
    f.OUT = Path(tempfile.mkdtemp()) / "sager.json"
    rc = f.main()
    return rc, (json.loads(f.OUT.read_text())["sager"] if rc == 0 else None)


def test_filtrering_og_partier():
    rc, sager = koer([
        afst(10, {"id": 1, "typeid": 3, "nummer": "L 1", "titel": "T", "titelkort": "TK", "resume": "R", "periodeid": 7},
             konklusion="Vedtaget For stemte 5 (S, V), imod stemte 2 (EL), hverken for eller imod stemte 0"),
        afst(9, {"id": 2, "typeid": 5, "nummer": "B 2", "titel": "T2", "titelkort": "", "resume": "", "periodeid": 7},
             konklusion="ulæselig"),
        afst(8, {"id": 3, "typeid": 3}, vedtaget=False),                      # forkastet
        afst(7, {"id": 4, "typeid": 9, "nummer": "V 1"}),                    # forslag til vedtagelse
        afst(6, {"id": 1, "typeid": 3, "nummer": "L 1"}),                    # samme sag igen
        afst(5, {"id": 5, "typeid": 3}, dato="2020-01-01T00:00:00"),         # for gammel
    ], stemmer=[
        {"typeid": 1, "Aktør": {"id": 100, "biografi": "<partyShortname>S</partyShortname>"}},
        {"typeid": 2, "Aktør": {"id": 101, "biografi": "<title>Navn (DF)</title>"}},
        {"typeid": 3, "Aktør": {"id": 102, "biografi": "<partyShortname>V</partyShortname>"}},
    ])
    assert rc == 0
    assert [s["nummer"] for s in sager] == ["L 1", "B 2"]
    l1, b2 = sager
    assert l1["type"] == "Lovforslag" and l1["partier"] == {"S": "for", "V": "for", "EL": "imod"}
    assert l1["url"] == "https://www.ft.dk/samling/20251/lovforslag/L1/index.htm"
    assert b2["type"] == "Beslutningsforslag" and b2["partikilde"] == "stemmer"
    assert b2["partier"] == {"S": "for", "DF": "imod"}  # fravær tæller ikke
    assert b2["resultat"] == {"for": 1, "imod": 1, "hverken": 0}


def test_ignoreret_filter_stopper():
    try:
        koer([afst(1, {"id": 1, "typeid": 3}, typeid=2)])
    except RuntimeError as e:
        assert "ignorerede filteret" in str(e)
    else:
        raise AssertionError("burde være stoppet")


def test_aendrede_typetabeller_stopper():
    gemt = TYPER["Stemmetype"]
    TYPER["Stemmetype"] = {"value": [{"id": 1, "type": "Ja"}]}
    try:
        koer([])
    except RuntimeError as e:
        assert "typetabeller" in str(e)
    else:
        raise AssertionError("burde være stoppet")
    finally:
        TYPER["Stemmetype"] = gemt


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
