(function () {
"use strict";

/* =========================================================
   Utilidades
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ic = (n, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function fmtDate(t, withTime) {
  if (!t) return "";
  const d = new Date(t), n = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = Math.round((dayStart(n) - dayStart(d)) / 864e5);
  if (diff === 0) return withTime === false ? "hoje" : "hoje, " + hm;
  if (diff === 1) return "ontem" + (withTime ? ", " + hm : "");
  if (diff === -1) return "amanhã, " + hm;
  const s = d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" }).replace(".", "");
  return withTime ? s + ", " + hm : s;
}
const PRIO = { 0: "Sem prioridade", 1: "Baixa", 2: "Média", 3: "Alta" };

/* API do app (Electron). No navegador, usa um substituto em memória para testes. */
const api = window.api || (() => {
  const K = "bc-dev";
  const get = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  const put = (d) => { try { localStorage.setItem(K, JSON.stringify(d)); } catch (e) {} };
  return {
    async load() { const d = get(); return { notebooks: d.notebooks || [], notes: Object.values(d.notes || {}), firstRun: !d.notebooks, dataDir: "C:\\Users\\voce\\Documents\\ForeverNote", session: d.session || {}, prefs: d.prefs || {}, platform: "browser" }; },
    async saveNote(n) { const d = get(); d.notes = d.notes || {}; d.notes[n.id] = n; put(d); },
    async deleteNote(id) { const d = get(); if (d.notes) delete d.notes[id]; put(d); },
    async saveNotebooks(l) { const d = get(); d.notebooks = l; put(d); },
    async saveSession(s) { const d = get(); d.session = s; put(d); },
    async savePrefs(p) { const d = get(); d.prefs = p; put(d); },
    async saveImage(dataUrl) { return dataUrl; },
    async saveAudio(buf) { return URL.createObjectURL(new Blob([buf], { type: "audio/webm" })); },
    async chooseFolder() { return null; }, async openFolder() {}, async openLink(u) { window.open(u, "_blank"); },
    async setFullscreen(on) { try { on ? await document.documentElement.requestFullscreen() : await document.exitFullscreen(); } catch (e) {} return on; },
    async focus() {}, async exportNote() { return false; },
    flush(p) { const d = get(); d.notes = d.notes || {}; (p.notes || []).forEach((n) => (d.notes[n.id] = n)); (p.deleted || []).forEach((id) => delete d.notes[id]); if (p.notebooks) d.notebooks = p.notebooks; if (p.session) d.session = p.session; put(d); },
    onFullscreen(cb) { document.addEventListener("fullscreenchange", () => cb(!!document.fullscreenElement)); }
  };
})();
const imgSrc = (name) => (/^(data|blob):/.test(name) ? name : "anexo://img/" + name);
const WEB = !window.api;                               // true quando roda no navegador/celular
const ICON = WEB ? "icon.png" : "../build/icon.png";

/* =========================================================
   Estado
   ========================================================= */
const S = {
  nbs: new Map(), notes: new Map(),
  sel: { type: "all" }, q: "",
  sort: { by: "updated", dir: "desc" }, nbSort: { by: "name", dir: "asc" },
  filter: blankFilter(),
  tabs: [], active: null, hist: [], histPos: -1,
  expanded: false, fullscreen: false, closed: {}, scroll: {},
  prefs: { theme: "system", autocap: true, spell: true, autolink: true, font: "", size: 16, wide: false, zoom: 1, anim: true, micId: "", lang: "pt", afterRec: "ask", hints: true, proofOnline: null, myWords: [], closeToTray: true, minToTray: true, startLogin: false, wpm: 150, templates: [] },
  dataDir: "", platform: "",
  picked: new Set(), pickMode: false, lastPick: null
};
function blankFilter() { return { tags: [], prio: [], stage: [], created: "any", from: "", to: "", fav: false, reminder: false, img: false, link: false }; }
const filterCount = () => { const f = S.filter; return f.tags.length + f.prio.length + (f.stage || []).length + (f.created !== "any" ? 1 : 0) + f.fav + f.reminder + f.img + f.link; };

/* =========================================================
   Estúdio: tempo de fala, etapa do vídeo e modelos prontos
   (carregado antes do app.js; usa as funções dele na hora da chamada)
   ========================================================= */

/* ---------- etapas ---------- */
const STAGES = [
  { k: "ideia", label: "Ideia", c: "#a78bfa" },
  { k: "roteiro", label: "Roteiro", c: "#60a5fa" },
  { k: "gravacao", label: "Gravação", c: "#f87171" },
  { k: "edicao", label: "Edição", c: "#f5b544" },
  { k: "postado", label: "Postado", c: "#34d399" }
];
const stageOf = (k) => STAGES.find((s) => s.k === k) || null;
const stageIdx = (k) => STAGES.findIndex((s) => s.k === k);
const SDOT_OK = `<svg viewBox="0 0 12 12"><path d="M3.2 6.3l1.9 1.9 3.8-4.3"/></svg>`;
const stageDot = (st) => `<i class="sdot${st && st.k === "postado" ? " ok" : ""}">${st && st.k === "postado" ? SDOT_OK : ""}</i>`;
const stagePill = (st, cls = "stage-f") => `<span class="${cls}" style="--sc:${st.c}">${stageDot(st)}${st.label}</span>`;

function setStage(ids, k) {
  const now = Date.now();
  ids.forEach((id) => { const n = S.notes.get(id); if (n && (n.stage || "") !== k) { n.stage = k; n.updated = now; markNote(id); } });
}
function stagePop(anchor, ids, done) {
  ids = ids.filter((id) => S.notes.has(id)); if (!ids.length) return;
  const first = S.notes.get(ids[0]).stage || "";
  let cur = ids.every((id) => (S.notes.get(id).stage || "") === first) ? first : null;
  const track = () => { const i = stageIdx(cur), st = stageOf(cur); return `<div class="stage-track" style="--sc:${st ? st.c : "var(--line)"}">${STAGES.map((s, j) => `<i class="${j <= i ? "on" : ""}" style="--d:${j}"></i>`).join("")}</div>`; };
  const items = () => STAGES.map((s, j) => `<button class="mi stage-mi${s.k === cur ? " active" : ""}" data-stage="${s.k}" style="--sc:${s.c}">${stageDot(s)}<span>${s.label}</span><span class="k">${j + 1}</span>${s.k === cur ? ic("check", "ck") : ""}</button>`).join("");
  const p = popover(anchor, `<div class="pop-h">Etapa do vídeo${ids.length > 1 ? ` · ${plural(ids.length, "nota", "notas")}` : ""}</div><div id="stTrack">${track()}</div><div id="stItems">${items()}</div>
    <hr><button class="mi" data-stage=""${cur === "" ? ' style="color:var(--faint)"' : ""}>${ic("x")}Sem etapa</button>`);
  p.classList.add("stage-pop");
  let busy = false;
  const choose = (k) => {
    if (busy) return; busy = true;
    cur = k; setStage(ids, k);
    const t = $("#stTrack", p); const prev = $$(".stage-track i.on", t).length;
    t.innerHTML = track();
    const segs = $$(".stage-track i", t); const now = stageIdx(k) + 1;
    /* anima só os segmentos que mudaram */
    segs.forEach((s, j) => { if ((j < now) !== (j < prev)) { s.classList.toggle("on", j >= prev); void s.offsetWidth; s.classList.toggle("on", j < now); } else s.style.transition = "none"; });
    $("#stItems", p).innerHTML = items();
    setTimeout(() => { closePop(); done ? done(k) : null; renderAfterStage(); }, k === "postado" ? 560 : 420);
    if (k === "postado") celebrate(anchor);
  };
  p.addEventListener("click", (e) => { const b = e.target.closest("[data-stage]"); if (b) choose(b.dataset.stage); });
  p.addEventListener("keydown", (e) => { if (/^[1-5]$/.test(e.key)) { e.preventDefault(); choose(STAGES[+e.key - 1].k); } });
  p.tabIndex = -1; p.focus({ preventScroll: true });
}
function caretStart(el) { ED.doc.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); saveSel(); }
function renderAfterStage() { if (ED) renderFoot(); renderList(false, true); renderSidebar(); }
/* um brilho discreto quando o vídeo é postado */
function celebrate(anchor) {
  if (document.documentElement.classList.contains("no-anim") || !anchor?.isConnected) return;
  const r = anchor.getBoundingClientRect();
  const box = document.createElement("div"); box.className = "spark-box"; box.style.left = r.left + r.width / 2 + "px"; box.style.top = r.top + r.height / 2 + "px";
  box.innerHTML = Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36}deg;--d:${18 + (i % 3) * 7}px"></i>`).join("");
  document.body.appendChild(box); setTimeout(() => box.remove(), 800);
}

/* ---------- tempo estimado de fala ---------- */
const PACES = [[130, "Calmo"], [150, "Normal"], [175, "Acelerado"]];
const paceName = (w) => (PACES.find((p) => p[0] === w) || [0, "Personalizado"])[1];
const BLOCK_SEL = "p,div,li,h1,h2,h3,h4,blockquote,pre,td,th";
function countWords(s) { return (s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu) || []).length; }
function speechStats(root, range) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let all = "", spoken = "", last = null;
  for (let t; (t = w.nextNode());) {
    const el = t.parentElement; if (!el || el.closest(".audio-block,.file-link")) continue;
    let s = t.data;
    if (range) {
      if (!range.intersectsNode(t)) continue;
      const a = t === range.startContainer ? range.startOffset : 0, b = t === range.endContainer ? range.endOffset : s.length;
      s = s.slice(a, b);
    }
    const blk = el.closest(BLOCK_SEL), sep = blk !== last ? " " : ""; last = blk;
    all += sep + s;
    spoken += el.closest("h1,h2,h3") ? " " : sep + s;
  }
  return { words: countWords(all), spoken: countWords(spoken), chars: all.replace(/\s/g, "").length };
}
function fmtSpeech(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
const durOf = (words, wpm) => (words / wpm) * 60;
let wcMode = "";
function updateWordCount() {
  const el = $("#wc"); if (!el || !ED) return;
  const wpm = S.prefs.wpm || 150;
  const sel = getSelection();
  const r = sel.rangeCount && !sel.isCollapsed && inDoc(sel.anchorNode) && inDoc(sel.focusNode) ? sel.getRangeAt(0) : null;
  const st = speechStats(ED.doc, r);
  const mode = r && st.words ? "sel" : "all";
  const time = st.spoken ? `≈ ${fmtSpeech(durOf(st.spoken, wpm))}` : "";
  let main;
  if (mode === "sel") main = `<b>Trecho</b>${time ? `<span class="wc-t">${time}</span><span class="wc-sep">·</span>` : ""}${plural(st.words, "palavra", "palavras")}`;
  else main = time ? `<span class="wc-t">${time}</span>&nbsp;de fala<span class="wc-sep">·</span>${plural(st.words, "palavra", "palavras")}` : plural(st.words, "palavra", "palavras");
  const others = PACES.filter((p) => p[0] !== wpm).map((p) => `<span>${p[1]}</span><b>≈ ${fmtSpeech(durOf(st.spoken, p[0]))}</b>`).join("");
  const tip = `<div class="wc-tip" role="tooltip"><div class="wc-tip-h">${ic("timer")}Tempo estimado de fala${mode === "sel" ? " do trecho" : ""}</div>
    <div class="wc-grid"><span>${paceName(wpm)} · ${wpm} palavras/min</span><b>${st.spoken ? "≈ " + fmtSpeech(durOf(st.spoken, wpm)) : "—"}</b>${st.spoken ? others : ""}</div>
    <div class="wc-foot">${plural(st.words, "palavra", "palavras")} · ${plural(st.chars, "caractere", "caracteres")}<br>Títulos de seção, links e áudios não entram no tempo. Mude o ritmo em Configurações › Editor.</div></div>`;
  const changed = mode !== wcMode; wcMode = mode;
  el.classList.toggle("sel", mode === "sel");
  el.innerHTML = `${ic("timer")}<span class="wc-in${changed ? " swap" : ""}">${main}</span>${tip}`;
}
let wcTimer = 0;
function updateWordCountSoon() { clearTimeout(wcTimer); wcTimer = setTimeout(updateWordCount, 90); }

/* ---------- modelos prontos ---------- */
const ph = (t, tag = "p") => `<${tag} data-ph="${t}"><br></${tag}>`;
const TEMPLATES = [
  { id: "tpl-roteiro", name: "Roteiro de vídeo", desc: "Gancho, introdução, patrocínio, conteúdo e encerramento", icon: "video", stage: "roteiro",
    html: `<div class="callout">${ph("Em uma frase: sobre o que é o vídeo e por que vale assistir")}</div><h2>Gancho · primeiros 15 segundos</h2>${ph("Abra com o momento mais forte e prometa o que o vídeo entrega")}<h2>Introdução</h2>${ph("Contexto rápido e o que vem a seguir")}<h2>Patrocínio</h2>${ph("Texto da publi. Se não tiver, apague esta seção")}<h2>Conteúdo</h2><ul>${ph("Primeiro ponto", "li")}${ph("Segundo ponto", "li")}${ph("Terceiro ponto", "li")}</ul><h2>Chamada para inscrição</h2>${ph("Peça a inscrição num momento natural do vídeo")}<h2>Encerramento</h2>${ph("Resumo em uma frase e convite para o próximo vídeo")}` },
  { id: "tpl-short", name: "Roteiro de Short", desc: "Vídeo curto em três partes, até 60 segundos", icon: "bolt", stage: "roteiro",
    html: `<div class="callout">${ph("A ideia do Short em uma frase")}</div><h2>Gancho · até 3 segundos</h2>${ph("A frase ou imagem que prende logo de cara")}<h2>Desenvolvimento</h2>${ph("Direto ao ponto, um assunto só")}<h2>Final</h2>${ph("Feche em loop com o começo ou chame para o vídeo longo")}` },
  { id: "tpl-ideia", name: "Ideia de vídeo", desc: "Conceito, títulos possíveis e ideia de thumb", icon: "bulb", stage: "ideia",
    html: `<h2>Conceito</h2>${ph("O que acontece no vídeo, em poucas linhas")}<h2>Por que vai performar</h2>${ph("Tendência, dúvida comum, novidade, polêmica…")}<h2>Títulos possíveis</h2><ol>${ph("Título 1", "li")}${ph("Título 2", "li")}${ph("Título 3", "li")}</ol><h2>Ideia de thumb</h2>${ph("Elemento principal, expressão e texto curto")}<h2>Referências</h2><ul>${ph("Links de vídeos parecidos ou clipes", "li")}</ul>` },
  { id: "tpl-upload", name: "Checklist de upload", desc: "Tudo o que conferir antes de publicar", icon: "check-list", stage: "",
    html: `<p>Antes de publicar, confira:</p><ul class="check"><li>Título final escolhido</li><li>Thumbnail pronta</li><li>Descrição com links e créditos</li><li>Tags e palavras-chave</li><li>Capítulos na descrição</li><li>Tela final e cards</li><li>Legendas revisadas</li><li>Comentário fixado</li><li>Horário de publicação definido</li><li>Divulgar nas redes</li></ul>` },
  { id: "tpl-publi", name: "Publi / patrocínio", desc: "Briefing da marca, texto da publi e entregas", icon: "megaphone", stage: "",
    html: `<div class="callout"><p><b>Marca:</b>&nbsp;</p><p><b>Cupom ou link:</b>&nbsp;</p><p><b>Prazo de entrega:</b>&nbsp;</p><p><b>Valor:</b>&nbsp;</p></div><h2>Pontos obrigatórios</h2><ul>${ph("O que a marca pediu para falar", "li")}</ul><h2>O que não falar</h2><ul>${ph("Restrições do briefing", "li")}</ul><h2>Texto da publi</h2>${ph("Escreva do jeito que você fala. O tempo aparece no rodapé")}<h2>Entregas</h2><ul class="check"><li>Enviar roteiro para aprovação</li><li>Roteiro aprovado</li><li>Gravar e enviar prévia</li><li>Publicar</li><li>Enviar métricas para a marca</li></ul>` }
];
const myTemplates = () => (Array.isArray(S.prefs.templates) ? S.prefs.templates : []);
function htmlText(html) {
  const d = document.createElement("div"); d.style.cssText = "position:fixed;left:-9999px;top:0;width:600px;white-space:pre-wrap";
  d.innerHTML = html; document.body.appendChild(d); const t = d.innerText; d.remove(); return t.replace(/ /g, " ");
}
function noteFromTemplate(t) {
  const extra = { title: t.title || "", html: t.html || "", text: htmlText(t.html || "") };
  if (t.stage) extra.stage = t.stage;
  if (t.nb && S.nbs.has(t.nb)) extra.nb = t.nb;
  if (t.tags && t.tags.length) extra.tags = [...new Set([...(S.sel.type === "tag" ? [S.sel.id] : []), ...t.tags])];
  if (t.prio) extra.prio = t.prio;
  newNote(extra);
}
/* aplica um modelo dentro da nota aberta (pelo comando /modelo) */
function applyTemplate(t) {
  const n = ED && S.notes.get(ED.id); if (!n || n.trashed) return;
  const empty = !(ED.doc.innerText || "").trim() && !ED.doc.querySelector("img,.audio-block,table,hr");
  if (empty) {
    ED.doc.innerHTML = t.html;
    mergeTplMeta(n, t);
    onDocChange(); renderFoot();
    const f = ED.doc.querySelector("[data-ph]"); if (f) caretStart(f);
  } else { mergeTplMeta(n, t); exec("insertHTML", t.html); onDocChange(); renderFoot(); }
  ED.doc.querySelectorAll("h2,ul,ol,.callout").forEach((el, i) => el.animate?.([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: Math.min(i, 10) * 30, easing: "ease-out", fill: "backwards" }));
  renderSidebar(); renderList();
  toast(`Modelo “${t.name}” aplicado`);
}
/* placeholders dos modelos somem para sempre depois que o bloco recebe texto */
function cleanPlaceholders(doc) {
  doc.querySelectorAll("[data-ph]").forEach((el) => {
    if ((el.textContent || "").trim() || el.querySelector("img,a")) el.removeAttribute("data-ph");
    else { const p = el.previousElementSibling; if (p && p.getAttribute("data-ph") === el.getAttribute("data-ph")) el.removeAttribute("data-ph"); }
  });
}
function tplCard(t, i, mine) {
  const st = stageOf(t.stage);
  const iconHTML = mine ? ic("template") : ic(t.icon);
  return `<div class="tpl" role="button" tabindex="0" data-tpl="${esc(t.id)}" style="--i:${i}">
    <div class="tpl-prev"><div class="tpl-page"><div class="tpl-title">${esc(t.title || "Título")}</div><div class="doc tpl-doc">${t.html}</div></div>${st ? stagePill(st, "stage-f tpl-stage") : ""}</div>
    <div class="tpl-meta"><span class="tpl-ic">${iconHTML}</span><div><b>${esc(t.name)}</b><span>${esc(mine ? (t.desc || "Seu modelo") : t.desc)}</span></div>${mine ? `<button class="ib sm tpl-more" data-tplmenu="${esc(t.id)}" aria-label="Opções do modelo">${ic("more")}</button>` : ""}</div></div>`;
}
function templatePicker(mode = "new", target) {
  const body = () => {
    const mine = myTemplates();
    let i = 0;
    const blank = mode === "new" ? `<div class="tpl tpl-blank" role="button" tabindex="0" data-tpl="blank" style="--i:${i++}"><div class="tpl-prev"><span class="tpl-plus">${ic("plus")}</span></div><div class="tpl-meta"><span class="tpl-ic">${ic("note-add")}</span><div><b>Nota em branco</b><span>Comece do zero</span></div></div></div>` : "";
    return `<div class="tpl-grid">${blank}${TEMPLATES.map((t) => tplCard(t, i++, false)).join("")}</div>
      <div class="tpl-sec">Meus modelos</div>
      ${mine.length ? `<div class="tpl-grid">${mine.map((t) => tplCard(t, i++, true)).join("")}</div>` : `<div class="tpl-empty">${ic("template")}<span>Transforme qualquer nota em modelo: abra a nota e use <b>⋯ › Salvar como modelo</b>.</span></div>`}`;
  };
  const m = modal(`<div class="m-head"><div class="m-ic">${ic("template")}</div><h2>${mode === "new" ? "Criar a partir de modelo" : "Aplicar modelo nesta nota"}</h2><button class="ib" id="tpX" aria-label="Fechar">${ic("x")}</button></div>
    <div class="m-body tpl-body" id="tpBody">${body()}</div>`, { wide: true });
  m.querySelector(".modal").classList.add("tpl-modal");
  const find = (id) => getTpl(id);
  const pick = (id) => {
    m.close();
    if (id === "blank") return newNote();
    const t = find(id); if (!t) return;
    mode === "new" ? noteFromTemplate(t) : target ? applyTemplateTo(target, t) : applyTemplate(t);
  };
  m.addEventListener("click", async (e) => {
    if (e.target.closest("#tpX")) return m.close();
    const mb = e.target.closest("[data-tplmenu]");
    if (mb) {
      e.stopPropagation();
      const t = find(mb.dataset.tplmenu);
      return menu(mb, [
        { icon: "edit", label: "Renomear", run: async () => { const v = await ask({ title: "Renomear modelo", input: "Nome", value: t.name, ok: "Salvar", icon: "template" }); if (v) { t.name = v; savePrefs(); } templatePicker(mode); } },
        { icon: "trash", label: "Excluir modelo", danger: true, run: async () => { const ok = await ask({ title: `Excluir “${t.name}”?`, text: "As notas criadas com este modelo continuam iguais.", ok: "Excluir", danger: true, icon: "trash" }); if (ok) { S.prefs.templates = myTemplates().filter((x) => x.id !== t.id); savePrefs(); toast("Modelo excluído"); } templatePicker(mode); } }
      ], { right: true });
    }
    const c = e.target.closest("[data-tpl]"); if (c) pick(c.dataset.tpl);
  });
  m.addEventListener("keydown", (e) => { const c = e.target.closest?.("[data-tpl]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(c.dataset.tpl); } });
}
async function saveAsTemplate(id = S.active) {
  const n = S.notes.get(id); if (!n) return;
  const v = await ask({ title: "Salvar como modelo", icon: "template", text: "O conteúdo desta nota vira um modelo, com a formatação e a etapa. O título não entra.", input: "Nome do modelo", value: (n.title || "").trim(), ok: "Salvar modelo" });
  const name = (typeof v === "string" ? v : "").trim(); if (!name) return;
  const html = ED && ED.id === n.id ? ED.doc.innerHTML : n.html || "";
  const tid = uid("tp_");
  S.prefs.templates = [...myTemplates(), { id: tid, name, title: "", html, stage: n.stage || "", tags: [...(n.tags || [])], nb: "", desc: "", created: Date.now() }];
  savePrefs(); renderSidebar();
  toast(`Modelo “${name}” salvo`, { label: "Ver modelos", run: () => { TV.sel = tid; setSel({ type: "tpl" }); } });
}

/* =========================================================
   Aba Modelos: galeria, prévia, padrões e edição
   ========================================================= */
const BUILTIN = new Set(TEMPLATES.map((t) => t.id));
const tplCount = () => TEMPLATES.length + myTemplates().length;
/* modelo com os padrões (caderno, etiquetas, etapa) já aplicados */
function getTpl(id) {
  const b = TEMPLATES.find((t) => t.id === id);
  if (b) return { ...b, tags: [], nb: "", ...((S.prefs.tplDefaults || {})[id] || {}), builtin: true };
  const m = myTemplates().find((t) => t.id === id);
  return m ? { tags: [], nb: "", ...m } : null;
}
function setTplDef(id, patch) {
  if (BUILTIN.has(id)) { S.prefs.tplDefaults = S.prefs.tplDefaults || {}; S.prefs.tplDefaults[id] = { ...(S.prefs.tplDefaults[id] || {}), ...patch }; }
  else { const m = myTemplates().find((t) => t.id === id); if (m) Object.assign(m, patch); }
  savePrefs();
}
let TV = { sel: null };
let TPLED = null; // modelo em edição: { id (nota temporária), tpl, prevActive }

function tvCard(t, i) {
  const st = stageOf(t.stage);
  const mine = !t.builtin;
  return `<div class="tpl${TV.sel === t.id ? " on" : ""}" role="button" tabindex="0" data-tv="${esc(t.id)}" style="--i:${i}">
    <div class="tpl-prev"><div class="tpl-page"><div class="tpl-title">Título</div><div class="doc tpl-doc">${t.html}</div></div>${st ? stagePill(st, "stage-f tpl-stage") : ""}</div>
    <div class="tpl-meta"><span class="tpl-ic">${ic(mine ? "template" : t.icon)}</span><div><b>${esc(t.name)}</b><span>${esc(mine ? (t.desc || "Seu modelo") : t.desc)}</span></div></div></div>`;
}
function renderTplView() {
  let v = $("#tplView");
  if (!v) { v = document.createElement("section"); v.id = "tplView"; v.className = "tv"; $("#pane").after(v); }
  const first = !v.dataset.ready; v.dataset.ready = "1";
  if (TV.sel && !getTpl(TV.sel)) TV.sel = null;
  const mine = myTemplates().map((t) => getTpl(t.id));
  let i = 0;
  v.classList.toggle("has-side", !!TV.sel);
  v.innerHTML = `<div class="tv-main">
      <div class="tv-head"><div class="tv-h"><div class="list-title-row"><button class="ib menu-btn" data-act="drawerBtn" aria-label="Mostrar cadernos">${ic("menu")}</button><h1>Modelos</h1><span class="list-count">${tplCount()}</span></div>
        <span class="list-sub">Notas que já nascem com a estrutura pronta</span></div>
        <button class="btn primary" data-tvact="new">${ic("plus")}Novo modelo</button></div>
      <div class="tv-scroll${first ? "" : " still"}">
        <div class="tpl-sec">Prontos</div>
        <div class="tpl-grid">${TEMPLATES.map((t) => tvCard(getTpl(t.id), i++)).join("")}</div>
        <div class="tpl-sec">Meus modelos${mine.length ? ` <span>${mine.length}</span>` : ""}</div>
        <div class="tpl-grid">${mine.map((t) => tvCard(t, i++)).join("")}
          <div class="tpl tpl-blank" role="button" tabindex="0" data-tvact="new" style="--i:${i++}"><div class="tpl-prev"><span class="tpl-plus">${ic("plus")}</span></div><div class="tpl-meta"><span class="tpl-ic">${ic("template")}</span><div><b>Novo modelo</b><span>Monte do zero com o editor</span></div></div></div>
        </div>
      </div>
    </div>
    <aside class="tv-side" id="tvSide">${TV.sel ? tvSideHTML(getTpl(TV.sel)) : ""}</aside>`;
}
function tvSideHTML(t) {
  const mine = !t.builtin, st = stageOf(t.stage);
  const nbs = sortedNbs([...S.nbs.values()]);
  return `<div class="tv-side-in" data-for="${esc(t.id)}">
    <div class="tv-side-head"><span class="tpl-ic">${ic(mine ? "template" : t.icon)}</span><div class="tv-name"><b>${esc(t.name)}</b><span>${mine ? "Seu modelo" : "Modelo pronto"}${st ? " · " + st.label : ""}</span></div>
      ${mine ? `<button class="ib sm" data-tvact="more" aria-label="Mais opções">${ic("more")}</button>` : ""}<button class="ib sm" data-tvact="close" aria-label="Fechar prévia">${ic("x")}</button></div>
    <div class="tv-actions"><button class="btn primary" data-tvact="use">${ic("note-add")}Usar modelo</button>
      ${mine ? `<button class="btn" data-tvact="edit">${ic("edit")}Editar</button>` : `<button class="btn" data-tvact="dup">${ic("dup")}Duplicar e personalizar</button>`}</div>
    <div class="tv-defs"><div class="tv-defs-h">Ao criar a nota</div>
      <label class="tv-row"><span>${ic("book")}Caderno</span><select class="field" data-tvdef="nb"><option value="">Caderno aberto no momento</option>${nbs.map((nb) => `<option value="${esc(nb.id)}"${t.nb === nb.id ? " selected" : ""}>${esc(nb.name)}</option>`).join("")}</select></label>
      <label class="tv-row"><span>${ic("video")}Etapa</span><select class="field" data-tvdef="stage"><option value="">Sem etapa</option>${STAGES.map((s) => `<option value="${s.k}"${t.stage === s.k ? " selected" : ""}>${s.label}</option>`).join("")}</select></label>
      <div class="tv-row tv-tags"><span>${ic("tag")}Etiquetas</span><div class="tv-tagbox">${(t.tags || []).map((g) => `<span class="ttag">${esc(g)}<button data-tvrmtag="${esc(g)}" aria-label="Remover ${esc(g)}">${ic("x")}</button></span>`).join("")}<input id="tvTagIn" list="tvTagList" placeholder="${(t.tags || []).length ? "Mais uma…" : "Adicionar etiqueta"}" autocomplete="off" spellcheck="false"><datalist id="tvTagList">${allTags().map(([g]) => `<option value="${esc(g)}">`).join("")}</datalist></div></div>
    </div>
    <div class="tv-prev"><div class="tv-page"><div class="tpl-title">Título</div><div class="doc tpl-doc">${t.html || '<p data-ph="Modelo vazio. Clique em Editar para montar."><br></p>'}</div></div></div>
  </div>`;
}
function paintTvSide() {
  const v = $("#tplView"); if (!v) return;
  v.classList.toggle("has-side", !!TV.sel);
  $$(".tpl[data-tv]", v).forEach((c) => c.classList.toggle("on", c.dataset.tv === TV.sel));
  const side = $("#tvSide"); if (TV.sel) side.innerHTML = tvSideHTML(getTpl(TV.sel));
}
function tvSelect(id) { TV.sel = TV.sel === id ? null : id; paintTvSide(); }
function newTemplate() {
  const t = { id: uid("tp_"), name: "Novo modelo", title: "", html: "", stage: "", tags: [], nb: "", desc: "", created: Date.now() };
  S.prefs.templates = [...myTemplates(), t]; savePrefs();
  TV.sel = t.id; startTplEdit(t.id, true);
}
function dupTemplate(id) {
  const b = getTpl(id); if (!b) return;
  const t = { id: uid("tp_"), name: b.name + " (cópia)", title: "", html: b.html, stage: b.stage || "", tags: [...(b.tags || [])], nb: b.nb || "", desc: b.desc || "", created: Date.now() };
  S.prefs.templates = [...myTemplates(), t]; savePrefs();
  TV.sel = t.id; startTplEdit(t.id);
  toast("Cópia criada. Agora ela é sua para mudar");
}
async function renameTemplate(id) {
  const t = myTemplates().find((x) => x.id === id); if (!t) return;
  const v = await ask({ title: "Renomear modelo", input: "Nome", value: t.name, ok: "Salvar", icon: "template" });
  if (v) { t.name = v; savePrefs(); renderTplView(); renderSidebar(); }
}
async function deleteTemplate(id) {
  const t = myTemplates().find((x) => x.id === id); if (!t) return;
  if (!(await ask({ title: `Excluir “${t.name}”?`, text: "As notas criadas com este modelo continuam iguais.", ok: "Excluir", danger: true, icon: "trash" }))) return;
  const card = $(`#tplView .tpl[data-tv="${id}"]`);
  const go = () => { S.prefs.templates = myTemplates().filter((x) => x.id !== id); savePrefs(); if (TV.sel === id) TV.sel = null; renderTplView(); renderSidebar(); toast("Modelo excluído"); };
  if (card && !document.documentElement.classList.contains("no-anim")) { card.classList.add("tpl-out"); setTimeout(go, 260); } else go();
}
function useTemplate(id) {
  const t = getTpl(id); if (!t) return;
  endTplEdit(true);
  noteFromTemplate(t);
}

/* editar um modelo no editor de notas (nota temporária que nunca vai para a lista) */
function startTplEdit(id, isNew) {
  const t = myTemplates().find((x) => x.id === id); if (!t) return;
  endTplEdit(true);
  const nid = "tpled_" + t.id;
  const n = { id: nid, tplEdit: t.id, nb: S.nbs.has(t.nb) ? t.nb : defaultNb(), title: isNew ? "" : t.name, html: t.html || "", text: htmlText(t.html || ""), tags: [...(t.tags || [])], prio: t.prio || 0, stage: t.stage || "", reminder: null, reminderDone: false, fav: false, trashed: false, created: t.created || Date.now(), updated: Date.now() };
  S.notes.set(nid, n);
  TPLED = { id: nid, tpl: t.id, prevActive: S.active };
  S.active = nid;
  if (S.sel.type !== "tpl") { S.sel = { type: "tpl" }; renderSidebar(); renderList(); }
  $("#app").classList.add("tpledit");
  renderPane({ focusTitle: isNew });
  if (!isNew) setTimeout(() => ED && ED.doc.focus({ preventScroll: true }), 60);
}
let tplSyncT = 0;
function syncTpl(n) {
  const t = myTemplates().find((x) => x.id === n.tplEdit); if (!t) return;
  t.html = ED && ED.id === n.id ? ED.doc.innerHTML : n.html;
  t.name = (n.title || "").trim() || "Modelo sem nome";
  t.tags = [...(n.tags || [])]; t.stage = n.stage || ""; t.prio = n.prio || 0;
  clearTimeout(tplSyncT); tplSyncT = setTimeout(() => savePrefs(), 400);
}
function endTplEdit(silent) {
  if (!TPLED) return;
  const n = S.notes.get(TPLED.id);
  if (n) syncTpl(n);
  clearTimeout(tplSyncT); savePrefs();
  S.notes.delete(TPLED.id);
  const prev = TPLED.prevActive; TPLED = null;
  S.active = prev && S.notes.has(prev) ? prev : null;
  $("#app").classList.remove("tpledit");
  renderPane(); renderTabs();
  if (S.sel.type === "tpl") renderTplView();
  renderSidebar();
  if (!silent) toast("Modelo salvo");
}

/* ---------- menu do botão direito com submenus ---------- */
let subEl = null, subFor = null, subTimer = 0;
function closeSub() { clearTimeout(subTimer); if (!subEl) return; const s = subEl; subEl = null; subFor?.classList.remove("open"); subFor = null; s.classList.add("closing"); setTimeout(() => s.remove(), 140); }
function openSub(item, spec) {
  if (subFor === item) return;
  closeSub();
  subFor = item; item.classList.add("open");
  const s = document.createElement("div"); s.className = "pop pop-sub";
  s.addEventListener("mousedown", (e) => { if (!e.target.closest("input,textarea,select,label")) e.preventDefault(); });
  document.body.appendChild(s); subEl = s;
  const draw = () => { s.innerHTML = spec.render ? spec.render() : menuItemsHTML(spec.items); };
  draw();
  const place = () => {
    const r = item.getBoundingClientRect(), pr = popEl ? popEl.getBoundingClientRect() : r;
    let left = pr.right + 4;
    if (left + s.offsetWidth > innerWidth - 8) { left = pr.left - s.offsetWidth - 4; s.style.transformOrigin = "top right"; s.classList.add("left"); }
    let top = r.top - 7; if (top + s.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - 8 - s.offsetHeight);
    s.style.left = Math.max(8, left) + "px"; s.style.top = top + "px";
  };
  place();
  s.onclick = (e) => {
    if (spec.click) return spec.click(e, { redraw: () => { draw(); }, close: closePop });
    const b = e.target.closest("[data-mi]"); if (!b) return;
    const it = spec.items[+b.dataset.mi]; if (!it || it.disabled) return;
    if (!it.keep) closePop();
    it.run && it.run();
  };
  spec.after && spec.after(s, { redraw: draw, close: closePop });
}
function menuItemsHTML(items) {
  return items.map((it, i) => it === "-" ? "<hr>" : it.h ? `<div class="pop-h">${esc(it.h)}</div>` :
    `<button class="mi${it.danger ? " danger" : ""}${it.sub ? " has-sub" : ""}${it.disabled ? " off" : ""}" data-mi="${i}"${it.style ? ` style="${it.style}"` : ""}>${it.iconHTML || (it.icon ? ic(it.icon) : "")}<span class="mi-l">${it.html || esc(it.label)}</span>${it.hint ? `<span class="k">${esc(it.hint)}</span>` : ""}${it.checked ? ic("check", "ck") : ""}${it.sub ? ic("chev-r", "sub-arrow") : ""}</button>`).join("");
}
function ctxMenu(e, items, cls) {
  const fake = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) };
  const p = popover(fake, menuItemsHTML(items));
  p.classList.add("ctx-menu"); if (cls) p.classList.add(cls);
  p.addEventListener("mouseover", (ev) => {
    const b = ev.target.closest("[data-mi]"); if (!b) return;
    const it = items[+b.dataset.mi];
    clearTimeout(subTimer);
    if (it && it.sub) subTimer = setTimeout(() => openSub(b, it.sub()), subFor ? 60 : 110);
    else if (subEl) subTimer = setTimeout(closeSub, 160);
  });
  p.onclick = (ev) => {
    const b = ev.target.closest("[data-mi]"); if (!b) return;
    const it = items[+b.dataset.mi]; if (!it || it.disabled) return;
    if (it.sub) { clearTimeout(subTimer); openSub(b, it.sub()); return; }
    if (!it.keep) closePop();
    it.run && it.run();
  };
  return p;
}
/* brilho rápido nos cartões que mudaram */
function bumpCards(ids) {
  requestAnimationFrame(() => ids.forEach((id) => { const c = $(`.card[data-note="${id}"]`); if (c) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); } }));
}
function afterCtx(ids) {
  renderList(false, true); renderSidebar();
  if (ED && ids.includes(ED.id)) renderFoot();
  bumpCards(ids);
}
const reminderOpts = () => {
  const at = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.getTime(); };
  const now = new Date(), o = [];
  if (now.getHours() < 17) o.push(["Hoje às 18:00", at(0, 18)]);
  o.push(["Amanhã às 09:00", at(1, 9)]);
  const mon = (8 - now.getDay()) % 7 || 7; o.push(["Segunda-feira às 09:00", at(mon, 9)]);
  return o;
};
function setReminder(ids, t) {
  ids.forEach((id) => { const n = S.notes.get(id); if (!n) return; n.reminder = t; n.reminderDone = false; n.updated = Date.now(); markNote(id); });
  afterCtx(ids);
  toast(t ? `Lembrete para ${fmtDate(t, true)}${ids.length > 1 ? ` em ${plural(ids.length, "nota", "notas")}` : ""}` : "Lembrete removido");
}
function noteCtx(e, card) {
  const id = card.dataset.note, n = S.notes.get(id); if (!n) return;
  const many = S.picked.has(id) && S.picked.size > 1;
  const ids = many ? [...S.picked].filter((x) => S.notes.has(x)) : [id];
  const notes = ids.map((x) => S.notes.get(x));
  if (n.trashed) {
    if (many) return ctxMenu(e, [{ h: plural(ids.length, "nota", "notas") }, { icon: "restore", label: "Restaurar", run: bulkRestore }, { icon: "trash", label: "Excluir para sempre", danger: true, run: bulkPurge }]);
    return ctxMenu(e, [{ icon: "restore", label: "Restaurar", run: () => restoreNote(id) }, { icon: "trash", label: "Excluir para sempre", danger: true, run: () => purgeNote(id) }]);
  }
  card.classList.add("ctx");
  const same = (f) => notes.every((x) => f(x) === f(notes[0])) ? f(notes[0]) : undefined;
  const prio = same((x) => x.prio || 0), stage = same((x) => x.stage || ""), allFav = notes.every((x) => x.fav);
  const hasRem = notes.some((x) => x.reminder);

  const prioSub = () => ({ items: [{ h: "Prioridade" }, ...[3, 2, 1, 0].map((p) => ({ iconHTML: p ? `<svg class="i" style="color:var(--p${p})"><use href="#i-flag"/></svg>` : ic("flag"), label: PRIO[p], checked: prio === p, run: () => { ids.forEach((x) => { const m = S.notes.get(x); if ((m.prio || 0) !== p) { m.prio = p; m.updated = Date.now(); markNote(x); } }); afterCtx(ids); } }))] });
  const stageSub = () => ({ items: [{ h: "Etapa do vídeo" }, ...STAGES.map((s, j) => ({ iconHTML: `<span class="mi-dot" style="--sc:${s.c}">${stageDot(s)}</span>`, label: s.label, hint: String(j + 1), checked: stage === s.k, run: () => { setStage(ids, s.k); afterCtx(ids); if (s.k === "postado") celebrate(card); } })), "-", { icon: "x", label: "Sem etapa", run: () => { setStage(ids, ""); afterCtx(ids); } }] });
  const tagSub = () => ({
    render: () => {
      const tags = allTags();
      return `<div class="pop-h">Etiquetas${many ? ` · ${plural(ids.length, "nota", "notas")}` : ""}</div>
        <div class="tagsub">${tags.length ? tags.map(([g]) => { const c = notes.filter((x) => (x.tags || []).includes(g)).length; return `<button class="mi tg-mi" data-tg="${esc(g)}"><span class="cbx${c === notes.length ? " on" : c ? " some" : ""}">${ic("check")}</span><span class="mi-l">${esc(g)}</span></button>`; }).join("") : `<div class="tg-empty">Nenhuma etiqueta ainda</div>`}</div>
        <hr><label class="tg-new">${ic("plus")}<input id="tgNew" placeholder="Nova etiqueta…" autocomplete="off" spellcheck="false"></label>`;
    },
    click: (ev, ctl) => {
      const b = ev.target.closest("[data-tg]"); if (!b) return;
      const g = b.dataset.tg, all = notes.every((x) => (x.tags || []).includes(g));
      notes.forEach((x) => { x.tags = x.tags || []; if (all) x.tags = x.tags.filter((y) => y !== g); else if (!x.tags.includes(g)) x.tags.push(g); x.updated = Date.now(); markNote(x.id); });
      const cb = b.querySelector(".cbx"); cb.classList.toggle("on", !all); cb.classList.remove("some");
      afterCtx(ids);
    },
    after: (s, ctl) => {
      s.addEventListener("keydown", (ev) => {
        if (ev.target.id !== "tgNew" || ev.key !== "Enter") return;
        ev.preventDefault();
        const g = ev.target.value.replace(/^#/, "").trim().slice(0, 40); if (!g) return;
        notes.forEach((x) => { x.tags = x.tags || []; if (!x.tags.some((y) => y.toLowerCase() === g.toLowerCase())) { x.tags.push(g); x.updated = Date.now(); markNote(x.id); } });
        afterCtx(ids); ctl.redraw();
        const inp = $("#tgNew", s); inp && inp.focus();
        const row = s.querySelector(`[data-tg="${CSS.escape(g)}"]`); row?.classList.add("fresh"); row?.scrollIntoView({ block: "nearest" });
      });
    }
  });
  const remSub = () => ({ items: [{ h: "Lembrete" }, ...reminderOpts().map(([l, t]) => ({ icon: "clock", label: l, run: () => setReminder(ids, t) })), "-",
    { icon: "calendar", label: "Escolher data e hora…", run: () => reminderPop(card, ids) },
    ...(hasRem ? [{ icon: "x", label: many ? "Remover lembretes" : "Remover lembrete", danger: true, run: () => setReminder(ids, null) }] : [])] });
  const tplSub = () => ({ items: [{ h: "Modelo" }, { icon: "template", label: "Aplicar modelo…", run: () => templatePicker("apply", id) }, { icon: "edit", label: "Salvar como modelo…", run: () => saveAsTemplate(id) }] });
  const moveSub = () => ({ items: [{ h: many ? `Mover ${plural(ids.length, "nota", "notas")}` : "Mover para o caderno" }, ...sortedNbs([...S.nbs.values()]).map((nb) => ({ icon: "book", label: nb.name, checked: !many && nb.id === n.nb, run: () => (many ? bulkMove(nb.id) : moveNote(id, nb.id)) })), "-", { icon: "plus", label: "Novo caderno…", run: async () => { const nb = await newNotebook(true); if (nb) many ? bulkMove(nb.id) : moveNote(id, nb.id); } }] });

  const items = [
    ...(many ? [{ h: plural(ids.length, "nota selecionada", "notas selecionadas") }] : [{ icon: "open", label: "Abrir em nova aba", run: () => openNote(id, { newTab: true }) }]),
    { icon: "star", label: allFav ? "Tirar das favoritas" : "Favoritar", run: () => { notes.forEach((x) => { x.fav = !allFav; markNote(x.id); }); afterCtx(ids); if (S.active && ids.includes(S.active)) renderPane({ keepScroll: $("#edScroll")?.scrollTop }); } },
    "-",
    { icon: "flag", label: "Prioridade", sub: prioSub },
    { icon: "video", label: "Etapa", sub: stageSub },
    { icon: "tag", label: "Etiquetas", sub: tagSub },
    { icon: "bell", label: "Lembrete", sub: remSub },
    ...(many ? [] : [{ icon: "template", label: "Modelo", sub: tplSub }]),
    "-",
    { icon: "book", label: "Mover para", sub: moveSub },
    ...(many ? [] : [{ icon: "dup", label: "Duplicar", run: () => duplicateNote(id) }]),
    "-",
    { icon: "trash", label: "Mover para a lixeira", danger: true, run: () => (many ? bulkTrash() : trashNote(id)) }
  ];
  const p = ctxMenu(e, items);
  new MutationObserver((_, o) => { if (!p.isConnected) { card.classList.remove("ctx"); o.disconnect(); } }).observe(document.body, { childList: true });
}
/* aplica um modelo numa nota qualquer: vazia recebe o modelo inteiro, com texto recebe no final */
function applyTemplateTo(id, t) {
  const n = S.notes.get(id); if (!n || n.trashed) return;
  if (ED && ED.id === id) {
    const empty = !(ED.doc.innerText || "").trim() && !ED.doc.querySelector("img,.audio-block,table,hr");
    if (empty) return applyTemplate(t);
    ED.doc.insertAdjacentHTML("beforeend", t.html);
    mergeTplMeta(n, t); onDocChange(); renderFoot(); renderList(); renderSidebar();
    $("#edScroll")?.scrollTo({ top: 1e6, behavior: "smooth" });
    return toast(`Modelo “${t.name}” adicionado no final da nota`);
  }
  const empty = !(n.text || "").trim() && !/<img|audio-block/.test(n.html || "");
  n.html = empty ? t.html : (n.html || "") + t.html;
  n.text = htmlText(n.html); mergeTplMeta(n, t); n.updated = Date.now(); markNote(id);
  afterCtx([id]);
  toast(empty ? `Modelo “${t.name}” aplicado` : `Modelo “${t.name}” adicionado no final`, { label: "Abrir", run: () => openNote(id) });
}
function mergeTplMeta(n, t) {
  if (t.stage && !n.stage) n.stage = t.stage;
  if (t.tags && t.tags.length) n.tags = [...new Set([...(n.tags || []), ...t.tags])];
}

/* =========================================================
   Salvamento automático
   ========================================================= */
const dirty = new Set(), deleted = new Set();
let saveTimer = null, nbDirty = false, saving = 0;
function setSave(state) {
  const dot = $("#saveDot"), txt = $("#saveText");
  dot.className = "save-dot" + (state === "busy" ? " busy" : state === "err" ? " err" : "");
  txt.textContent = state === "busy" ? "Salvando…" : state === "err" ? "Erro ao salvar" : "Tudo salvo";
  const pill = $("#edStatus");
  if (pill) pill.innerHTML = state === "busy" ? "Salvando…" : state === "err" ? "Erro ao salvar" : ic("check") + "Salvo";
}
function markNote(id) { const n = S.notes.get(id); if (n && n.tplEdit) { syncTpl(n); return; } dirty.add(id); queueSave(); }
function markNotebooks() { nbDirty = true; queueSave(); }
function queueSave() { setSave("busy"); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 450); }
async function flushSave() {
  const ids = [...dirty]; dirty.clear();
  const dels = [...deleted]; deleted.clear();
  const nb = nbDirty; nbDirty = false;
  saving++;
  try {
    await Promise.all([
      ...ids.map((id) => { const n = S.notes.get(id); return n ? api.saveNote(n) : null; }),
      ...dels.map((id) => api.deleteNote(id)),
      nb ? api.saveNotebooks([...S.nbs.values()]) : null
    ]);
    saving--; if (!dirty.size && !saving) setSave("ok");
  } catch (e) {
    saving--; console.error(e); ids.forEach((id) => dirty.add(id)); if (nb) nbDirty = true; setSave("err");
    clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 3000);
  }
}
function sessionData() {
  return { tabs: S.tabs, active: S.active, sel: S.sel, sort: S.sort, nbSort: S.nbSort, filter: S.filter, expanded: S.expanded, closed: S.closed, scroll: S.scroll };
}
const saveSession = debounce(() => api.saveSession(sessionData()), 700);
const savePrefs = () => api.savePrefs(S.prefs);
window.addEventListener("beforeunload", () => {
  if (S.restoring) return;
  if (TPLED) { const n = S.notes.get(TPLED.id); if (n) syncTpl(n); savePrefs(); }
  rememberScroll();
  api.flush({ notes: [...dirty].map((id) => S.notes.get(id)).filter(Boolean), deleted: [...deleted], notebooks: nbDirty ? [...S.nbs.values()] : null, session: sessionData() });
});

/* =========================================================
   Consultas
   ========================================================= */
const live = () => [...S.notes.values()].filter((n) => !n.trashed && !n.tplEdit);
const nbName = (id) => S.nbs.get(id)?.name || "Sem caderno";
const titleOf = (n) => (n.title || "").trim() || "Sem título";
function allTags() {
  const m = new Map();
  live().forEach((n) => (n.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
}
function nbUpdated(id) { let u = S.nbs.get(id)?.created || 0; S.notes.forEach((n) => { if (n.nb === id && !n.trashed && n.updated > u) u = n.updated; }); return u; }
function sortedNbs(list) {
  const { by, dir } = S.nbSort, k = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => by === "name" ? k * a.name.localeCompare(b.name, "pt-BR") : by === "created" ? k * ((a.created || 0) - (b.created || 0)) : k * (nbUpdated(a.id) - nbUpdated(b.id)));
}
function inScope(n) {
  const s = S.sel;
  if (n.tplEdit) return false;
  if (s.type === "trash") return !!n.trashed;
  if (n.trashed) return false;
  if (S.q) return true;
  if (s.type === "nb") return n.nb === s.id;
  if (s.type === "stack") return (S.nbs.get(n.nb)?.stack || "") === s.id;
  if (s.type === "fav") return !!n.fav;
  if (s.type === "tag") return (n.tags || []).includes(s.id);
  if (s.type === "rem") return !!n.reminder;
  if (s.type === "stage") return (n.stage || "") === s.id;
  return true;
}
function passFilter(n) {
  const f = S.filter;
  if (f.tags.length && !f.tags.every((t) => (n.tags || []).includes(t))) return false;
  if (f.prio.length && !f.prio.includes(n.prio || 0)) return false;
  if (f.stage && f.stage.length && !f.stage.includes(n.stage || "")) return false;
  if (f.fav && !n.fav) return false;
  if (f.reminder && !n.reminder) return false;
  if (f.img && !/<img/i.test(n.html || "")) return false;
  if (f.link && !/<a\s/i.test(n.html || "")) return false;
  if (f.created !== "any") {
    const now = Date.now(), c = n.created || 0;
    if (f.created === "today" && c < dayStart(new Date())) return false;
    if (f.created === "7" && c < now - 7 * 864e5) return false;
    if (f.created === "30" && c < now - 30 * 864e5) return false;
    if (f.created === "custom") {
      if (f.from && c < new Date(f.from + "T00:00").getTime()) return false;
      if (f.to && c > new Date(f.to + "T23:59:59").getTime()) return false;
    }
  }
  return true;
}
function matchQ(n) {
  if (!S.q) return true;
  const words = norm(S.q).split(/\s+/).filter(Boolean);
  const hay = norm([n.title, n.text, (n.tags || []).join(" "), nbName(n.nb)].join("\n"));
  return words.every((w) => hay.includes(w));
}
const ordOf = (n) => (typeof n.order === "number" ? n.order : -(n.created || 0));
function visibleNotes() {
  const arr = [...S.notes.values()].filter((n) => inScope(n) && passFilter(n) && matchQ(n));
  const { by, dir } = S.sel.type === "rem" && !S.q ? { by: "reminder", dir: "asc" } : S.sort;
  const k = dir === "asc" ? 1 : -1;
  const f = {
    title: (a, b) => titleOf(a).localeCompare(titleOf(b), "pt-BR", { numeric: true }),
    created: (a, b) => (a.created || 0) - (b.created || 0),
    updated: (a, b) => (a.updated || 0) - (b.updated || 0),
    priority: (a, b) => (a.prio || 0) - (b.prio || 0) || (a.updated || 0) - (b.updated || 0),
    manual: (a, b) => ordOf(a) - ordOf(b),
    reminder: (a, b) => (a.reminder || 0) - (b.reminder || 0)
  }[by];
  return arr.sort((a, b) => k * f(a, b));
}
function hl(text) {
  if (!S.q) return esc(text);
  const words = norm(S.q).split(/\s+/).filter(Boolean);
  const n = norm(text);
  const marks = [];
  words.forEach((w) => { let i = n.indexOf(w); while (i >= 0) { marks.push([i, i + w.length]); i = n.indexOf(w, i + w.length); } });
  if (!marks.length) return esc(text);
  marks.sort((a, b) => a[0] - b[0]);
  let out = "", p = 0;
  marks.forEach(([a, b]) => { if (a < p) return; out += esc(text.slice(p, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>"; p = b; });
  return out + esc(text.slice(p));
}
function snippet(n) {
  const b = (n.text || "").replace(/\s+/g, " ").trim();
  if (S.q) { const w = norm(S.q).split(/\s+/)[0]; const i = norm(b).indexOf(w); if (i > 50) return "…" + b.slice(i - 36, i + 140); }
  return b.slice(0, 180);
}
const firstImg = (n) => { const m = /<img[^>]+src="([^"]+)"/i.exec(n.html || ""); return m ? m[1] : null; };

/* =========================================================
   Barra lateral
   ========================================================= */
function renderSidebar() {
  const L = live(), s = S.sel;
  const cnt = {}; L.forEach((n) => (cnt[n.nb] = (cnt[n.nb] || 0) + 1));
  const on = (t, id) => (!S.q && s.type === t && (id === undefined || s.id === id) ? " on" : "");
  const rems = L.filter((n) => n.reminder).length;
  const trashN = [...S.notes.values()].filter((n) => n.trashed).length;
  let h = `
    <button class="nv${on("all")}" data-sel="all">${ic("notes")}<span class="lbl">Todas as notas</span><span class="cnt">${L.length}</span></button>
    <button class="nv${on("fav")}" data-sel="fav">${ic("star")}<span class="lbl">Favoritas</span><span class="cnt">${L.filter((n) => n.fav).length || ""}</span></button>
    <button class="nv${on("rem")}" data-sel="rem">${ic("bell")}<span class="lbl">Lembretes</span><span class="cnt">${rems || ""}</span></button>
    <button class="nv${on("tpl")}" data-sel="tpl">${ic("template")}<span class="lbl">Modelos</span><span class="cnt">${tplCount()}</span></button>`;

  /* cadernos */
  const closedNb = S.closed["sec-nb"];
  h += `<div class="sec${closedNb ? " closed" : ""}"><button class="tg" data-sec="sec-nb">${ic("chev-d")}Cadernos</button><button class="ib" id="secNewNb" title="Novo caderno" aria-label="Novo caderno">${ic("plus")}</button></div>`;
  h += `<div class="sec-body"${closedNb ? " hidden" : ""}>`;
  const nbs = sortedNbs([...S.nbs.values()]);
  const stacks = {}, loose = [];
  nbs.forEach((nb) => (nb.stack ? (stacks[nb.stack] = stacks[nb.stack] || []).push(nb) : loose.push(nb)));
  const row = (nb) => `<div class="nv${on("nb", nb.id)}" role="button" tabindex="0" data-sel="nb" data-id="${nb.id}" data-drop="${nb.id}">${ic("book")}<span class="lbl">${esc(nb.name)}</span><span class="cnt">${cnt[nb.id] || 0}</span><button class="more" data-nbmenu="${nb.id}" aria-label="Opções do caderno">${ic("more")}</button></div>`;
  Object.keys(stacks).sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((st) => {
    const c = S.closed["st-" + st];
    const total = stacks[st].reduce((a, nb) => a + (cnt[nb.id] || 0), 0);
    h += `<button class="stack-h${c ? " closed" : ""}${on("stack", st) ? " on" : ""}" data-stack="${esc(st)}">${ic("chev-d", "chev")}${ic("stack")}<span class="lbl">${esc(st)}</span><span class="cnt">${total}</span></button>
      <div class="stack-b"${c ? " hidden" : ""}>${stacks[st].map(row).join("")}</div>`;
  });
  h += loose.map(row).join("");
  if (!nbs.length) h += `<div class="side-empty">Nenhum caderno ainda.</div>`;
  h += `</div>`;

  /* etiquetas */
  const tags = allTags();
  const closedTg = S.closed["sec-tag"];
  h += `<div class="sec${closedTg ? " closed" : ""}"><button class="tg" data-sec="sec-tag">${ic("chev-d")}Etiquetas</button></div>`;
  h += `<div class="sec-body"${closedTg ? " hidden" : ""}>`;
  h += tags.length ? tags.map(([t, c]) => `<div class="nv${on("tag", t)}" role="button" tabindex="0" data-sel="tag" data-id="${esc(t)}">${ic("tag")}<span class="lbl">${esc(t)}</span><span class="cnt">${c}</span><button class="more" data-tagmenu="${esc(t)}" aria-label="Opções da etiqueta">${ic("more")}</button></div>`).join("")
    : `<div class="side-empty">Adicione etiquetas no rodapé de uma nota.</div>`;
  h += `</div>`;

  /* etapas do vídeo */
  const scnt = {}; L.forEach((n) => n.stage && (scnt[n.stage] = (scnt[n.stage] || 0) + 1));
  if (Object.keys(scnt).length || s.type === "stage") {
    const closedSt = S.closed["sec-stage"];
    h += `<div class="sec${closedSt ? " closed" : ""}"><button class="tg" data-sec="sec-stage">${ic("chev-d")}Etapas</button></div>`;
    h += `<div class="sec-body"${closedSt ? " hidden" : ""}>` + STAGES.map((st) => `<div class="nv nv-stage${on("stage", st.k)}${scnt[st.k] ? "" : " zero"}" role="button" tabindex="0" data-sel="stage" data-id="${st.k}" data-drop="stage:${st.k}" style="--sc:${st.c}">${stageDot(st)}<span class="lbl">${st.label}</span><span class="cnt">${scnt[st.k] || ""}</span></div>`).join("") + `</div>`;
  }

  h += `<div class="sec"><span class="tg" style="cursor:default">Outros</span></div>
    <button class="nv${on("trash")}" data-sel="trash" data-drop="trash">${ic("trash")}<span class="lbl">Lixeira</span><span class="cnt">${trashN || ""}</span></button>`;
  $("#sideNav").innerHTML = h;
}

/* =========================================================
   Lista de notas
   ========================================================= */
let lastScopeKey = "";
function scopeTitle() {
  const s = S.sel;
  if (S.q) return "Resultados";
  return { all: "Notas", fav: "Favoritas", rem: "Lembretes", trash: "Lixeira" }[s.type] || (s.type === "nb" ? nbName(s.id) : s.type === "tag" ? "#" + s.id : s.type === "stage" ? (stageOf(s.id)?.label || "Etapa") : s.type === "tpl" ? "Modelos" : s.id);
}
function renderList(animate, noAnim) {
  const tm = S.sel.type === "tpl" && !S.q;
  $("#app").classList.toggle("tplmode", tm);
  if (tm) { renderTplView(); return; }
  const arr = visibleNotes();
  $("#listTitle").textContent = scopeTitle();
  $("#listCount").textContent = arr.length;
  const sortLbl = { updated: "Atualizadas", created: "Criadas", title: "Título", priority: "Prioridade", manual: "Ordem manual" }[S.sort.by];
  const s = S.sel;
  $("#listSub").textContent = S.q ? `Pesquisando “${S.q}” em todos os cadernos` : s.type === "nb" && S.nbs.get(s.id)?.stack ? `Pilha ${S.nbs.get(s.id).stack} · ${sortLbl}` : s.type === "rem" ? "Por data do lembrete" : `Ordenado por: ${sortLbl.toLowerCase()}`;
  $("#listNew").hidden = s.type === "trash";
  const fc = filterCount(); const b = $("#filterBadge"); b.hidden = !fc; b.textContent = fc;
  $("#listFilter").classList.toggle("on", fc > 0);
  renderChips();

  const box = $("#notes");
  const key = JSON.stringify([S.sel, S.q, S.filter, S.sort]);
  const anim = !noAnim && (animate || key !== lastScopeKey); lastScopeKey = key;
  if (!arr.length) {
    let e;
    if (S.q) e = ["search", "Nada encontrado", `Nenhuma nota corresponde a “${esc(S.q)}”.`];
    else if (fc) e = ["filter", "Nenhuma nota com esses filtros", `<button class="btn" data-act="clearfilters">Limpar filtros</button>`];
    else if (s.type === "trash") e = ["trash", "A lixeira está vazia", `Notas excluídas ficam aqui até você apagar de vez.${api.backupList ? `<br><button class="restore-link" data-act="restoremodal" style="margin-top:10px">${ic("restore")}Recuperar notas excluídas</button>` : ""}`];
    else if (s.type === "fav") e = ["star", "Nenhuma favorita", "Clique na estrela de uma nota para ela aparecer aqui."];
    else if (s.type === "stage") e = ["video", `Nenhuma nota em ${stageOf(s.id)?.label || "etapa"}`, "Mude a etapa no rodapé de uma nota ou arraste uma nota até aqui."];
    else if (s.type === "rem") e = ["bell", "Nenhum lembrete", "Use o sino no rodapé de uma nota para criar um lembrete."];
    else e = ["note-add", "Nenhuma nota aqui", `<button class="btn primary" data-act="new">${ic("plus")}Nova nota</button>`];
    box.innerHTML = `<div class="empty"><div class="em-ic">${ic(e[0])}</div><b>${e[1]}</b><span>${e[2]}</span></div>`;
    return;
  }
  let h = "";
  if (s.type === "trash" && !S.q) h += `<div class="trash-head"><span>Notas na lixeira</span><button class="btn ghost danger" data-act="emptytrash">${ic("trash")}Esvaziar lixeira</button></div>`;
  if (s.type === "trash" && !S.q && api.backupList) h += `<button class="restore-link" data-act="restoremodal">${ic("restore")}Recuperar notas excluídas nos últimos 14 dias</button>`;
  h += arr.map((n, i) => {
    const img = firstImg(n);
    const due = n.reminder && !n.reminderDone && n.reminder < Date.now();
    const meta = [
      `<span>${fmtDate(s.type === "rem" ? n.reminder : S.sort.by === "created" ? n.created : n.updated, s.type === "rem")}</span>`,
      s.type !== "nb" ? `<span class="nb">${esc(nbName(n.nb))}</span>` : "",
      n.stage && stageOf(n.stage) && s.type !== "stage" ? stagePill(stageOf(n.stage)) : "",
      n.prio ? `<span class="prio-f p${n.prio}">${ic("flag")}${PRIO[n.prio]}</span>` : "",
      n.reminder && s.type !== "rem" ? `<span class="rem${due ? " due" : ""}">${ic("bell")}${fmtDate(n.reminder, true)}</span>` : "",
      ...(n.tags || []).slice(0, 3).map((t) => `<span class="mini-tag">${hl(t)}</span>`)
    ].join("");
    return `<button class="card${n.id === S.active ? " on" : ""}${S.picked.has(n.id) ? " picked" : ""}" data-note="${n.id}" draggable="true" style="--i:${Math.min(i, 14)}"><span class="pick" data-pick="${n.id}" aria-hidden="true">${ic("check")}</span>
      <div class="card-main"><span class="t">${n.fav ? `<svg class="i fav"><use href="#i-star"/></svg>` : ""}<span>${hl(titleOf(n))}</span></span>
      <span class="s">${hl(snippet(n)) || '<i style="opacity:.6">Nota vazia</i>'}</span><span class="m">${meta}</span></div>
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : ""}</button>`;
  }).join("");
  box.innerHTML = h;
  $("#list").classList.toggle("picking", S.pickMode || S.picked.size > 0);
  renderBulk();
  box.classList.remove("enter");
  if (anim) { void box.offsetWidth; box.classList.add("enter"); }
}
const renderListSoon = debounce(() => { renderList(); renderSidebar(); }, 300);
function renderChips() {
  const f = S.filter, c = [];
  f.tags.forEach((t) => c.push([`#${t}`, () => (f.tags = f.tags.filter((x) => x !== t))]));
  f.prio.forEach((p) => c.push([`Prioridade ${PRIO[p].toLowerCase()}`, () => (f.prio = f.prio.filter((x) => x !== p))]));
  (f.stage || []).forEach((k) => c.push([`Etapa: ${stageOf(k)?.label || k}`, () => (f.stage = f.stage.filter((x) => x !== k))]));
  if (f.created !== "any") c.push([{ today: "Criadas hoje", 7: "Últimos 7 dias", 30: "Últimos 30 dias", custom: "Período personalizado" }[f.created], () => (f.created = "any")]);
  if (f.fav) c.push(["Favoritas", () => (f.fav = false)]);
  if (f.reminder) c.push(["Com lembrete", () => (f.reminder = false)]);
  if (f.img) c.push(["Com imagens", () => (f.img = false)]);
  if (f.link) c.push(["Com links", () => (f.link = false)]);
  const row = $("#activeChips");
  row.hidden = !c.length;
  row.innerHTML = c.map((x, i) => `<span class="chip">${esc(x[0])}<button data-chip="${i}" aria-label="Remover filtro">${ic("x")}</button></span>`).join("") + (c.length > 1 ? `<button class="chip clear" data-act="clearfilters">Limpar tudo</button>` : "");
  row._fns = c.map((x) => x[1]);
}

/* =========================================================
   Abas e histórico
   ========================================================= */
function renderTabs() {
  S.tabs = S.tabs.filter((id) => S.notes.has(id));
  $("#tabs").innerHTML = S.tabs.map((id) => {
    const n = S.notes.get(id);
    return `<div class="tab${id === S.active ? " on" : ""}" role="tab" tabindex="0" aria-selected="${id === S.active}" data-tab="${id}" title="${esc(titleOf(n))}">${ic("notes")}<span class="tl">${esc(titleOf(n))}</span><button class="x" data-close="${id}" aria-label="Fechar aba">${ic("x")}</button></div>`;
  }).join("");
  $("#navBack").disabled = S.histPos <= 0;
  $("#navFwd").disabled = S.histPos >= S.hist.length - 1;
  const t = $(".tab.on"); if (t) t.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function pushHist(id) {
  if (S.hist[S.histPos] === id) return;
  S.hist = S.hist.slice(0, S.histPos + 1); S.hist.push(id);
  if (S.hist.length > 60) S.hist.shift();
  S.histPos = S.hist.length - 1;
}
function goHist(d) {
  let p = S.histPos + d;
  while (p >= 0 && p < S.hist.length && !S.notes.has(S.hist[p])) p += d;
  if (p < 0 || p >= S.hist.length) return;
  S.histPos = p; openNote(S.hist[p], { noHist: true });
}

/* =========================================================
   Editor
   ========================================================= */
let ED = null; // { id, title, doc }
const FONTS = [
  ["fn-sans", "Sans Serif", "var(--ui)", /^(?!.*(lora|roboto slab|consolas|cascadia|dancing|caveat))/i],
  ["fn-serif", "Serif", "Lora, Georgia, serif", /lora|georgia/i],
  ["fn-slab", "Slab Serif", "'Roboto Slab', Rockwell, serif", /roboto slab|rockwell/i],
  ["fn-mono", "Monospace", "'Cascadia Code', Consolas, monospace", /cascadia|consolas|mono/i],
  ["fn-script", "Script", "'Dancing Script', cursive", /dancing/i],
  ["fn-hand", "Escrito à mão", "Caveat, 'Segoe Print', cursive", /caveat|segoe print/i]
];
const fontOf = (cssFamily) => FONTS.slice(1).find((f) => f[3].test(cssFamily)) || FONTS[0];
const SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 64];
const COLORS = ["#d4d4d8", "#a1a1aa", "#71717a", "#3f3f46", "#000000", "#8b5cf6", "#d946ef", "#ef4444", "#f97316", "#eab308", "#22c55e", "#5fd4e8", "#60a5fa", "#4f6ef7"];
const HILITES = ["#d4d4d866", "#a1a1aa66", "#71717a66", "#3f3f4666", "#00000033", "#8b5cf64d", "#d946ef4d", "#ef44444d", "#f973164d", "#eab30866", "#22c55e4d", "#5fd4e84d", "#60a5fa4d", "#4f6ef74d"];
const toHex = (rgb) => { const m = String(rgb).match(/\d+(\.\d+)?/g); if (!m) return ""; const [r, g, b, a] = m.map(Number); const h = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join(""); return a !== undefined && a < 1 ? h + Math.round(a * 255).toString(16).padStart(2, "0") : h; };
const BLOCKS = [["p", "Texto normal", ""], ["h1", "Título 1", "h1"], ["h2", "Título 2", "h2"], ["h3", "Título 3", "h3"], ["blockquote", "Citação", "q"], ["pre", "Bloco de código", "c"]];

function toolbarHTML() {
  const g = (pri, inner) => `<div class="tgroup" data-pri="${pri}">${inner}</div>`;
  const b = (cmd, icon, label, k) => `<button class="tb" data-cmd="${cmd}" title="${label}${k ? " (" + k + ")" : ""}" aria-label="${label}">${ic(icon)}</button>`;
  return `
    ${g(1, b("undo", "undo", "Desfazer", "Ctrl+Z") + b("redo", "redo", "Refazer", "Ctrl+Y"))}
    ${g(2, `<button class="tb sel" data-pop="block" title="Estilo do parágrafo"><span class="v" id="tbBlock">Texto normal</span>${ic("chev-d", "caret")}</button>`)}
    ${g(2, `<button class="tb sel" data-pop="font" title="Fonte"><span class="v" id="tbFont">Sans Serif</span>${ic("chev-d", "caret")}</button>`)}
    ${g(2, `<button class="tb sel w-size" data-pop="size" title="Tamanho da letra"><span class="v" id="tbSize">16</span>${ic("chev-d", "caret")}</button>`)}
    ${g(1, `<button class="tb" data-pop="color" title="Cor do texto" aria-label="Cor do texto"><span class="swatch">${ic("color")}<i id="tbColorBar"></i></span>${ic("chev-d", "caret")}</button><button class="tb" data-pop="hilite" title="Cor de destaque" aria-label="Cor de destaque">${ic("marker")}${ic("chev-d", "caret")}</button>`)}
    ${g(1, b("bold", "bold", "Negrito", "Ctrl+B") + b("italic", "italic", "Itálico", "Ctrl+I") + b("underline", "underline", "Sublinhado", "Ctrl+U") + b("strikeThrough", "strike", "Tachado"))}
    ${g(3, b("insertUnorderedList", "ul", "Lista com marcadores") + b("insertOrderedList", "ol", "Lista numerada") + b("checklist", "check-list", "Lista de tarefas", "Ctrl+Shift+L"))}
    ${g(1, `<button class="tb proof" data-cmd="proof" title="Corrigir texto (F7) · selecione um trecho ou corrija a nota inteira" aria-label="Corrigir texto">${ic("proof")}</button>`)}
    ${g(1, b("link", "link", "Inserir link", "Ctrl+Shift+K") + b("image", "image", "Inserir imagem") + b("mic", "mic", "Gravar áudio"))}
    ${g(4, `<button class="tb" data-pop="align" title="Alinhamento" aria-label="Alinhamento"><span id="tbAlign">${ic("al")}</span>${ic("chev-d", "caret")}</button>` + b("outdent", "outdent", "Diminuir recuo") + b("indent", "indent", "Aumentar recuo"))}
    ${g(5, b("hr", "hr", "Linha divisória") + b("datetime", "clock", "Inserir data e hora", "F5") + b("clear", "eraser", "Limpar formatação"))}
    <span class="spacer"></span>
    <button class="tb more-btn" id="tbMore" data-pop="more" hidden>Mais${ic("chev-d", "caret")}</button>`;
}

function renderPane(opts = {}) {
  const pane = $("#pane");
  const n = S.active && S.notes.get(S.active);
  if (!n) {
    ED = null;
    pane.innerHTML = `<div class="ed-top"><button class="ib" data-act="expand" title="Expandir nota" aria-label="Expandir">${ic(S.expanded ? "uncollapse" : "collapse")}</button></div>
      <div class="pane-empty"><div><div class="em-ic">${ic("notes")}</div><h2>Escolha uma nota ou crie uma nova</h2>
      <p>As notas abertas ficam em abas no topo, e tudo é salvo sozinho enquanto você digita.</p>
      <button class="btn primary" data-act="new" style="margin-top:6px">${ic("plus")}Nova nota</button>
      <div class="shortcuts"><kbd>Ctrl+N</kbd><span>Nova nota</span><kbd>Ctrl+K</kbd><span>Pesquisar</span><kbd>Ctrl+F</kbd><span>Localizar na nota</span><kbd>Ctrl+Shift+E</kbd><span>Expandir a nota</span><kbd>F11</kbd><span>Tela cheia (Esc para sair)</span></div></div></div>`;
    return;
  }
  const nb = S.nbs.get(n.nb);
  pane.innerHTML = `
    <div class="ed-top">
      <button class="ib mob-back" data-act="mobback" aria-label="Voltar para a lista">${ic("left")}</button>
      <button class="ib" data-act="expand" id="btnExpand" title="${S.expanded ? "Mostrar cadernos e lista" : "Expandir nota"} (Ctrl+Shift+E)" aria-label="Expandir nota">${ic(S.expanded ? "uncollapse" : "collapse")}</button>
      <button class="ib" data-act="fullscreen" id="btnFull" title="${S.fullscreen ? "Sair da tela cheia" : "Tela cheia"} (F11)" aria-label="Tela cheia">${ic(S.fullscreen ? "shrink" : "expand")}</button>
      ${n.tplEdit ? `<div class="crumb"><button data-act="tplback">${ic("template")}<span>Modelos</span></button>${ic("chev-r", "sep")}<span class="cur" id="crumbTitle">${esc(titleOf(n))}</span></div>` : `<div class="crumb">
        ${nb && nb.stack ? `<button data-crumb="stack">${ic("stack")}<span>${esc(nb.stack)}</span></button>${ic("chev-r", "sep")}` : ""}
        <button data-crumb="nb" title="Mover para outro caderno">${ic("book")}<span>${esc(nbName(n.nb))}</span></button>${ic("chev-r", "sep")}
        <span class="cur" id="crumbTitle">${esc(titleOf(n))}</span>
      </div>`}
      <span class="status-pill" id="edStatus">${ic("check")}Salvo</span>
      ${n.tplEdit ? "" : `<button class="ib star${n.fav ? " on" : ""}" data-act="fav" title="Favoritar" aria-label="Favoritar">${ic("star")}</button>
      <button class="ib" data-act="notemenu" title="Mais opções" aria-label="Mais opções">${ic("more")}</button>`}
    </div>
    ${n.tplEdit ? `<div class="tpl-banner">${ic("template")}<span><b>Editando modelo.</b> Tudo é salvo sozinho. O que estiver aqui aparece em cada nota nova criada com ele.</span><button class="btn primary" data-act="tpldone">${ic("check")}Concluir</button></div>` : ""}
    ${n.trashed ? `<div class="trash-banner">${ic("trash")}<span>Esta nota está na lixeira e não pode ser editada.</span><button class="btn" data-act="restore">${ic("restore")}Restaurar</button><button class="btn danger" data-act="purge">Excluir para sempre</button></div>` : `<div class="toolbar" id="toolbar">${toolbarHTML()}</div>`}
    <div class="ed-scroll" id="edScroll">
      <div class="ed-stamp" id="edStamp"></div>
      <div class="page">
        <textarea class="title-in" id="title" rows="1" placeholder="${n.tplEdit ? "Nome do modelo" : "Título"}" spellcheck="${S.prefs.spell}" ${n.trashed ? "readonly" : ""}></textarea>
        <div class="doc" id="doc" contenteditable="${!n.trashed}" spellcheck="${S.prefs.spell}" data-ph="Comece a escrever, ou cole links e imagens…"></div>
      </div>
    </div>
    <div class="ed-foot" id="edFoot"></div>`;
  const title = $("#title"), doc = $("#doc");
  title.value = n.title || "";
  stopAudio(); closeReview(true);
  doc.innerHTML = n.html || "";
  doc.querySelectorAll("[data-state]").forEach((x) => x.removeAttribute("data-state"));
  doc.querySelectorAll(".audio-block").forEach((x) => { x.contentEditable = "false"; });
  refreshNoteLinks(doc);
  doc.querySelectorAll("a.file-link").forEach((a) => { a.contentEditable = "false"; });
  if (!n.trashed) doc.insertAdjacentHTML("afterend", `<button class="blk-handle" id="blkHandle" draggable="true" title="Arraste para mover · Clique para opções" aria-label="Mover bloco">${ic("grip")}</button><div class="blk-drop" id="blkDrop"></div><div class="line-hint" id="lineHint">Digite <kbd>/</kbd> para comandos ou <kbd>@</kbd> para vincular uma nota</div>`);
  if (S.prefs.font) doc.style.fontFamily = S.prefs.font;
  doc.style.fontSize = `calc(${S.prefs.size || 16}px * var(--zoom))`;
  ED = { id: n.id, title, doc };
  updateStamp(false);
  doc.addEventListener("focus", () => {
    if (doc.contentEditable === "true" && !doc.firstElementChild && !doc.textContent.trim()) {
      doc.innerHTML = "<p><br></p>"; const r = document.createRange(); r.setStart(doc.firstChild, 0); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
    }
  });
  doc.addEventListener("blur", () => { if (!doc.textContent.trim() && !doc.querySelector("img,hr,li")) doc.innerHTML = ""; });
  autoGrow();
  renderFoot();
  layoutToolbar();
  updateToolbar();
  document.execCommand("defaultParagraphSeparator", false, "p");
  const sc = $("#edScroll");
  requestAnimationFrame(() => { sc.scrollTop = opts.keepScroll ? opts.keepScroll : S.scroll[n.id] || 0; });
  sc.addEventListener("scroll", debounce(() => { if (ED && ED.id === n.id) { S.scroll[n.id] = sc.scrollTop; saveSession(); } }, 300));
  if (S.q) setTimeout(() => highlightDoc(S.q), 30);
  if (opts.focusTitle) setTimeout(() => title.focus(), 40);
}
function rememberScroll() { const sc = $("#edScroll"); if (ED && sc) S.scroll[ED.id] = sc.scrollTop; }
function autoGrow() { if (!ED) return; const t = ED.title; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }

/* conteúdo alterado */
function stampText(n) {
  const d = new Date(n.updated || n.created || Date.now()), now = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = Math.round((dayStart(now) - dayStart(d)) / 864e5);
  const date = d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }).replace(/\./g, ".").replace(/ de (\w+)\.? ?/, " de $1. ").trim();
  if (n.trashed) return `Na lixeira · editado em ${date} às ${hm}`;
  return `Editado em ${date} às ${hm}`;
}
let stampFx = 0;
function updateStamp(flash) {
  const el = $("#edStamp"); if (!el || !ED) return;
  const n = S.notes.get(ED.id); if (!n) return;
  const txt = stampText(n);
  const full = (t) => new Date(t).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  el.title = `Editado: ${full(n.updated || n.created)}\nCriado: ${full(n.created)}`;
  if (el.textContent !== txt) el.innerHTML = `<span>${esc(txt)}</span>`;

}
function onDocChange() {
  if (!ED) return;
  const n = S.notes.get(ED.id); if (!n || n.trashed) return;
  normalizeSizes();
  cleanPlaceholders(ED.doc);
  n.html = ED.doc.innerHTML;
  n.text = docText().replace(/\u00a0/g, " ");
  n.updated = Date.now();
  markNote(n.id);
  updateWordCount();
  updateStamp(true);
  renderListSoon();
}
function onTitleChange() {
  const n = S.notes.get(ED.id); if (!n || n.trashed) return;
  n.title = ED.title.value.replace(/\n/g, " ");
  n.updated = Date.now();
  markNote(n.id);
  autoGrow();
  updateStamp(true);
  const t = titleOf(n);
  const ct = $("#crumbTitle"); if (ct) ct.textContent = t;
  const tb = $(`.tab[data-tab="${n.id}"] .tl`); if (tb) tb.textContent = t;
  renderListSoon();
}
function docText() {
  if (!ED) return "";
  const ab = ED.doc.querySelectorAll(".audio-block"); ab.forEach((b) => (b.hidden = true));
  const t = ED.doc.innerText || ""; ab.forEach((b) => (b.hidden = false)); return t;
}

/* ---------- seleção ---------- */
let savedRange = null;
function inDoc(node) { return ED && node && ED.doc.contains(node.nodeType === 3 ? node.parentNode : node); }
function saveSel() { const s = getSelection(); if (s.rangeCount && inDoc(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
function restoreSel() {
  if (!ED) return;
  ED.doc.focus({ preventScroll: true });
  const s = getSelection();
  if (savedRange && ED.doc.contains(savedRange.startContainer)) { s.removeAllRanges(); s.addRange(savedRange); }
  else if (!s.rangeCount || !inDoc(s.anchorNode)) { const r = document.createRange(); r.selectNodeContents(ED.doc); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
}
function selEl() { const s = getSelection(); if (!s.rangeCount) return null; let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; return inDoc(n) ? n : null; }

/* ---------- comandos ---------- */
const CSS_CMDS = new Set(["foreColor", "hiliteColor", "fontName", "fontSize"]);
function exec(cmd, val) {
  restoreSel();
  document.execCommand("styleWithCSS", false, CSS_CMDS.has(cmd));
  document.execCommand(cmd, false, val);
  saveSel(); onDocChange(); updateToolbar();
}
let pendingSize = null;
function setFontSize(px) {
  pendingSize = px;
  restoreSel();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand("fontSize", false, "7");
  normalizeSizes();
  saveSel(); onDocChange(); updateToolbar();
}
function normalizeSizes() {
  if (!ED) return;
  ED.doc.querySelectorAll('[style*="xxx-large"]').forEach((el) => { el.style.fontSize = (pendingSize || S.prefs.size || 16) + "px"; });
  ED.doc.querySelectorAll('font[size="7"]').forEach((f) => { const s = document.createElement("span"); s.style.fontSize = (pendingSize || 16) + "px"; s.innerHTML = f.innerHTML; f.replaceWith(s); });
}
function setColor(kind, color) {
  const cmd = kind === "color" ? "foreColor" : "hiliteColor";
  const sentinel = kind === "color" ? "rgb(1, 2, 3)" : "rgb(3, 2, 1)";
  if (color) { exec(cmd, color); return; }
  exec(cmd, sentinel);
  const prop = kind === "color" ? "color" : "backgroundColor";
  ED.doc.querySelectorAll("[style]").forEach((el) => { if (el.style[prop] === sentinel) el.style[prop] = ""; if (!el.getAttribute("style")) el.removeAttribute("style"); });
  onDocChange();
}
function setFont(key) {
  const f = FONTS.find((x) => x[0] === key); if (!f) return;
  exec("fontName", key);
  ED.doc.querySelectorAll("[style*='font-family']").forEach((el) => { if (el.style.fontFamily.replace(/["']/g, "") === key) el.style.fontFamily = key === "fn-sans" ? "" : f[2]; if (!el.getAttribute("style")) el.removeAttribute("style"); });
  ED.doc.querySelectorAll("font[face]").forEach((el) => { if (el.getAttribute("face") === key) { const sp = document.createElement("span"); if (key !== "fn-sans") sp.style.fontFamily = f[2]; sp.innerHTML = el.innerHTML; el.replaceWith(sp); } });
  onDocChange(); updateToolbar();
}
function listToggle(kind) {
  restoreSel();
  const sel = getSelection(); if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const tag = kind === "ol" ? "OL" : "UL";
  const matches = (l) => l.tagName === tag && (kind === "check") === l.classList.contains("check");
  const li = selEl()?.closest("li"), list = li?.closest("ul,ol");
  let caretTarget = null;
  if (list && ED.doc.contains(list)) {
    if (matches(list)) {
      const frag = document.createDocumentFragment();
      [...list.children].forEach((x) => { const p = document.createElement("p"); p.innerHTML = x.innerHTML || "<br>"; frag.appendChild(p); if (x === li) caretTarget = p; });
      list.replaceWith(frag);
    } else {
      const nl = document.createElement(tag); if (kind === "check") nl.className = "check";
      while (list.firstChild) nl.appendChild(list.firstChild);
      if (kind !== "check") nl.querySelectorAll("li").forEach((x) => x.removeAttribute("data-done"));
      list.replaceWith(nl); caretTarget = li;
    }
  } else {
    let blocks = [...ED.doc.children].filter((c) => range.intersectsNode(c) && /^(P|DIV|H1|H2|H3|BLOCKQUOTE)$/.test(c.tagName) && !c.classList.contains("audio-block") && !c.classList.contains("callout"));
    const inner = selEl()?.closest("p,div,h1,h2,h3,blockquote");
    if (!blocks.length && inner && inner !== ED.doc) blocks = [inner];
    const nl = document.createElement(tag); if (kind === "check") nl.className = "check";
    if (!blocks.length) { const x = document.createElement("li"); x.innerHTML = "<br>"; nl.appendChild(x); range.insertNode(nl); caretTarget = x; }
    else {
      blocks[0].before(nl);
      blocks.forEach((b) => { const x = document.createElement("li"); x.innerHTML = b.innerHTML.trim() ? b.innerHTML : "<br>"; nl.appendChild(x); b.remove(); caretTarget = x; });
    }
  }
  if (caretTarget) { const r = document.createRange(); r.selectNodeContents(caretTarget); r.collapse(false); if (caretTarget.lastChild && caretTarget.lastChild.nodeName === "BR") { r.setStartBefore(caretTarget.lastChild); r.collapse(true); } sel.removeAllRanges(); sel.addRange(r); }
  saveSel(); onDocChange(); updateToolbar();
}
function toggleChecklist() { listToggle("check"); }
function insertDateTime() {
  if (!ED || ED.doc.contentEditable !== "true") return;
  const d = new Date();
  exec("insertText", d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
}
function runCmd(cmd) {
  if (!ED) return;
  switch (cmd) {
    case "undo": case "redo": restoreSel(); document.execCommand(cmd); saveSel(); onDocChange(); updateToolbar(); break;
    case "checklist": toggleChecklist(); break;
    case "insertUnorderedList": listToggle("ul"); break;
    case "insertOrderedList": listToggle("ol"); break;
    case "link": openLinkEditor(); break;
    case "image": saveSel(); $("#imgInput").click(); break;
    case "hr": exec("insertHorizontalRule"); break;
    case "datetime": insertDateTime(); break;
    case "mic": startRecording(); break;
    case "proof": proofText(); break;
    case "clear": exec("removeFormat"); exec("formatBlock", "p"); break;
    default: exec(cmd);
  }
}

/* ---------- estado da barra ---------- */
function updateToolbar() {
  if (!ED || !$("#toolbar")) return;
  const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
  const el = selEl();
  $$("[data-cmd]").forEach((b) => {
    const c = b.dataset.cmd;
    if (["bold", "italic", "strikeThrough"].includes(c)) b.classList.toggle("on", !!el && q(c));
    if (c === "underline") b.classList.toggle("on", !!el && (el.closest("a") ? !!el.closest("u") : q(c)));
    if (c === "insertOrderedList") b.classList.toggle("on", !!el?.closest("ol"));
    if (c === "insertUnorderedList") b.classList.toggle("on", !!el?.closest("ul:not(.check)"));
    if (c === "checklist") b.classList.toggle("on", !!el?.closest("ul.check"));
    if (c === "link") b.classList.toggle("on", !!el?.closest("a"));
  });
  if (!el) return;
  const blk = el.closest("h1,h2,h3,blockquote,pre");
  const bl = BLOCKS.find((x) => x[0] === (blk ? blk.tagName.toLowerCase() : "p"));
  $$("#tbBlock").forEach((x) => (x.textContent = bl ? bl[1] : "Texto normal"));
  const cs = getComputedStyle(el);
  $$("#tbFont").forEach((x) => (x.textContent = fontOf(cs.fontFamily)[1]));
  const zoom = S.prefs.zoom || 1;
  $$("#tbSize").forEach((x) => (x.textContent = Math.round(parseFloat(cs.fontSize) / zoom)));
  $$("#tbColorBar").forEach((x) => (x.style.background = cs.color));
  const al = q("justifyCenter") ? "ac" : q("justifyRight") ? "ar" : q("justifyFull") ? "aj" : "al";
  $$("#tbAlign").forEach((x) => (x.innerHTML = ic(al)));
}

/* barra responsiva: grupos que não cabem vão para o menu "Mais" */
function layoutToolbar() {
  const tb = $("#toolbar"); if (!tb) return;
  const groups = $$(".tgroup", tb);
  groups.forEach((g) => (g.hidden = false));
  const more = $("#tbMore"); more.hidden = true;
  if (tb.scrollWidth <= tb.clientWidth + 1) return;
  more.hidden = false;
  const order = groups.slice().sort((a, b) => b.dataset.pri - a.dataset.pri || groups.indexOf(b) - groups.indexOf(a));
  for (const g of order) { if (tb.scrollWidth <= tb.clientWidth + 1) break; g.hidden = true; }
}
const toolbarRO = new ResizeObserver(debounce(() => layoutToolbar(), 60));
toolbarRO.observe(document.body);

/* ---------- rodapé: lembrete, etiquetas, prioridade ---------- */
function renderFoot() {
  const f = $("#edFoot"); const n = ED && S.notes.get(ED.id); if (!f || !n) return;
  const due = n.reminder && !n.reminderDone && n.reminder < Date.now();
  f.innerHTML = `
    ${n.tplEdit ? "" : `<button class="foot-btn${n.reminder ? " set" : ""}${due ? " due" : ""}" data-act="reminder" title="Lembrete">${ic("bell")}${n.reminder ? fmtDate(n.reminder, true) : "Lembrete"}</button>`}
    <button class="foot-btn${n.prio ? " set p" + n.prio : ""}" data-act="prio" title="Prioridade">${ic("flag")}${n.prio ? PRIO[n.prio] : "Prioridade"}</button>
    ${stageBtnHTML(n)}
    <div class="tags-edit"><span id="tagChips" style="display:contents">${tagChipsHTML(n)}</span>
      ${n.trashed ? "" : `<label class="tag-input-w">${ic("tag")}<input id="tagIn" type="text" placeholder="Adicionar etiqueta" autocomplete="off" spellcheck="false"></label>`}</div>
    <span class="wc" id="wc"></span>`;
  updateWordCount();
}
function stageBtnHTML(n) {
  const st = stageOf(n.stage);
  return `<button class="foot-btn stage-btn${st ? " set" : ""}" data-act="stage" title="Etapa do vídeo"${st ? ` style="--sc:${st.c}"` : ""}>${st ? stageDot(st) + `<span>${st.label}</span><span class="stage-n">${stageIdx(st.k) + 1}/5</span>` : ic("video") + "Etapa"}</button>`;
}
const tagChipsHTML = (n) => (n.tags || []).map((t) => `<span class="ttag">${esc(t)}<button data-rmtag="${esc(t)}" aria-label="Remover etiqueta ${esc(t)}">${ic("x")}</button></span>`).join("");
function refreshTags() { const n = ED && S.notes.get(ED.id); const c = $("#tagChips"); if (n && c) c.innerHTML = tagChipsHTML(n); renderSidebar(); renderList(); }
function addTag(raw) {
  const n = ED && S.notes.get(ED.id); if (!n) return;
  const t = raw.replace(/^#/, "").trim().slice(0, 40);
  const inp = $("#tagIn"); if (inp) inp.value = "";
  $(".suggest")?.remove();
  if (!t) return;
  n.tags = n.tags || [];
  if (!n.tags.some((x) => x.toLowerCase() === t.toLowerCase())) { n.tags.push(t); n.updated = Date.now(); markNote(n.id); }
  refreshTags();
  inp?.focus();
}
function tagSuggest(input) {
  $(".suggest")?.remove();
  const v = norm(input.value.replace(/^#/, "")); const n = S.notes.get(ED.id);
  const opts = allTags().map((x) => x[0]).filter((t) => !(n.tags || []).includes(t) && (!v || norm(t).includes(v))).slice(0, 6);
  if (!opts.length) return;
  const box = document.createElement("div"); box.className = "suggest";
  box.innerHTML = opts.map((t) => `<button class="mi" data-sugtag="${esc(t)}">${ic("tag")}${esc(t)}</button>`).join("");
  input.parentNode.appendChild(box);
}

/* ---------- imagens ---------- */
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1800;
        if (img.width <= max && file.size < 1.5e6 && /png|jpe?g|gif|webp/.test(file.type)) return res(fr.result);
        const k = Math.min(1, max / img.width);
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", .88));
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
async function insertImages(files) {
  if (!ED || ED.doc.contentEditable !== "true") return;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      const data = await fileToDataUrl(f);
      const name = await api.saveImage(data);
      restoreSel();
      const inBlock = selEl()?.closest("li,h1,h2,h3,blockquote,pre");
      if (inBlock) { let top = inBlock; while (top.parentNode !== ED.doc) top = top.parentNode; const r = document.createRange(); r.setStartAfter(top); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }
      document.execCommand("insertHTML", false, `<img src="${esc(imgSrc(name))}" alt=""><p><br></p>`);
      saveSel();
    } catch (e) { console.error(e); toast("Não foi possível adicionar essa imagem."); }
  }
  onDocChange();
}

/* ---------- colar com segurança ---------- */
const KEEP = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "A", "UL", "OL", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "CODE", "SPAN", "IMG", "HR", "DIV", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "IFRAME", "OBJECT", "EMBED", "TITLE", "HEAD", "NOSCRIPT", "SVG", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 8) { c.remove(); return; }
      if (c.nodeType !== 1) return;
      let tag = c.tagName;
      if (DROP.has(tag)) { c.remove(); return; }
      if (tag === "H4" || tag === "H5" || tag === "H6") { const h = doc.createElement("h3"); h.innerHTML = c.innerHTML; c.replaceWith(h); walk(h); return; }
      if (!KEEP.has(tag)) { walk(c); c.replaceWith(...c.childNodes); return; }
      const keep = {};
      if (tag === "A") { const h = c.getAttribute("href") || ""; if (/^(https?:|mailto:)/i.test(h)) keep.href = h; }
      if (tag === "IMG") { const s = c.getAttribute("src") || ""; if (/^(https:|data:image\/|anexo:)/i.test(s)) keep.src = s; else { c.remove(); return; } }
      const st = c.style; const ks = [];
      if (/bold|[6-9]00/.test(st.fontWeight)) ks.push("font-weight:bold");
      if (st.fontStyle === "italic") ks.push("font-style:italic");
      if (/underline|line-through/.test(st.textDecoration)) ks.push("text-decoration:" + st.textDecoration.split(" ")[0]);
      if (/center|right|justify/.test(st.textAlign)) ks.push("text-align:" + st.textAlign);
      [...c.attributes].forEach((a) => c.removeAttribute(a.name));
      Object.entries(keep).forEach(([k, v]) => c.setAttribute(k, v));
      if (ks.length) c.setAttribute("style", ks.join(";"));
      walk(c);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ---------- links ---------- */
function normUrl(u) { u = u.trim(); if (!u) return ""; if (/^(https?:|mailto:)/i.test(u)) return u; if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return "mailto:" + u; return "https://" + u; }
function openLinkEditor(existing) {
  saveSel();
  const a = existing || selEl()?.closest("a");
  const selText = savedRange ? savedRange.toString() : "";
  const anchor = existing || $('[data-cmd="link"]:not([hidden])') || ED.doc;
  const p = popover(anchor, `<form class="pop-form" id="linkForm">
      <label>Endereço (URL)<input class="field" id="lkUrl" placeholder="https://exemplo.com" value="${esc(a ? a.getAttribute("href") : "")}" autocomplete="off" spellcheck="false"></label>
      <label>Texto do link<input class="field" id="lkText" placeholder="Texto que aparece na nota" value="${esc(a ? a.textContent : selText)}" autocomplete="off"></label>
      <div class="row">${a ? `<button type="button" class="btn ghost danger" id="lkRemove">Remover link</button>` : ""}<span style="flex:1"></span><button type="button" class="btn" id="lkCancel">Cancelar</button><button class="btn primary">${a ? "Salvar" : "Inserir"}</button></div></form>`);
  setTimeout(() => $("#lkUrl").focus(), 30);
  $("#lkCancel").onclick = () => closePop();
  if ($("#lkRemove")) $("#lkRemove").onclick = () => { closePop(); const r = document.createRange(); r.selectNodeContents(a); savedRange = r; exec("unlink"); };
  $("#linkForm").onsubmit = (e) => {
    e.preventDefault();
    const url = normUrl($("#lkUrl").value); const text = $("#lkText").value.trim() || url.replace(/^mailto:/, "");
    closePop(); if (!url) return;
    if (a) { a.setAttribute("href", url); if (a.textContent !== text) a.textContent = text; onDocChange(); return; }
    restoreSel();
    if (selText && text === selText) exec("createLink", url);
    else exec("insertHTML", `<a href="${esc(url)}">${esc(text)}</a>&nbsp;`);
  };
}
function linkCard(a) {
  const href = a.getAttribute("href") || "";
  popover(a, `<div class="link-card"><span class="u" title="${esc(href)}">${esc(href.replace(/^mailto:/, ""))}</span>
    <button class="ib sm" id="lcOpen" title="Abrir link" aria-label="Abrir link">${ic("open")}</button>
    <button class="ib sm" id="lcCopy" title="Copiar link" aria-label="Copiar link">${ic("copy")}</button>
    <button class="ib sm" id="lcEdit" title="Editar link" aria-label="Editar link">${ic("edit")}</button></div>`, { below: true });
  $("#lcOpen").onclick = () => { closePop(); api.openLink(href); };
  $("#lcCopy").onclick = async () => { closePop(); try { await navigator.clipboard.writeText(href); toast("Link copiado"); } catch (e) {} };
  $("#lcEdit").onclick = () => { closePop(); openLinkEditor(a); };
}
function tryAutolink() {
  if (!S.prefs.autolink) return;
  const s = getSelection(); if (!s.isCollapsed) return;
  const node = s.anchorNode; if (!node || node.nodeType !== 3 || !inDoc(node)) return;
  if (node.parentElement.closest("a,pre,code")) return;
  const txt = node.textContent.slice(0, s.anchorOffset);
  const m = txt.match(/(?:^|\s)((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)"'])$/);
  if (!m) return;
  const url = m[1], start = s.anchorOffset - url.length;
  const r = document.createRange(); r.setStart(node, start); r.setEnd(node, s.anchorOffset);
  const a = document.createElement("a"); a.href = url.startsWith("www.") ? "https://" + url : url;
  r.surroundContents(a);
  const r2 = document.createRange(); r2.setStartAfter(a); r2.collapse(true); s.removeAllRanges(); s.addRange(r2);
}

/* ---------- maiúscula automática ---------- */
function autoCap(e) {
  if (!S.prefs.autocap || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || !/\p{Ll}/u.test(e.key)) return false;
  const s = getSelection(); if (!s.isCollapsed || !s.rangeCount) return false;
  const el = selEl(); if (!el || el.closest("pre,code,a")) return false;
  const block = el.closest("p,div,li,h1,h2,h3,blockquote") || ED.doc;
  const r = document.createRange(); r.selectNodeContents(block); r.setEnd(s.anchorNode, s.anchorOffset);
  const before = r.toString();
  if (/^\s*$/.test(before) || /[.!?…]\s+$/.test(before)) {
    if (/(^|\s)(ex|sr|sra|dr|dra|etc|p\.ex)\.\s+$/i.test(before)) return false;
    e.preventDefault(); document.execCommand("insertText", false, e.key.toUpperCase()); return true;
  }
  return false;
}

/* ---------- localizar (Ctrl+F) e realce da pesquisa ---------- */
let findState = { q: "", ranges: [], i: 0 };
function textRanges(q) {
  const out = []; if (!ED || !q) return out;
  const nq = norm(q);
  const w = document.createTreeWalker(ED.doc, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = w.nextNode())) {
    const t = norm(node.textContent); let i = t.indexOf(nq);
    while (i >= 0) { const r = new Range(); r.setStart(node, i); r.setEnd(node, i + nq.length); out.push(r); i = t.indexOf(nq, i + nq.length); }
  }
  return out;
}
function highlightDoc(q) {
  if (!window.CSS || !CSS.highlights) return;
  CSS.highlights.delete("busca");
  if (!q || !ED) return;
  const rs = norm(q).split(/\s+/).filter(Boolean).flatMap((w) => textRanges(w));
  if (rs.length) CSS.highlights.set("busca", new Highlight(...rs));
}
function openFind() {
  if (!ED) return;
  let bar = $("#findbar");
  if (!bar) {
    $("#edScroll").insertAdjacentHTML("beforebegin", `<div class="findbar" id="findbar">${ic("search")}<input id="findIn" placeholder="Localizar na nota" autocomplete="off" spellcheck="false"><span class="fc" id="findCount"></span>
      <button class="ib sm" id="findPrev" aria-label="Anterior" title="Anterior (Shift+Enter)" style="transform:rotate(180deg)">${ic("chev-d")}</button><button class="ib sm" id="findNext" aria-label="Próximo" title="Próximo (Enter)">${ic("chev-d")}</button><button class="ib sm" id="findClose" aria-label="Fechar">${ic("x")}</button></div>`);
    bar = $("#findbar");
    $("#edScroll").parentNode.style.position = "relative";
  }
  const sel = getSelection().toString();
  const inp = $("#findIn");
  if (sel && !sel.includes("\n") && sel.length < 60) inp.value = sel;
  inp.focus(); inp.select(); runFind();
}
function runFind() {
  const q = $("#findIn")?.value || "";
  findState = { q, ranges: textRanges(q), i: 0 };
  if (CSS.highlights) { CSS.highlights.delete("busca-atual"); findState.ranges.length ? CSS.highlights.set("busca", new Highlight(...findState.ranges)) : CSS.highlights.delete("busca"); }
  $("#findCount").textContent = q ? (findState.ranges.length ? `1 de ${findState.ranges.length}` : "Nenhum") : "";
  if (findState.ranges.length) showFind(0);
}
function showFind(d) {
  const n = findState.ranges.length; if (!n) return;
  findState.i = (findState.i + d + n) % n;
  const r = findState.ranges[findState.i];
  if (CSS.highlights) CSS.highlights.set("busca-atual", new Highlight(r));
  $("#findCount").textContent = `${findState.i + 1} de ${n}`;
  const rect = r.getBoundingClientRect(), sc = $("#edScroll"), sr = sc.getBoundingClientRect();
  if (rect.top < sr.top + 60 || rect.bottom > sr.bottom - 40) sc.scrollTo({ top: sc.scrollTop + rect.top - sr.top - sr.height / 3, behavior: "smooth" });
}
function closeFind() { $("#findbar")?.remove(); if (CSS.highlights) { CSS.highlights.delete("busca-atual"); CSS.highlights.delete("busca"); } if (S.q) highlightDoc(S.q); restoreSel(); }

/* =========================================================
   Gravação de áudio, player e transcrição
   ========================================================= */
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
let REC = null;
async function startRecording() {
  if (REC) return;
  if (!ED || ED.doc.contentEditable !== "true") { toast("Abra uma nota para gravar."); return; }
  saveSel();
  let stream;
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: S.prefs.micId ? { ...base, deviceId: { exact: S.prefs.micId } } : base }); }
  catch (e) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: base }); if (S.prefs.micId) toast("O microfone escolhido não foi encontrado. Usando o padrão do Windows."); }
    catch (e2) { toast("Não consegui usar o microfone. Confira em Configurações do Windows › Privacidade › Microfone."); return; }
  }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
  const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
  REC = { stream, rec, ctx, an, chunks: [], peaks: [], acc: 0, since: performance.now(), paused: false, noteId: ED.id, cancel: false, lastPeak: 0 };
  rec.ondataavailable = (ev) => { if (ev.data.size) REC.chunks.push(ev.data); };
  rec.onstop = finishRecording;
  rec.start(250);
  const bar = document.createElement("div"); bar.className = "rec-bar"; bar.id = "recBar";
  bar.innerHTML = `<span class="rec-dot"></span><span class="rec-time" id="recTime">0:00</span><div class="rec-wave" id="recWave">${"<i></i>".repeat(28)}</div>
    <button class="ib" id="recPause" title="Pausar" aria-label="Pausar">${ic("pause")}</button>
    <button class="ib stop" id="recStop" title="Concluir gravação">${ic("stop")}Concluir</button>
    <button class="ib" id="recCancel" title="Descartar" aria-label="Descartar gravação">${ic("x")}</button>`;
  $("#pane").appendChild(bar);
  $("#recPause").onclick = () => {
    if (!REC) return;
    if (REC.paused) { REC.rec.resume(); REC.since = performance.now(); REC.paused = false; bar.classList.remove("paused"); $("#recPause").innerHTML = ic("pause"); $("#recPause").title = "Pausar"; }
    else { REC.rec.pause(); REC.acc += performance.now() - REC.since; REC.paused = true; bar.classList.add("paused"); $("#recPause").innerHTML = ic("mic"); $("#recPause").title = "Continuar"; }
  };
  $("#recStop").onclick = () => stopRecording(false);
  $("#recCancel").onclick = () => stopRecording(true);
  const data = new Uint8Array(an.fftSize);
  const tick = () => {
    if (!REC) return;
    const el = (REC.acc + (REC.paused ? 0 : performance.now() - REC.since)) / 1000;
    const tEl = $("#recTime"); if (tEl) tEl.textContent = fmtDur(el);
    an.getByteTimeDomainData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const lvl = REC.paused ? 0 : Math.min(1, Math.sqrt(sum / data.length) * 4.2);
    const bars = $$("#recWave i"); if (bars.length) { for (let i = 0; i < bars.length - 1; i++) bars[i].style.height = bars[i + 1].style.height; bars[bars.length - 1].style.height = Math.max(10, lvl * 100) + "%"; }
    if (!REC.paused && performance.now() - REC.lastPeak > 90) { REC.peaks.push(lvl); REC.lastPeak = performance.now(); }
    REC.raf = requestAnimationFrame(tick);
  };
  tick();
}
function stopRecording(cancel) {
  if (!REC) return;
  REC.cancel = cancel;
  if (!REC.paused) REC.acc += performance.now() - REC.since;
  REC.rec.state !== "inactive" ? REC.rec.stop() : finishRecording();
}
async function finishRecording() {
  const R = REC; if (!R) return; REC = null;
  cancelAnimationFrame(R.raf);
  R.stream.getTracks().forEach((t) => t.stop()); try { R.ctx.close(); } catch (e) {}
  const bar = $("#recBar"); if (bar) { bar.classList.add("out"); setTimeout(() => bar.remove(), 220); }
  if (R.cancel) { toast("Gravação descartada"); return; }
  const dur = R.acc / 1000;
  if (dur < 0.6 || !R.chunks.length) { toast("Gravação muito curta"); return; }
  const blob = new Blob(R.chunks, { type: "audio/webm" });
  let name;
  try { name = await api.saveAudio(await blob.arrayBuffer(), "webm"); } catch (e) { toast("Não foi possível salvar o áudio."); return; }
  const n = 48, pk = R.peaks.length ? R.peaks : [0];
  const peaks = Array.from({ length: n }, (_, i) => { const a = Math.floor(i * pk.length / n), b2 = Math.max(a + 1, Math.floor((i + 1) * pk.length / n)); let m = 0; for (let j = a; j < b2 && j < pk.length; j++) m = Math.max(m, pk[j]); return m; });
  const html = audioBlockHTML(name, dur, peaks);
  if (ED && ED.id === R.noteId) {
    restoreSel();
    const inBlock = selEl()?.closest("li,h1,h2,h3,blockquote,pre");
    if (inBlock) { let top = inBlock; while (top.parentNode !== ED.doc) top = top.parentNode; const r = document.createRange(); r.setStartAfter(top); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }
    document.execCommand("insertHTML", false, html + "<p><br></p>");
    ED.doc.querySelectorAll(".audio-block").forEach((x) => { x.contentEditable = "false"; });
    saveSel(); onDocChange();
  } else {
    const note = S.notes.get(R.noteId); if (!note) return;
    note.html = (note.html || "") + html; note.updated = Date.now(); markNote(note.id);
  }
  if (S.prefs.afterRec === "never") return;
  if (S.prefs.afterRec === "always") { transcribeAudio(R.noteId, name); return; }
  const yes = await ask({ title: "Transcrever a gravação?", icon: "text-wave", text: "O ForeverNote pode transformar o que você falou em texto, logo abaixo do áudio. Tudo acontece no seu computador, sem enviar a gravação para a internet.", ok: "Transcrever", cancel: "Agora não" });
  if (yes) transcribeAudio(R.noteId, name);
}
function audioBlockHTML(file, dur, peaks) {
  const d = new Date();
  const bars = peaks.map((v) => `<b style="height:${Math.round(14 + v * 86)}%"></b>`).join("");
  return `<div class="audio-block" contenteditable="false" data-audio="${esc(file)}" data-dur="${dur.toFixed(2)}"><button class="ab-play" data-act="abplay" title="Ouvir" aria-label="Ouvir gravação"><svg class="i"><use href="#i-play"/></svg></button><div class="ab-mid"><div class="ab-wave" data-act="abseek">${bars}</div><div class="ab-meta"><span class="ab-time">${fmtDur(dur)}</span><span>Gravação · ${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><span class="st"><i class="spin"></i>Transcrevendo…</span></div></div><div class="ab-actions"><button data-act="abtrans" title="Transcrever para texto"><svg class="i"><use href="#i-text-wave"/></svg>Transcrever</button><button data-act="abdel" title="Remover áudio" aria-label="Remover áudio"><svg class="i"><use href="#i-trash"/></svg></button></div></div>`;
}

/* player com Web Audio: permite pular para qualquer ponto da gravação */
const PLAYER = { ctx: null, src: null, block: null, file: null, offset: 0, startedAt: 0, playing: false, raf: 0, cache: new Map() };
async function audioBuffer(file) {
  if (PLAYER.cache.has(file)) return PLAYER.cache.get(file);
  const ab = await (await fetch(imgSrc(file))).arrayBuffer();
  PLAYER.ctx = PLAYER.ctx || new AudioContext();
  const buf = await PLAYER.ctx.decodeAudioData(ab);
  PLAYER.cache.set(file, buf); return buf;
}
function paintAudio(block, t, dur) {
  const bars = block.querySelectorAll(".ab-wave b"); const k = dur ? t / dur : 0;
  bars.forEach((b2, i) => b2.classList.toggle("done", (i + 0.5) / bars.length <= k));
  const tm = block.querySelector(".ab-time"); if (tm) tm.textContent = t > 0 ? `${fmtDur(t)} / ${fmtDur(dur)}` : fmtDur(dur);
}
function stopAudio(keep) {
  if (PLAYER.src) { try { PLAYER.src.onended = null; PLAYER.src.stop(); } catch (e) {} PLAYER.src = null; }
  cancelAnimationFrame(PLAYER.raf);
  if (PLAYER.block && !keep) { const pb = PLAYER.block.querySelector(".ab-play"); if (pb) pb.innerHTML = ic("play"); }
  PLAYER.playing = false;
}
async function playAudio(block, from) {
  const file = block.dataset.audio;
  if (PLAYER.block === block && PLAYER.playing && from === undefined) { PLAYER.offset += PLAYER.ctx.currentTime - PLAYER.startedAt; stopAudio(); return; }
  if (PLAYER.block !== block) { stopAudio(); if (PLAYER.block) paintAudio(PLAYER.block, 0, +PLAYER.block.dataset.dur); PLAYER.offset = 0; }
  else stopAudio(true);
  PLAYER.block = block; PLAYER.file = file;
  let buf; try { buf = await audioBuffer(file); } catch (e) { toast("Não foi possível tocar este áudio."); return; }
  if (PLAYER.ctx.state === "suspended") await PLAYER.ctx.resume();
  if (from !== undefined) PLAYER.offset = from;
  if (PLAYER.offset >= buf.duration - 0.05) PLAYER.offset = 0;
  const src = PLAYER.ctx.createBufferSource(); src.buffer = buf; src.connect(PLAYER.ctx.destination);
  src.start(0, PLAYER.offset); PLAYER.src = src; PLAYER.startedAt = PLAYER.ctx.currentTime; PLAYER.playing = true;
  block.dataset.dur = buf.duration.toFixed(2);
  block.querySelector(".ab-play").innerHTML = ic("pause");
  src.onended = () => { stopAudio(); PLAYER.offset = 0; paintAudio(block, 0, buf.duration); };
  const loop = () => { if (!PLAYER.playing) return; paintAudio(block, PLAYER.offset + PLAYER.ctx.currentTime - PLAYER.startedAt, buf.duration); PLAYER.raf = requestAnimationFrame(loop); };
  loop();
}
function seekAudio(block, k) {
  const dur = +block.dataset.dur || 0;
  if (PLAYER.block === block && PLAYER.playing) playAudio(block, k * dur);
  else { if (PLAYER.block !== block) { stopAudio(); PLAYER.block = block; } PLAYER.offset = k * dur; paintAudio(block, k * dur, dur); }
}

/* transcrição local (Whisper) */
async function toWav16k(arrayBuffer) {
  const ac = new AudioContext(); const dec = await ac.decodeAudioData(arrayBuffer.slice(0)); ac.close();
  const rate = 16000, len = Math.max(1, Math.ceil(dec.duration * rate));
  const off = new OfflineAudioContext(1, len, rate); const s2 = off.createBufferSource(); s2.buffer = dec; s2.connect(off.destination); s2.start();
  const d = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + d.length * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + d.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}
function voiceModal() {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`<div class="m-head"><div class="m-ic">${ic("text-wave")}</div><h2>Ativar a transcrição</h2></div>
      <div class="m-body" id="vBody"><p>Para transformar voz em texto, o ForeverNote precisa baixar uma vez o pacote de reconhecimento de voz em português (cerca de 190 MB).</p>
      <div class="note-tip">${ic("check")}<span>Depois disso, a transcrição funciona mesmo sem internet e suas gravações nunca saem do computador.</span></div></div>
      <div class="m-foot"><span class="grow"></span><button class="btn" id="vNo">Agora não</button><button class="btn primary" id="vGo">Baixar e ativar</button></div>`,
      { onClose: () => { if (!done) { done = true; resolve(false); } } });
    $("#vNo", m).onclick = () => m.close();
    $("#vGo", m).onclick = async () => {
      $("#vBody", m).innerHTML = `<p>Baixando o reconhecimento de voz… Pode continuar usando o app.</p><div class="progress"><i id="vBar"></i></div><div class="progress-txt"><span id="vTxt">Conectando…</span><span id="vPct">0%</span></div>`;
      $("#vGo", m).disabled = true; $("#vGo", m).textContent = "Baixando…"; $("#vNo", m).textContent = "Ocultar";
      try { await api.voiceDownload(); done = true; resolve(true); m.close(); toast("Transcrição ativada"); }
      catch (e) {
        $("#vBody", m).innerHTML = `<p>Não foi possível baixar agora. Confira sua internet e tente de novo.</p><div class="note-tip">${ic("x")}<span>${esc(e.message || e)}</span></div>`;
        $("#vGo", m).disabled = false; $("#vGo", m).textContent = "Tentar de novo"; $("#vNo", m).textContent = "Fechar";
      }
    };
  });
}
if (api.onVoiceProgress) api.onVoiceProgress(({ got, total }) => {
  const bar = $("#vBar"); if (!bar) return;
  const pct = total ? Math.round(got / total * 100) : 0;
  bar.style.width = pct + "%"; $("#vPct").textContent = pct + "%";
  $("#vTxt").textContent = `${(got / 1048576).toFixed(0)} de ${total ? (total / 1048576).toFixed(0) : "?"} MB`;
});
function setAudioState(noteId, file, state) {
  if (!ED || ED.id !== noteId) return;
  const b2 = ED.doc.querySelector(`.audio-block[data-audio="${CSS.escape(file)}"]`);
  if (b2) state ? b2.setAttribute("data-state", state) : b2.removeAttribute("data-state");
}
async function transcribeAudio(noteId, file) {
  if (!api.transcribe) { toast("A transcrição funciona no app instalado no Windows."); return; }
  const st = await api.voiceStatus();
  if (!st.bin) { toast("A ferramenta de transcrição não foi encontrada. Reinstale o app."); return; }
  if (!st.model && !(await voiceModal())) return;
  setAudioState(noteId, file, "busy");
  try {
    const raw = await (await fetch(imgSrc(file))).arrayBuffer();
    const text = await api.transcribe(await toWav16k(raw), S.prefs.lang || "pt");
    setAudioState(noteId, file, "");
    insertTranscript(noteId, file, text || "Não consegui entender a fala nesta gravação.");
    toast("Transcrição pronta");
  } catch (e) { setAudioState(noteId, file, ""); toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
}
function insertTranscript(noteId, file, text) {
  const sel = `.audio-block[data-audio="${CSS.escape(file)}"]`;
  if (ED && ED.id === noteId) {
    const b2 = ED.doc.querySelector(sel); const p = document.createElement("p"); p.className = "transcript"; p.textContent = text;
    if (b2) b2.after(p); else ED.doc.appendChild(p);
    onDocChange(); setTimeout(() => { p.removeAttribute("class"); onDocChange(); }, 900);
    return;
  }
  const n = S.notes.get(noteId); if (!n) return;
  const tmp = document.createElement("div"); tmp.innerHTML = n.html || "";
  const b2 = tmp.querySelector(sel); const p = document.createElement("p"); p.textContent = text;
  if (b2) b2.after(p); else tmp.appendChild(p);
  n.html = tmp.innerHTML; n.text = tmp.innerText; n.updated = Date.now(); markNote(n.id); renderList();
}

/* =========================================================
   Revisão de texto: regras do app + dicionário do Windows + LanguageTool
   ========================================================= */
const KIND = { ort: "Ortografia", gra: "Gramática", pon: "Pontuação", est: "Estilo", gir: "Gíria ou abreviação" };
/* gírias, abreviações de internet e palavras sem acento que são comuns no português do Brasil */
const SLANG = {
  nois: ["nós"], nóis: ["nós"], noiz: ["nós"], ta: ["tá", "está"], to: ["tô", "estou"], tava: ["estava"], tavam: ["estavam"], tamo: ["estamos", "tamo"],
  tlg: ["tá ligado"], tlgd: ["tá ligado"], vc: ["você"], vcs: ["vocês"], cê: null, pq: ["porque", "por que", "por quê"], q: ["que"], oq: ["o que"], oque: ["o que"],
  tb: ["também"], tbm: ["também"], tmb: ["também"], tbem: ["também"], mt: ["muito", "muita"], mto: ["muito"], mts: ["muitos", "muitas"], mta: ["muita"],
  blz: ["beleza"], vlw: ["valeu"], tmj: ["tamo junto"], pfv: ["por favor"], pfvr: ["por favor"], obg: ["obrigado", "obrigada"], msm: ["mesmo"],
  cmg: ["comigo"], ctg: ["contigo"], hj: ["hoje"], td: ["tudo"], tds: ["todos"], ñ: ["não"], nd: ["nada"], agr: ["agora"], dps: ["depois"], dpois: ["depois"],
  kd: ["cadê"], cade: ["cadê"], fds: ["fim de semana"], sdds: ["saudades"], qnd: ["quando"], qdo: ["quando"], qm: ["quem"], ngm: ["ninguém"], alg: ["alguém"],
  vdd: ["verdade"], fzr: ["fazer"], smp: ["sempre"], qlqr: ["qualquer"], qlq: ["qualquer"], dms: ["demais"], rlx: ["relaxa"], pdc: ["pode crer"], flw: ["falou"],
  bjs: ["beijos"], abs: ["abraços"], msg: ["mensagem"], msgs: ["mensagens"], sla: ["sei lá"], pprt: ["papo reto"], mds: ["meu Deus"], aki: ["aqui"], eh: ["é"],
  neh: ["né"], ne: ["né"], vamo: ["vamos"], ja: ["já"], so: ["só"], ate: ["até"], pra: null, pro: null, voce: ["você"], voces: ["vocês"], nao: ["não"], entao: ["então"],
  tambem: ["também"], porem: ["porém"], alem: ["além"], ninguem: ["ninguém"], alguem: ["alguém"], mae: ["mãe"], irmao: ["irmão"], amanha: ["amanhã"], manha: ["manhã"],
  ola: ["olá"], informacao: ["informação"], informacoes: ["informações"], atencao: ["atenção"], opcao: ["opção"], opcoes: ["opções"], video: ["vídeo"], videos: ["vídeos"],
  musica: ["música"], musicas: ["músicas"], proximo: ["próximo"], proxima: ["próxima"], ultimo: ["último"], ultima: ["última"], numero: ["número"], pagina: ["página"],
  titulo: ["título"], possivel: ["possível"], impossivel: ["impossível"], facil: ["fácil"], dificil: ["difícil"], rapido: ["rápido"], rapida: ["rápida"], unico: ["único"],
  unica: ["única"], publico: ["público"], historia: ["história"], maiuscula: ["maiúscula"], minuscula: ["minúscula"], virgula: ["vírgula"], codigo: ["código"],
  saude: ["saúde"], conteudo: ["conteúdo"], horario: ["horário"], experiencia: ["experiência"], audio: ["áudio"], audios: ["áudios"], tecnico: ["técnico"],
  pratico: ["prático"], otimo: ["ótimo"], otima: ["ótima"], obvio: ["óbvio"], inicio: ["início"], logico: ["lógico"], serie: ["série"], especifico: ["específico"],
  basico: ["básico"], automatico: ["automático"], ai: ["aí"], la: ["lá"], ce: ["cê", "você"], voo: null, tao: ["tão"], sao: ["são"], pao: ["pão"], mao: ["mão"], nos: null
};
const SLANG_KIND = (w) => (/^(ta|to|tava|tavam|nois|nóis|noiz|ja|so|ate|ai|la|ce|tao|sao|pao|mao|eh|neh|ne|aki|cade)$/.test(w) || !/^[bcdfghjklmnpqrstvwxyzñ]+$/.test(w) ? "ort" : "gir");
const deacc = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
/* reordena sugestões: primeiro as que só mudam o acento, depois as mais parecidas */
function rankFixes(word, cands) {
  const w = deacc(word);
  const score = (c) => { const d = deacc(c); if (d === w) return -10; let sc = lev(w, d); if (d[0] !== w[0]) sc += 1.5; sc += Math.abs(d.length - w.length) * 0.4; if (/\s/.test(c) && !/\s/.test(word)) sc += 1; return sc; };
  return [...new Set(cands.filter(Boolean))].map((c, i) => ({ c, s: score(c) + i * 0.05 })).sort((a, b) => a.s - b.s).map((x) => x.c);
}
const matchCase = (orig, rep, cap) => (cap || /^\p{Lu}/u.test(orig) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep);
function slangIssues(text) {
  const out = []; const re = /(?<![\p{L}\d@/.:_-])[\p{L}]+(?![\p{L}\d@_-]|\.\w)/gu; let m;
  while ((m = re.exec(text))) {
    const w = m[0], low = w.toLowerCase();
    if (!SLANG[low] || S.prefs.myWords?.includes(low)) continue;
    if (w.length > 1 && w === w.toUpperCase() && low !== "ñ") continue;
    const cap = sentenceStartAt(text, m.index);
    const fixes = SLANG[low].map((r) => matchCase(w, r, cap));
    const kind = SLANG_KIND(low);
    out.push({ offset: m.index, length: w.length, replacement: fixes[0], alts: fixes.slice(1), message: kind === "gir" ? `Abreviação de “${SLANG[low][0]}”.` : `O certo é “${SLANG[low][0]}”${SLANG[low][1] ? ` (ou “${SLANG[low][1]}”)` : ""}.`, kind, prio: 3 });
  }
  return out;
}
const ltKind = (k) => (k === "misspelling" ? "ort" : k === "typographical" || k === "whitespace" ? "pon" : k === "style" || k === "locale-violation" ? "est" : "gra");
const COMMON = { voce: "você", voces: "vocês", nao: "não", entao: "então", tambem: "também", porem: "porém", alem: "além", ninguem: "ninguém", alguem: "alguém", ate: null, tem: null, sao: null, vai: null, ja: null, so: null, mae: "mãe", pai: null, irmao: "irmão", amanha: "amanhã", manha: "manhã", ola: "olá", obrigado: null, voltarei: null, informacao: "informação", informacoes: "informações", atencao: "atenção", opcao: "opção", opcoes: "opções", video: "vídeo", videos: "vídeos", musica: "música", musicas: "músicas", proximo: "próximo", proxima: "próxima", ultimo: "último", ultima: "última", numero: "número", pagina: "página", titulo: "título", possivel: "possível", impossivel: "impossível", facil: "fácil", dificil: "difícil", rapido: "rápido", unico: "único", unica: "única", publico: "público", historia: "história", maiuscula: "maiúscula", minuscula: "minúscula", virgula: "vírgula", codigo: "código", rapida: "rápida", saude: "saúde", conteudo: "conteúdo", horario: "horário", experiencia: "experiência", audio: "áudio", audios: "áudios", tecnico: "técnico", pratico: "prático", otimo: "ótimo", otima: "ótima", obvio: "óbvio", inicio: "início", logico: "lógico", serie: "série", especifico: "específico", basico: "básico", automatico: "automático" };
const ABBR = /(^|\s)(sr|sra|srta|dr|dra|prof|profa|etc|ex|obs|pág|p|av|nº|vs|aprox)\.\s*$/i;
function sentenceStartAt(text, i) {
  let j = i - 1; while (j >= 0 && (text[j] === " " || text[j] === "\u00a0")) j--;
  if (j < 0 || text[j] === "\n") return true;
  if (!/[.!?…]/.test(text[j])) return false;
  const before = text.slice(Math.max(0, j - 12), j + 1);
  if (ABBR.test(before) || /\d\.$/.test(before) || /(https?:|www\.|@)\S*$/.test(text.slice(Math.max(0, j - 60), j + 1))) return false;
  return true;
}
function localIssues(text) {
  const out = [], add = (offset, length, replacement, message, kind) => out.push({ offset, length, replacement, message, kind });
  const inUrl = (i) => { const st = text.lastIndexOf(" ", i) + 1, en = text.indexOf(" ", i); const tok = text.slice(st, en < 0 ? undefined : en); return /:\/\/|www\.|@|\.(com|br|net|org|io|gg)\b/i.test(tok); };
  let m;
  const R = (re, fn) => { re.lastIndex = 0; while ((m = re.exec(text))) fn(m); };
  R(/[ \u00a0]{2,}/g, (x) => { if (x.index > 0 && text[x.index - 1] !== "\n") add(x.index, x[0].length, " ", "Espaço duplo entre palavras.", "pon"); });
  R(/(\S)([ \u00a0]+)([,.;:!?…])(?![.\w])/g, (x) => add(x.index + 1, x[2].length, "", "Sem espaço antes da pontuação.", "pon"));
  R(/([,;:])(?=[A-Za-zÀ-ÿ])/g, (x) => { if (!inUrl(x.index) && !/\d/.test(text[x.index - 1] || "")) add(x.index, 1, x[1] + " ", "Falta um espaço depois da pontuação.", "pon"); });
  R(/(\p{Ll}{2,})([.!?])(\p{L})(?=\p{L}{2})/gu, (x) => { if (!inUrl(x.index)) add(x.index + x[1].length, 1, x[2] + " ", "Falta um espaço depois do ponto.", "pon"); });
  R(/\b(\p{L}{2,})([ \u00a0]+)\1\b/giu, (x) => { if (x[1].toLowerCase() !== "que" || true) add(x.index, x[0].length, x[1], "Palavra repetida.", "gra"); });
  R(/(\p{Ll})/gu, (x) => { if (sentenceStartAt(text, x.index) && !inUrl(x.index)) add(x.index, 1, x[1].toUpperCase(), "Frases começam com letra maiúscula.", "pon"); });
  return out;
}
function spellIssues(text) {
  if (!api.misspelled) return [];
  const out = []; const re = /(?<![\p{L}\d@/.:_-])\p{L}{3,}(?![\p{L}\d@_-]|\.\w)/gu; let m, n = 0;
  while ((m = re.exec(text)) && n < 1500) {
    n++; const w = m[0];
    if (w === w.toUpperCase()) continue;
    if (/^\p{Lu}/u.test(w) && !sentenceStartAt(text, m.index)) continue;
    if (SLANG[w.toLowerCase()] !== undefined || S.prefs.myWords?.includes(w.toLowerCase()) || !api.misspelled(w)) continue;
    const sug = rankFixes(w, (api.suggest(w) || []).filter((x) => x && x !== w));
    if (sug.length && sentenceStartAt(text, m.index)) sug[0] = sug[0][0].toUpperCase() + sug[0].slice(1);
    if (sug.length) out.push({ offset: m.index, length: w.length, replacement: sug[0], alts: sug.slice(1, 4), message: "Palavra não encontrada no dicionário.", kind: "ort" });
  }
  return out;
}
function collectText(range) {
  const segs = []; let text = "", lastBlock = null;
  const skip = (n) => n.parentElement && n.parentElement.closest(".audio-block,a.note-link,pre,code");
  const w = document.createTreeWalker(ED.doc, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = w.nextNode())) {
    if (!range.intersectsNode(node) || skip(node)) continue;
    let st = 0, en = node.textContent.length;
    if (node === range.startContainer) st = range.startOffset;
    if (node === range.endContainer) en = range.endOffset;
    if (en <= st) continue;
    const blk = node.parentElement.closest("p,li,h1,h2,h3,blockquote,td,th,div") || ED.doc;
    if (lastBlock && blk !== lastBlock) text += "\n";
    lastBlock = blk;
    segs.push({ node, nodeStart: st, len: en - st, textStart: text.length });
    text += node.textContent.slice(st, en);
  }
  return { text, segs };
}
function posAt(segs, o, isEnd) {
  for (const s2 of segs) { if (o >= s2.textStart && (o < s2.textStart + s2.len || (isEnd && o === s2.textStart + s2.len))) return [s2.node, s2.nodeStart + (o - s2.textStart)]; }
  return null;
}
let REV = null;
async function proofText(scope) {
  if (!ED || ED.doc.contentEditable !== "true") { toast("Abra uma nota para corrigir."); return; }
  const sel = getSelection();
  let range, partial = false;
  if (scope !== "all" && sel.rangeCount && !sel.isCollapsed && inDoc(sel.anchorNode) && inDoc(sel.focusNode)) { range = sel.getRangeAt(0).cloneRange(); partial = true; }
  else { range = document.createRange(); range.selectNodeContents(ED.doc); }
  const { text, segs } = collectText(range);
  if (!text.trim()) { toast(partial ? "Selecione um trecho com texto." : "A nota ainda não tem texto para corrigir."); return; }
  if (S.prefs.proofOnline === null && api.grammar) {
    const yes = await ask({ title: "Revisão mais completa?", icon: "proof", text: "O ForeverNote corrige espaços, pontuação, maiúsculas e ortografia no próprio computador. Para revisar também gramática e concordância, ele pode usar o serviço gratuito <b>LanguageTool</b>, enviando só o trecho revisado. Você pode mudar isso depois em Configurações › Editor.", ok: "Usar também online", cancel: "Só no computador" });
    S.prefs.proofOnline = !!yes; savePrefs();
  }
  const btn = $(".tb.proof"); btn && btn.classList.add("busy");
  openReview(partial);
  let issues = [...slangIssues(text), ...localIssues(text), ...spellIssues(text)], online = false, onlineErr = "";
  if (S.prefs.proofOnline && api.grammar) {
    try { const lt = await api.grammar(text, { pt: "pt-BR", en: "en-US", es: "es" }[S.prefs.lang] || "pt-BR"); issues = [...lt.map((x) => {
      const k = ltKind(x.kind), orig = text.substr(x.offset, x.length);
      if (k === "ort") { if (S.prefs.myWords?.includes(orig.toLowerCase())) return null; const all = rankFixes(orig, [x.replacement, ...(x.alts || [])]); return { ...x, replacement: all[0], alts: all.slice(1, 5), kind: k, online: true, prio: 2 }; }
      return { ...x, alts: (x.alts || []).slice(0, 4), kind: k, online: true, prio: 2 };
    }).filter(Boolean), ...issues]; online = true; }
    catch (e) { onlineErr = /limite/.test(String(e)) ? "Limite da revisão online atingido. Tente em alguns minutos." : "Sem conexão com a revisão online. Usei só a revisão do computador."; }
  }
  btn && btn.classList.remove("busy");
  if (!REV) return;
  issues.sort((a, b) => a.offset - b.offset || b.length - a.length || (b.prio || 0) - (a.prio || 0));
  const bySpan = new Map(); issues.forEach((x) => { const k = x.offset + ":" + x.length; const cur = bySpan.get(k); if (!cur || (x.prio || 0) > (cur.prio || 0)) bySpan.set(k, x); });
  issues = issues.filter((x) => bySpan.get(x.offset + ":" + x.length) === x);
  const kept = []; let lastEnd = -1;
  for (const it of issues) {
    if (it.offset < lastEnd) continue;
    const orig = text.slice(it.offset, it.offset + it.length);
    if (orig === it.replacement || orig.includes("\n")) continue;
    const a = posAt(segs, it.offset, false), b2 = posAt(segs, it.offset + it.length, true);
    if (!a || !b2) continue;
    const r = document.createRange(); try { r.setStart(a[0], a[1]); r.setEnd(b2[0], b2[1]); } catch (e) { continue; }
    kept.push({ ...it, orig, range: r }); lastEnd = it.offset + Math.max(1, it.length);
  }
  REV.items = kept; REV.online = online; REV.onlineErr = onlineErr;
  renderReview();
}
function openReview(partial) {
  closeReview(true);
  const el = document.createElement("div"); el.className = "review"; el.id = "review";
  el.innerHTML = `<div class="rv-head"><span class="rv-ic">${ic("proof")}</span><b>Revisão${partial ? " do trecho" : ""}</b><span class="rv-count" id="rvCount" hidden>0</span><button class="ib sm" id="rvClose" aria-label="Fechar revisão">${ic("x")}</button></div><div class="rv-busy"><i class="spin"></i>Revisando o texto…</div>`;
  $("#pane").appendChild(el); $("#pane").classList.add("reviewing");
  REV = { el, items: [] };
}
function paintReviewMarks(cur) {
  if (!CSS.highlights || !REV) return;
  const valid = REV.items.filter((x) => !x.done && x.range.toString() === x.orig);
  valid.length ? CSS.highlights.set("rev", new Highlight(...valid.map((x) => x.range))) : CSS.highlights.delete("rev");
  cur && cur.range.toString() === cur.orig ? CSS.highlights.set("rev-atual", new Highlight(cur.range)) : CSS.highlights.delete("rev-atual");
}
function renderReview() {
  const el = REV.el; const left = REV.items.filter((x) => !x.done);
  const cnt = $("#rvCount", el); cnt.hidden = !left.length; cnt.textContent = left.length;
  el.querySelector(".rv-busy, .rv-tools, .rv-list, .rv-done, .rv-foot")?.remove(); $$(".rv-tools,.rv-list,.rv-done,.rv-foot", el).forEach((x) => x.remove());
  const foot = `<div class="rv-foot">${REV.onlineErr ? esc(REV.onlineErr) : REV.online ? "Revisado no computador e com LanguageTool" : `Revisado no computador${api.grammar && !S.prefs.proofOnline ? ` · <button id="rvOnline">Ativar revisão online</button>` : ""}`}</div>`;
  if (!left.length) {
    el.insertAdjacentHTML("beforeend", `<div class="rv-done"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="34"/><path d="M22 37l9.5 9.5L51 27"/></svg><b>${REV.items.length ? "Tudo corrigido!" : "Tudo certo!"}</b><span>${REV.items.length ? "Todas as sugestões foram aplicadas ou ignoradas." : "Não encontrei erros neste texto."}</span></div>${foot}`);
    const b = $(".tb.proof"); if (b) { b.classList.remove("done"); void b.offsetWidth; b.classList.add("done"); }
    paintReviewMarks(); clearTimeout(REV.t); REV.t = setTimeout(() => closeReview(), REV.items.length ? 1600 : 2200);
    return;
  }
  el.insertAdjacentHTML("beforeend", `<div class="rv-tools"><button class="btn primary" id="rvAll">${ic("check")}Corrigir tudo</button><button class="btn" id="rvSkipAll">Ignorar tudo</button></div>
    <div class="rv-list">${REV.items.map((x, i) => x.done ? "" : `<div class="rv-card" data-ri="${i}" style="--i:${Math.min(i, 12)}"><span class="rv-kind k-${x.kind}">${KIND[x.kind]}</span>
      <div class="rv-fix"><s>${esc(vis(x.orig))}</s>${ic("chev-r")}<b>${esc(x.replacement === "" ? "(remover espaço)" : vis(x.replacement))}</b></div>
      ${x.message ? `<div class="rv-msg">${esc(x.message)}</div>` : ""}
      ${x.alts && x.alts.length ? `<div class="rv-alts"><span>Ou:</span>${x.alts.map((a) => `<button data-rv="alt" data-ri="${i}" data-alt="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : ""}
      <div class="rv-acts"><button class="ok" data-rv="apply" data-ri="${i}">${ic("check")}Aplicar</button><button class="no" data-rv="skip" data-ri="${i}">Ignorar</button>${x.kind === "ort" || x.kind === "gir" ? `<button class="no" data-rv="learn" data-ri="${i}" title="Nunca mais marcar esta palavra">Manter sempre</button>` : ""}</div></div>`).join("")}</div>${foot}`);
  paintReviewMarks();
}
function vis(t) { t = t.length > 42 ? t.slice(0, 42) + "…" : t; return t.trim() !== t || !t.trim() ? t.replace(/[ \u00a0]/g, "␣") : t; }
function applyIssue(x) {
  if (x.done) return false;
  x.done = true;
  if (x.range.toString() !== x.orig) return false;
  const tn = document.createTextNode(x.replacement);
  x.range.deleteContents(); if (x.replacement) x.range.insertNode(tn);
  return true;
}
function dismissCard(i, applied) {
  const card = $(`.rv-card[data-ri="${i}"]`, REV.el);
  const after = () => { if (!REV) return; if (!REV.items.some((x) => !x.done)) renderReview(); else { const c = $("#rvCount", REV.el); c.textContent = REV.items.filter((x) => !x.done).length; paintReviewMarks(); } };
  if (card) { card.classList.add("gone"); setTimeout(() => { card.remove(); after(); }, 280); } else after();
  if (applied) onDocChange();
}
function closeReview(instant) {
  if (!REV) return;
  const el = REV.el; clearTimeout(REV.t); REV = null; $("#pane")?.classList.remove("reviewing");
  if (CSS.highlights) { CSS.highlights.delete("rev"); CSS.highlights.delete("rev-atual"); }
  if (instant) el.remove(); else { el.classList.add("out"); setTimeout(() => el.remove(), 250); }
}
document.addEventListener("click", (e) => {
  if (!REV || !REV.el.contains(e.target)) return;
  const t = e.target.closest("button,[data-ri]"); if (!t) return;
  if (t.id === "rvClose") return closeReview();
  if (t.id === "rvOnline") { S.prefs.proofOnline = true; savePrefs(); closeReview(true); proofText(); return; }
  if (t.id === "rvAll") {
    let n = 0; [...REV.items].reverse().forEach((x) => { if (applyIssue(x)) n++; });
    onDocChange(); renderReview(); toast(n ? `${plural(n, "correção aplicada", "correções aplicadas")}` : "Nada para aplicar"); return;
  }
  if (t.id === "rvSkipAll") { REV.items.forEach((x) => (x.done = true)); renderReview(); return; }
  const i = +t.dataset.ri; const x = REV.items[i]; if (!x) return;
  if (t.dataset.rv === "apply") { const ok = applyIssue(x); dismissCard(i, ok); if (!ok) toast("Esse trecho mudou. Revise de novo."); return; }
  if (t.dataset.rv === "skip") { x.done = true; dismissCard(i, false); return; }
  if (t.dataset.rv === "alt") { x.replacement = t.dataset.alt; const ok = applyIssue(x); dismissCard(i, ok); return; }
  if (t.dataset.rv === "learn") {
    const w = x.orig.toLowerCase(); S.prefs.myWords = [...new Set([...(S.prefs.myWords || []), w])]; savePrefs();
    REV.items.forEach((y, j) => { if (!y.done && y.orig.toLowerCase() === w && (y.kind === "ort" || y.kind === "gir")) { y.done = true; dismissCard(j, false); } });
    toast(`“${x.orig}” não será mais marcada`); return;
  }
  $$(".rv-card.cur", REV.el).forEach((c) => c.classList.remove("cur")); t.classList.add("cur");
  paintReviewMarks(x);
  const rr = x.range.getBoundingClientRect(), sc = $("#edScroll"), sr = sc.getBoundingClientRect();
  if (rr.top < sr.top + 40 || rr.bottom > sr.bottom - 40) sc.scrollTo({ top: sc.scrollTop + rr.top - sr.top - sr.height / 3, behavior: "smooth" });
});
document.addEventListener("mouseover", (e) => { if (!REV) return; const c = e.target.closest?.(".rv-card"); if (c && REV.el.contains(c)) paintReviewMarks(REV.items[+c.dataset.ri]); });
if (api.onProof) api.onProof((v) => proofText(v === "all" ? "all" : undefined));

/* nota rápida (janela da bandeja) */
function textToHTML(t) {
  const link = (x) => esc(x).replace(/((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)"'])/g, (u) => `<a href="${u.startsWith("www.") ? "https://" + u : u}">${u}</a>`);
  return t.split(/\r?\n/).map((l) => (l.trim() ? `<p>${link(l)}</p>` : "<p><br></p>")).join("").replace(/^(<p><br><\/p>)+|(<p><br><\/p>)+$/g, "");
}
if (api.onQuick) {
  api.onQuick("add", ({ text, nb, rid, audios }) => {
    const lines = (text || "").split(/\r?\n/); const i = lines.findIndex((l) => l.trim());
    let title = i < 0 ? "Gravação de voz" : (lines[i] || "").trim(), rest = i < 0 ? "" : lines.slice(i + 1).join("\n");
    if (title.length > 120) { rest = title + "\n" + rest; title = title.slice(0, 60).replace(/\s+\S*$/, "") + "…"; }
    const now = Date.now(), nbId = S.nbs.has(nb) ? nb : defaultNb();
    let html = textToHTML(rest.replace(/^\s*\n/, ""));
    (audios || []).forEach((a) => { html += audioBlockHTML(a.file, a.dur || 0, a.peaks || Array(48).fill(.2)) + "<p><br></p>"; });
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const n = { id: uid("nt_"), nb: nbId, title, html, text: tmp.innerText, tags: [], prio: 0, reminder: null, reminderDone: false, fav: false, trashed: false, created: now, updated: now };
    S.notes.set(n.id, n); markNote(n.id); flushSave();
    renderSidebar(); renderList(); $(`.card[data-note="${n.id}"]`)?.classList.add("fresh");
    api.quickAdded({ rid, id: n.id, nbName: nbName(nbId) });
  });
  api.onQuick("open", (id) => { if (id && S.notes.has(id)) openNote(id, { newTab: true }); });
  api.onQuick("new", () => newNote());
}

/* ---------- atualização automática ---------- */
const appVer = () => { try { return (api.appVersion && api.appVersion()) || "2.2"; } catch (e) { return "2.2"; } };
const fmtMB = (b) => (b ? (b / 1048576).toFixed(0) + " MB" : "");
let updInfo = null, updating = false;
function escNotes(s) {
  return esc(String(s || "").trim()).split(/\r?\n/).filter((l) => l.trim()).slice(0, 8)
    .map((l) => `<div class="upd-li">${l.replace(/^[-*•]\s*/, "")}</div>`).join("") || "";
}
if (api.onUpdateAvailable) api.onUpdateAvailable((info) => { if (info && info.version) { updInfo = info; showUpdateBanner(info); } });
if (api.onUpdateProgress) api.onUpdateProgress(({ got, total }) => {
  const bar = $("#updBar"); if (bar) bar.style.width = (total ? Math.round(got / total * 100) : 0) + "%";
  const pct = $("#updPct"); if (pct && total) pct.textContent = Math.round(got / total * 100) + "%";
});
function showUpdateBanner(info) {
  $("#updateBanner")?.remove();
  const b = document.createElement("div");
  b.id = "updateBanner"; b.className = "update-banner";
  b.innerHTML = `<div class="ub-ic">${ic("restore")}</div>
    <div class="ub-txt"><b>Nova versão ${esc(info.version)} disponível</b><span>Clique para atualizar sozinho, sem baixar nada à mão.</span></div>
    ${info.notes ? `<button class="ub-link" data-ua="notes">Novidades</button>` : ""}
    <button class="btn primary" data-ua="go">${ic("restore")}Atualizar</button>
    <button class="ib sm" data-ua="later" title="Agora não" aria-label="Agora não">${ic("x")}</button>`;
  document.body.appendChild(b);
  b.addEventListener("click", (e) => {
    const a = e.target.closest("[data-ua]"); if (!a) return;
    if (a.dataset.ua === "later") { b.classList.add("out"); setTimeout(() => b.remove(), 250); }
    else if (a.dataset.ua === "notes") updateNotesModal(info);
    else if (a.dataset.ua === "go") runUpdate(info);
  });
}
function updateNotesModal(info) {
  modal(`<div class="m-head"><div class="m-ic">${ic("restore")}</div><h2>Novidades da versão ${esc(info.version)}</h2><button class="ib" data-close-upd aria-label="Fechar">${ic("x")}</button></div>
    <div class="m-body"><div class="upd-notes">${escNotes(info.notes) || "<span style='color:var(--muted)'>Sem descrição.</span>"}</div></div>
    <div class="m-foot"><span class="grow"></span><button class="btn primary" data-ua2="go">${ic("restore")}Atualizar agora</button></div>`).addEventListener("click", function (e) {
    if (e.target.closest("[data-close-upd]")) this.close();
    if (e.target.closest("[data-ua2=go]")) { this.close(); runUpdate(info); }
  });
}
async function runUpdate(info) {
  if (updating) return; updating = true;
  if (!api.installUpdate) { toast("Atualização automática indisponível nesta versão."); updating = false; return; }
  const b = $("#updateBanner");
  if (b) b.innerHTML = `<div class="ub-ic spin-ic">${ic("restore")}</div>
    <div class="ub-txt"><b>Baixando a versão ${esc(info.version)}… <span id="updPct">0%</span></b><span>O app vai fechar e reabrir sozinho quando terminar.</span>
    <div class="ub-progress"><i id="updBar"></i></div></div>`;
  const r = await api.installUpdate(info);
  if (r && r.error) {
    updating = false;
    if (b) b.classList.add("out"), setTimeout(() => b.remove(), 250);
    toast("Não consegui atualizar agora: " + r.error + ". Tente de novo mais tarde.");
  }
  /* se deu ok, o app fecha sozinho pra instalar */
}
function checkForUpdate(btn, m) {
  if (!api.checkUpdate) return;
  const info = $("#sUpdInfo", m); if (!info) return;
  btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = `${ic("restore")}Procurando…`;
  api.checkUpdate().then((r) => {
    btn.disabled = false; btn.innerHTML = old; info.hidden = false;
    if (!r) { info.className = "upd-info ok"; info.innerHTML = `${ic("check")}Você já está na versão mais recente (${esc(appVer())}).`; }
    else if (r.error) { info.className = "upd-info"; info.innerHTML = `Não consegui verificar agora. Tente mais tarde.`; }
    else { info.className = "upd-info new"; info.innerHTML = `${ic("restore")}<div><b>Versão ${esc(r.version)} disponível!</b></div><button class="btn primary sm" id="sUpdGo">Atualizar</button>`; $("#sUpdGo", info).onclick = () => { m.close(); runUpdate(r); }; }
  });
}

/* =========================================================
   Popovers, menus, modais, avisos
   ========================================================= */
let popEl = null, popAnchor = null;
function closePop() {
  closeSub();
  if (!popEl) return;
  const p = popEl; popEl = null; popAnchor = null;
  p.classList.add("closing"); setTimeout(() => p.remove(), 140);
}
function popover(anchor, html, o = {}) {
  closePop();
  const p = document.createElement("div"); p.className = "pop"; p.innerHTML = html;
  p.addEventListener("mousedown", (e) => { if (!e.target.closest("input,textarea,select,label")) e.preventDefault(); });
  document.body.appendChild(p); popEl = p; popAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  let left = o.right ? r.right - p.offsetWidth : r.left;
  left = Math.max(8, Math.min(left, innerWidth - p.offsetWidth - 8));
  let top = r.bottom + 6;
  if (top + p.offsetHeight > innerHeight - 8) { top = r.top - p.offsetHeight - 6; p.style.transformOrigin = "bottom left"; }
  p.style.left = left + "px"; p.style.top = Math.max(8, top) + "px";
  return p;
}
function menu(anchor, items, o) {
  const html = items.map((it, i) => it === "-" ? "<hr>" : it.h ? `<div class="pop-h">${esc(it.h)}</div>` :
    `<button class="mi${it.danger ? " danger" : ""}${it.active ? " active" : ""}${it.big ? " big" : ""}" data-mi="${i}" ${it.style ? `style="${it.style}"` : ""}>${it.icon ? ic(it.icon) : ""}${it.html || esc(it.label)}${it.k ? `<span class="k">${it.k}</span>` : ""}${it.checked ? ic("check", "ck") : ""}</button>`).join("");
  const p = popover(anchor, html, o);
  p.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; const it = items[+b.dataset.mi]; if (!it.keep) closePop(); it.run && it.run(); };
  return p;
}
function modal(html, o = {}) {
  closePop();
  const L = $("#layer");
  const sc = document.createElement("div"); sc.className = "scrim";
  sc.innerHTML = `<div class="modal${o.wide ? " wide" : ""}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  L.appendChild(sc);
  const close = () => { if (sc.classList.contains("closing")) return; sc.classList.add("closing"); setTimeout(() => sc.remove(), 160); o.onClose && o.onClose(); };
  sc.addEventListener("mousedown", (e) => { if (e.target === sc) close(); });
  sc.close = close;
  setTimeout(() => (sc.querySelector("[autofocus]") || sc.querySelector("input,button.primary") || sc.querySelector(".modal"))?.focus({ preventScroll: true }), 40);
  return sc;
}
function ask({ title, text, ok = "OK", cancel = "Cancelar", danger, icon = "notes", input, value = "", extra = "" }) {
  return new Promise((res) => {
    let done = false;
    const m = modal(`<form id="askF"><div class="m-head"><div class="m-ic">${ic(icon)}</div><h2>${esc(title)}</h2></div>
      <div class="m-body">${text ? `<p>${text}</p>` : ""}${input ? `<input class="field" id="askIn" value="${esc(value)}" placeholder="${esc(input)}" autocomplete="off" autofocus>` : ""}${extra}</div>
      <div class="m-foot"><span class="grow"></span><button type="button" class="btn" id="askNo">${esc(cancel)}</button><button class="btn ${danger ? "danger solid" : "primary"}">${esc(ok)}</button></div></form>`,
      { onClose: () => { if (!done) { done = true; res(input ? null : false); } } });
    $("#askNo", m).onclick = () => m.close();
    $("#askF", m).onsubmit = (e) => { e.preventDefault(); const v = input ? $("#askIn", m).value.trim() : true; const ex = m.querySelector("[data-extra]"); done = true; res(ex ? { v, extra: ex.value } : v); m.close(); };
    if (input) setTimeout(() => $("#askIn", m)?.select(), 50);
  });
}
function toast(msg, action) {
  let w = $(".toast-w"); if (!w) { w = document.createElement("div"); w.className = "toast-w"; document.body.appendChild(w); }
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ""}`;
  w.appendChild(t);
  const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 200); };
  if (action) t.querySelector("button").onclick = () => { action.run(); kill(); };
  setTimeout(kill, action ? 5000 : 2600);
}

/* ---------- popovers da barra ---------- */
function toolbarPop(kind, btn) {
  saveSel();
  if (kind === "block") return menu(btn, BLOCKS.map(([tag, label, cls]) => ({ big: true, html: `<span class="${cls}">${label}</span>`, run: () => exec("formatBlock", tag) })));
  if (kind === "font") {
    const cur = fontOf(selEl() ? getComputedStyle(selEl()).fontFamily : "")[0];
    const p = menu(btn, FONTS.map(([key, label, stack]) => ({ label, active: key === cur, checked: key === cur, style: `font-family:${stack.replace(/"/g, "'")}`, run: () => setFont(key) })));
    p.classList.add("font-menu"); return p;
  }
  if (kind === "size") {
    const cur = +$("#tbSize")?.textContent;
    return menu(btn, SIZES.map((s) => ({ label: String(s), checked: s === cur, run: () => setFontSize(s) })));
  }
  if (kind === "color" || kind === "hilite") {
    const isC = kind === "color", list = isC ? COLORS : HILITES;
    const el = selEl();
    let cur = "";
    if (el) {
      if (isC) { const c = el.closest("[style*='color']:not(.doc)"); cur = c && c.style.color ? toHex(getComputedStyle(el).color) : ""; }
      else { let x = el; while (x && x !== ED.doc && !(x.style && x.style.backgroundColor)) x = x.parentElement; cur = x && x !== ED.doc ? toHex(x.style.backgroundColor) : ""; }
    }
    const p = popover(btn, `<div class="colors">
      <button class="auto-btn${cur ? "" : " on"}" data-col="">${ic("auto")}${isC ? "Automático" : "Sem destaque"}</button>
      <div class="swatches">${list.map((c) => `<button class="sw${cur && cur.slice(0, 7) === c.slice(0, 7) ? " on" : ""}" data-col="${c}" style="background:${c}${isC ? "" : ";box-shadow:inset 0 0 0 1px rgba(127,127,127,.3)"}" aria-label="Cor ${c}"></button>`).join("")}</div>
      <label class="custom"><input type="color" id="colCustom" value="${(cur || "#4f6ef7").slice(0, 7)}">Escolher outra cor…</label></div>`);
    p.onclick = (e) => { const b = e.target.closest("[data-col]"); if (!b) return; closePop(); setColor(kind, b.dataset.col); };
    $("#colCustom", p).addEventListener("change", (e) => { const v = e.target.value; closePop(); setColor(kind, isC ? v : v + "55"); });
    return p;
  }
  if (kind === "align") return menu(btn, [["justifyLeft", "al", "Alinhar à esquerda"], ["justifyCenter", "ac", "Centralizar"], ["justifyRight", "ar", "Alinhar à direita"], ["justifyFull", "aj", "Justificar"]].map(([c, i, l]) => ({ icon: i, label: l, run: () => exec(c) })));
  if (kind === "more") {
    const hidden = $$("#toolbar .tgroup[hidden]");
    const p = popover(btn, `<div style="display:flex;flex-direction:column;gap:4px;padding:2px">${hidden.map((g) => `<div class="tgroup" style="padding:0">${g.innerHTML}</div>`).join("")}</div>`, { right: true });
    updateToolbar();
    return p;
  }
}

/* =========================================================
   Ações: notas e cadernos
   ========================================================= */
function setSel(sel) {
  if (TPLED) endTplEdit(true);
  S.sel = sel; S.q = ""; $("#search").value = ""; S.picked.clear(); S.lastPick = null;
  if (CSS.highlights) CSS.highlights.delete("busca");
  $("#app").classList.remove("drawer");
  mobShowList();
  renderSidebar(); renderList(true); saveSession();
}
/* navegação de celular: lista ⇄ nota */
const mqMobile = matchMedia("(max-width:640px)");
function mobShowList() { $("#app")?.classList.remove("note-open"); }
function mobShowNote() { if (mqMobile.matches) { $("#app")?.classList.add("note-open"); try { history.pushState({ fn: "note" }, ""); } catch (e) {} } }
function applyMobile() { document.documentElement.classList.toggle("mobile", mqMobile.matches); if (!mqMobile.matches) mobShowList(); }
mqMobile.addEventListener("change", applyMobile);
addEventListener("popstate", () => { if ($("#app")?.classList.contains("note-open")) mobShowList(); });
function openNote(id, o = {}) {
  if (!S.notes.has(id)) return;
  if (TPLED && id !== TPLED.id) endTplEdit(true);
  if (S.sel.type === "tpl") { S.sel = { type: "all" }; renderSidebar(); renderList(true); saveSession(); }
  rememberScroll();
  if (!S.tabs.includes(id)) { const i = S.tabs.indexOf(S.active); if (o.newTab || !S.active || i < 0) S.tabs.push(id); else S.tabs.splice(i + 1, 0, id); }
  S.active = id;
  if (!o.noHist) pushHist(id);
  renderTabs(); renderPane(o);
  $$(".card").forEach((c) => c.classList.toggle("on", c.dataset.note === id));
  mobShowNote();
  saveSession();
}
function closeTab(id) {
  const i = S.tabs.indexOf(id); if (i < 0) return;
  rememberScroll();
  S.tabs.splice(i, 1);
  const n = S.notes.get(id);
  if (n && !n.trashed && !(n.title || "").trim() && !(n.text || "").trim() && !/<img/.test(n.html || "")) { S.notes.delete(id); deleted.add(id); dirty.delete(id); queueSave(); }
  if (S.active === id) S.active = S.tabs[Math.min(i, S.tabs.length - 1)] || null;
  renderTabs(); renderPane(); renderList(); renderSidebar(); saveSession();
}
function defaultNb() {
  const s = S.sel;
  if (s.type === "nb" && S.nbs.has(s.id)) return s.id;
  if (s.type === "stack") { const nb = [...S.nbs.values()].find((x) => x.stack === s.id); if (nb) return nb.id; }
  const cur = S.notes.get(S.active); if (cur && S.nbs.has(cur.nb)) return cur.nb;
  let nb = sortedNbs([...S.nbs.values()])[0];
  if (!nb) { nb = { id: uid("nb_"), name: "Primeiro Caderno", stack: "", created: Date.now() }; S.nbs.set(nb.id, nb); markNotebooks(); }
  return nb.id;
}
function newNote(extra = {}) {
  if (TPLED) endTplEdit(true);
  if (S.sel.type === "trash" || S.sel.type === "tpl") S.sel = { type: "all" };
  const now = Date.now();
  const n = { id: uid("nt_"), nb: defaultNb(), title: "", html: "", text: "", tags: S.sel.type === "tag" ? [S.sel.id] : [], prio: 0, reminder: null, reminderDone: false, fav: S.sel.type === "fav", stage: S.sel.type === "stage" ? S.sel.id : "", trashed: false, created: now, updated: now, ...extra };
  S.notes.set(n.id, n); markNote(n.id);
  if (S.q) { S.q = ""; $("#search").value = ""; }
  renderSidebar(); renderList();
  $(`.card[data-note="${n.id}"]`)?.classList.add("fresh");
  openNote(n.id, { focusTitle: true });
}
function trashNote(id) {
  const n = S.notes.get(id); if (!n) return;
  const card = $(`.card[data-note="${id}"]`);
  if (card && !card.classList.contains("leaving") && !document.documentElement.classList.contains("no-anim")) { card.style.height = card.offsetHeight + "px"; card.classList.add("leaving"); setTimeout(() => trashNote2(id), 300); return; }
  trashNote2(id);
}
function trashNote2(id) {
  const n = S.notes.get(id); if (!n) return;
  n.trashed = true; n.trashedAt = Date.now(); markNote(id);
  const i = S.tabs.indexOf(id); if (i >= 0) S.tabs.splice(i, 1);
  if (S.active === id) S.active = S.tabs[Math.min(i, S.tabs.length - 1)] || null;
  renderAll();
  toast("Nota movida para a lixeira", { label: "Desfazer", run: () => { n.trashed = false; markNote(id); openNote(id); renderSidebar(); renderList(); } });
}
function restoreNote(id) {
  const n = S.notes.get(id); if (!n) return;
  n.trashed = false; if (!S.nbs.has(n.nb)) n.nb = defaultNb(); markNote(id);
  renderAll(); toast("Nota restaurada para “" + nbName(n.nb) + "”");
}
/* arquivos (imagens e áudios) usados por qualquer nota, inclusive as da lixeira */
function usedAttachments() {
  const set = new Set();
  S.notes.forEach((n) => {
    const h = n.html || "";
    for (const m of h.matchAll(/anexo:\/\/img\/([\w.-]+)/g)) set.add(m[1]);
    for (const m of h.matchAll(/data-audio="([\w.-]+)"/g)) set.add(m[1]);
    for (const m of h.matchAll(/data-file="([\w.-]+)"/g)) set.add(m[1]);
  });
  (S.prefs.templates || []).forEach((t) => { for (const m of (t.html || "").matchAll(/(?:anexo:\/\/img\/|data-audio="|data-file=")([\w.-]+)/g)) set.add(m[1]); });
  return [...set];
}
async function cleanAttachments(minAge) {
  if (!api.cleanAttachments) return;
  await flushSave();
  try { return await api.cleanAttachments(usedAttachments(), minAge || 0); } catch (e) { return null; }
}
async function purgeNote(id) {
  const n = S.notes.get(id); if (!n) return;
  if (!(await ask({ title: "Excluir para sempre?", text: `“${esc(titleOf(n))}” sai da lixeira. Se se arrepender, dá para recuperar por 14 dias em Configurações › Restaurar.`, ok: "Excluir", danger: true, icon: "trash" }))) return;
  S.notes.delete(id); deleted.add(id); dirty.delete(id); queueSave();
  S.tabs = S.tabs.filter((x) => x !== id); if (S.active === id) S.active = null;
  renderAll(); cleanAttachments();
}
function duplicateNote(id) {
  const n = S.notes.get(id); if (!n) return;
  const now = Date.now();
  const c = { ...n, id: uid("nt_"), title: (n.title || "Sem título") + " (cópia)", tags: [...(n.tags || [])], created: now, updated: now, reminder: null, reminderDone: false };
  S.notes.set(c.id, c); markNote(c.id); renderList(); renderSidebar(); openNote(c.id); toast("Nota duplicada");
}
function moveNote(id, nbId) {
  const n = S.notes.get(id); if (!n || n.nb === nbId) return;
  n.nb = nbId; n.updated = Date.now(); markNote(id);
  renderSidebar(); renderList(); if (S.active === id) renderPane({ keepScroll: $("#edScroll")?.scrollTop });
  toast("Nota movida para “" + nbName(nbId) + "”");
}
function moveMenu(anchor, id) {
  const n = S.notes.get(id);
  menu(anchor, [{ h: "Mover para o caderno" }, ...sortedNbs([...S.nbs.values()]).map((nb) => ({ icon: "book", label: nb.name, checked: nb.id === n.nb, run: () => moveNote(id, nb.id) })), "-", { icon: "plus", label: "Novo caderno…", run: async () => { const nb = await newNotebook(true); if (nb) moveNote(id, nb.id); } }]);
}
async function newNotebook(silent) {
  const stacks = [...new Set([...S.nbs.values()].map((x) => x.stack).filter(Boolean))];
  const r = await ask({ title: "Novo caderno", input: "Nome do caderno (ex.: Roteiros, Estudos)", ok: "Criar caderno", icon: "book",
    extra: `<label style="font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:5px">Pilha (opcional)<input class="field" data-extra list="stackList" placeholder="Junte cadernos parecidos, ex.: YouTube" autocomplete="off"><datalist id="stackList">${stacks.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>` });
  if (!r || !r.v) return null;
  const nb = { id: uid("nb_"), name: r.v, stack: (r.extra || "").trim(), created: Date.now() };
  S.nbs.set(nb.id, nb); markNotebooks();
  if (!silent) setSel({ type: "nb", id: nb.id }); else renderSidebar();
  toast(`Caderno “${nb.name}” criado`);
  return nb;
}
function nbMenu(btn, id) {
  const nb = S.nbs.get(id); if (!nb) return;
  const stacks = [...new Set([...S.nbs.values()].map((x) => x.stack).filter(Boolean))];
  menu(btn, [
    { icon: "note-add", label: "Nova nota neste caderno", run: () => { S.sel = { type: "nb", id }; newNote(); } },
    { icon: "edit", label: "Renomear", run: async () => { const v = await ask({ title: "Renomear caderno", input: "Nome", value: nb.name, ok: "Salvar", icon: "book" }); if (v) { nb.name = v; markNotebooks(); renderAll(true); } } },
    { icon: "stack", label: nb.stack ? "Mudar de pilha" : "Adicionar a uma pilha", run: async () => {
      const v = await ask({ title: "Pilha do caderno", text: "Pilhas agrupam cadernos na barra lateral." + (stacks.length ? " Pilhas existentes: " + stacks.map(esc).join(", ") + "." : ""), input: "Nome da pilha", value: nb.stack || "", ok: "Salvar", icon: "stack" });
      if (v !== null) { nb.stack = v; markNotebooks(); renderSidebar(); } } },
    ...(nb.stack ? [{ icon: "x", label: "Tirar da pilha", run: () => { nb.stack = ""; markNotebooks(); renderSidebar(); } }] : []),
    "-",
    { icon: "trash", label: "Excluir caderno", danger: true, run: async () => {
      const ns = live().filter((n) => n.nb === id);
      if (S.nbs.size === 1 && ns.length) { toast("Crie outro caderno antes de excluir o último."); return; }
      if (!(await ask({ title: `Excluir “${nb.name}”?`, text: ns.length ? `As ${plural(ns.length, "nota", "notas")} deste caderno vão para a lixeira.` : "O caderno está vazio.", ok: "Excluir", danger: true, icon: "trash" }))) return;
      ns.forEach((n) => { n.trashed = true; n.trashedAt = Date.now(); markNote(n.id); });
      S.nbs.delete(id); markNotebooks();
      S.tabs = S.tabs.filter((t) => !ns.some((n) => n.id === t)); if (ns.some((n) => n.id === S.active)) S.active = S.tabs[0] || null;
      if (S.sel.id === id) S.sel = { type: "all" };
      renderAll(true); toast("Caderno excluído");
    } }
  ]);
}
function tagMenu(btn, tag) {
  menu(btn, [
    { icon: "edit", label: "Renomear etiqueta", run: async () => {
      const v = await ask({ title: "Renomear etiqueta", input: "Nome", value: tag, ok: "Salvar", icon: "tag" }); if (!v || v === tag) return;
      S.notes.forEach((n) => { if ((n.tags || []).includes(tag)) { n.tags = [...new Set(n.tags.map((t) => (t === tag ? v : t)))]; markNote(n.id); } });
      if (S.sel.type === "tag" && S.sel.id === tag) S.sel.id = v; S.filter.tags = S.filter.tags.map((t) => (t === tag ? v : t)); renderAll(true); } },
    { icon: "trash", label: "Remover de todas as notas", danger: true, run: async () => {
      if (!(await ask({ title: `Remover “${tag}”?`, text: "A etiqueta sai de todas as notas. As notas continuam iguais.", ok: "Remover", danger: true, icon: "tag" }))) return;
      S.notes.forEach((n) => { if ((n.tags || []).includes(tag)) { n.tags = n.tags.filter((t) => t !== tag); markNote(n.id); } });
      if (S.sel.type === "tag" && S.sel.id === tag) S.sel = { type: "all" }; S.filter.tags = S.filter.tags.filter((t) => t !== tag); renderAll(true); } }
  ]);
}
function noteMenu(btn) {
  const n = S.notes.get(S.active); if (!n) return;
  if (n.trashed) return menu(btn, [{ icon: "restore", label: "Restaurar", run: () => restoreNote(n.id) }, { icon: "trash", label: "Excluir para sempre", danger: true, run: () => purgeNote(n.id) }], { right: true });
  menu(btn, [
    { icon: "book", label: "Mover para…", keep: true, run: () => moveMenu(btn, n.id) },
    { icon: "dup", label: "Duplicar nota", run: () => duplicateNote(n.id) },
    { icon: "template", label: "Salvar como modelo…", run: () => saveAsTemplate(n.id) },
    { icon: "search", label: "Localizar na nota", k: "Ctrl+F", run: openFind },
    "-",
    { icon: "export", label: "Exportar como página (.html)", run: () => exportNote("html") },
    { icon: "export", label: "Exportar como texto (.txt)", run: () => exportNote("txt") },
    "-",
    { icon: "width", label: "Texto em largura total", checked: S.prefs.wide, run: () => { S.prefs.wide = !S.prefs.wide; $("#app").classList.toggle("wide", S.prefs.wide); savePrefs(); } },
    { label: "Criada " + fmtDate(n.created, true), icon: "calendar", run: () => {} },
    "-",
    { icon: "trash", label: "Mover para a lixeira", danger: true, run: () => trashNote(n.id) }
  ], { right: true });
}
async function exportNote(format) {
  const n = S.notes.get(S.active); if (!n) return;
  if (!window.api) { toast("Exportar funciona no app instalado."); return; }
  const ok = await api.exportNote({ title: n.title, html: n.html, text: (n.title ? n.title + "\n\n" : "") + (n.text || ""), format });
  if (ok) toast("Nota exportada");
}

/* ---------- lembretes e prioridade ---------- */
function reminderPop(btn, ids) {
  const ctx = !!ids; ids = ids || [S.active];
  const notes = ids.map((x) => S.notes.get(x)).filter((n) => n && !n.trashed); if (!notes.length) return;
  const n = notes[0], opts = reminderOpts();
  const at = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const local = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
  const has = notes.some((x) => x.reminder);
  const p = popover(btn, `<div class="pop-h">Lembrete${notes.length > 1 ? ` · ${plural(notes.length, "nota", "notas")}` : ""}</div>
    ${opts.map((o, i) => `<button class="mi" data-rq="${i}">${ic("clock")}${o[0]}</button>`).join("")}
    <hr><form class="pop-form" id="remF" style="padding:6px 6px 4px;min-width:260px"><label>Data e hora<input class="field" type="datetime-local" id="remAt" value="${local(n.reminder || at(1, 9))}"></label>
    <div class="row">${has ? `<button type="button" class="btn ghost danger" id="remDel">Remover</button><span style="flex:1"></span>` : ""}<button class="btn primary">Definir</button></div></form>`);
  const set = (t) => {
    closePop();
    if (ctx) return setReminder(notes.map((x) => x.id), t);
    n.reminder = t; n.reminderDone = false; n.updated = Date.now(); markNote(n.id); renderFoot(); renderList(); renderSidebar();
    if (t) toast("Lembrete para " + fmtDate(t, true));
  };
  p.onclick = (e) => { const b = e.target.closest("[data-rq]"); if (b) set(opts[+b.dataset.rq][1]); };
  $("#remF").onsubmit = (e) => { e.preventDefault(); const v = $("#remAt").value; if (v) set(new Date(v).getTime()); };
  if ($("#remDel")) $("#remDel").onclick = () => set(null);
}
function prioPop(btn) {
  const n = S.notes.get(S.active); if (!n || n.trashed) return;
  menu(btn, [3, 2, 1, 0].map((p) => ({ icon: "flag", label: PRIO[p], checked: (n.prio || 0) === p, style: p ? `color:var(--p${p})` : "", run: () => { n.prio = p; n.updated = Date.now(); markNote(n.id); renderFoot(); renderList(); } })));
}
function checkReminders() {
  const now = Date.now();
  S.notes.forEach((n) => {
    if (!n.reminder || n.reminderDone || n.trashed || n.reminder > now) return;
    n.reminderDone = true; markNote(n.id);
    try {
      const notif = new Notification("Lembrete: " + titleOf(n), { body: (n.text || "").slice(0, 120) || "Abra a nota para ver.", silent: false });
      notif.onclick = () => { api.focus(); openNote(n.id); };
    } catch (e) {}
    toast("Lembrete: " + titleOf(n), { label: "Abrir", run: () => openNote(n.id) });
    if (S.active === n.id) renderFoot();
    renderList();
  });
}

/* ---------- filtrar e classificar ---------- */
function filterModal() {
  const f = JSON.parse(JSON.stringify(S.filter));
  const tags = allTags();
  const pc = { 0: 0, 1: 0, 2: 0, 3: 0 }; live().forEach((n) => pc[n.prio || 0]++);
  const sc = {}; live().forEach((n) => n.stage && (sc[n.stage] = (sc[n.stage] || 0) + 1)); f.stage = f.stage || [];
  const body = () => `
    <div class="fsec"><div class="fl">${ic("tag")}Etiquetas</div><div class="opts">${tags.length ? tags.map(([t, c]) => `<button type="button" class="opt${f.tags.includes(t) ? " on" : ""}" data-ft="${esc(t)}">${esc(t)}<span class="n">${c}</span></button>`).join("") : `<span style="color:var(--faint);font-size:13px">Nenhuma etiqueta criada ainda.</span>`}</div></div>
    <div class="fsec"><div class="fl">${ic("flag")}Prioridade</div><div class="opts">${[3, 2, 1, 0].map((p) => `<button type="button" class="opt p${p}${f.prio.includes(p) ? " on" : ""}" data-fp="${p}">${p ? ic("flag") : ""}${PRIO[p]}<span class="n">${pc[p]}</span></button>`).join("")}</div></div>
    <div class="fsec"><div class="fl">${ic("video")}Etapa do vídeo</div><div class="opts">${STAGES.map((st) => `<button type="button" class="opt opt-stage${f.stage.includes(st.k) ? " on" : ""}" data-fs="${st.k}" style="--sc:${st.c}">${stageDot(st)}${st.label}<span class="n">${sc[st.k] || 0}</span></button>`).join("")}</div></div>
    <div class="fsec"><div class="fl">${ic("calendar")}Data de criação</div><div class="opts">${[["any", "Qualquer data"], ["today", "Hoje"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["custom", "Personalizado"]].map(([v, l]) => `<button type="button" class="opt${f.created === v ? " on" : ""}" data-fc="${v}">${l}</button>`).join("")}</div>
      ${f.created === "custom" ? `<div class="dates"><label>De<input class="field" type="date" id="fFrom" value="${f.from}"></label><label>Até<input class="field" type="date" id="fTo" value="${f.to}"></label></div>` : ""}</div>
    <div class="fsec"><div class="fl">${ic("check")}Mostrar só notas</div><div class="opts">${[["fav", "star", "Favoritas"], ["reminder", "bell", "Com lembrete"], ["img", "image", "Com imagens"], ["link", "link", "Com links"]].map(([k, i, l]) => `<button type="button" class="opt${f[k] ? " on" : ""}" data-fb="${k}">${ic(i)}${l}</button>`).join("")}</div></div>`;
  const count = () => { const keep = S.filter; S.filter = f; const c = visibleNotes().length; S.filter = keep; return c; };
  const m = modal(`<div class="m-head"><div class="m-ic">${ic("filter")}</div><h2>Filtrar notas</h2><button class="ib" id="fX" aria-label="Fechar">${ic("x")}</button></div>
    <div class="m-body" id="fBody">${body()}</div>
    <div class="m-foot"><button class="btn ghost" id="fClear">Limpar filtros</button><span class="grow"></span><button class="btn primary" id="fApply">Mostrar ${plural(count(), "nota", "notas")}</button></div>`, { wide: true });
  const refresh = () => { $("#fBody", m).innerHTML = body(); $("#fApply", m).textContent = "Mostrar " + plural(count(), "nota", "notas"); };
  m.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.ft) { const v = t.dataset.ft; f.tags = f.tags.includes(v) ? f.tags.filter((x) => x !== v) : [...f.tags, v]; refresh(); }
    else if (t.dataset.fp) { const v = +t.dataset.fp; f.prio = f.prio.includes(v) ? f.prio.filter((x) => x !== v) : [...f.prio, v]; refresh(); }
    else if (t.dataset.fc) { f.created = t.dataset.fc; refresh(); }
    else if (t.dataset.fs) { const v = t.dataset.fs; f.stage = f.stage.includes(v) ? f.stage.filter((x) => x !== v) : [...f.stage, v]; refresh(); }
    else if (t.dataset.fb) { f[t.dataset.fb] = !f[t.dataset.fb]; refresh(); }
    else if (t.id === "fClear") { Object.assign(f, blankFilter()); refresh(); }
    else if (t.id === "fApply") { S.filter = f; m.close(); renderList(true); saveSession(); }
    else if (t.id === "fX") m.close();
  });
  m.addEventListener("change", (e) => { if (e.target.id === "fFrom") f.from = e.target.value; if (e.target.id === "fTo") f.to = e.target.value; $("#fApply", m).textContent = "Mostrar " + plural(count(), "nota", "notas"); });
}
function sortPop(btn) {
  const s = S.sort, nbs = S.nbSort;
  const dirLabel = (by, d) => by === "title" || by === "name" ? (d === "asc" ? "A → Z" : "Z → A") : by === "priority" ? (d === "desc" ? "Mais alta primeiro" : "Mais baixa primeiro") : d === "desc" ? "Mais recentes primeiro" : "Mais antigas primeiro";
  menu(btn, [
    { h: "Classificar notas por" },
    ...[["manual", "Manual (arraste as notas)"], ["title", "Título"], ["updated", "Data de atualização"], ["created", "Data de criação"], ["priority", "Prioridade"]].map(([by, l]) => ({ label: l, checked: s.by === by, keep: true, run: () => { S.sort = { by, dir: by === "title" || by === "manual" ? "asc" : "desc" }; renderList(true); saveSession(); sortPop(btn); } })),
    ...(s.by === "manual" ? [] : ["-", { h: "Ordem" },
    ...["desc", "asc"].map((d) => ({ label: dirLabel(s.by, d), checked: s.dir === d, keep: true, run: () => { S.sort.dir = d; renderList(true); saveSession(); sortPop(btn); } }))]),
    "-", { h: "Cadernos na barra lateral" },
    ...[["name", "Nome"], ["updated", "Atualização mais recente"], ["created", "Data de criação"]].map(([by, l]) => ({ label: l, checked: nbs.by === by, keep: true, run: () => { S.nbSort = { by, dir: by === "name" ? "asc" : "desc" }; renderSidebar(); saveSession(); sortPop(btn); } }))
  ], { right: true });
}

/* ---------- configurações ---------- */
function settingsModal(tab) {
  const P = S.prefs;
  let cur = tab || "geral", meterStop = null;
  const TABS = [["geral", "folder", "Geral"], ["aparencia", "palette", "Aparência"], ["editor", "type", "Editor"], ["voz", "mic", "Microfone e voz"], ["atalhos", "keyboard", "Atalhos"]];
  const sw = (k, label, sub) => `<div class="set-row"><div class="sl"><b>${label}</b><span>${sub}</span></div><button class="switch${P[k] ? " on" : ""}" data-sw="${k}" role="switch" aria-checked="${!!P[k]}" aria-label="${label}"></button></div>`;
  const pane = {
    geral: () => `<div class="set-card pad about-card"><div class="about"><img src="${ICON}" alt=""><div><b>ForeverNote</b><br><span>by revmpt · ${WEB ? "versão celular" : "versão " + esc(appVer())}</span></div>${WEB ? "" : `<button class="btn" id="sUpd">${ic("restore")}Procurar atualizações</button>`}</div><div id="sUpdInfo" class="upd-info" hidden></div></div><h3>Geral</h3>
      ${WEB ? `<div class="set-card pad"><b>Suas notas neste aparelho</b><p style="font-size:12.5px;color:var(--muted);margin:6px 0 0">As notas que você cria aqui ficam guardadas neste celular. A <b>sincronização com o PC</b> está chegando: quando ligarmos, suas notas vão aparecer iguais nos dois lados.</p></div>` : `<div class="set-card pad"><b>Onde as notas ficam salvas</b><div class="path-box">${esc(S.dataDir)}</div>
        <p style="font-size:12.5px;color:var(--muted);margin:0">Para ter uma cópia na nuvem, escolha uma pasta dentro do <b>Google Drive</b> (por exemplo, “Meu Drive”). As notas atuais são copiadas para lá.</p>
        <div class="opts"><button class="btn" id="sOpen">${ic("folder")}Abrir pasta</button><button class="btn" id="sChange">Trocar pasta…</button></div></div>
      <div class="set-card"><div class="set-row"><div class="sl"><b>Nota rápida</b><span>Clique no ícone do ForeverNote na bandeja (perto do relógio) ou use o atalho</span></div><kbd>Ctrl+Alt+N</kbd></div>
        ${sw("closeToTray", "Fechar leva para a bandeja", "O X esconde o app perto do relógio, sem fechar. Para sair de vez: botão direito no ícone › Sair.")}
        ${sw("minToTray", "Minimizar leva para a bandeja", "Ao minimizar, o app some da barra de tarefas e fica perto do relógio.")}
        ${sw("startLogin", "Iniciar com o Windows", "Abre escondido na bandeja quando o computador liga, pronto para notas rápidas.")}</div>
      <div class="set-card pad"><div style="display:flex;align-items:center;gap:12px"><span class="ev-logo">${ic("restore")}</span><div style="flex:1"><b>Importar do Evernote</b><p style="font-size:12.5px;color:var(--muted);margin:2px 0 0">Traz cadernos, notas, etiquetas, imagens e anexos, mantendo as datas de criação e edição.</p></div><button class="btn primary" id="sEnex">Importar…</button></div></div>
      <div class="set-card pad"><b>Cópias de segurança</b><p style="font-size:12.5px;color:var(--muted);margin:0">Todo dia o app guarda uma cópia de todas as suas notas, cadernos, imagens e áudios. As cópias dos últimos 14 dias ficam disponíveis, e notas excluídas da lixeira podem ser recuperadas por 14 dias. Suas notas em si nunca são apagadas.</p><div class="opts"><button class="btn primary" id="sRestore">${ic("restore")}Restaurar…</button><button class="btn" id="sBackups">${ic("folder")}Abrir pasta das cópias</button></div></div>`}`,
    aparencia: () => `<h3>Aparência</h3>
      <div class="set-card"><div class="set-row"><div class="sl"><b>Tema</b><span>Claro, escuro ou igual ao Windows</span></div><div class="seg" id="sTheme">${[["system", "Sistema"], ["light", "Claro"], ["dark", "Escuro"]].map(([v, l]) => `<button data-theme="${v}" class="${P.theme === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      ${sw("anim", "Animações", "Transições suaves ao abrir notas, menus e janelas.")}
      ${sw("wide", "Texto em largura total", "Usa toda a largura da tela para o texto das notas.")}</div>`,
    editor: () => `<h3>Editor</h3>
      <div class="set-card"><div class="set-row"><div class="sl"><b>Fonte padrão das notas</b><span>Usada no texto sem fonte escolhida</span></div><select class="field" id="sFont" style="width:180px">${FONTS.map(([k, l, st]) => `<option value="${esc(k === "fn-sans" ? "" : st)}"${(P.font || "") === (k === "fn-sans" ? "" : st) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="set-row"><div class="sl"><b>Tamanho padrão</b><span>Tamanho da letra do texto da nota</span></div><select class="field" id="sSize" style="width:90px">${[13, 14, 15, 16, 17, 18, 20].map((x) => `<option${(P.size || 16) === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="set-row"><div class="sl"><b>Ritmo de fala</b><span>Usado no tempo estimado que aparece no rodapé da nota</span></div><div class="seg" id="sWpm">${PACES.map(([v, l]) => `<button data-wpm="${v}" class="${(P.wpm || 150) === v ? "on" : ""}" title="${v} palavras por minuto">${l}</button>`).join("")}</div></div>
      ${sw("spell", "Correção ortográfica", "Sublinha palavras erradas. Botão direito mostra sugestões.")}
      ${sw("autocap", "Maiúscula automática", "Começa frases com letra maiúscula.")}
      ${sw("autolink", "Links automáticos", "Transforma www.site.com em link clicável.")}
      ${sw("hints", "Dica na linha vazia", "Mostra “Digite / para comandos ou @ para vincular uma nota”.")}
      ${sw("proofOnline", "Revisão online (LanguageTool)", "Gramática e concordância mais completas. O trecho revisado é enviado ao serviço gratuito LanguageTool.")}</div>`,
    voz: () => `<h3>Microfone e voz</h3>
      <div class="set-card pad"><b>Microfone</b>
        <div class="mic-row"><select class="field" id="sMic"><option value="">Padrão do Windows</option></select><button class="btn" id="sMicTest">${ic("mic")}Testar</button></div>
        <div class="meter" id="sMeterW" hidden><i id="sMeter"></i></div>
        <span id="sMicHint" style="font-size:12px;color:var(--faint)">Fale algo durante o teste: a barra deve se mexer.</span></div>
      <div class="set-card"><div class="set-row"><div class="sl"><b>Idioma da transcrição</b><span>Língua falada nas gravações</span></div><select class="field" id="sLang" style="width:200px">${[["pt", "Português"], ["en", "Inglês"], ["es", "Espanhol"], ["auto", "Detectar automaticamente"]].map(([v, l]) => `<option value="${v}"${(P.lang || "pt") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="set-row"><div class="sl"><b>Depois de gravar</b><span>O que fazer quando a gravação termina</span></div><div class="seg" id="sAfter">${[["ask", "Perguntar"], ["always", "Transcrever"], ["never", "Só guardar"]].map(([v, l]) => `<button data-after="${v}" class="${(P.afterRec || "ask") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="set-row"><div class="sl"><b>Pacote de reconhecimento de voz</b><span id="sVoiceSub">Verificando…</span></div><div id="sVoiceBtns"></div></div></div>`,
    atalhos: () => `<h3>Atalhos</h3><div class="set-card pad"><div class="keys">
      ${[["Nova nota", "Ctrl+N"], ["Novo caderno", "Ctrl+Shift+N"], ["Pesquisar", "Ctrl+K"], ["Localizar na nota", "Ctrl+F"], ["Comandos rápidos", "/"], ["Vincular uma nota", "@"], ["Inserir link", "Ctrl+Shift+K"], ["Lista de tarefas", "Ctrl+Shift+L"], ["Data e hora", "F5"], ["Corrigir texto", "F7"], ["Nota rápida (de qualquer lugar)", "Ctrl+Alt+N"], ["Expandir a nota", "Ctrl+Shift+E"], ["Tela cheia", "F11 · Esc sai"], ["Fechar aba", "Ctrl+W"], ["Próxima aba", "Ctrl+Tab"], ["Voltar / avançar", "Alt+← / Alt+→"], ["Zoom do texto", "Ctrl + / Ctrl − / Ctrl+0"]].map(([a, b]) => `<span>${a}</span><kbd>${b}</kbd>`).join("")}</div></div>`
  };
  const m = modal(`<div class="m-head"><div class="m-ic">${ic("gear")}</div><h2>Configurações</h2><button class="ib" id="sX" aria-label="Fechar">${ic("x")}</button></div>
    <div class="set-wrap"><nav class="set-nav">${TABS.map(([k, i, l]) => `<button data-tab-set="${k}">${ic(i)}<span>${l}</span></button>`).join("")}</nav><div class="set-pane" id="sPane"></div></div>`,
    { wide: true, onClose: () => meterStop && meterStop() });
  m.querySelector(".modal").classList.add("settings");
  const show = (k) => {
    if (meterStop) meterStop();
    cur = k; $$("[data-tab-set]", m).forEach((b) => b.classList.toggle("on", b.dataset.tabSet === k));
    const pn = $("#sPane", m); pn.innerHTML = pane[k](); pn.style.animation = "none"; void pn.offsetWidth; pn.style.animation = "";
    if (k === "voz") { loadMics(); voiceInfo(); }
  };
  async function loadMics() {
    const sel = $("#sMic", m); if (!sel || !navigator.mediaDevices) return;
    let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    if (devs.length && !devs[0].label) { try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications"); } catch (e) {} }
    sel.innerHTML = `<option value="">Padrão do Windows</option>` + devs.map((d, i) => `<option value="${esc(d.deviceId)}"${P.micId === d.deviceId ? " selected" : ""}>${esc(d.label || "Microfone " + (i + 1))}</option>`).join("");
    if (P.micId && !devs.some((d) => d.deviceId === P.micId)) $("#sMicHint", m).textContent = "O microfone escolhido antes não está conectado. Usando o padrão.";
  }
  async function voiceInfo() {
    const sub = $("#sVoiceSub", m), box = $("#sVoiceBtns", m); if (!sub) return;
    if (!api.voiceStatus) { sub.textContent = "Disponível no app instalado"; box.innerHTML = ""; return; }
    const st = await api.voiceStatus();
    sub.innerHTML = st.model ? `<span class="pill ok">${ic("check")}Instalado</span> Funciona sem internet` : `<span class="pill no">Não instalado</span> Cerca de ${st.size} MB`;
    box.innerHTML = st.model ? `<button class="btn ghost danger" id="sVoiceDel">Remover</button>` : `<button class="btn primary" id="sVoiceGet">Baixar agora</button>`;
  }
  async function toggleMeter() {
    if (meterStop) { meterStop(); return; }
    const btn = $("#sMicTest", m);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: P.micId ? { deviceId: { exact: P.micId } } : true }); }
    catch (e) { $("#sMicHint", m).textContent = "Não consegui acessar esse microfone. Confira se ele está conectado e permitido no Windows."; return; }
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.fftSize); let raf, peak = 0;
    $("#sMeterW", m).hidden = false; btn.innerHTML = ic("stop") + "Parar"; btn.classList.add("primary");
    const loop = () => { an.getByteTimeDomainData(data); let sum = 0; for (const v of data) { const x = (v - 128) / 128; sum += x * x; } const lvl = Math.min(1, Math.sqrt(sum / data.length) * 5); peak = Math.max(lvl, peak * .92); const el = $("#sMeter", m); if (el) el.style.width = (peak * 100) + "%"; raf = requestAnimationFrame(loop); };
    loop();
    meterStop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); meterStop = null; const b2 = $("#sMicTest", m); if (b2) { b2.innerHTML = ic("mic") + "Testar"; b2.classList.remove("primary"); } const w = $("#sMeterW", m); if (w) w.hidden = true; };
  }
  m.addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.tabSet) return show(t.dataset.tabSet);
    if (t.id === "sX") m.close();
    if (t.id === "sOpen") api.openFolder("data");
    if (t.id === "sBackups") api.openFolder("backups");
    if (t.id === "sRestore") { m.close(); setTimeout(restoreModal, 180); }
    if (t.id === "sEnex") { m.close(); setTimeout(importEvernote, 180); }
    if (t.id === "sUpd") checkForUpdate(t, m);
    if (t.id === "sChange") { flushSave(); const r = await api.chooseFolder(); if (r) { toast(r.usedExisting ? "Usando as notas que já estavam nessa pasta" : "Notas copiadas para a nova pasta"); setTimeout(() => (api.reload ? api.reload() : location.reload()), 900); } }
    if (t.dataset.theme) { P.theme = t.dataset.theme; $$("#sTheme button", m).forEach((b) => b.classList.toggle("on", b === t)); savePrefs(); }
    if (t.dataset.wpm) { P.wpm = +t.dataset.wpm; $$("#sWpm button", m).forEach((b) => b.classList.toggle("on", b === t)); savePrefs(); updateWordCount(); }
    if (t.dataset.after) { P.afterRec = t.dataset.after; $$("#sAfter button", m).forEach((b) => b.classList.toggle("on", b === t)); savePrefs(); }
    if (t.dataset.sw) {
      const k = t.dataset.sw; P[k] = !P[k]; t.classList.toggle("on", P[k]); t.setAttribute("aria-checked", P[k]); savePrefs();
      if (k === "anim") document.documentElement.classList.toggle("no-anim", !P.anim);
      if (k === "wide") $("#app").classList.toggle("wide", P.wide);
      if (k === "spell" && ED) { ED.doc.spellcheck = P.spell; ED.title.spellcheck = P.spell; }
      if (k === "hints") hideLineHint();
      if (k === "startLogin" && api.setLogin) api.setLogin(P.startLogin);
    }
    if (t.id === "sMicTest") toggleMeter();
    if (t.id === "sVoiceGet") { if (await voiceModal()) voiceInfo(); }
    if (t.id === "sVoiceDel") { if (await ask({ title: "Remover o reconhecimento de voz?", text: "Libera cerca de 190 MB. Para transcrever de novo, o app baixa o pacote outra vez.", ok: "Remover", danger: true, icon: "mic" })) { await api.voiceRemove(); voiceInfo(); toast("Pacote de voz removido"); } }
  });
  m.addEventListener("change", (e) => {
    const id = e.target.id;
    if (id === "sFont") { P.font = e.target.value; savePrefs(); if (ED) ED.doc.style.fontFamily = P.font; }
    if (id === "sSize") { P.size = +e.target.value; savePrefs(); if (ED) ED.doc.style.fontSize = `calc(${P.size}px * var(--zoom))`; }
    if (id === "sMic") { P.micId = e.target.value; savePrefs(); if (meterStop) { meterStop(); toggleMeter(); } toast("Microfone salvo"); }
    if (id === "sLang") { P.lang = e.target.value; savePrefs(); }
  });
  show(cur);
}

/* =========================================================
   Arrastar blocos dentro da nota
   ========================================================= */
let DRAGB = null, BLK_DROP = null, hoverBlk = null;
function blockCandidates() {
  const out = [];
  [...ED.doc.children].forEach((c) => { if (c.tagName === "UL" || c.tagName === "OL") { const lis = [...c.children].filter((x) => x.tagName === "LI"); lis.length ? out.push(...lis) : out.push(c); } else out.push(c); });
  return out;
}
function blockAtY(y, wantLi) {
  if (!ED) return null;
  let list = blockCandidates();
  if (wantLi === false) list = [...ED.doc.children];
  let best = null, bd = 1e9;
  for (const b of list) { const r = b.getBoundingClientRect(); if (y >= r.top - 3 && y <= r.bottom + 3) return b; const d = Math.min(Math.abs(y - r.top), Math.abs(y - r.bottom)); if (d < bd) { bd = d; best = b; } }
  return best;
}
function placeHandle(b) {
  const h = $("#blkHandle"); if (!h || !b) return;
  const page = h.parentNode.getBoundingClientRect(), r = b.getBoundingClientRect(), dr = ED.doc.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(b).lineHeight) || 26;
  h.style.top = (r.top - page.top + Math.max(0, (Math.min(lh, r.height) - 26) / 2)) + "px";
  h.style.left = (dr.left - page.left - 30 - (b.tagName === "LI" ? 22 : 0)) + "px";
  h.classList.add("show"); hoverBlk = b;
}
function hideHandle() { const h = $("#blkHandle"); if (h && !DRAGB) h.classList.remove("show"); }
document.addEventListener("mousemove", (e) => {
  if (!ED || DRAGB || ED.doc.contentEditable !== "true") return;
  const page = e.target.closest?.(".page");
  if (!page) { hideHandle(); return; }
  if (e.target.closest(".blk-handle")) return;
  const b = blockAtY(e.clientY);
  if (b) placeHandle(b); else hideHandle();
});
document.addEventListener("dragstart", (e) => {
  if (!e.target.closest?.(".blk-handle") || !hoverBlk) return;
  DRAGB = hoverBlk;
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-fn-block", "1");
  try { e.dataTransfer.setDragImage(DRAGB, 20, 16); } catch (er) {}
  requestAnimationFrame(() => DRAGB && DRAGB.classList.add("blk-dragging"));
}, true);
function blockDropTarget(y) {
  const isLi = DRAGB.tagName === "LI";
  let t = blockAtY(y, isLi ? undefined : false);
  if (!t) return null;
  if (isLi && t.tagName !== "LI") return null;
  const r = t.getBoundingClientRect();
  return { el: t, after: y > r.top + r.height / 2 };
}
document.addEventListener("dragover", (e) => {
  if (!DRAGB) return;
  if (!e.target.closest?.(".page")) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  const tg = blockDropTarget(e.clientY); BLK_DROP = tg;
  const line = $("#blkDrop"); if (!line) return;
  if (!tg || tg.el === DRAGB) { line.classList.remove("show"); return; }
  const page = line.parentNode.getBoundingClientRect(), r = tg.el.getBoundingClientRect(), dr = ED.doc.getBoundingClientRect();
  line.style.top = ((tg.after ? r.bottom + 3 : r.top - 4) - page.top) + "px";
  line.style.left = (r.left - page.left) + "px"; line.style.width = (dr.right - r.left) + "px";
  line.classList.add("show");
}, true);
document.addEventListener("drop", (e) => {
  if (!DRAGB) return;
  e.preventDefault(); e.stopPropagation();
  const tg = BLK_DROP, b = DRAGB;
  if (tg && tg.el !== b) {
    const oldList = b.tagName === "LI" ? b.parentNode : null;
    const first = b.getBoundingClientRect().top;
    tg.after ? tg.el.after(b) : tg.el.before(b);
    if (oldList && !oldList.children.length) oldList.remove();
    b.classList.remove("blk-dragging");
    const dy = first - b.getBoundingClientRect().top;
    b.animate([{ transform: `translateY(${dy}px)`, background: "var(--accent-soft)" }, { transform: "none", background: "transparent" }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" });
    onDocChange();
  }
  endBlockDrag();
}, true);
document.addEventListener("dragend", () => { if (DRAGB) endBlockDrag(); }, true);
function endBlockDrag() { if (DRAGB) DRAGB.classList.remove("blk-dragging"); if (DRAGB && !DRAGB.getAttribute("class")) DRAGB.removeAttribute("class"); DRAGB = null; BLK_DROP = null; $("#blkDrop")?.classList.remove("show"); hideHandle(); }
function blockMenu(btn) {
  const b = hoverBlk; if (!b || !ED) return;
  const caretIn = () => { const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); savedRange = r; };
  const turn = (fn) => () => { caretIn(); fn(); };
  menu(btn, [
    { h: "Transformar em" },
    { icon: "notes", label: "Texto", run: turn(() => exec("formatBlock", "p")) },
    { icon: "h1", label: "Título grande", run: turn(() => exec("formatBlock", "h1")) },
    { icon: "h2", label: "Título médio", run: turn(() => exec("formatBlock", "h2")) },
    { icon: "check-list", label: "Lista de tarefas", run: turn(toggleChecklist) },
    { icon: "quote", label: "Citação", run: turn(() => exec("formatBlock", "blockquote")) },
    "-",
    { icon: "up", label: "Mover para cima", run: () => { const p = b.previousElementSibling; if (p) { p.before(b); onDocChange(); } } },
    { icon: "down", label: "Mover para baixo", run: () => { const n2 = b.nextElementSibling; if (n2) { n2.after(b); onDocChange(); } } },
    { icon: "dup", label: "Duplicar", run: () => { const c = b.cloneNode(true); b.after(c); c.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 300 }); onDocChange(); } },
    { icon: "trash", label: "Excluir bloco", danger: true, run: () => { const pl = b.parentNode; b.remove(); if ((pl.tagName === "UL" || pl.tagName === "OL") && !pl.children.length) pl.remove(); onDocChange(); hideHandle(); } }
  ]);
}
document.addEventListener("click", (e) => { const h = e.target.closest?.(".blk-handle"); if (h) { e.stopPropagation(); blockMenu(h); } }, true);

/* dica na linha vazia */
function hideLineHint() { $("#lineHint")?.classList.remove("show"); }
function updateLineHint() {
  const h = $("#lineHint"); if (!h || !ED) return;
  if (!S.prefs.hints || TRIG || document.activeElement !== ED.doc || ED.doc.contentEditable !== "true") return hideLineHint();
  const el = selEl(); const b = el && el !== ED.doc ? el.closest("p,h1,h2,h3,li,div:not(.callout):not(.audio-block)") : null;
  if (!b || b.textContent.replace(/\u200b/g, "").length || b.querySelector("img,.audio-block,table,hr") || b.closest("pre,td,th") || b.hasAttribute("data-ph")) return hideLineHint();
  const page = h.parentNode.getBoundingClientRect(), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  h.style.top = (r.top - page.top + (parseFloat(cs.paddingTop) || 0)) + "px";
  h.style.left = (r.left - page.left + (parseFloat(cs.paddingLeft) || 0)) + "px";
  h.style.maxWidth = Math.max(80, r.width - 8) + "px"; h.style.lineHeight = cs.lineHeight; h.style.fontSize = cs.fontSize;
  h.classList.add("show");
}

/* =========================================================
   Menus "/" (comandos) e "@" (vincular nota)
   ========================================================= */
const SLASH = [
  { sec: "Essenciais" },
  { id: "todo", icon: "check-list", label: "Lista de tarefas", desc: "Itens com caixinha para marcar", k: "Ctrl+Shift+L", kw: "tarefa todo check checklist" },
  { id: "ul", icon: "ul", label: "Lista com marcadores", desc: "Lista simples com pontos", kw: "lista bullet topicos" },
  { id: "ol", icon: "ol", label: "Lista numerada", desc: "Passos em ordem", kw: "numero passos" },
  { id: "h1", icon: "h1", label: "Título grande", kw: "titulo h1 cabecalho" },
  { id: "h2", icon: "h2", label: "Título médio", kw: "titulo h2 subtitulo" },
  { id: "h3", icon: "h3", label: "Título pequeno", kw: "titulo h3" },
  { id: "callout", icon: "callout", label: "Caixa de destaque", desc: "Bloco colorido para chamar atenção", kw: "destaque aviso nota callout" },
  { id: "quote", icon: "quote", label: "Citação", kw: "citacao quote" },
  { id: "table", icon: "table", label: "Tabela", desc: "Grade de 3 × 3. Tab vai para a próxima célula", kw: "tabela grade planilha" },
  { id: "code", icon: "code", label: "Bloco de código", kw: "codigo code" },
  { id: "hr", icon: "hr", label: "Divisor", desc: "Linha separando seções", k: "---", kw: "linha separador divisor" },
  { sec: "Inserir" },
  { id: "notelink", icon: "link-note", label: "Link para nota", desc: "Vincular outra nota a esta", k: "@", kw: "vincular nota link mencionar" },
  { id: "newlinked", icon: "note-add", label: "Nova nota vinculada", desc: "Cria uma nota e coloca o link aqui", kw: "nova nota vinculada criar" },
  { id: "link", icon: "link", label: "Link", desc: "Endereço de site", k: "Ctrl+Shift+K", kw: "link url site" },
  { id: "image", icon: "image", label: "Imagem", kw: "imagem foto figura" },
  { id: "mic", icon: "mic", label: "Gravar áudio", desc: "Grave e transforme em texto", kw: "audio gravar voz microfone transcrever" },
  { id: "date", icon: "clock", label: "Data e hora", k: "F5", kw: "data hora hoje" },
  { id: "proof", icon: "proof", label: "Corrigir texto", desc: "Gramática, pontuação e ortografia", k: "F7", kw: "corrigir revisar gramatica ortografia pontuacao" },
  { sec: "Nota" },
  { id: "reminder", icon: "bell", label: "Lembrete", desc: "Avisar sobre esta nota", kw: "lembrete alarme aviso" },
  { id: "tag", icon: "tag", label: "Adicionar etiqueta", kw: "etiqueta tag" },
  { id: "prio", icon: "flag", label: "Prioridade", kw: "prioridade urgente" },
  { id: "stage", icon: "video", label: "Etapa do vídeo", desc: "Ideia, roteiro, gravação, edição ou postado", kw: "etapa status video ideia roteiro gravacao edicao postado" },
  { id: "template", icon: "template", label: "Modelo", desc: "Preencher com um modelo pronto", kw: "modelo template roteiro short checklist publi" }
];
let TRIG = null;
function caretInfo() { const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return null; return { node: s.anchorNode, off: s.anchorOffset }; }
function openTrigger(ch) {
  const c = caretInfo(); if (!c || c.node.nodeType !== 3) return;
  if (selEl()?.closest("pre,code,a")) return;
  const start = c.off - 1, before = c.node.textContent.slice(0, start);
  if (before.length && !/[\s ]$/.test(before)) return;
  TRIG = { kind: ch, node: c.node, start, q: "", sel: 0, items: [] };
  hideLineHint(); renderTrigger();
}
function updateTrigger(fromSel) {
  if (!TRIG) return;
  const c = caretInfo();
  if (!c || c.node !== TRIG.node || c.off <= TRIG.start || TRIG.node.textContent[TRIG.start] !== TRIG.kind) { closeTrigger(); return; }
  const q = TRIG.node.textContent.slice(TRIG.start + 1, c.off);
  if (q === TRIG.q && fromSel) return;
  if ((TRIG.kind === "/" && (/\s/.test(q) || q.length > 24)) || q.length > 48 || /\s\s$/.test(q)) { closeTrigger(); return; }
  TRIG.q = q; TRIG.sel = 0; renderTrigger();
}
function trigItems() {
  const q = norm(TRIG.q.replace(/ /g, " ")).trim();
  if (TRIG.kind === "/") {
    const out = []; let sec = null;
    SLASH.forEach((it) => { if (it.sec) { sec = it.sec; return; } if (!q || norm(it.label + " " + (it.kw || "")).includes(q)) out.push({ ...it, secName: sec }); });
    return out;
  }
  const notes = [...S.notes.values()].filter((n) => !n.trashed && n.id !== (ED && ED.id)).filter((n) => !q || norm(titleOf(n) + " " + nbName(n.nb)).includes(q))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 30).map((n) => ({ id: "note:" + n.id, note: n, icon: "notes", label: titleOf(n), desc: nbName(n.nb) }));
  if (q) notes.push({ id: "create", icon: "plus", label: `Criar nota “${TRIG.q.trim()}”`, desc: "Nova nota vinculada a esta", create: true });
  return notes;
}
function renderTrigger() {
  TRIG.items = trigItems();
  const r = document.createRange();
  try { r.setStart(TRIG.node, TRIG.start); r.setEnd(TRIG.node, TRIG.start + 1); } catch (e) { closeTrigger(); return; }
  const rect = r.getBoundingClientRect();
  const anchor = { getBoundingClientRect: () => ({ left: rect.left - 6, right: rect.right, top: rect.top - 2, bottom: rect.bottom + 2 }), contains: () => false };
  let h = "", lastSec = null;
  if (TRIG.kind === "@") h += `<div class="pop-h">${TRIG.q ? "Notas encontradas" : "Notas recentes"}</div>`;
  TRIG.items.forEach((it, i) => {
    if (TRIG.kind === "/" && it.secName !== lastSec) { lastSec = it.secName; h += `<div class="pop-h">${esc(it.secName)}</div>`; }
    h += `<button class="cmd-item${i === TRIG.sel ? " sel" : ""}${it.create ? " cmd-new" : ""}" data-ti="${i}"><span class="ci">${ic(it.icon)}</span><span class="ct"><b>${TRIG.kind === "@" && !it.create ? hlq(it.label, TRIG.q) : esc(it.label)}</b>${it.desc ? `<span>${esc(it.desc)}</span>` : ""}</span>${it.k ? `<span class="k hide-sel">${esc(it.k)}</span>` : ""}<span class="enter">${TRIG.kind === "@" ? "Enter para adicionar" : ""}${ic("enter")}</span></button>`;
  });
  if (!TRIG.items.length) h += `<div class="cmd-empty">${TRIG.kind === "/" ? "Nenhum comando encontrado" : "Nenhuma nota encontrada"}</div>`;
  const keepScroll = popEl && popEl.classList.contains("cmd-pop") ? popEl.scrollTop : 0;
  const wasOpen = popEl && popEl.classList.contains("cmd-pop");
  if (wasOpen) { popEl.innerHTML = h; }
  else { popover(anchor, h); popEl.classList.add("cmd-pop"); popEl.addEventListener("mousemove", (e) => { const b = e.target.closest("[data-ti]"); if (b && TRIG && +b.dataset.ti !== TRIG.sel) { TRIG.sel = +b.dataset.ti; paintTrigSel(); } }); popEl.addEventListener("click", (e) => { const b = e.target.closest("[data-ti]"); if (b) chooseTrig(+b.dataset.ti); }); }
  if (wasOpen) popEl.scrollTop = keepScroll;
  const pr = popEl.getBoundingClientRect();
  let top = rect.bottom + 6; if (top + pr.height > innerHeight - 8) top = Math.max(8, rect.top - pr.height - 6);
  popEl.style.top = top + "px"; popEl.style.left = Math.max(8, Math.min(rect.left - 6, innerWidth - pr.width - 8)) + "px";
}
const hlq = (text, q) => { const nq = norm(q).trim(); if (!nq) return esc(text); const i = norm(text).indexOf(nq); if (i < 0) return esc(text); return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + nq.length)) + "</mark>" + esc(text.slice(i + nq.length)); };
function paintTrigSel() { if (!popEl) return; $$(".cmd-item", popEl).forEach((b, i) => b.classList.toggle("sel", i === TRIG.sel)); $(".cmd-item.sel", popEl)?.scrollIntoView({ block: "nearest" }); }
function moveTrigSel(d) { if (!TRIG.items.length) return; TRIG.sel = (TRIG.sel + d + TRIG.items.length) % TRIG.items.length; paintTrigSel(); }
function closeTrigger() { if (!TRIG) return; TRIG = null; if (popEl && popEl.classList.contains("cmd-pop")) closePop(); }
function deleteTrigText() {
  const c = caretInfo(); const end = c && c.node === TRIG.node ? c.off : TRIG.start + 1 + TRIG.q.length;
  const r = document.createRange(); r.setStart(TRIG.node, TRIG.start); r.setEnd(TRIG.node, Math.min(end, TRIG.node.textContent.length));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("delete"); saveSel();
}
function insertNoteLink(n) {
  restoreSel();
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0); r.deleteContents();
  const tmp = document.createElement("div"); tmp.innerHTML = noteLinkHTML(n);
  const a = tmp.firstChild, sp = document.createTextNode("\u00a0");
  r.insertNode(sp); r.insertNode(a);
  const r2 = document.createRange(); r2.setStartAfter(sp); r2.collapse(true); sel.removeAllRanges(); sel.addRange(r2);
  a.animate([{ transform: "scale(.7)", opacity: 0 }, { transform: "scale(1.08)", opacity: 1, offset: .6 }, { transform: "none" }], { duration: 380, easing: "ease-out" });
  saveSel(); refreshNoteLinks(); onDocChange();
}
function noteLinkHTML(n) { return `<a class="note-link" data-note="${n.id}" href="#" contenteditable="false">${ic("notes")}<span>${esc(titleOf(n))}</span></a>&nbsp;`; }
function refreshNoteLinks(root) { (root || ED?.doc)?.querySelectorAll("a.note-link").forEach((a) => { const n = S.notes.get(a.dataset.note); const sp = a.querySelector("span"); if (sp) sp.textContent = n ? titleOf(n) : "Nota excluída"; a.classList.toggle("missing", !n || !!n.trashed); a.contentEditable = "false"; }); }
function createLinkedNote(title) {
  const now = Date.now(), cur = S.notes.get(ED.id);
  const n = { id: uid("nt_"), nb: cur ? cur.nb : defaultNb(), title: title || "Nova nota", html: "", text: "", tags: [], prio: 0, reminder: null, reminderDone: false, fav: false, trashed: false, created: now, updated: now };
  S.notes.set(n.id, n); markNote(n.id); renderList(); renderSidebar();
  return n;
}
function chooseTrig(i) {
  const it = TRIG && TRIG.items[i]; if (!it) return;
  const kind = TRIG.kind, q0 = TRIG.q.trim();
  deleteTrigText(); closeTrigger();
  if (kind === "@") {
    const n = it.create ? createLinkedNote(q0) : it.note;
    insertNoteLink(n);
    if (it.create) toast("Nota criada e vinculada", { label: "Abrir", run: () => openNote(n.id, { newTab: true }) });
    return;
  }
  const curBlock = () => selEl()?.closest("p,div,h1,h2,h3,blockquote,li");
  const caretInto = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); saveSel(); };
  switch (it.id) {
    case "todo": toggleChecklist(); break;
    case "ul": listToggle("ul"); break;
    case "ol": listToggle("ol"); break;
    case "h1": case "h2": case "h3": exec("formatBlock", it.id); break;
    case "quote": exec("formatBlock", "blockquote"); break;
    case "code": exec("formatBlock", "pre"); break;
    case "hr": exec("insertHorizontalRule"); break;
    case "callout": {
      const b = curBlock(); exec("insertHTML", `<div class="callout"><p id="fnNew"><br></p></div><p><br></p>`);
      if (b && b.tagName === "P" && !b.textContent.trim() && b.parentNode === ED.doc) b.remove();
      const np = $("#fnNew"); if (np) { np.removeAttribute("id"); caretInto(np); } onDocChange(); break;
    }
    case "table": {
      const b = curBlock(); const row = (tag) => `<tr>${`<${tag}><br></${tag}>`.repeat(3)}</tr>`;
      exec("insertHTML", `<table><tbody>${row("td").replace("<td>", '<td id="fnNew">')}${row("td")}${row("td")}</tbody></table><p><br></p>`);
      if (b && b.tagName === "P" && !b.textContent.trim() && b.parentNode === ED.doc) b.remove();
      const c = $("#fnNew"); if (c) { c.removeAttribute("id"); caretInto(c); } onDocChange(); break;
    }
    case "notelink": exec("insertText", "@"); openTrigger("@"); break;
    case "newlinked": { const n = createLinkedNote("Nova nota"); insertNoteLink(n); toast("Nota criada e vinculada", { label: "Abrir", run: () => openNote(n.id, { newTab: true }) }); break; }
    case "link": openLinkEditor(); break;
    case "image": $("#imgInput").click(); break;
    case "mic": startRecording(); break;
    case "date": insertDateTime(); break;
    case "proof": proofText("all"); break;
    case "reminder": { const b = $('[data-act="reminder"]'); if (b) reminderPop(b); break; }
    case "tag": $("#tagIn")?.focus(); break;
    case "prio": { const b = $('[data-act="prio"]'); if (b) prioPop(b); break; }
    case "stage": { const b = $('[data-act="stage"]'); if (b) stagePop(b, [ED.id]); break; }
    case "template": templatePicker("apply"); break;
  }
}

/* ---------- seleção múltipla ---------- */
function togglePick(id) { S.picked.has(id) ? S.picked.delete(id) : S.picked.add(id); S.lastPick = id; paintPicks(); }
function pickRange(a, b) {
  const ids = visibleNotes().map((n) => n.id); let i = ids.indexOf(a), j = ids.indexOf(b);
  if (i < 0 || j < 0) return togglePick(b);
  if (i > j) [i, j] = [j, i];
  ids.slice(i, j + 1).forEach((x) => S.picked.add(x)); S.lastPick = b; paintPicks();
}
function pickAll() { const ids = visibleNotes().map((n) => n.id); const all = ids.length && ids.every((x) => S.picked.has(x)); S.picked = all ? new Set() : new Set(ids); paintPicks(); }
function clearPicks() { S.picked.clear(); S.pickMode = false; S.lastPick = null; paintPicks(); }
function paintPicks() {
  $$(".card", $("#notes")).forEach((c) => c.classList.toggle("picked", S.picked.has(c.dataset.note)));
  $("#list").classList.toggle("picking", S.pickMode || S.picked.size > 0);
  $("#listPick").classList.toggle("on", S.pickMode || S.picked.size > 0);
  renderBulk();
}
function renderBulk() {
  const bar = $("#bulk"); const n = S.picked.size;
  $("#listPick")?.classList.toggle("on", S.pickMode || n > 0);
  if (!n && !S.pickMode) { if (!bar.hidden) { bar.classList.add("out"); setTimeout(() => { bar.hidden = true; bar.classList.remove("out"); }, 200); } return; }
  const trash = S.sel.type === "trash";
  const total = visibleNotes().length;
  const allFav = n && [...S.picked].every((id) => S.notes.get(id)?.fav);
  bar.innerHTML = `<div class="bulk-top"><b>${n ? plural(n, "nota selecionada", "notas selecionadas") : "Toque nas notas para selecionar"}</b>
      <button class="bulk-link" data-bk="all">${n === total && n ? "Desmarcar todas" : "Selecionar todas"}</button><button class="ib sm" data-bk="cancel" title="Cancelar (Esc)" aria-label="Cancelar seleção">${ic("x")}</button></div>
    <div class="bulk-acts">${trash
      ? `<button class="bk" data-bk="restore"${n ? "" : " disabled"}>${ic("restore")}<span>Restaurar</span></button><button class="bk danger" data-bk="purge"${n ? "" : " disabled"}>${ic("trash")}<span>Excluir para sempre</span></button>`
      : `<button class="bk" data-bk="move"${n ? "" : " disabled"}>${ic("book")}<span>Mover</span></button><button class="bk" data-bk="tag"${n ? "" : " disabled"}>${ic("tag")}<span>Etiqueta</span></button><button class="bk" data-bk="stage"${n ? "" : " disabled"}>${ic("video")}<span>Etapa</span></button><button class="bk" data-bk="fav"${n ? "" : " disabled"}>${ic("star")}<span>${allFav ? "Desfavoritar" : "Favoritar"}</span></button><button class="bk danger" data-bk="trash"${n ? "" : " disabled"}>${ic("trash")}<span>Lixeira</span></button>`}</div>`;
  if (bar.hidden) { bar.hidden = false; }
}
function afterBulk(ids) {
  ids.forEach((id) => { const i = S.tabs.indexOf(id); if (i >= 0) S.tabs.splice(i, 1); if (S.active === id) S.active = null; });
  if (!S.active) S.active = S.tabs[S.tabs.length - 1] || null;
}
function bulkTrash() {
  const ids = [...S.picked].filter((id) => S.notes.has(id) && !S.notes.get(id).trashed); if (!ids.length) return;
  const cards = ids.map((id) => $(`.card[data-note="${id}"]`)).filter(Boolean);
  cards.forEach((c) => { c.style.height = c.offsetHeight + "px"; c.classList.add("leaving"); });
  setTimeout(() => {
    const now = Date.now(); ids.forEach((id) => { const n = S.notes.get(id); n.trashed = true; n.trashedAt = now; markNote(id); });
    afterBulk(ids); S.picked.clear(); S.pickMode = false; renderAll();
    toast(`${plural(ids.length, "nota movida", "notas movidas")} para a lixeira`, { label: "Desfazer", run: () => { ids.forEach((id) => { const n = S.notes.get(id); if (n) { n.trashed = false; markNote(id); } }); renderSidebar(); renderList(); } });
  }, cards.length && !document.documentElement.classList.contains("no-anim") ? 300 : 0);
}
async function bulkPurge() {
  const ids = [...S.picked].filter((id) => S.notes.get(id)?.trashed); if (!ids.length) return;
  if (!(await ask({ title: `Excluir ${plural(ids.length, "nota", "notas")}?`, text: "Elas saem da lixeira. Se se arrepender, dá para recuperar por 14 dias em Configurações › Restaurar.", ok: "Excluir", danger: true, icon: "trash" }))) return;
  ids.forEach((id) => { S.notes.delete(id); deleted.add(id); dirty.delete(id); });
  afterBulk(ids); S.picked.clear(); S.pickMode = false; queueSave(); renderAll(); cleanAttachments();
  toast(`${plural(ids.length, "nota excluída", "notas excluídas")}`);
}
function bulkRestore() {
  const ids = [...S.picked].filter((id) => S.notes.get(id)?.trashed);
  ids.forEach((id) => { const n = S.notes.get(id); n.trashed = false; if (!S.nbs.has(n.nb)) n.nb = defaultNb(); markNote(id); });
  S.picked.clear(); S.pickMode = false; renderAll(); toast(`${plural(ids.length, "nota restaurada", "notas restauradas")}`);
}
function bulkMove(nbId) {
  const ids = [...S.picked]; ids.forEach((id) => { const n = S.notes.get(id); if (n && n.nb !== nbId) { n.nb = nbId; n.updated = Date.now(); markNote(id); } });
  S.picked.clear(); S.pickMode = false; renderAll(true); toast(`${plural(ids.length, "nota movida", "notas movidas")} para “${nbName(nbId)}”`);
}
$("#bulk").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-bk]"); if (!b || b.disabled) return;
  const k = b.dataset.bk;
  if (k === "cancel") return clearPicks();
  if (k === "all") return pickAll();
  if (k === "trash") return bulkTrash();
  if (k === "purge") return bulkPurge();
  if (k === "restore") return bulkRestore();
  if (k === "fav") { const ids = [...S.picked]; const all = ids.every((id) => S.notes.get(id)?.fav); ids.forEach((id) => { const n = S.notes.get(id); n.fav = !all; markNote(id); }); renderSidebar(); renderList(); return; }
  if (k === "stage") return stagePop(b, [...S.picked], (v) => { const c = S.picked.size; S.picked.clear(); S.pickMode = false; renderBulk(); toast(v ? `${plural(c, "nota", "notas")} em “${stageOf(v).label}”` : "Etapa removida"); });
  if (k === "move") return menu(b, [{ h: "Mover para o caderno" }, ...sortedNbs([...S.nbs.values()]).map((nb) => ({ icon: "book", label: nb.name, run: () => bulkMove(nb.id) })), "-", { icon: "plus", label: "Novo caderno…", run: async () => { const nb = await newNotebook(true); if (nb) bulkMove(nb.id); } }]);
  if (k === "tag") {
    const v = await ask({ title: "Adicionar etiqueta", icon: "tag", input: "Nome da etiqueta", ok: "Adicionar", extra: `<datalist id="bkTags">${allTags().map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>` });
    const t = (typeof v === "string" ? v : "").replace(/^#/, "").trim(); if (!t) return;
    [...S.picked].forEach((id) => { const n = S.notes.get(id); n.tags = n.tags || []; if (!n.tags.includes(t)) { n.tags.push(t); markNote(id); } });
    renderSidebar(); renderList(); toast(`Etiqueta “${t}” adicionada a ${plural(S.picked.size, "nota", "notas")}`);
  }
});

/* ---------- importar do Evernote ---------- */
const IMPORT_STYLE = /^(color|background-color|font-weight|font-style|text-decoration|text-decoration-line|text-align)$/;
function enmlToHtml(enml, res, tasks, tasksAs) {
  const src = String(enml).replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/gi, "").replace(/<(en-todo|en-media|en-crypt)\b([^>]*?)\s*\/>/gi, "<$1$2></$1>");
  const doc = new DOMParser().parseFromString(src, "text/html");
  const root = doc.querySelector("en-note") || doc.body;
  const mk = (h) => { const t = doc.createElement("template"); t.innerHTML = h; return t.content; };
  // Tarefas do Evernote (bolinhas): ficam fora do texto no arquivo; voltam para o lugar delas
  const taskHTML = (list) => {
    const sorted = list.slice().sort((a, b) => String(a.order).localeCompare(String(b.order)));
    return tasksAs === "text" ? sorted.map((t) => `<p>${esc(t.title)}</p>`).join("") : `<ul class="check">${sorted.map((t) => `<li${t.done ? " data-done" : ""}>${esc(t.title)}</li>`).join("")}</ul>`;
  };
  const pending = (tasks || []).slice();
  root.querySelectorAll("div[style*='en-task-group']").forEach((d) => {
    const id = (/--en-id\s*:\s*([^;]+)/.exec(d.getAttribute("style") || "") || [])[1]?.trim();
    const mine = pending.filter((t) => t.group === id);
    mine.forEach((t) => pending.splice(pending.indexOf(t), 1));
    if (mine.length) d.replaceWith(mk(taskHTML(mine))); else d.remove();
  });
  if (pending.length) root.appendChild(mk(taskHTML(pending)));
  root.querySelectorAll("en-crypt").forEach((x) => x.replaceWith(mk("<p><i>Trecho criptografado no Evernote (não foi importado)</i></p>")));
  root.querySelectorAll("en-media").forEach((x) => {
    const r = res[x.getAttribute("hash")];
    if (!r) { x.remove(); return; }
    if (r.mime.startsWith("image/")) x.replaceWith(mk(`<img src="anexo://img/${r.file}" alt="">`));
    else if (r.mime.startsWith("audio/")) x.replaceWith(mk(audioBlockHTML(r.file, 0, Array(48).fill(0.25))));
    else x.replaceWith(mk(`<a class="file-link" data-file="${esc(r.file)}" href="#" contenteditable="false">📎 <span>${esc(r.name)}</span></a>&nbsp;`));
  });
  // listas de tarefas do Evernote novo (ul com --en-todo) e antigo (en-todo no início da linha)
  root.querySelectorAll("ul").forEach((ul) => { if (/--en-todo\s*:\s*true/.test(ul.getAttribute("style") || "")) { ul.classList.add("check"); ul.querySelectorAll(":scope > li").forEach((li) => { if (/--en-checked\s*:\s*true/.test(li.getAttribute("style") || "")) li.setAttribute("data-done", ""); }); } });
  [...root.querySelectorAll("en-todo")].forEach((td) => {
    const blk = td.closest("div,p,li") || td.parentElement;
    const li = doc.createElement("li"); if (td.getAttribute("checked") === "true") li.setAttribute("data-done", "");
    td.remove(); li.innerHTML = blk && blk !== root ? blk.innerHTML : "";
    const prev = blk && blk.previousElementSibling;
    if (blk && blk !== root) {
      if (prev && prev.tagName === "UL" && prev.classList.contains("check")) { prev.appendChild(li); blk.remove(); }
      else { const ul = doc.createElement("ul"); ul.className = "check"; ul.appendChild(li); blk.replaceWith(ul); }
    }
  });
  root.querySelectorAll("div").forEach((d) => { if (/-en-codeblock\s*:\s*true/.test(d.getAttribute("style") || "")) { const pre = doc.createElement("pre"); pre.textContent = d.innerText || d.textContent; d.replaceWith(pre); } });
  // limpar: manter só o que o editor entende
  const KEEPI = new Set([...KEEP, "TABLE", "COLGROUP", "COL", "SUB", "SUP", "FONT"]);
  const walk = (node) => [...node.childNodes].forEach((c) => {
    if (c.nodeType === 8) return c.remove();
    if (c.nodeType !== 1) return;
    if (c.matches("a.file-link,.audio-block") ) return;
    const tag = c.tagName;
    if (DROP.has(tag)) return c.remove();
    if (/^H[4-6]$/.test(tag)) { const h = doc.createElement("h3"); h.innerHTML = c.innerHTML; c.replaceWith(h); return walk(h); }
    if (tag === "FONT") { const sp = doc.createElement("span"); if (c.getAttribute("color")) sp.style.color = c.getAttribute("color"); sp.innerHTML = c.innerHTML; c.replaceWith(sp); return walk(sp); }
    if (!KEEPI.has(tag)) { walk(c); c.replaceWith(...c.childNodes); return; }
    const keepAttr = {};
    if (tag === "A") { const h = c.getAttribute("href") || ""; if (/^(https?:|mailto:)/i.test(h)) keepAttr.href = h; }
    if (tag === "IMG") keepAttr.src = c.getAttribute("src");
    if (tag === "UL" && c.classList.contains("check")) keepAttr.class = "check";
    if (tag === "LI" && c.hasAttribute("data-done")) keepAttr["data-done"] = "";
    if ((tag === "TD" || tag === "TH") && c.getAttribute("colspan")) keepAttr.colspan = c.getAttribute("colspan");
    const st = [];
    for (let i = 0; i < c.style.length; i++) { const k = c.style[i]; if (IMPORT_STYLE.test(k)) { let v = c.style.getPropertyValue(k); if (k === "background-color" && /^(rgb\(255, 255, 255\)|white|#fff(fff)?)$/i.test(v.trim())) continue; if (k === "color" && /^(rgb\(0, 0, 0\)|black|#000(000)?)$/i.test(v.trim())) continue; st.push(k + ":" + v); } }
    [...c.attributes].forEach((a) => c.removeAttribute(a.name));
    Object.entries(keepAttr).forEach(([k, v]) => v !== null && v !== undefined && c.setAttribute(k, v));
    if (st.length) c.setAttribute("style", st.join(";"));
    walk(c);
  });
  walk(root);
  // blocos de primeiro nível: div vira parágrafo
  [...root.children].forEach((c) => { if (c.tagName === "DIV" && !c.matches(".audio-block,.callout")) { const p = doc.createElement("p"); p.innerHTML = c.innerHTML.trim() ? c.innerHTML : "<br>"; c.replaceWith(p); } });
  return root.innerHTML.replace(/(<p><br><\/p>\s*){3,}/g, "<p><br></p><p><br></p>").trim();
}
async function importEvernote() {
  if (!api.enexPick) { toast("Disponível no app instalado."); return; }
  const stacks = [...new Set([...S.nbs.values()].map((x) => x.stack).filter(Boolean))];
  const m = modal(`<div class="m-head"><div class="m-ic">${ic("restore")}</div><h2>Importar do Evernote</h2><button class="ib" id="evX" aria-label="Fechar">${ic("x")}</button></div>
    <div class="m-body" id="evBody">
      <div class="ev-steps">
        <div><span>1</span><p>No Evernote, clique com o botão direito em um caderno e escolha <b>Exportar caderno…</b> (formato <b>ENEX</b>). Faça isso com cada caderno que quiser trazer.</p></div>
        <div><span>2</span><p>Aqui, clique em <b>Escolher arquivos .enex</b> e selecione todos de uma vez. Cada arquivo vira um caderno com o mesmo nome.</p></div>
        <div><span>3</span><p>As datas de criação e edição, etiquetas, imagens, áudios, anexos e listas de tarefas vêm junto. Importar o mesmo arquivo de novo não duplica as notas.</p></div>
      </div>
      <label style="font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:5px">Colocar os cadernos importados numa pilha (opcional)<input class="field" id="evStack" list="evStacks" placeholder="Ex.: Evernote" autocomplete="off"><datalist id="evStacks">${stacks.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
    </div>
    <div class="m-foot"><span class="grow"></span><button class="btn" id="evNo">Cancelar</button><button class="btn primary" id="evGo">Escolher arquivos .enex</button></div>`, { wide: true });
  $("#evX", m).onclick = $("#evNo", m).onclick = () => m.close();
  const tasksAs = "text";
  $("#evGo", m).onclick = async () => {
    const stack = $("#evStack", m).value.trim();
    $("#evGo", m).disabled = true; $("#evGo", m).textContent = "Lendo arquivos…";
    const files = await api.enexPick();
    if (!files) { $("#evGo", m).disabled = false; $("#evGo", m).textContent = "Escolher arquivos .enex"; return; }
    const total = files.reduce((a, f) => a + (f.notes ? f.notes.length : 0), 0);
    $("#evBody", m).innerHTML = `<p>Importando <b>${total}</b> ${total === 1 ? "nota" : "notas"}…</p><div class="progress"><i id="evBar"></i></div><div class="progress-txt"><span id="evTxt">Preparando…</span><span id="evPct">0%</span></div>`;
    m.querySelector(".m-foot").hidden = true;
    const known = new Set([...S.notes.values()].map((n) => n.src).filter(Boolean));
    const summary = []; let done = 0, added = 0, skipped = 0, files2 = 0;
    for (const f of files) {
      if (f.error) { summary.push({ name: f.fileName, error: f.error }); continue; }
      const nbName2 = (f.notebook || "Evernote").trim();
      let nb = [...S.nbs.values()].find((x) => x.name.toLowerCase() === nbName2.toLowerCase());
      if (!nb) { nb = { id: uid("nb_"), name: nbName2, stack, created: Math.min(...f.notes.map((n) => n.created || Date.now()), Date.now()) }; S.nbs.set(nb.id, nb); markNotebooks(); }
      else if (stack && !nb.stack) { nb.stack = stack; markNotebooks(); }
      let a = 0, sk = 0;
      for (const en of f.notes) {
        const src = "ever:" + (en.created || 0) + ":" + (en.title || "");
        done++;
        if (known.has(src)) { sk++; skipped++; continue; }
        let html = ""; try { html = enmlToHtml(en.enml, en.resources || {}, en.tasks || [], tasksAs); } catch (e) { html = `<p>${esc(en.enml.replace(/<[^>]+>/g, " "))}</p>`; }
        if (en.sourceUrl && /^https?:/i.test(en.sourceUrl)) html += `<p>Fonte: <a href="${esc(en.sourceUrl)}">${esc(en.sourceUrl)}</a></p>`;
        const tmp = document.createElement("div"); tmp.innerHTML = html.replace(/<\/(p|div|li|h1|h2|h3|pre|tr|blockquote)>|<br\s*\/?>/gi, "$&\n");
        tmp.querySelectorAll(".audio-block").forEach((x) => x.remove());
        const created = en.created || Date.now(), updated = en.updated || created;
        const n = { id: uid("nt_"), nb: nb.id, title: en.title || "Sem título", html, text: (tmp.textContent || "").replace(/\n{3,}/g, "\n\n").trim(), tags: en.tags || [], prio: 0, reminder: null, reminderDone: false, fav: false, trashed: false, created, updated, src };
        S.notes.set(n.id, n); markNote(n.id); known.add(src); a++; added++;
        files2 += Object.keys(en.resources || {}).length;
        if (done % 20 === 0) { const pct = Math.round(done / Math.max(1, total) * 100); $("#evBar", m).style.width = pct + "%"; $("#evPct", m).textContent = pct + "%"; $("#evTxt", m).textContent = `${done} de ${total}`; await new Promise((r) => setTimeout(r, 0)); }
      }
      summary.push({ name: nbName2, added: a, skipped: sk });
    }
    await flushSave();
    renderSidebar(); renderList(true);
    $("#evBody", m).innerHTML = `<div class="rv-done" style="padding:10px 0 4px"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="34"/><path d="M22 37l9.5 9.5L51 27"/></svg><b>Importação concluída</b><span>${plural(added, "nota importada", "notas importadas")}${files2 ? ` · ${plural(files2, "anexo", "anexos")}` : ""}${skipped ? ` · ${plural(skipped, "já existia", "já existiam")}` : ""}</span></div>
      <div class="rs-list">${summary.map((x) => `<div class="rs-item"><div class="rs-ic">${ic(x.error ? "x" : "book")}</div><div class="rs-main"><b>${esc(x.name)}</b><span class="rs-meta">${x.error ? "Não foi possível ler este arquivo" : `${plural(x.added, "nota nova", "notas novas")}${x.skipped ? ` · ${x.skipped} já existiam` : ""}`}</span></div></div>`).join("")}</div>`;
    const foot = m.querySelector(".m-foot"); foot.hidden = false; foot.innerHTML = `<span class="grow"></span><button class="btn primary" id="evOk">Ver as notas</button>`;
    $("#evOk", m).onclick = () => { m.close(); const first = summary.find((x) => x.added); const nb = first && [...S.nbs.values()].find((y) => y.name === first.name); setSel(nb ? { type: "nb", id: nb.id } : { type: "all" }); };
  };
}

/* ---------- restaurar notas excluídas e cópias diárias ---------- */
async function restoreModal(tab) {
  if (!api.backupList) { toast("Disponível no app instalado."); return; }
  let cur = tab || "deleted", data = await api.backupList();
  const dayName = (d) => { const x = new Date(d + "T12:00"); const t = x.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const left = (t) => { const dd = Math.max(0, Math.ceil((t - Date.now()) / 864e5)); return dd <= 1 ? "some amanhã" : `some em ${dd} dias`; };
  const body = () => cur === "deleted"
    ? (data.deleted.length ? data.deleted.map((x, i) => `<div class="rs-item" data-id="${esc(x.id)}" style="--i:${Math.min(i, 12)}"><div class="rs-ic">${ic("notes")}</div><div class="rs-main"><b>${esc(x.title)}</b>${x.snippet ? `<span class="rs-snip">${esc(x.snippet)}</span>` : ""}<span class="rs-meta">Excluída ${fmtDate(x.deletedAt, true)} · ${left(x.expires)}${x.nb ? " · " + esc(x.nb) : ""}${x.hasFiles ? ` · ${plural(x.hasFiles, "anexo", "anexos")}` : ""}</span></div><button class="btn primary" data-rn="${esc(x.id)}">${ic("restore")}Recuperar</button></div>`).join("")
      : `<div class="empty" style="padding:30px 10px"><div class="em-ic">${ic("check")}</div><b>Nenhuma nota excluída</b><span>Notas que você excluir da lixeira aparecem aqui por 14 dias.</span></div>`)
    : (data.days.length ? data.days.map((x, i) => `<div class="rs-item" style="--i:${Math.min(i, 12)}"><div class="rs-ic">${ic("calendar")}</div><div class="rs-main"><b>${dayName(x.date)}${i === 0 && x.date === new Date().toISOString().slice(0, 10) ? " · hoje" : ""}</b><span class="rs-meta">${plural(x.count, "nota", "notas")}</span></div><button class="btn" data-rd="${x.date}">Voltar para este dia</button></div>`).join("")
      : `<div class="empty" style="padding:30px 10px"><div class="em-ic">${ic("calendar")}</div><b>Ainda não há cópias</b><span>A primeira cópia é feita amanhã, quando você abrir o app.</span></div>`);
  const m = modal(`<div class="m-head"><div class="m-ic">${ic("restore")}</div><h2>Restaurar</h2><button class="ib" id="rsX" aria-label="Fechar">${ic("x")}</button></div>
    <div class="m-body"><div class="seg" id="rsTabs"><button data-rt="deleted">Notas excluídas <span class="rs-n">${data.deleted.length}</span></button><button data-rt="days">Cópias diárias <span class="rs-n">${data.days.length}</span></button></div>
    <p id="rsHint" style="font-size:12.5px"></p><div class="rs-list" id="rsList"></div></div>`, { wide: true });
  const paint = () => {
    $$("#rsTabs button", m).forEach((b) => b.classList.toggle("on", b.dataset.rt === cur));
    $("#rsHint", m).textContent = cur === "deleted" ? "Notas excluídas da lixeira ficam guardadas por 14 dias, com imagens e áudios." : "Volta todas as notas para como estavam no dia escolhido. O estado de agora é guardado antes, então dá para desfazer.";
    const l = $("#rsList", m); l.innerHTML = body(); l.classList.remove("enter"); void l.offsetWidth; l.classList.add("enter");
  };
  m.addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.id === "rsX") return m.close();
    if (t.dataset.rt) { cur = t.dataset.rt; paint(); return; }
    if (t.dataset.rn) {
      t.disabled = true;
      try {
        const n = await api.restoreNote(t.dataset.rn);
        if (!S.nbs.has(n.nb)) n.nb = defaultNb();
        n.tags = n.tags || []; S.notes.set(n.id, n); markNote(n.id);
        renderSidebar(); renderList();
        const row = t.closest(".rs-item"); row.classList.add("gone"); setTimeout(() => row.remove(), 300);
        data.deleted = data.deleted.filter((x) => x.id !== n.id); $("#rsTabs .rs-n", m).textContent = data.deleted.length;
        toast(`“${titleOf(n)}” recuperada em “${nbName(n.nb)}”`, { label: "Abrir", run: () => { m.close(); openNote(n.id); } });
      } catch (er) { t.disabled = false; toast(String(er.message || er).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
      return;
    }
    if (t.dataset.rd) {
      const d = t.dataset.rd;
      if (!(await ask({ title: "Voltar as notas para " + dayName(d).toLowerCase() + "?", icon: "restore", text: "Todas as notas e cadernos ficam como estavam nesse dia. Antes, o app guarda uma cópia de como está agora. Notas criadas depois dessa data vão para “Notas excluídas”, de onde podem ser recuperadas.", ok: "Restaurar" }))) return;
      await flushSave(); S.restoring = true;
      try { await api.restoreDay(d); toast("Notas restauradas. Recarregando…"); setTimeout(() => (api.reload ? api.reload() : location.reload()), 700); }
      catch (er) { S.restoring = false; toast(String(er.message || er).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    }
  });
  paint();
}

/* ---------- modo expandido e tela cheia ---------- */
function setExpanded(on) {
  S.expanded = on; $("#app").classList.toggle("expanded", on);
  const b = $("#btnExpand"); if (b) { b.innerHTML = ic(on ? "uncollapse" : "collapse"); b.title = (on ? "Mostrar cadernos e lista" : "Expandir nota") + " (Ctrl+Shift+E)"; }
  saveSession(); setTimeout(layoutToolbar, 340);
}
async function setFullscreen(on) { await api.setFullscreen(on); applyFullscreen(on); }
function applyFullscreen(on) {
  S.fullscreen = on; $("#app").classList.toggle("fullscreen", on);
  const b = $("#btnFull"); if (b) { b.innerHTML = ic(on ? "shrink" : "expand"); b.title = on ? "Sair da tela cheia (Esc)" : "Tela cheia (F11)"; }
  if (on && !S.expanded) { S._expBeforeFs = true; setExpanded(true); }
  if (!on && S._expBeforeFs) { S._expBeforeFs = false; setExpanded(false); }
  setTimeout(layoutToolbar, 340);
}
api.onFullscreen((v) => applyFullscreen(v));

function setZoom(z) { S.prefs.zoom = Math.max(.7, Math.min(2, Math.round(z * 10) / 10)); document.documentElement.style.setProperty("--zoom", S.prefs.zoom); savePrefs(); toast("Zoom do texto: " + Math.round(S.prefs.zoom * 100) + "%"); }

function renderAll(keepScroll) {
  renderSidebar(); renderList(); renderTabs();
  renderPane(keepScroll ? { keepScroll: $("#edScroll")?.scrollTop } : {});
  saveSession();
}

/* =========================================================
   Eventos
   ========================================================= */
document.addEventListener("mousedown", (e) => {
  if (e.target.closest?.(".audio-block")) e.preventDefault();
  if (TRIG && !e.target.closest?.(".cmd-pop")) closeTrigger();
  if (e.target.closest(".toolbar .tb, .pop .tb")) { e.preventDefault(); saveSel(); }
  if (popEl && !popEl.contains(e.target) && !e.target.closest?.(".pop-sub") && !(popAnchor && popAnchor.contains && popAnchor.contains(e.target))) closePop();
  if (!e.target.closest(".tag-input-w")) $(".suggest")?.remove();
  if (e.button === 1) { const t = e.target.closest("[data-tab]"); if (t) { e.preventDefault(); closeTab(t.dataset.tab); } }
});

document.addEventListener("click", async (e) => {
  const t = e.target;
  /* bloco de áudio */
  const ab = ED && ED.doc.contains(t) && t.closest(".audio-block");
  if (ab) {
    e.preventDefault();
    const act = t.closest("[data-act]")?.dataset.act;
    if (act === "abplay") playAudio(ab);
    else if (act === "abseek") { const w = t.closest(".ab-wave").getBoundingClientRect(); seekAudio(ab, Math.max(0, Math.min(1, (e.clientX - w.left) / w.width))); }
    else if (act === "abtrans") transcribeAudio(ED.id, ab.dataset.audio);
    else if (act === "abdel") { if (PLAYER.block === ab) stopAudio(); const nx = ab.nextElementSibling; ab.remove(); if (nx && nx.tagName === "P" && !nx.textContent.trim()) nx.remove(); onDocChange(); toast("Áudio removido da nota"); }
    return;
  }
  /* dentro do texto da nota */
  if (ED && ED.doc.contains(t)) {
    $$("img.selected", ED.doc).forEach((i) => i !== t && i.classList.remove("selected"));
    const li = t.closest("ul.check > li");
    if (li && ED.doc.contentEditable === "true" && e.clientX - li.getBoundingClientRect().left < 26) { li.toggleAttribute("data-done"); onDocChange(); return; }
    const fl = t.closest("a.file-link");
    if (fl) { e.preventDefault(); api.openAttachment && api.openAttachment(fl.dataset.file).then((r) => { if (r) toast(r === "missing" ? "Esse anexo não foi encontrado." : "Não foi possível abrir o anexo."); }); return; }
    const nl = t.closest("a.note-link");
    if (nl) { e.preventDefault(); const target = S.notes.get(nl.dataset.note); if (!target) toast("Essa nota foi excluída."); else { if (target.trashed) toast("Essa nota está na lixeira."); openNote(target.id, { newTab: true }); } return; }
    const a = t.closest("a");
    if (a) { if (e.ctrlKey || e.metaKey || ED.doc.contentEditable !== "true") { e.preventDefault(); api.openLink(a.getAttribute("href")); } else linkCard(a); return; }
    if (t.tagName === "IMG") { t.classList.add("selected"); imageMenu(t); return; }
    return;
  }
  const b = t.closest("button,[data-sel],[data-tab],[data-note]");
  if (!b) return;
  if (b.dataset.close) { e.stopPropagation(); closeTab(b.dataset.close); return; }
  if (b.dataset.nbmenu) { e.stopPropagation(); nbMenu(b, b.dataset.nbmenu); return; }
  if (b.dataset.tagmenu) { e.stopPropagation(); tagMenu(b, b.dataset.tagmenu); return; }
  if (b.dataset.sec) { S.closed[b.dataset.sec] = !S.closed[b.dataset.sec]; renderSidebar(); saveSession(); return; }
  if (b.dataset.stack !== undefined && b.classList.contains("stack-h")) {
    const st = b.dataset.stack;
    if (e.target.closest(".chev")) { S.closed["st-" + st] = !S.closed["st-" + st]; renderSidebar(); saveSession(); }
    else setSel({ type: "stack", id: st });
    return;
  }
  if (b.dataset.sel) { setSel(b.dataset.id !== undefined ? { type: b.dataset.sel, id: b.dataset.id } : { type: b.dataset.sel }); return; }
  if (b.dataset.tab) { openNote(b.dataset.tab); return; }
  if (b.dataset.note) {
    const id = b.dataset.note;
    if (e.shiftKey && S.lastPick) { pickRange(S.lastPick, id); return; }
    if (e.ctrlKey || e.metaKey || e.target.closest("[data-pick]") || S.pickMode || S.picked.size) { togglePick(id); return; }
    openNote(id); return;
  }
  if (b.dataset.cmd) { closePop(); runCmd(b.dataset.cmd); return; }
  if (b.dataset.pop) { if (popAnchor === b) { closePop(); return; } toolbarPop(b.dataset.pop, b); return; }
  if (b.dataset.chip !== undefined) { $("#activeChips")._fns[+b.dataset.chip](); renderList(true); saveSession(); return; }
  if (b.dataset.rmtag) { const n = S.notes.get(S.active); n.tags = (n.tags || []).filter((x) => x !== b.dataset.rmtag); n.updated = Date.now(); markNote(n.id); refreshTags(); return; }
  if (b.dataset.sugtag) { addTag(b.dataset.sugtag); return; }
  if (b.dataset.crumb === "nb") { moveMenu(b, S.active); return; }
  if (b.dataset.crumb === "stack") { const nb = S.nbs.get(S.notes.get(S.active)?.nb); if (nb) setSel({ type: "stack", id: nb.stack }); return; }
  switch (b.dataset.act || b.id) {
    case "new": case "sideNew": case "listNew": case "tabAdd": newNote(); break;
    case "sideNewNb": case "secNewNb": newNotebook(); break;
    case "sideSettings": settingsModal(); break;
    case "listFilter": filterModal(); break;
    case "listSort": sortPop(b); break;
    case "listPick": S.pickMode = !S.pickMode; if (!S.pickMode) S.picked.clear(); renderList(); break;
    case "clearfilters": S.filter = blankFilter(); renderList(true); saveSession(); break;
    case "emptytrash": emptyTrash(); break;
    case "expand": setExpanded(!S.expanded); break;
    case "restoremodal": restoreModal(); break;
    case "fullscreen": setFullscreen(!S.fullscreen); break;
    case "fav": { const n = S.notes.get(S.active); n.fav = !n.fav; markNote(n.id); b.classList.toggle("on", n.fav); renderList(); renderSidebar(); break; }
    case "notemenu": noteMenu(b); break;
    case "restore": restoreNote(S.active); break;
    case "purge": purgeNote(S.active); break;
    case "reminder": reminderPop(b); break;
    case "prio": prioPop(b); break;
    case "stage": if (!S.notes.get(S.active)?.trashed) stagePop(b, [S.active]); break;
    case "sideNewTpl": templatePicker(); break;
    case "tpldone": endTplEdit(); break;
    case "tplback": endTplEdit(); break;
    case "mobback": if (history.state && history.state.fn === "note") history.back(); else mobShowList(); break;
    case "navBack": goHist(-1); break;
    case "navFwd": goHist(1); break;
    case "drawerBtn": $("#app").classList.toggle("drawer"); break;
    case "drawerScrim": $("#app").classList.remove("drawer"); break;
    case "findNext": showFind(1); break;
    case "findPrev": showFind(-1); break;
    case "findClose": closeFind(); break;
  }
});
$("#drawerScrim").addEventListener("click", () => $("#app").classList.remove("drawer"));

function imageMenu(img) {
  menu(img, [
    { h: "Tamanho da imagem" },
    ...[["w-s", "Pequena"], ["w-m", "Média"], ["w-l", "Largura total"], ["", "Original"]].map(([c, l]) => ({ label: l, checked: c ? img.classList.contains(c) : !/w-[sml]/.test(img.className), run: () => { img.classList.remove("w-s", "w-m", "w-l"); if (c) img.classList.add(c); finishImg(img); } })),
    "-",
    { icon: "ac", label: "Centralizar", checked: img.classList.contains("center"), run: () => { img.classList.toggle("center"); finishImg(img); } },
    { icon: "trash", label: "Remover imagem", danger: true, run: () => { img.remove(); onDocChange(); } }
  ], { below: true });
}
function finishImg(img) { img.classList.remove("selected"); onDocChange(); }

document.addEventListener("input", (e) => {
  const t = e.target;
  if (ED && t === ED.doc) {
    if (e.inputType === "insertText" && (e.data === "/" || e.data === "@")) openTrigger(e.data);
    else if (TRIG) updateTrigger();
    if (e.inputType === "insertParagraph") { const li = selEl()?.closest("ul.check > li"); if (li && !li.textContent.trim()) li.removeAttribute("data-done"); }
    onDocChange(); return;
  }
  if (ED && t === ED.title) { onTitleChange(); return; }
  if (t.id === "search") {
    S.q = t.value.trim();
    renderList(); renderSidebar();
    if (ED) highlightDoc(S.q);
    return;
  }
  if (t.id === "findIn") { runFind(); return; }
  if (t.id === "tagIn") { tagSuggest(t); return; }
});

document.addEventListener("selectionchange", () => {
  if (!ED) return;
  const s = getSelection();
  if (s.rangeCount && inDoc(s.anchorNode)) { saveSel(); updateToolbarSoon(); updateLineHint(); updateWordCountSoon(); if (TRIG) updateTrigger(true); }
  else { hideLineHint(); if (wcMode === "sel") updateWordCountSoon(); }
});
const updateToolbarSoon = debounce(updateToolbar, 60);

document.addEventListener("paste", async (e) => {
  if (!ED || !ED.doc.contains(e.target) || ED.doc.contentEditable !== "true") return;
  const cd = e.clipboardData;
  const files = [...cd.files].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); saveSel(); insertImages(files); return; }
  const html = cd.getData("text/html");
  if (html && !e.shiftKey) {
    e.preventDefault();
    if (selEl()?.closest("pre")) document.execCommand("insertText", false, cd.getData("text/plain"));
    else document.execCommand("insertHTML", false, sanitize(html));
    onDocChange();
    return;
  }
  const text = cd.getData("text/plain");
  if (/^(https?:\/\/|www\.)\S+$/.test(text.trim()) && S.prefs.autolink && !selEl()?.closest("a,pre")) {
    e.preventDefault();
    const url = normUrl(text.trim()); const s = getSelection();
    if (!s.isCollapsed) document.execCommand("createLink", false, url);
    else document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(text.trim())}</a>&nbsp;`);
    onDocChange();
  }
});
document.addEventListener("dragover", (e) => { if (ED && ED.doc.contains(e.target) && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!ED || !ED.doc.contains(e.target)) return;
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (pos) savedRange = pos;
  insertImages(files);
});
$("#imgInput").addEventListener("change", (e) => { insertImages([...e.target.files]); e.target.value = ""; });

/* arrastar notas: reordenar, mover para caderno ou lixeira */
let dragId = null, dropAt = null;
const clearDropMarks = () => $$(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
document.addEventListener("dragstart", (e) => {
  const c = e.target.closest?.(".card"); if (!c) return;
  dragId = c.dataset.note; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", titleOf(S.notes.get(dragId)));
  requestAnimationFrame(() => { c.classList.add("dragging"); $("#app").classList.add("note-drag"); $("#notes").classList.add("dragging-on"); });
});
document.addEventListener("dragend", () => {
  dragId = null; dropAt = null; clearDropMarks();
  $$(".dragging,.drop,.over").forEach((x) => x.classList.remove("dragging", "drop", "over"));
  $("#app").classList.remove("note-drag"); $("#notes").classList.remove("dragging-on");
});
$("#notes").addEventListener("dragover", (e) => {
  if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move";
  let c = e.target.closest(".card");
  if (!c) { const cards = $$(".card", $("#notes")); c = cards[cards.length - 1]; if (!c) return; dropAt = { id: c.dataset.note, after: true }; }
  else { const r = c.getBoundingClientRect(); dropAt = { id: c.dataset.note, after: e.clientY > r.top + r.height / 2 }; }
  if (dropAt.id === dragId) { clearDropMarks(); return; }
  clearDropMarks(); c.classList.add(dropAt.after ? "drop-after" : "drop-before");
});
$("#notes").addEventListener("dragleave", (e) => { if (!$("#notes").contains(e.relatedTarget)) clearDropMarks(); });
$("#notes").addEventListener("drop", (e) => { if (!dragId || !dropAt || dropAt.id === dragId) return; e.preventDefault(); reorderNote(dragId, dropAt.id, dropAt.after); });
const td = $("#trashDrop");
td.addEventListener("dragover", (e) => { if (!dragId) return; e.preventDefault(); td.classList.add("over"); clearDropMarks(); });
td.addEventListener("dragleave", () => td.classList.remove("over"));
td.addEventListener("drop", (e) => { if (!dragId) return; e.preventDefault(); const id = dragId; td.classList.remove("over"); if (S.picked.has(id) && S.picked.size > 1) bulkTrash(); else trashNote(id); });
$("#sideNav").addEventListener("dragover", (e) => { const d = e.target.closest("[data-drop]"); if (!d || !dragId) return; e.preventDefault(); $$(".drop").forEach((x) => x !== d && x.classList.remove("drop")); d.classList.add("drop"); });
$("#sideNav").addEventListener("dragleave", (e) => { const d = e.target.closest("[data-drop]"); if (d && !d.contains(e.relatedTarget)) d.classList.remove("drop"); });
$("#sideNav").addEventListener("drop", (e) => { const d = e.target.closest("[data-drop]"); if (!d || !dragId) return; e.preventDefault(); const many = S.picked.has(dragId) && S.picked.size > 1; if (d.dataset.drop === "trash") many ? bulkTrash() : trashNote(dragId); else if (d.dataset.drop.startsWith("stage:")) { const k = d.dataset.drop.slice(6), ids = many ? [...S.picked] : [dragId]; setStage(ids, k); d.classList.remove("drop"); renderAfterStage(); toast(`${ids.length > 1 ? plural(ids.length, "nota", "notas") : "Nota"} em “${stageOf(k).label}”`); } else many ? bulkMove(d.dataset.drop) : moveNote(dragId, d.dataset.drop); });

function reorderNote(id, targetId, after) {
  const arr = visibleNotes();
  const ids = arr.map((n) => n.id).filter((x) => x !== id);
  let i = ids.indexOf(targetId); if (i < 0) return;
  ids.splice(after ? i + 1 : i, 0, id);
  const slots = arr.map(ordOf).sort((a, b) => a - b);
  for (let k = 1; k < slots.length; k++) if (slots[k] <= slots[k - 1]) slots[k] = slots[k - 1] + 0.001;
  ids.forEach((nid, k) => { const n = S.notes.get(nid); if (n && n.order !== slots[k]) { n.order = slots[k]; markNote(nid); } });
  const first = new Map($$(".card", $("#notes")).map((c) => [c.dataset.note, c.getBoundingClientRect().top]));
  if (S.sort.by !== "manual") { S.sort = { by: "manual", dir: "asc" }; saveSession(); toast("Ordem manual ativada. Arraste as notas para organizar."); }
  renderList(false, true);
  $$(".card", $("#notes")).forEach((c) => {
    const old = first.get(c.dataset.note); if (old === undefined) return;
    const dy = old - c.getBoundingClientRect().top; if (!dy) return;
    c.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" });
  });
  const moved = $(`.card[data-note="${id}"]`);
  if (moved) moved.animate([{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 700 });
}

/* menu de contexto dos cartões */
/* esvaziar a lixeira (também pelo botão direito na barra lateral, sem abrir) */
async function emptyTrash() {
  const tr = [...S.notes.values()].filter((n) => n.trashed);
  if (!tr.length) { toast("A lixeira já está vazia"); return; }
  if (!(await ask({ title: "Esvaziar a lixeira?", text: `${plural(tr.length, "nota sai", "notas saem")} da lixeira. Se se arrepender, dá para recuperar por 14 dias em Configurações › Restaurar.`, ok: "Esvaziar", danger: true, icon: "trash" }))) return;
  const finish = () => {
    tr.forEach((n) => { S.notes.delete(n.id); deleted.add(n.id); dirty.delete(n.id); S.tabs = S.tabs.filter((x) => x !== n.id); if (S.active === n.id) S.active = null; });
    S.picked.clear();
    $$(".toast").forEach((t) => { t.classList.add("out"); setTimeout(() => t.remove(), 200); }); /* "Desfazer" antigo não vale mais */
    queueSave(); renderAll(); cleanAttachments();
    const row = $('#sideNav [data-sel="trash"]'); if (row) { row.classList.remove("emptied"); void row.offsetWidth; row.classList.add("emptied"); }
    toast(`Lixeira esvaziada · ${plural(tr.length, "nota excluída", "notas excluídas")}`, api.backupList ? { label: "Recuperar", run: () => restoreModal() } : undefined);
  };
  /* se a lixeira estiver aberta na lista, as notas saem uma a uma */
  const cards = S.sel.type === "trash" && !document.documentElement.classList.contains("no-anim") ? $$("#notes .card") : [];
  if (!cards.length) return finish();
  cards.forEach((c, i) => { c.style.height = c.offsetHeight + "px"; c.style.animationDelay = Math.min(i, 8) * 35 + "ms"; c.classList.add("leaving"); });
  setTimeout(finish, 300 + Math.min(cards.length, 8) * 35);
}
function trashCtx(e, row) {
  const n = [...S.notes.values()].filter((x) => x.trashed).length;
  const fake = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) };
  row.classList.add("ctx");
  const p = menu(fake, [
    { h: n ? `Lixeira · ${plural(n, "nota", "notas")}` : "Lixeira" },
    n ? { icon: "trash", label: "Esvaziar lixeira…", danger: true, run: emptyTrash } : { icon: "check", label: "A lixeira está vazia", style: "color:var(--faint);pointer-events:none" },
    "-",
    { icon: "open", label: "Abrir lixeira", run: () => setSel({ type: "trash" }) },
    ...(api.backupList ? [{ icon: "restore", label: "Recuperar notas excluídas…", run: () => restoreModal() }] : [])
  ]);
  p.classList.add("trash-ctx");
  new MutationObserver((_, o) => { if (!p.isConnected) { row.classList.remove("ctx"); o.disconnect(); } }).observe(document.body, { childList: true });
}

document.addEventListener("contextmenu", (e) => {
  const tr = e.target.closest('#sideNav [data-sel="trash"]'); if (tr) { e.preventDefault(); trashCtx(e, tr); return; }
  const c = e.target.closest(".card"); if (!c) return;
  e.preventDefault();
  noteCtx(e, c);
});

/* aba Modelos: eventos */
document.addEventListener("click", (e) => {
  const v = e.target.closest("#tplView"); if (!v) return;
  const a = e.target.closest("[data-tvact]");
  const id = TV.sel;
  if (a) {
    const k = a.dataset.tvact;
    if (k === "new") return newTemplate();
    if (k === "close") { TV.sel = null; return paintTvSide(); }
    if (k === "use") return useTemplate(id);
    if (k === "edit") return startTplEdit(id);
    if (k === "dup") return dupTemplate(id);
    if (k === "more") return menu(a, [{ icon: "edit", label: "Editar", run: () => startTplEdit(id) }, { icon: "type", label: "Renomear", run: () => renameTemplate(id) }, { icon: "dup", label: "Duplicar", run: () => dupTemplate(id) }, "-", { icon: "trash", label: "Excluir modelo", danger: true, run: () => deleteTemplate(id) }], { right: true });
    return;
  }
  const rm = e.target.closest("[data-tvrmtag]");
  if (rm) { const t = getTpl(id); setTplDef(id, { tags: (t.tags || []).filter((g) => g !== rm.dataset.tvrmtag) }); paintTvSide(); return; }
  const c = e.target.closest("[data-tv]"); if (c) tvSelect(c.dataset.tv);
});
document.addEventListener("dblclick", (e) => { const c = e.target.closest("#tplView [data-tv]"); if (c) useTemplate(c.dataset.tv); });
document.addEventListener("change", (e) => {
  const d = e.target.closest?.("#tplView [data-tvdef]"); if (!d || !TV.sel) return;
  setTplDef(TV.sel, { [d.dataset.tvdef]: d.value });
  if (d.dataset.tvdef === "stage") renderTplView();
  toast("Padrão do modelo atualizado");
});
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t.id === "tvTagIn" && e.key === "Enter") {
    e.preventDefault();
    const g = t.value.replace(/^#/, "").trim().slice(0, 40); if (!g || !TV.sel) return;
    const cur = getTpl(TV.sel).tags || [];
    if (!cur.some((x) => x.toLowerCase() === g.toLowerCase())) setTplDef(TV.sel, { tags: [...cur, g] });
    paintTvSide(); setTimeout(() => $("#tvTagIn")?.focus(), 0);
    return;
  }
  if (t.closest?.("#tplView [data-tv]") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tvSelect(t.closest("[data-tv]").dataset.tv); }
});

/* teclado */
document.addEventListener("keydown", (e) => {
  const t = e.target, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (TRIG && ED && t === ED.doc) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); moveTrigSel(e.key === "ArrowDown" ? 1 : -1); return; }
    if (e.key === "Enter" || e.key === "Tab") { if (TRIG.items.length) { e.preventDefault(); chooseTrig(TRIG.sel); return; } }
    if (e.key === "Escape") { e.preventDefault(); closeTrigger(); return; }
  }
  if ((t.matches?.("[data-sel],[data-tab]")) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); return; }
  const inText = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "");
  if (!inText && !$(".scrim") && !popEl) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); pickAll(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && S.picked.size) { e.preventDefault(); S.sel.type === "trash" ? bulkPurge() : bulkTrash(); return; }
  }
  if (e.key === "Escape" && !inText && !popEl && !$(".scrim") && (S.picked.size || S.pickMode)) { clearPicks(); return; }
  if (e.key === "Escape") {
    if (popEl) { closePop(); return; }
    const sc = $$(".scrim:not(.closing)").pop(); if (sc) { sc.close(); return; }
    if ($("#findbar")) { closeFind(); return; }
    if (REV) { closeReview(); return; }
    if ($("#app").classList.contains("drawer")) { $("#app").classList.remove("drawer"); return; }
    if (S.fullscreen) { setFullscreen(false); return; }
    if (S.expanded) { setExpanded(false); return; }
    if (t.id === "search" && t.value) { t.value = ""; S.q = ""; renderList(true); renderSidebar(); highlightDoc(""); return; }
  }
  if (popEl && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const items = $$(".mi", popEl); if (!items.length) return;
    e.preventDefault(); const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); return;
  }
  if (t.id === "findIn" && e.key === "Enter") { e.preventDefault(); showFind(e.shiftKey ? -1 : 1); return; }
  if (t.id === "tagIn") {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); const first = $(".suggest .mi.focus"); addTag(first ? first.dataset.sugtag : t.value); return; }
    if (e.key === "Backspace" && !t.value) { const n = S.notes.get(S.active); if (n.tags?.length) { n.tags.pop(); markNote(n.id); refreshTags(); } return; }
  }
  if (ED && t === ED.title) {
    if (e.key === "Enter" || (e.key === "ArrowDown" && t.selectionStart === t.value.length)) {
      e.preventDefault();
      ED.doc.focus(); const first = ED.doc.firstElementChild && !ED.doc.firstElementChild.matches(".audio-block,table,hr") ? ED.doc.firstElementChild : ED.doc; const r = document.createRange(); r.selectNodeContents(first); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return;
    }
  }
  if (ED && t === ED.doc) {
    if (!mod && (e.key === " " || e.key === "Enter")) tryAutolink();
    if (!mod && autoCap(e)) return;
    const cell = selEl()?.closest("td,th");
    if (e.key === "Tab" && cell) {
      e.preventDefault();
      const cells = [...cell.closest("table").querySelectorAll("td,th")]; let i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (i >= cells.length) { const tr = cell.closest("tr").cloneNode(true); tr.querySelectorAll("td,th").forEach((c) => (c.innerHTML = "<br>")); cell.closest("tbody,table").appendChild(tr); onDocChange(); i = cells.length; }
      const all = [...cell.closest("table").querySelectorAll("td,th")]; const nc = all[Math.max(0, i)];
      const r = document.createRange(); r.selectNodeContents(nc); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); return;
    }
    if (e.key === "Tab") { e.preventDefault(); if (selEl()?.closest("li")) exec(e.shiftKey ? "outdent" : "indent"); else if (!e.shiftKey) exec("insertText", "    "); return; }
    if (e.key === "Backspace" && !mod) {
      const s = getSelection(); const li = selEl()?.closest("ul.check > li");
      if (li && s.isCollapsed && !li.textContent && li.parentNode.children.length === 1) { e.preventDefault(); toggleChecklist(); return; }
    }
  }
  if (e.key === "F5") { e.preventDefault(); insertDateTime(); return; }
  if (e.key === "F7") { e.preventDefault(); proofText(); return; }
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goHist(-1); return; }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goHist(1); return; }
  if (!mod) return;
  if (k === "n" && e.shiftKey) { e.preventDefault(); newNotebook(); }
  else if (k === "n") { e.preventDefault(); newNote(); }
  else if (k === "k" && e.shiftKey) { e.preventDefault(); if (ED) openLinkEditor(); }
  else if (k === "k") { e.preventDefault(); if (S.expanded) setExpanded(false); $("#search").focus(); $("#search").select(); }
  else if (k === "f" && !e.shiftKey) { e.preventDefault(); if (ED) openFind(); else $("#search").focus(); }
  else if (k === "e" && e.shiftKey) { e.preventDefault(); setExpanded(!S.expanded); }
  else if (k === "l" && e.shiftKey) { e.preventDefault(); if (ED) toggleChecklist(); }
  else if (k === "w") { e.preventDefault(); if (S.active) closeTab(S.active); }
  else if (k === "s") { e.preventDefault(); flushSave(); toast("Tudo salvo — o app salva sozinho enquanto você digita"); }
  else if (k === "tab") { e.preventDefault(); if (S.tabs.length > 1) { const i = S.tabs.indexOf(S.active); openNote(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length]); } }
  else if (k === "=" || k === "+") { e.preventDefault(); setZoom((S.prefs.zoom || 1) + .1); }
  else if (k === "-") { e.preventDefault(); setZoom((S.prefs.zoom || 1) - .1); }
  else if (k === "0") { e.preventDefault(); setZoom(1); }
  else if (k === "y" && ED && t === ED.doc) { e.preventDefault(); runCmd("redo"); }
});
window.addEventListener("resize", debounce(() => { if (innerWidth > 980) $("#app").classList.remove("drawer"); }, 100));

/* =========================================================
   Início
   ========================================================= */
function welcomeNote(nbId) {
  const now = Date.now();
  const html = `<p>Este é o seu novo app de notas. Algumas coisas para experimentar:</p>
<h2>Escrever e formatar</h2>
<ul><li>Use a barra no topo para <b>negrito</b>, <i>itálico</i>, <u>sublinhado</u>, <span style="color: #4b8cf0;">cores</span>, <span style="background-color: #ffd60a55;">destaque</span>, tamanhos e fontes.</li>
<li>Cole um endereço como www.youtube.com e ele vira um link. Clique no link para abrir, copiar ou editar.</li>
<li>Arraste uma imagem para cá, cole com Ctrl+V ou use o botão de imagem.</li></ul>
<h2>Organizar</h2>
<ul class="check"><li data-done="">Crie cadernos no + ao lado de “Cadernos”</li><li>Junte cadernos numa pilha pelo menu ⋯ do caderno</li><li>Adicione etiquetas, prioridade e lembretes no rodapé da nota</li><li>Filtre e classifique pelos botões acima da lista de notas</li></ul>
<blockquote>Tudo é salvo sozinho enquanto você digita. Ao fechar e abrir o app, ele volta exatamente onde você parou.</blockquote>
<p>Atalhos úteis: <b>Ctrl+N</b> nova nota · <b>Ctrl+K</b> pesquisar · <b>Ctrl+F</b> localizar · <b>Ctrl+Shift+E</b> expandir · <b>F11</b> tela cheia (Esc sai).</p>`;
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  return { id: uid("nt_"), nb: nbId, title: "Bem-vindo ao ForeverNote", html, text: tmp.innerText, tags: ["começo"], prio: 0, reminder: null, reminderDone: false, fav: true, trashed: false, created: now, updated: now };
}

async function init() {
  const d = await api.load();
  S.dataDir = d.dataDir; S.platform = d.platform;
  if (d.platform === "win32") $("#app").classList.add("win");
  (d.notebooks || []).forEach((nb) => S.nbs.set(nb.id, nb));
  (d.notes || []).forEach((n) => { n.tags = n.tags || []; S.notes.set(n.id, n); });
  Object.assign(S.prefs, d.prefs || {});
  document.documentElement.style.setProperty("--zoom", S.prefs.zoom || 1);
  document.documentElement.classList.toggle("no-anim", S.prefs.anim === false);
  $("#app").classList.toggle("wide", !!S.prefs.wide);
  const ss = d.session || {};
  if (ss.sel) S.sel = ss.sel;
  if (ss.sort) S.sort = ss.sort;
  if (ss.nbSort) S.nbSort = ss.nbSort;
  if (ss.filter) S.filter = Object.assign(blankFilter(), ss.filter);
  S.closed = ss.closed || {}; S.scroll = ss.scroll || {};
  S.tabs = (ss.tabs || []).filter((id) => S.notes.has(id));
  S.active = S.notes.has(ss.active) ? ss.active : S.tabs[0] || null;
  if ((S.sel.type === "nb" && !S.nbs.has(S.sel.id))) S.sel = { type: "all" };

  if (d.firstRun && !S.nbs.size) {
    const nb = { id: uid("nb_"), name: "Primeiro Caderno", stack: "", created: Date.now() };
    S.nbs.set(nb.id, nb); markNotebooks();
    const w = welcomeNote(nb.id); S.notes.set(w.id, w); markNote(w.id);
    S.tabs = [w.id]; S.active = w.id;
  }
  if (S.active) pushHist(S.active);
  if (ss.expanded) { S.expanded = true; $("#app").classList.add("expanded"); }
  $("#app").classList.add("booting");
  renderSidebar(); renderList(true); renderTabs(); renderPane();
  applyMobile();
  if (WEB && "serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  setTimeout(() => $("#app").classList.remove("booting"), 1100);
  setSave("ok");
  checkReminders(); setInterval(checkReminders, 20000);
  /* aviso ao abrir logo após uma atualização (só no app de PC, não no navegador) */
  if (!WEB) {
    const curVer = appVer();
    if (!d.firstRun && S.prefs.lastVer !== curVer) setTimeout(() => toast("✨ Atualizado para a versão " + curVer), 1400);
    if (S.prefs.lastVer !== curVer) { S.prefs.lastVer = curVer; savePrefs(); }
  }
  setTimeout(() => cleanAttachments(864e5), 8000);
  setInterval(() => { updateStamp(false); if (!ED || document.activeElement?.id === "tagIn" || $(".suggest")) return; renderFoot(); }, 60000);
  if ("Notification" in window && Notification.permission === "default") try { Notification.requestPermission(); } catch (e) {}
}
init().catch((e) => { console.error(e); document.body.insertAdjacentHTML("beforeend", `<div class="toast-w"><div class="toast">Não foi possível abrir as notas: ${esc(e.message)}</div></div>`); });
})();
