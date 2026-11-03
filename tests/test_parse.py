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


def test_ulaeselig():
    assert parse_konklusion("Vedtaget uden afstemning") is None
    assert parse_konklusion(None) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
