"use strict";

// Vedtaget — tag stilling til vedtagne sager og se, hvilke partier du stemmer som.
// Alle dine stemmer ligger kun i denne browsers localStorage.

const STORE_KEY = "vedtaget.v1";
const DATA_URL = "data/sager.json";
const MANDATER = 179;

const PARTINAVNE = {
  S: "Socialdemokratiet", V: "Venstre", SF: "SF", M: "Moderaterne",
  DD: "Danmarksdemokraterne", LA: "Liberal Alliance", KF: "Konservative",
  KONS: "Konservative", EL: "Enhedslisten", DF: "Dansk Folkeparti",
  RV: "Radikale Venstre", ALT: "Alternativet", BP: "Borgernes Parti",
  NB: "Nye Borgerlige", KD: "Kristendemokraterne", FG: "Frie Grønne",
  SIU: "Siumut", IA: "Inuit Ataqatigiit", NQ: "Naleraq", N: "Naleraq",
  JF: "Javnaðarflokkurin", SP: "Sambandsflokkurin", T: "Tjóðveldi", TF: "Tjóðveldi",
};
const IKKE_PARTIER = new Set(["UFG", "UP"]);
const VALG = { for: "For", imod: "Imod", hverken: "Hverken for eller imod", blank: "Sprunget over" };

// --- Lager ---------------------------------------------------------------------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object" && s.votes) return s;
  } catch (_) { /* tom eller blokeret lagring */ }
  return { votes: {}, lastSeen: null, onboarded: false };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignorer */ }
}

const state = load();
let sager = [];
let generated = null;
let view = "feed";
let revealed = null;      // sag-id der vises med resultat i Sager-fanen
let matchPeriode = "alle";
let loaded = false;
let loadError = false;

// --- Hjælpere ------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v; // kun til statiske ikoner
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
};
const icon = (name) => el("span", { html: ICON[name], style: "display:contents" });
const partinavn = (p) => PARTINAVNE[p] || p;
const fmtDato = (iso, opts = { day: "numeric", month: "long", year: "numeric" }) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("da-DK", opts) : "ukendt dato";
const sorterede = () => [...sager].sort((a, b) => (b.dato || "").localeCompare(a.dato || "") || b.id - a.id);
const ubesvarede = () => sorterede().filter((s) => !state.votes[s.id]);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function toast(tekst) {
  const t = $("#toast");
  t.textContent = tekst;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// --- Data ----------------------------------------------------------------------

async function hentData() {
  try {
    const r = await fetch(DATA_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    sager = Array.isArray(d.sager) ? d.sager : [];
    generated = d.genereret || null;
  } catch (_) {
    loadError = true;
  }
  loaded = true;
  render();
  if (!state.onboarded && sager.length) visIntro();
}

function opdaterBadge() {
  const n = ubesvarede().length;
  const b = $("#badge");
  b.hidden = n === 0;
  b.textContent = n > 99 ? "99+" : String(n);
}

// --- Navigation ----------------------------------------------------------------

function gaaTil(v) {
  view = v;
  if (v !== "feed") revealed = null;
  render();
  window.scrollTo({ top: 0 });
  $("#view").focus({ preventScroll: true });
}

function render() {
  document.querySelectorAll(".tabbar button").forEach((b) =>
    b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  const root = $("#view");
  root.replaceChildren();
  if (!loaded) root.append(el("p", { class: "page-sub" }, "Henter sager …"));
  else if (view === "feed") root.append(renderFeed());
  else if (view === "match") root.append(renderMatch());
  else root.append(renderHistorik());
  opdaterBadge();
}

// --- Sager ---------------------------------------------------------------------

function tomTilstand(titel, tekst, knap) {
  return el("section", { class: "empty" },
    el("div", { class: "glyph", "aria-hidden": "true" }, ...Array.from({ length: 5 }, () => el("i"))),
    el("h2", {}, titel),
    el("p", {}, tekst),
    knap || null);
}

function renderFeed() {
  const frag = document.createDocumentFragment();
  if (loadError) {
    frag.append(tomTilstand("Sagerne kunne ikke hentes", "Tjek din forbindelse og åbn appen igen. Dine stemmer er gemt."));
    return frag;
  }
  if (!sager.length) {
    frag.append(tomTilstand("Ingen sager endnu", "Der er ikke hentet data fra Folketinget endnu. Kør jobbet ”Hent vedtagne sager” under Actions på GitHub."));
    return frag;
  }
  if (revealed) {
    const sag = sager.find((s) => s.id === revealed);
    if (sag) { frag.append(fremdrift(), sagKort(sag, true)); return frag; }
  }
  const liste = ubesvarede();
  if (!liste.length) {
    frag.append(tomTilstand(
      "Du er ajour",
      `Du har taget stilling til alle ${sager.length} sager. Nye vedtagne sager kommer hver lørdag.`,
      el("button", { class: "primary", style: "max-width:260px;margin-inline:auto", onclick: () => gaaTil("match") }, "Se dit match")));
    return frag;
  }
  const stak = el("div", { class: "stack" });
  if (liste.length > 1) stak.append(el("div", { class: "card behind", "aria-hidden": "true" }));
  const kort = sagKort(liste[0], false);
  stak.append(kort);
  frag.append(fremdrift(), stak);
  if (!state.swipeHintSeen) frag.append(el("p", { class: "hint" }, "Swipe mod højre for at stemme for og mod venstre for at stemme imod"));
  return frag;
}

function fremdrift() {
  const besvaret = sager.length - ubesvarede().length;
  return el("div", { class: "progress" },
    el("div", { class: "progress-text" },
      el("span", {}, el("b", {}, String(besvaret)), ` af ${sager.length} sager`),
      el("span", {}, generated ? "Opdateret " + new Date(generated).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "")),
    el("div", { class: "progress-track" }, el("span", { style: `width:${(besvaret / sager.length) * 100}%` })));
}

function sagKort(sag, afsloeret) {
  const mit = state.votes[sag.id]?.valg;
  const resume = (sag.resume || "").trim();
  const kort = el("article", { class: "card enter" + (afsloeret ? " is-revealed" : ""), "aria-label": sag.titelkort || sag.titel },
    el("span", { class: "stamp s-for", "aria-hidden": "true" }, "FOR"),
    el("span", { class: "stamp s-imod", "aria-hidden": "true" }, "IMOD"),
    el("div", { class: "tag-row" },
      el("span", { class: "tag" }, sag.nummer || sag.type),
      el("span", { class: "date" }, `${sag.type}, vedtaget ${fmtDato(sag.dato)}`)),
    el("h2", {}, sag.titelkort || sag.titel),
    sag.type === "Beslutningsforslag" ? el("p", { class: "note-b" }, "Et beslutningsforslag pålægger regeringen at handle. Det er ikke i sig selv en lov.") : null,
    sag.titel && sag.titel !== sag.titelkort ? el("p", { class: "fulltitle" }, sag.titel) : null,
    el("p", { class: "resume" }, resume || "Folketinget har ikke skrevet et resumé af denne sag."),
    el("div", { class: "links" },
      resume && (afsloeret || resume.length > 380) ? el("button", { class: "text-btn", onclick: () => visResume(sag) }, afsloeret ? "Læs resuméet" : "Læs hele resuméet") : null,
      sag.url ? el("a", { class: "text-btn", href: sag.url, target: "_blank", rel: "noopener" }, "Sagen på ft.dk") : null),
  );

  if (!afsloeret) {
    kort.append(
      el("div", { class: "ballot" },
        el("button", { class: "b-imod", onclick: () => stem(sag, "imod") }, icon("cross"), "Imod"),
        el("button", { class: "b-for", onclick: () => stem(sag, "for") }, icon("check"), "For")),
      el("button", { class: "skip", onclick: () => stem(sag, "blank") }, "Spring over"));
    gørSwipebar(kort, sag);
  } else {
    kort.append(afsloering(sag, mit));
    kort.append(el("button", { class: "primary", onclick: naeste },
      ubesvarede().length ? "Næste sag" : "Se dit match"));
  }
  return kort;
}

function naeste() {
  revealed = null;
  if (!ubesvarede().length) { gaaTil("match"); return; }
  render();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
}

function gørSwipebar(kort, sag) {
  let start = null, dx = 0;
  const sFor = $(".s-for", kort), sImod = $(".s-imod", kort);
  const reset = () => {
    kort.style.transition = "transform .25s ease";
    kort.style.transform = "";
    sFor.style.opacity = sImod.style.opacity = 0;
  };
  kort.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    start = { x: e.clientX, y: e.clientY }; dx = 0;
    kort.style.transition = "none";
    try { kort.setPointerCapture(e.pointerId); } catch (_) { /* ikke understøttet */ }
  });
  kort.addEventListener("pointermove", (e) => {
    if (!start) return;
    dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 12) return;
    kort.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    sFor.style.opacity = Math.max(0, Math.min(1, dx / 90));
    sImod.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const slut = () => {
    if (!start) return;
    start = null;
    if (Math.abs(dx) > 100) {
      const valg = dx > 0 ? "for" : "imod";
      kort.style.transition = "transform .22s ease-in, opacity .22s";
      kort.style.transform = `translateX(${dx > 0 ? 120 : -120}vw) rotate(${dx > 0 ? 18 : -18}deg)`;
      kort.style.opacity = 0;
      setTimeout(() => stem(sag, valg), reduceMotion() ? 0 : 200);
    } else reset();
  };
  kort.addEventListener("pointerup", slut);
  kort.addEventListener("pointercancel", () => { start = null; reset(); });
}

function stem(sag, valg) {
  state.votes[sag.id] = { valg, tid: new Date().toISOString() };
  state.swipeHintSeen = state.swipeHintSeen || Object.keys(state.votes).length >= 3;
  save();
  if (valg === "blank") { revealed = null; toast("Sprunget over"); }
  else revealed = sag.id;
  render();
  window.scrollTo({ top: 0 });
}

function grupper(sag) {
  const g = { for: [], imod: [], hverken: [] };
  for (const [p, v] of Object.entries(sag.partier || {})) {
    if (g[v] && !IKKE_PARTIER.has(p)) g[v].push(p);
  }
  Object.values(g).forEach((l) => l.sort((a, b) => partinavn(a).localeCompare(partinavn(b), "da")));
  return g;
}

function afsloering(sag, mit) {
  const r = { for: 0, imod: 0, hverken: 0, ...(sag.resultat || {}) };
  const fravaer = Math.max(0, MANDATER - r.for - r.imod - r.hverken);
  const g = grupper(sag);
  const somDig = mit === "for" || mit === "imod" ? g[mit].length : 0;
  const ialt = g.for.length + g.imod.length + g.hverken.length;

  let linje, under;
  if (mit === "for") {
    linje = "Du stemte med flertallet";
    under = r.imod === 0 ? "Ingen mandater stemte imod forslaget." : `${r.for} mandater stemte for, ${r.imod} imod.`;
  } else {
    linje = r.imod === 0 ? "Du stemte imod, det gjorde ingen i salen" : "Du stemte med mindretallet";
    under = r.imod === 0 ? `Forslaget blev vedtaget med ${r.for} stemmer for.` : `${r.imod} mandater stemte også imod.`;
  }

  // Stemmetavlen: én prik pr. mandat
  const prikker = [
    ...Array(r.for).fill("d-for"), ...Array(r.hverken).fill("d-hverken"),
    ...Array(r.imod).fill("d-imod"), ...Array(fravaer).fill(""),
  ].slice(0, MANDATER);
  const tavle = el("div", { class: "board", role: "img",
    "aria-label": `${r.for} for, ${r.imod} imod, ${r.hverken} hverken for eller imod, ${fravaer} ikke til stede` },
    prikker.map((c, i) => el("i", { class: c, style: `--i:${i}` })));

  return el("section", { class: "verdict", "aria-live": "polite" },
    el("p", { class: "verdict-line" }, linje),
    el("p", { class: "verdict-sub" }, under),
    tavle,
    el("div", { class: "legend" },
      el("span", {}, el("i", { class: "dot for" }), el("b", {}, String(r.for)), "for"),
      el("span", {}, el("i", { class: "dot imod" }), el("b", {}, String(r.imod)), "imod"),
      r.hverken ? el("span", {}, el("i", { class: "dot hverken" }), el("b", {}, String(r.hverken)), "hverken") : null,
      el("span", {}, el("i", { class: "dot fravaer" }), el("b", {}, String(fravaer)), "ikke til stede")),
    el("div", { class: "parties" },
      ...["for", "imod", "hverken"].filter((k) => g[k].length).map((k) =>
        el("div", { class: "pgroup" + (mit === k ? " mine" : "") },
          el("h3", {}, el("i", { class: "dot " + k }), VALG[k], mit === k ? el("span", { class: "you" }, `${somDig} af ${ialt} partier som dig`) : null),
          el("div", { class: "chips" }, g[k].map((p) => el("span", { class: "chip" }, partinavn(p))))))),
  );
}

// --- Ark: resumé, intro, om ----------------------------------------------------

function visArk(...indhold) {
  const d = $("#sheet");
  $("#sheet-body").replaceChildren(...indhold);
  if (!d.open) d.showModal?.();
  return d;
}
function lukArk() { $("#sheet").close?.(); }
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") lukArk(); });

function visResume(sag) {
  visArk(
    el("h2", { id: "sheet-title", tabindex: "-1", autofocus: true }, sag.titelkort || sag.titel),
    el("p", { class: "resume-full" }, sag.resume),
    el("div", { class: "actions" },
      sag.url ? el("a", { class: "secondary", href: sag.url, target: "_blank", rel: "noopener", style: "text-decoration:none;color:inherit" }, "Læs sagen på ft.dk") : null,
      el("button", { class: "primary", style: "margin:0", onclick: lukArk }, "Tilbage til sagen")));
}

function visIntro() {
  const demo = [...Array(50).fill("d-for"), ...Array(6).fill("d-hverken"), ...Array(16).fill("d-imod")];
  visArk(
    el("h2", { id: "sheet-title", tabindex: "-1", autofocus: true }, "Politik, én vedtaget sag ad gangen"),
    el("div", { class: "intro-board", "aria-hidden": "true" }, demo.map((c) => el("i", { class: c }))),
    el("ol", { class: "steps" },
      el("li", {}, el("span", { class: "n" }, "1"), el("span", {}, el("b", {}, "Læs sagen"), "Med Folketingets egen titel og resumé. Ingen vinkling.")),
      el("li", {}, el("span", { class: "n" }, "2"), el("span", {}, el("b", {}, "Tag stilling"), "For eller imod, før du ser, hvad partierne stemte.")),
      el("li", {}, el("span", { class: "n" }, "3"), el("span", {}, el("b", {}, "Se dit match"), "Over tid viser appen, hvilke partier der faktisk stemmer som dig."))),
    el("button", { class: "primary", onclick: () => { state.onboarded = true; save(); lukArk(); } }, "Tag stilling til første sag"));
}

function visOm() {
  const antal = Object.keys(state.votes).length;
  visArk(
    el("h2", { id: "sheet-title", tabindex: "-1", autofocus: true }, "Om Vedtaget"),
    el("p", {}, "Sagerne kommer fra Folketingets Åbne Data og opdateres hver lørdag. Titler og resuméer er Folketingets egne, og alle vedtagne lov- og beslutningsforslag kommer med, nyeste først."),
    el("p", {}, `Dine ${antal} stemmer gemmes kun på denne telefon. Tag en backup, hvis du skifter telefon eller rydder Safari.`),
    el("div", { class: "actions" },
      el("button", { class: "secondary", onclick: gemBackup }, "Gem backup"),
      el("label", { class: "secondary", style: "cursor:pointer" }, "Indlæs backup",
        el("input", { type: "file", accept: "application/json", hidden: true, onchange: indlaesBackup })),
      el("button", { class: "secondary", onclick: () => { lukArk(); visIntro(); } }, "Vis introduktionen igen"),
      el("button", { class: "secondary danger", onclick: nulstil }, "Slet alle mine stemmer")));
}
$("#open-om").addEventListener("click", visOm);

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

  frag.append(el("h2", { class: "page-title" }, "Mit match"),
    el("p", { class: "page-sub" }, antal === 1 ? "Baseret på 1 sag, du har taget stilling til." : `Baseret på ${antal} sager, du har taget stilling til.`));

  if (antal < 3) {
    frag.append(tomTilstand("Dit match tager form",
      antal ? `Tag stilling til ${3 - antal} sager mere, så viser vi, hvilke partier der stemmer som dig.`
            : "Tag stilling til tre sager, så viser vi, hvilke partier der stemmer som dig.",
      el("button", { class: "primary", style: "max-width:260px;margin-inline:auto", onclick: () => gaaTil("feed") }, "Gå til sagerne")));
    return frag;
  }

  frag.append(el("div", { class: "segmented", role: "group", "aria-label": "Periode" },
    ...[["alle", "Hele perioden"], ["90", "Seneste 90 dage"]].map(([k, t]) =>
      el("button", { "aria-pressed": String(matchPeriode === k), onclick: () => { matchPeriode = k; render(); } }, t))));

  if (!liste.length) {
    frag.append(tomTilstand("Ingen sager i perioden", "Du har ikke taget stilling til sager fra de seneste 90 dage."));
    return frag;
  }

  const top = liste.filter((x) => x.pct === liste[0].pct);
  const navne = top.map((x) => partinavn(x.p));
  const ogListe = (l) => l.length > 1 ? l.slice(0, -1).join(", ") + " og " + l.at(-1) : l[0];
  frag.append(el("section", { class: "hero" },
    el("p", {}, "Du stemmer oftest som"),
    el("div", { class: "who" }, navne.length > 2 ? `${navne.length} partier på delt førsteplads` : ogListe(navne)),
    navne.length > 2 ? el("p", { class: "tied" }, ogListe(navne)) : null,
    el("div", { class: "figs" },
      el("span", { class: "pct" }, Math.round(liste[0].pct * 100) + " %"),
      el("span", { class: "of" }, `enige i ${liste[0].enig} af ${liste[0].n} sager`))));

  frag.append(el("section", { class: "list", "aria-label": "Alle partier" }, liste.map(({ p, enig, n, pct }) =>
    el("div", { class: "mrow" },
      el("div", { class: "mrow-top" },
        el("span", { class: "mname" }, partinavn(p)),
        el("span", { class: "mpct" }, Math.round(pct * 100) + " %")),
      el("div", { class: "mbar", "aria-hidden": "true" }, el("span", { style: `width:${pct * 100}%` })),
      el("div", { class: "mmeta" }, `Enig i ${enig} af ${n} sager${n < 5 ? ". Få sager, så tallet er usikkert" : ""}`)))));

  frag.append(el("details", { class: "method" },
    el("summary", {}, "Sådan regner vi"),
    el("p", {}, "En sag tæller med, når både du og partiet stemte for eller imod. Stemte I ens, er I enige. Sager du sprang over, og partiers stemmer om hverken for eller imod, tæller ikke med. Alle partier og alle sager vægtes ens, og kun vedtagne forslag indgår.")));
  return frag;
}

// --- Historik ------------------------------------------------------------------

function renderHistorik() {
  const frag = document.createDocumentFragment();
  frag.append(el("h2", { class: "page-title" }, "Historik"));
  const besvarede = sorterede().filter((s) => state.votes[s.id]);
  if (!besvarede.length) {
    frag.append(tomTilstand("Ingen stemmer endnu", "Sager, du tager stilling til, samles her, så du kan se dem igen eller ændre din stemme.",
      el("button", { class: "primary", style: "max-width:260px;margin-inline:auto", onclick: () => gaaTil("feed") }, "Gå til sagerne")));
    return frag;
  }
  frag.append(el("p", { class: "page-sub" }, "Tryk på en sag for at se resultatet eller ændre din stemme."));
  let maaned = null, liste = null;
  for (const sag of besvarede) {
    const m = fmtDato(sag.dato, { month: "long", year: "numeric" });
    if (m !== maaned) {
      maaned = m;
      liste = el("section", { class: "list" });
      frag.append(el("h3", { class: "month" }, m[0].toUpperCase() + m.slice(1)), liste);
    }
    const mit = state.votes[sag.id].valg;
    const g = grupper(sag);
    const meta = mit === "blank" ? "Sprunget over"
      : `Du stemte ${mit}, ${g[mit].length} af ${g.for.length + g.imod.length + g.hverken.length} partier med dig`;
    liste.append(el("button", { class: "hrow", onclick: () => aabnHistorik(sag) },
      el("i", { class: "dot " + (mit === "blank" ? "fravaer" : mit) }),
      el("span", {}, el("span", { class: "htitle" }, sag.titelkort || sag.titel), el("span", { class: "hmeta", style: "display:block" }, meta)),
      icon("chev")));
  }
  return frag;
}

function aabnHistorik(sag) {
  const mit = state.votes[sag.id].valg;
  visArk(
    el("h2", { id: "sheet-title", tabindex: "-1", autofocus: true }, sag.titelkort || sag.titel),
    el("p", {}, `${sag.nummer || sag.type}, vedtaget ${fmtDato(sag.dato)}. Din stemme: ${VALG[mit]}.`),
    mit !== "blank" ? afsloering(sag, mit) : null,
    el("div", { class: "actions" },
      el("button", { class: "secondary", onclick: () => { delete state.votes[sag.id]; save(); lukArk(); revealed = null; gaaTil("feed"); toast("Sagen er tilbage blandt dine sager"); } }, "Stem om"),
      el("button", { class: "primary", style: "margin:0", onclick: lukArk }, "Luk")));
}

// --- Backup --------------------------------------------------------------------

function gemBackup() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `vedtaget-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup gemt");
}
async function indlaesBackup(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || typeof d.votes !== "object") throw new Error();
    Object.assign(state.votes, d.votes);
    state.onboarded = true;
    save(); lukArk(); render();
    toast(`Backup indlæst: ${Object.keys(d.votes).length} stemmer`);
  } catch (_) { toast("Filen er ikke en Vedtaget-backup"); }
}
function nulstil() {
  if (!confirm("Slet alle dine stemmer på denne telefon? Det kan ikke fortrydes, medmindre du har en backup.")) return;
  state.votes = {};
  save(); lukArk(); revealed = null; gaaTil("feed");
  toast("Alle stemmer er slettet");
}

// --- Start ---------------------------------------------------------------------

document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => gaaTil(b.dataset.view)));

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
render();
hentData();
