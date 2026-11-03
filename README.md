# Vedtaget

Politik i hverdagen, én vedtaget sag ad gangen. Hver uge henter appen de lovforslag og beslutningsforslag, Folketinget har vedtaget, fra Folketingets Åbne Data (ODA). Du tager stilling, før du ser, hvordan partierne stemte, og over tid bygger du dit eget match med partierne – baseret på faktiske afstemninger, ikke valgløfter.

## Sådan virker det

- **Data:** `scripts/fetch_oda.py` henter afstemninger af typen "endelig vedtagelse" fra `oda.ft.dk` (standard: de seneste 400 dage) og skriver `data/sager.json`.
- **Partistemmer:** læses fra afstemningens konklusionstekst. Kan den ikke læses, tælles medlemmernes stemmer op pr. parti (flertallet i partiet).
- **Neutralitet:** sagerne vises med Folketingets egne titler og resuméer, nyeste først. Ingen redaktionel udvælgelse, og partierne vises først, når du har stemt.
- **Match:** sager, hvor både du og partiet stemte for eller imod. Sprunget over, hverken-for-eller-imod og fravær tæller ikke med.
- **Privatliv:** dine stemmer ligger kun i browseren på din telefon. Brug "Gem backup" i bunden for at tage en kopi.

## Opsætning (ca. 10 minutter)

1. Opret et nyt repository på GitHub, fx `vedtaget`, og læg alle filerne i det.
2. Under **Settings → Actions → General → Workflow permissions** skal du vælge **Read and write permissions**.
3. Under **Settings → Pages** skal du vælge **Deploy from a branch**, branch `main` og mappen `/ (root)`.
4. Gå til **Actions → Hent vedtagne sager → Run workflow** for at hente data første gang. Derefter kører jobbet automatisk hver lørdag morgen.
5. Åbn `https://<dit-brugernavn>.github.io/vedtaget/` i Safari på iPhone og vælg **Del → Føj til hjemmeskærm**.

Første kørsel er også testen af ODA-koblingen. Fejler den, ligger loggen under Actions.

## Lokalt

```bash
python3 scripts/fetch_oda.py      # henter data
python3 tests/test_parse.py       # tester tolkningen af konklusionstekster
python3 -m http.server            # åbn http://localhost:8000
```

`DAYS_BACK=60 python3 scripts/fetch_oda.py` henter en kortere periode.

## Idéer til næste skridt

- Gruppér sager efter ministerområde (via `SagAktør`) og vis match pr. område.
- Match med enkelte folketingsmedlemmer, ikke kun partier.
- Ugentlig påmindelse, når der er nye sager.
- Vis sagens forløb (fremsat → 1., 2. og 3. behandling) fra `Sagstrin`.
