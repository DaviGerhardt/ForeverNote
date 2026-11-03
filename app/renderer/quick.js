(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n, c = "") => `<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
const api = window.api;
let notebooks = [], nb = "", pinned = false, lastId = null, saveT = null, doneT = null, audios = [], prefs = {};
const qn = $("#qn"), ta = $("#qText");

function refreshUI() {
  const t = ta.value.trim();
  $("#qConvert").disabled = !t && !audios.length;
  const words = (ta.value.match(/\S+/g) || []).length;
  $("#qCount").textContent = words ? `${words} ${words === 1 ? "palavra" : "palavras"}` : "";
  const cur = notebooks.find((x) => x.id === nb) || notebooks[0];
  $("#qNbName").textContent = cur ? cur.name : "Primeiro Caderno";
}
async function load() {
  const info = await api.quickInfo();
  notebooks = (info.notebooks || []).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  nb = notebooks.some((x) => x.id === info.nb) ? info.nb : (notebooks[0] && notebooks[0].id) || "";
  pinned = info.pinned; prefs = info.prefs || {};
  audios = info.audios || []; renderAudios();
  if (document.activeElement !== ta || !ta.value) ta.value = info.draft || "";
  refreshUI();
}
function show() {
  closeMenu(); $("#qDone").hidden = true;
  load().then(() => { qn.classList.remove("out"); requestAnimationFrame(() => qn.classList.add("show")); setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60); });
}
api.onQuick("show", show);
api.onQuick("hide", () => { closeMenu(); qn.classList.add("out"); setTimeout(() => qn.classList.remove("show", "out"), 170); });

ta.addEventListener("input", () => { refreshUI(); clearTimeout(saveT); saveT = setTimeout(() => api.quickDraft(ta.value), 300); });

async function convert(open) {
  const text = ta.value.trim();
  if (!text && !audios.length) { if (open) api.quickOpenApp(null); return; }
  if (REC) return;
  $("#qConvert").disabled = true;
  stopPlay();
  const r = await api.quickConvert({ text, nb, audios });
  if (!r) { $("#qConvert").disabled = false; flashError(); return; }
  ta.value = ""; api.quickDraft(""); audios = []; api.quickAudios([]); renderAudios(); $("#qBanner").hidden = true; refreshUI(); lastId = r.id;
  if (open) { api.quickOpenApp(r.id); return; }
  $("#qDoneTxt").textContent = `Em “${r.nbName}”`;
  $("#qDone").hidden = false;
  clearTimeout(doneT); doneT = setTimeout(() => { $("#qDone").hidden = true; ta.focus(); }, 2600);
}
function flashError() {
  $("#qCount").textContent = "Não foi possível salvar. Abra o ForeverNote e tente de novo.";
}
$("#qConvert").onclick = () => convert(false);
$("#qExpand").onclick = () => convert(true);
$("#qDoneOpen").onclick = () => { clearTimeout(doneT); $("#qDone").hidden = true; api.quickOpenApp(lastId); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); convert(false); }
  if (e.key === "Escape") { if (!$("#qMenu").hidden) closeMenu(); else if (REC) stopRec(true); else api.quickClose(); }
});

/* menus */
function closeMenu() { $("#qMenu").hidden = true; }
function openMenu(anchor, items, alignRight) {
  const m = $("#qMenu");
  m.innerHTML = items.map((it, i) => it === "-" ? "<hr>" : it.h ? `<div class="pop-h">${esc(it.h)}</div>` : `<button class="mi${it.danger ? " danger" : ""}" data-i="${i}">${it.icon ? ic(it.icon) : ""}${esc(it.label)}${it.checked ? ic("check", "ck") : ""}</button>`).join("");
  m.hidden = false; m.style.animation = "none"; void m.offsetWidth; m.style.animation = "";
  const r = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
  let top = r.bottom + 6; if (top + mr.height > innerHeight - 8) top = r.top - mr.height - 6;
  m.style.top = Math.max(8, top) + "px";
  m.style.left = Math.max(8, Math.min(alignRight ? r.right - mr.width : r.left, innerWidth - mr.width - 8)) + "px";
  m.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b) return; closeMenu(); items[+b.dataset.i].run(); };
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest("#qMenu,#qMore,#qNb")) closeMenu(); });
$("#qNb").onclick = (e) => {
  if (!$("#qMenu").hidden) return closeMenu();
  if (!notebooks.length) return;
  openMenu(e.currentTarget, [{ h: "Salvar no caderno" }, ...notebooks.map((x) => ({ icon: "book", label: (x.stack ? x.stack + " › " : "") + x.name, checked: x.id === nb, run: () => { nb = x.id; api.quickSetNb(nb); refreshUI(); ta.focus(); } }))]);
};
$("#qMore").onclick = (e) => {
  if (!$("#qMenu").hidden) return closeMenu();
  openMenu(e.currentTarget, [
    { icon: "pin", label: "Manter aberta", checked: pinned, run: async () => { pinned = await api.quickPin(!pinned); ta.focus(); } },
    { icon: "copy", label: "Copiar texto", run: async () => { try { await navigator.clipboard.writeText(ta.value); } catch (er) { ta.select(); } ta.focus(); } },
    { icon: "note-add", label: "Converter e abrir no app", run: () => convert(true) },
    { icon: "app", label: "Abrir o ForeverNote", run: () => api.quickOpenApp(null) },
    "-",
    { icon: "trash", label: "Limpar rascunho", danger: true, run: () => { ta.value = ""; api.quickDraft(""); audios = []; api.quickAudios([]); renderAudios(); $("#qBanner").hidden = true; refreshUI(); ta.focus(); } }
  ], true);
};

/* ===================== voz ===================== */
const fmt = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
let REC = null;
$("#qMic").onclick = () => startRec();
async function startRec() {
  if (REC) return;
  closeMenu(); $("#qBanner").hidden = true;
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: prefs.micId ? { ...base, deviceId: { exact: prefs.micId } } : base }); }
  catch (e) { try { stream = await navigator.mediaDevices.getUserMedia({ audio: base }); } catch (e2) { banner(`<b>Não consegui usar o microfone.</b><span>Confira em Configurações do Windows › Privacidade › Microfone.</span><div class="row"><button class="btn" data-b="close">Ok</button></div>`); return; } }
  const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm", audioBitsPerSecond: 64000 });
  const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
  REC = { stream, rec, ctx, an, chunks: [], peaks: [], acc: 0, since: performance.now(), paused: false, last: 0, cancel: false };
  rec.ondataavailable = (ev) => ev.data.size && REC.chunks.push(ev.data);
  rec.onstop = finishRec; rec.start(250);
  REC.wasPinned = pinned; if (!pinned) api.quickPin(true);
  $("#qRecWave").innerHTML = "<i></i>".repeat(30);
  $("#qFoot").hidden = true; $("#qRec").hidden = false; $("#qRec").classList.remove("paused");
  const data = new Uint8Array(an.fftSize);
  const tick = () => {
    if (!REC) return;
    const el = (REC.acc + (REC.paused ? 0 : performance.now() - REC.since)) / 1000; $("#qRecTime").textContent = fmt(el);
    an.getByteTimeDomainData(data); let sum = 0; for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
    const lvl = REC.paused ? 0 : Math.min(1, Math.sqrt(sum / data.length) * 4.2);
    const bars = document.querySelectorAll("#qRecWave i"); for (let i = 0; i < bars.length - 1; i++) bars[i].style.height = bars[i + 1].style.height; if (bars.length) bars[bars.length - 1].style.height = Math.max(10, lvl * 100) + "%";
    if (!REC.paused && performance.now() - REC.last > 90) { REC.peaks.push(lvl); REC.last = performance.now(); }
    REC.raf = requestAnimationFrame(tick);
  };
  tick();
}
$("#qRecPause").onclick = () => {
  if (!REC) return;
  if (REC.paused) { REC.rec.resume(); REC.since = performance.now(); REC.paused = false; $("#qRec").classList.remove("paused"); $("#qRecPause").innerHTML = ic("pause"); }
  else { REC.rec.pause(); REC.acc += performance.now() - REC.since; REC.paused = true; $("#qRec").classList.add("paused"); $("#qRecPause").innerHTML = ic("mic"); }
};
$("#qRecStop").onclick = () => stopRec(false);
$("#qRecCancel").onclick = () => stopRec(true);
function stopRec(cancel) { if (!REC) return; REC.cancel = cancel; if (!REC.paused) REC.acc += performance.now() - REC.since; REC.rec.state !== "inactive" ? REC.rec.stop() : finishRec(); }
async function finishRec() {
  const R = REC; if (!R) return; REC = null;
  cancelAnimationFrame(R.raf); R.stream.getTracks().forEach((t) => t.stop()); try { R.ctx.close(); } catch (e) {}
  $("#qRec").hidden = true; $("#qFoot").hidden = false;
  if (!R.wasPinned) api.quickPin(false);
  const dur = R.acc / 1000;
  if (R.cancel || dur < 0.6 || !R.chunks.length) { ta.focus(); return; }
  const blob = new Blob(R.chunks, { type: "audio/webm" });
  let file; try { file = await api.saveAudio(await blob.arrayBuffer(), "webm"); } catch (e) { return; }
  const n = 32, pk = R.peaks.length ? R.peaks : [0];
  const peaks = Array.from({ length: n }, (_, i) => { const a = Math.floor(i * pk.length / n), b = Math.max(a + 1, Math.floor((i + 1) * pk.length / n)); let m = 0; for (let j = a; j < b && j < pk.length; j++) m = Math.max(m, pk[j]); return +m.toFixed(2); });
  audios.push({ file, dur: +dur.toFixed(2), peaks }); api.quickAudios(audios); renderAudios(); refreshUI();
  if (prefs.afterRec === "always") transcribe(file);
  else if (prefs.afterRec !== "never") banner(`<b>Transcrever a gravação?</b><span>O texto entra na nota rápida. Tudo acontece no seu computador.</span><div class="row"><button class="btn" data-b="close">Agora não</button><button class="btn primary" data-b="trans" data-f="${esc(file)}">Transcrever</button></div>`);
}
function banner(html) { const b = $("#qBanner"); b.innerHTML = html; b.hidden = false; }
$("#qBanner").addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.b === "close") { $("#qBanner").hidden = true; ta.focus(); }
  if (t.dataset.b === "trans") { $("#qBanner").hidden = true; transcribe(t.dataset.f); }
  if (t.dataset.b === "get") {
    banner(`<b>Baixando o reconhecimento de voz…</b><div class="progress"><i id="qvBar"></i></div><div class="progress-txt"><span id="qvTxt">Conectando…</span><span id="qvPct">0%</span></div>`);
    try { await api.voiceDownload(); $("#qBanner").hidden = true; transcribe(t.dataset.f); }
    catch (er) { banner(`<b>Não foi possível baixar agora.</b><span>Confira sua internet e tente de novo.</span><div class="row"><button class="btn" data-b="close">Fechar</button><button class="btn primary" data-b="get" data-f="${esc(t.dataset.f)}">Tentar de novo</button></div>`); }
  }
});
api.onVoiceProgress(({ got, total }) => { const b = $("#qvBar"); if (!b) return; const p = total ? Math.round(got / total * 100) : 0; b.style.width = p + "%"; $("#qvPct").textContent = p + "%"; $("#qvTxt").textContent = `${(got / 1048576).toFixed(0)} de ${total ? (total / 1048576).toFixed(0) : "?"} MB`; });
function renderAudios() {
  $("#qAudios").innerHTML = audios.map((a, i) => `<div class="qa" data-i="${i}"><button class="qa-play" data-a="play" aria-label="Ouvir">${ic("play")}</button><div class="qa-wave" data-a="seek">${(a.peaks || []).map((v) => `<b style="height:${Math.round(14 + v * 86)}%"></b>`).join("")}</div><span class="qa-time">${fmt(a.dur)}</span><span class="qa-st"><i class="spin"></i>Transcrevendo…</span><button class="qa-btn qa-trans" data-a="trans" title="Transcrever para texto">${ic("text-wave")}Transcrever</button><button class="qa-btn icon" data-a="del" title="Remover gravação" aria-label="Remover gravação">${ic("trash")}</button></div>`).join("");
}
$("#qAudios").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const row = b.closest(".qa"), i = +row.dataset.i, a = audios[i]; if (!a) return;
  if (b.dataset.a === "play") play(row, a);
  if (b.dataset.a === "seek") { const r = b.getBoundingClientRect(); play(row, a, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.dur); }
  if (b.dataset.a === "trans") transcribe(a.file);
  if (b.dataset.a === "del") { if (P.row === row) stopPlay(); row.classList.add("gone"); setTimeout(() => { audios.splice(i, 1); api.quickAudios(audios); renderAudios(); refreshUI(); }, 240); }
});
/* player */
const P = { ctx: null, src: null, row: null, file: null, off: 0, t0: 0, raf: 0, cache: new Map() };
async function buf(file) { if (P.cache.has(file)) return P.cache.get(file); P.ctx = P.ctx || new AudioContext(); const ab = await (await fetch("anexo://img/" + file)).arrayBuffer(); const b = await P.ctx.decodeAudioData(ab); P.cache.set(file, b); return b; }
function paint(row, t, d) { const bars = row.querySelectorAll(".qa-wave b"); bars.forEach((x, i) => x.classList.toggle("done", (i + .5) / bars.length <= t / d)); row.querySelector(".qa-time").textContent = t > 0 ? fmt(t) : fmt(d); }
function stopPlay() { if (P.src) { try { P.src.onended = null; P.src.stop(); } catch (e) {} P.src = null; } cancelAnimationFrame(P.raf); if (P.row) { const pb = P.row.querySelector(".qa-play"); if (pb) pb.innerHTML = ic("play"); } }
async function play(row, a, from) {
  if (P.row === row && P.src && from === undefined) { P.off += P.ctx.currentTime - P.t0; stopPlay(); return; }
  if (P.row !== row) { stopPlay(); P.off = 0; }
  else stopPlay();
  P.row = row; P.file = a.file;
  let b; try { b = await buf(a.file); } catch (e) { return; }
  if (from !== undefined) P.off = from; if (P.off >= b.duration - .05) P.off = 0;
  const s = P.ctx.createBufferSource(); s.buffer = b; s.connect(P.ctx.destination); s.start(0, P.off); P.src = s; P.t0 = P.ctx.currentTime;
  row.querySelector(".qa-play").innerHTML = ic("pause");
  s.onended = () => { stopPlay(); P.off = 0; paint(row, 0, b.duration); };
  const loop = () => { if (!P.src) return; paint(row, P.off + P.ctx.currentTime - P.t0, b.duration); P.raf = requestAnimationFrame(loop); }; loop();
}
/* transcrição */
async function toWav16k(ab) {
  const ac = new AudioContext(); const dec = await ac.decodeAudioData(ab.slice(0)); ac.close();
  const rate = 16000, len = Math.max(1, Math.ceil(dec.duration * rate)); const off = new OfflineAudioContext(1, len, rate); const s = off.createBufferSource(); s.buffer = dec; s.connect(off.destination); s.start();
  const d = (await off.startRendering()).getChannelData(0); const out = new ArrayBuffer(44 + d.length * 2), v = new DataView(out);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + d.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) { const x = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return out;
}
async function transcribe(file) {
  const st = await api.voiceStatus();
  if (!st.bin) { banner(`<b>Ferramenta de transcrição não encontrada.</b><span>Reinstale o ForeverNote.</span><div class="row"><button class="btn" data-b="close">Ok</button></div>`); return; }
  if (!st.model) { banner(`<b>Ativar a transcrição</b><span>É preciso baixar uma vez o reconhecimento de voz em português (cerca de ${st.size} MB). Depois funciona sem internet.</span><div class="row"><button class="btn" data-b="close">Agora não</button><button class="btn primary" data-b="get" data-f="${esc(file)}">Baixar e ativar</button></div>`); return; }
  const row = [...document.querySelectorAll(".qa")].find((r) => audios[+r.dataset.i] && audios[+r.dataset.i].file === file);
  row && row.classList.add("busy");
  try {
    const raw = await (await fetch("anexo://img/" + file)).arrayBuffer();
    const text = await api.transcribe(await toWav16k(raw), prefs.lang || "pt");
    row && row.classList.remove("busy");
    if (!text) { banner(`<b>Não consegui entender a fala.</b><span>Tente gravar mais perto do microfone.</span><div class="row"><button class="btn" data-b="close">Ok</button></div>`); return; }
    const sep = ta.value && !/\n$/.test(ta.value) ? "\n" : "";
    ta.value = ta.value + sep + text; ta.dispatchEvent(new Event("input"));
    ta.classList.remove("flash"); void ta.offsetWidth; ta.classList.add("flash");
    ta.scrollTop = ta.scrollHeight; ta.focus();
  } catch (e) { row && row.classList.remove("busy"); banner(`<b>A transcrição falhou.</b><span>${esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))}</span><div class="row"><button class="btn" data-b="close">Ok</button></div>`); }
}
show();
})();
