"use strict";

// Vedtaget — tag stilling til vedtagne sager og se, hvilke partier du stemmer som.
// Alle dine stemmer ligger kun i denne browsers localStorage.

const STORE_KEY = "vedtaget.v1";
const DATA_URL = "data/sager.json";

const PARTINAVNE = {
  S: "Socialdemokratiet", V: "Venstre", SF: "SF", M: "Moderaterne",
  DD: "Danmarksdemokraterne", LA: "Liberal Alliance", KF: "Det Konservative Folkeparti",
  KONS: "Det Konservative Folkeparti", EL: "Enhedslisten", DF: "Dansk Folkeparti",
  RV: "Radikale Venstre", ALT: "Alternativet", BP: "Borgernes Parti",
  NB: "Nye Borgerlige", KD: "Kristendemokraterne", FG: "Frie Grønne",
  SIU: "Siumut", IA: "Inuit Ataqatigiit", NQ: "Naleraq", N: "Naleraq",
  JF: "Javnaðarflokkurin", SP: "Sambandsflokkurin", T: "Tjóðveldi", TF: "Tjóðveldi",
};
const IKKE_PARTIER = new Set(["UFG", "UP"]);
const VALG_TEKST = { for: "For", imod: "Imod", hverken: "Hverken for eller imod", blank: "Sprunget over" };

// --- Lager ---------------------------------------------------------------------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object" && s.votes) return s;
  } catch (_) { /* tom eller blokeret lagring */ }
  return { votes: {}, lastSeen: null };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignorer */ }
}

const state = load();
let sager = [];
let generated = null;
let view = "feed";
let current = null;      // sag-id der er afsløret i feedet lige nu
let matchPeriode = "alle";

// --- Hjælpere ------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}
const partinavn = (p) => PARTINAVNE[p] || p;
const fmtDato = (iso) => iso
  ? new Date(iso + "T12:00:00").toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })
  : "ukendt dato";
const sorterede = () => [...sager].sort((a, b) => (b.dato || "").localeCompare(a.dato || "") || b.id - a.id);
const ubesvarede = () => sorterede().filter((s) => !state.votes[s.id]);

// --- Data ----------------------------------------------------------------------

async function hentData() {
  try {
    const r = await fetch(DATA_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    sager = Array.isArray(d.sager) ? d.sager : [];
    generated = d.genereret || null;
  } catch (e) {
    $("#status").textContent = "Kunne ikke hente sager. Prøv igen senere.";
    sager = [];
  }
  $("#status").textContent = sager.length
    ? `${sager.length} vedtagne sager · opdateret ${generated ? new Date(generated).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "–"}`
    : generated === null && sager.length === 0 && $("#status").textContent.startsWith("Henter")
      ? "Venter på første datahentning"
      : $("#status").textContent;
  if (generated) { state.lastSeen = generated; save(); }
  render();
}

function opdaterBadge() {
  const n = ubesvarede().length;
  const b = $("#badge");
  b.hidden = n === 0;
  b.textContent = n > 99 ? "99+" : String(n);
}

// --- Visninger -----------------------------------------------------------------

function render() {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.view === view)));
  const root = $("#view");
  root.replaceChildren();
  if (view === "feed") root.append(renderFeed());
  if (view === "match") root.append(renderMatch());
  if (view === "historik") root.append(renderHistorik());
  opdaterBadge();
}

function renderFeed() {
  const frag = document.createDocumentFragment();
  if (current) {
    const sag = sager.find((s) => s.id === current);
    if (sag) { frag.append(sagKort(sag, true)); return frag; }
  }
  const liste = ubesvarede();
  if (!sager.length) {
    frag.append(el("div", { class: "card empty" },
      el("h2", {}, "Ingen sager endnu"),
      el("p", {}, "Der er ikke hentet data fra Folketinget endnu. Kør jobbet ”Hent vedtagne sager” under Actions på GitHub.")));
    return frag;
  }
  if (!liste.length) {
    frag.append(el("div", { class: "card empty" },
      el("h2", {}, "Du er ajour"),
      el("p", {}, "Der er ingen nye vedtagne sager lige nu. Nye sager hentes hver uge."),
      el("button", { class: "link", onclick: () => { view = "match"; render(); } }, "Se dit match")));
    return frag;
  }
  const besvaret = sager.length - liste.length;
  frag.append(el("p", { class: "progress" }, `${liste.length} sager venter · ${besvaret} besvaret`));
  frag.append(sagKort(liste[0], false));
  return frag;
}

function sagKort(sag, afsloeret) {
  const mit = state.votes[sag.id]?.valg;
  const resume = (sag.resume || "").trim();
  const langt = resume.length > 420;
  const resumeEl = el("p", { class: "resume" + (langt ? " clamp" : "") }, resume || "Folketinget har ikke skrevet et resumé af denne sag.");

  const kort = el("article", { class: "card" },
    el("div", { class: "meta" },
      el("b", {}, sag.nummer || ""), el("span", {}, sag.type), el("span", {}, "vedtaget " + fmtDato(sag.dato))),
    el("h2", {}, sag.titelkort || sag.titel),
    sag.titel && sag.titel !== sag.titelkort ? el("p", { class: "fulltitle" }, sag.titel) : null,
    resumeEl,
    el("div", { class: "row" },
      langt ? el("button", { class: "link", onclick: (e) => { resumeEl.classList.toggle("clamp"); e.target.textContent = resumeEl.classList.contains("clamp") ? "Læs hele resuméet" : "Vis mindre"; } }, "Læs hele resuméet") : null,
      sag.url ? el("a", { class: "link", href: sag.url, target: "_blank", rel: "noopener" }, "Sagen på ft.dk") : null),
  );

  if (!afsloeret) {
    kort.append(el("div", { class: "vote" },
      el("button", { class: "for", onclick: () => stem(sag, "for") }, "For"),
      el("button", { class: "imod", onclick: () => stem(sag, "imod") }, "Imod"),
      el("button", { class: "blank", onclick: () => stem(sag, "blank") }, "Spring over / ingen holdning")));
  } else {
    kort.append(afsloering(sag, mit));
    kort.append(el("button", { class: "next", onclick: () => { current = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
      ubesvarede().length ? "Næste sag" : "Færdig"));
  }
  return kort;
}

function afsloering(sag, mit) {
  const r = sag.resultat || { for: 0, imod: 0, hverken: 0 };
  const total = (r.for || 0) + (r.imod || 0) + (r.hverken || 0) || 1;
  const grupper = { for: [], imod: [], hverken: [] };
  for (const [p, v] of Object.entries(sag.partier || {})) {
    if (grupper[v] && !IKKE_PARTIER.has(p)) grupper[v].push(p);
  }
  Object.values(grupper).forEach((g) => g.sort((a, b) => partinavn(a).localeCompare(partinavn(b), "da")));

  const andel = r.for / Math.max(1, r.for + r.imod);
  const flertal = r.imod === 0 ? "uden stemmer imod"
    : andel >= 0.8 ? "med bredt flertal" : andel >= 0.6 ? "med klart flertal" : "med smalt flertal";

  return el("section", { class: "reveal", "aria-live": "polite" },
    el("p", { class: "you" }, "Din stemme: ", el("strong", {}, VALG_TEKST[mit] || "–")),
    el("div", { class: "tally", role: "img", "aria-label": `${r.for} for, ${r.imod} imod, ${r.hverken} hverken` },
      el("span", { class: "t-for", style: `width:${(r.for / total) * 100}%` }),
      el("span", { class: "t-imod", style: `width:${(r.imod / total) * 100}%` }),
      el("span", { class: "t-hverken", style: `width:${(r.hverken / total) * 100}%` })),
    el("p", { class: "tally-label" }, `${r.for} for · ${r.imod} imod · ${r.hverken} hverken — vedtaget ${flertal}`),
    el("div", { class: "groups" },
      ...["for", "imod", "hverken"].filter((k) => grupper[k].length).map((k) =>
        el("div", { class: "group" + (mit === k ? " mine" : "") },
          el("h3", {}, VALG_TEKST[k]),
          el("div", { class: "chips" }, grupper[k].map((p) => el("span", { class: "chip " + k, title: partinavn(p) }, partinavn(p))))))),
  );
}

function stem(sag, valg) {
  state.votes[sag.id] = { valg, tid: new Date().toISOString() };
  save();
  current = valg === "blank" ? null : sag.id;
  render();
}

// --- Match ---------------------------------------------------------------------

function beregnMatch(periode) {
  const graense = periode === "90" ? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) : "";
  const pr = {};
  for (const sag of sager) {
    const mit = state.votes[sag.id]?.valg;
    if (mit !== "for" && mit !== "imod") continue;
    if (graense && (sag.dato || "") < graense) continue;
    for (const [p, v] of Object.entries(sag.partier || {})) {
      if (IKKE_PARTIER.has(p) || (v !== "for" && v !== "imod")) continue;
      pr[p] ??= { enig: 0, n: 0 };
      pr[p].n++;
      if (v === mit) pr[p].enig++;
    }
  }
  return Object.entries(pr)
    .map(([p, { enig, n }]) => ({ p, enig, n, pct: enig / n }))
    .sort((a, b) => b.pct - a.pct || b.n - a.n || partinavn(a.p).localeCompare(partinavn(b.p), "da"));
}

function renderMatch() {
  const frag = document.createDocumentFragment();
  const liste = beregnMatch(matchPeriode);
  const antal = Object.values(state.votes).filter((v) => v.valg === "for" || v.valg === "imod").length;

  const kort = el("section", { class: "card" },
    el("div", { class: "filters" },
      ...[["alle", "Hele perioden"], ["90", "Seneste 90 dage"]].map(([k, t]) =>
        el("button", { "aria-pressed": String(matchPeriode === k), onclick: () => { matchPeriode = k; render(); } }, t))));

  if (!liste.length) {
    kort.append(el("div", { class: "empty" },
      el("h2", {}, "Intet match endnu"),
      el("p", {}, antal ? "Ingen sager i den valgte periode." : "Tag stilling til et par sager, så begynder dit match at tage form.")));
  } else {
    kort.append(el("ul", { class: "matchlist" }, liste.map(({ p, enig, n, pct }) =>
      el("li", {},
        el("span", { class: "mname" }, partinavn(p)),
        el("span", { class: "mpct" }, Math.round(pct * 100) + " %"),
        el("div", { class: "mbar" }, el("span", { style: `width:${pct * 100}%` })),
        el("span", { class: "mn" }, `Enig i ${enig} af ${n} sager${n < 5 ? " · få sager, tallet er usikkert" : ""}`)))));
  }
  kort.append(el("p", { class: "note" },
    "Sådan regnes det: For hver sag, hvor både du og partiet stemte for eller imod, tæller det som enighed, hvis I stemte ens. " +
    "Sager du sprang over, og partiers 'hverken for eller imod' eller fravær tæller ikke med. Alle partier vægtes ens, og kun vedtagne sager indgår."));
  frag.append(kort);
  return frag;
}

// --- Historik ------------------------------------------------------------------

function renderHistorik() {
  const frag = document.createDocumentFragment();
  const besvarede = sorterede().filter((s) => state.votes[s.id]);
  if (!besvarede.length) {
    frag.append(el("div", { class: "card empty" }, el("h2", {}, "Ingen historik endnu"), el("p", {}, "Dine stemmer dukker op her.")));
    return frag;
  }
  frag.append(el("section", { class: "card" }, el("ul", { class: "hist" }, besvarede.map((sag) => {
    const mit = state.votes[sag.id].valg;
    const parti = mit === "for" || mit === "imod"
      ? Object.values(sag.partier || {}).filter((v) => v === mit).length : null;
    return el("li", {},
      el("div", { class: "h-row" }, el("b", {}, sag.nummer || ""), el("span", {}, fmtDato(sag.dato))),
      el("p", { class: "h-title" }, sag.titelkort || sag.titel),
      el("div", { class: "h-row" },
        el("span", { class: "chip " + (mit === "blank" ? "hverken" : mit) }, VALG_TEKST[mit]),
        parti != null ? el("span", {}, `${parti} partier stemte som dig`) : null,
        el("button", { class: "link", onclick: () => { current = sag.id; view = "feed"; render(); } }, "Se"),
        el("button", { class: "link", onclick: () => { delete state.votes[sag.id]; save(); render(); } }, "Fortryd")));
  }))));
  return frag;
}

// --- Backup --------------------------------------------------------------------

$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `vedtaget-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#import").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || typeof d.votes !== "object") throw new Error();
    Object.assign(state.votes, d.votes);
    save(); render();
    alert("Backup indlæst.");
  } catch (_) { alert("Filen kunne ikke læses som en Vedtaget-backup."); }
  e.target.value = "";
});

// --- Start ---------------------------------------------------------------------

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => { view = b.dataset.view; if (view !== "feed") current = null; render(); $("#view").focus({ preventScroll: true }); }));

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
hentData();
