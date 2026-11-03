import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from fetch_oda import parse_konklusion  # noqa: E402


def test_fuld_tekst():
    tekst = (
        "Lovforslaget blev vedtaget.\n\n"
        "90 stemmer for forslaget (S, V, M, KF)\n\n"
        "15 stemmer imod forslaget (EL, ALT)\n\n"
        "1 stemme hverken for eller imod forslaget (RV)"
    )
    tal, partier = parse_konklusion(tekst)
    assert tal == {"for": 90, "imod": 15, "hverken": 1}
    assert partier == {"S": "for", "V": "for", "M": "for", "KF": "for",
                       "EL": "imod", "ALT": "imod", "RV": "hverken"}


def test_ingen_imod_partier():
    tekst = "Vedtaget\n\n100 stemmer for forslaget (S, V)\n\n0 stemmer imod forslaget\n\n0 stemmer hverken for eller imod forslaget"
    tal, partier = parse_konklusion(tekst)
    assert tal == {"for": 100, "imod": 0, "hverken": 0}
    assert partier == {"S": "for", "V": "for"}


def test_nyt_format_med_enkeltmedlemmer():
    tekst = ("Forslaget er forkastet.\nFor stemte 45 (DF, LA, KF, EL, DD, ALT, BP, Cecilie Liv Hansen (UFG), "
             "Jacob Harris (UFG), Nadja Natalie Isaksen (UFG)),\nimod stemte 64 (S, SF, V, M, RV, "
             "Leila Stockmarr (EL), Trine Pertou Mach (EL)),\nhverken for eller imod stemte 0.")
    tal, partier = parse_konklusion(tekst)
    assert tal == {"for": 45, "imod": 64, "hverken": 0}
    assert partier["EL"] == "for"          # partiet som helhed vinder over to afvigere
    assert partier["V"] == "imod"
    assert partier["UFG"] == "for"         # løsgængere samles (vises ikke i appen)


def test_nyt_format_og_hverken():
    tekst = ("Forslaget er vedtaget.\nFor stemte 57 (V, DF, LA, KF, EL, DD, ALT, BP, Cecilie Liv Hansen (UFG), "
             "Jacob Harris (UFG) og Nadja Natalie Isaksen (UFG)),\nimod stemte 0,\n"
             "hverken for eller imod stemte 52 (S, SF, M og RV).")
    tal, partier = parse_konklusion(tekst)
    assert tal == {"for": 57, "imod": 0, "hverken": 52}
    assert partier["RV"] == "hverken" and partier["M"] == "hverken" and partier["BP"] == "for"


def test_nyt_format_en_linje():
    tekst = ("Vedtaget For stemte 69 (S, SF, M, EL, RV, ALT, N, IA), imod stemte 44 (V, DF, LA, KF, DD, BP, "
             "Nadja Natalie Isaksen (UFG), Jacob Harris (UFG)), hverken for eller imod stemte 0")
    tal, partier = parse_konklusion(tekst)
    assert tal == {"for": 69, "imod": 44, "hverken": 0}
    assert partier["N"] == "for" and partier["DD"] == "imod"


def test_ulaeselig():
    assert parse_konklusion("Vedtaget uden afstemning") is None
    assert parse_konklusion(None) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
