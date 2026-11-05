"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, nativeTheme, session, screen, net, Tray, nativeImage, globalShortcut } = require("electron");
const os = require("os");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

app.setName("ForeverNote");
const APP_ID = "com.forevernote.app";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

protocol.registerSchemesAsPrivileged([
  { scheme: "anexo", privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

/* ---------------- arquivos ---------------- */
const userDir = () => app.getPath("userData");
const configFile = () => path.join(userDir(), "config.json");
const ICON = path.join(__dirname, "build", "icon.ico");
const ICON_PNG = path.join(__dirname, "build", "icon.png");

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data, null, 1);
  const tmp = file + ".tmp";
  try {
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    // pastas sincronizadas (ex.: Google Drive) às vezes travam o arquivo por um instante
    try { fs.writeFileSync(file, json, "utf8"); } catch (e2) { console.error("Falha ao salvar", file, e2); throw e2; }
    try { fs.unlinkSync(tmp); } catch (e3) {}
  }
}

let config = null;
function defaultDataDir() { return path.join(app.getPath("documents"), "ForeverNote"); }
function loadConfig() {
  config = readJSON(configFile(), {});
  if (!config.dataDir) config.dataDir = defaultDataDir();
  config.session = config.session || {};
  config.prefs = config.prefs || {};
  return config;
}
let cfgTimer = null;
function saveConfig(sync) {
  clearTimeout(cfgTimer);
  if (sync) return writeJSON(configFile(), config);
  cfgTimer = setTimeout(() => writeJSON(configFile(), config), 300);
}
const D = {
  root: () => config.dataDir,
  notebooks: () => path.join(config.dataDir, "cadernos.json"),
  notes: () => path.join(config.dataDir, "notas"),
  images: () => path.join(config.dataDir, "anexos"),
  backups: () => path.join(config.dataDir, "backups")
};
const safeId = (id) => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");

function loadData() {
  fs.mkdirSync(D.notes(), { recursive: true });
  const firstRun = !fs.existsSync(D.notebooks());
  const notebooks = readJSON(D.notebooks(), []);
  const notes = [];
  for (const f of fs.readdirSync(D.notes())) {
    if (!f.endsWith(".json")) continue;
    const n = readJSON(path.join(D.notes(), f), null);
    if (n && n.id) notes.push(n);
  }
  return { notebooks, notes, firstRun, dataDir: config.dataDir, session: config.session, prefs: config.prefs, platform: process.platform };
}

/* backup diário: guarda as últimas 14 cópias das notas */
const KEEP_DAYS = 14;
const B = {
  pool: () => path.join(D.backups(), "anexos"),
  gone: () => path.join(D.backups(), "excluidas")
};
const dayStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const attachNames = (html) => { const out = []; const h = String(html || ""); for (const m of h.matchAll(/anexo:\/\/img\/([\w.-]+)/g)) out.push(m[1]); for (const m of h.matchAll(/data-audio="([\w.-]+)"/g)) out.push(m[1]); for (const m of h.matchAll(/data-file="([\w.-]+)"/g)) out.push(m[1]); return out; };
function toPool(name) {
  const src = path.join(D.images(), name), dst = path.join(B.pool(), name);
  if (!fs.existsSync(src) || fs.existsSync(dst)) return;
  fs.mkdirSync(B.pool(), { recursive: true });
  try { fs.linkSync(src, dst); } catch (e) { try { fs.copyFileSync(src, dst); } catch (e2) {} }
}
/* nota excluída para sempre: guarda uma cópia por 14 dias (com seus anexos) */
function archiveNote(id) {
  const file = path.join(D.notes(), safeId(id) + ".json");
  const n = readJSON(file, null);
  if (n && ((n.title || "").trim() || (n.text || "").trim() || /<img|audio-block/.test(n.html || ""))) {
    attachNames(n.html).forEach(toPool);
    n.deletedAt = Date.now(); n.trashed = false;
    try { writeJSON(path.join(B.gone(), safeId(id) + ".json"), n); } catch (e) {}
  }
  try { fs.unlinkSync(file); } catch (e) {}
}
function dailyBackup() {
  try {
    if (!fs.existsSync(D.notebooks())) return;
    const dest = path.join(D.backups(), dayStamp());
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(D.notebooks(), path.join(dest, "cadernos.json"));
      if (fs.existsSync(D.notes())) fs.cpSync(D.notes(), path.join(dest, "notas"), { recursive: true });
      if (fs.existsSync(D.images())) fs.readdirSync(D.images()).forEach(toPool);
    }
    pruneBackups();
  } catch (e) { console.error("backup", e); }
}
function pruneBackups() {
  const days = fs.readdirSync(D.backups()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  while (days.length > KEEP_DAYS) fs.rmSync(path.join(D.backups(), days.shift()), { recursive: true, force: true });
  const limit = Date.now() - KEEP_DAYS * 864e5, used = new Set();
  if (fs.existsSync(B.gone())) for (const f of fs.readdirSync(B.gone())) {
    const fp = path.join(B.gone(), f), n = readJSON(fp, null);
    if (!n || (n.deletedAt || 0) < limit) { try { fs.unlinkSync(fp); } catch (e) {} continue; }
    attachNames(n.html).forEach((x) => used.add(x));
  }
  for (const d of days) { const nd = path.join(D.backups(), d, "notas"); if (fs.existsSync(nd)) for (const f of fs.readdirSync(nd)) attachNames((readJSON(path.join(nd, f), {}) || {}).html).forEach((x) => used.add(x)); }
  if (fs.existsSync(B.pool())) for (const f of fs.readdirSync(B.pool())) if (!used.has(f)) { try { fs.unlinkSync(path.join(B.pool(), f)); } catch (e) {} }
}
function restoreAttachments(html) {
  fs.mkdirSync(D.images(), { recursive: true });
  attachNames(html).forEach((name) => { const dst = path.join(D.images(), name), src = path.join(B.pool(), name); if (!fs.existsSync(dst) && fs.existsSync(src)) { try { fs.copyFileSync(src, dst); } catch (e) {} } });
}

/* ---------------- janela ---------------- */
let win = null;
const THEMES = {
  dark: { color: "#14161a", symbolColor: "#c9ccd3" },
  light: { color: "#eceef2", symbolColor: "#3a3f48" }
};
function overlay() { return { ...(nativeTheme.shouldUseDarkColors ? THEMES.dark : THEMES.light), height: 44 }; }

function boundsVisible(b) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
}

function createWindow() {
  const st = config.window || {};
  const opts = {
    width: 1320, height: 840, minWidth: 760, minHeight: 520,
    show: false, title: "ForeverNote",
    backgroundColor: overlay().color,
    titleBarStyle: "hidden",
    titleBarOverlay: overlay(),
    icon: fs.existsSync(ICON) ? ICON : ICON_PNG,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, spellcheck: true, devTools: !app.isPackaged }
  };
  if (st.bounds && boundsVisible(st.bounds)) Object.assign(opts, st.bounds);
  win = new BrowserWindow(opts);
  if (st.maximized) win.maximize();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => { if (!process.argv.includes("--bandeja")) win.show(); });

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    config.window = { bounds: win.isMaximized() || win.isFullScreen() ? (config.window || {}).bounds : win.getBounds(), maximized: win.isMaximized() };
    saveConfig();
  };
  win.on("resize", remember); win.on("move", remember);
  win.on("close", (e) => {
    remember(); saveConfig(true);
    if (!app.isQuitting && tray && config.prefs.closeToTray !== false) { e.preventDefault(); hideToTray(); }
  });
  win.on("minimize", () => { if (tray && config.prefs.minToTray !== false) { setTimeout(() => hideToTray(), 10); } });
  win.on("enter-full-screen", () => win.webContents.send("win:fullscreen", true));
  win.on("leave-full-screen", () => win.webContents.send("win:fullscreen", false));

  const wc = win.webContents;
  wc.on("will-navigate", (e, url) => { if (url.split("#")[0] === wc.getURL().split("#")[0]) return; e.preventDefault(); openExternal(url); });
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  wc.on("context-menu", (e, p) => buildContextMenu(p));
  wc.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (["http:", "https:", "mailto:"].includes(u.protocol)) shell.openExternal(u.toString());
  } catch (e) {}
}

function buildContextMenu(p) {
  const wc = win.webContents;
  const t = [];
  if (p.misspelledWord) {
    const sug = (p.dictionarySuggestions || []).slice(0, 6);
    if (sug.length) sug.forEach((s) => t.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    else t.push({ label: "Sem sugestões", enabled: false });
    t.push({ label: "Adicionar ao dicionário", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    t.push({ type: "separator" });
  }
  if (p.linkURL && /^(https?|mailto):/i.test(p.linkURL)) {
    t.push({ label: "Abrir link", click: () => openExternal(p.linkURL) });
    t.push({ label: "Copiar link", click: () => require("electron").clipboard.writeText(p.linkURL) });
    t.push({ type: "separator" });
  }
  if (p.isEditable && (!p.formControlType || p.formControlType === "none")) {
    if (p.selectionText && p.selectionText.trim()) t.push({ label: "Corrigir texto selecionado", accelerator: "F7", click: () => wc.send("ctx:proof", "sel") });
    t.push({ label: "Revisar a nota inteira", click: () => wc.send("ctx:proof", "all") }, { type: "separator" });
  }
  if (p.isEditable) {
    t.push(
      { label: "Desfazer", role: "undo", enabled: p.editFlags.canUndo },
      { label: "Refazer", role: "redo", enabled: p.editFlags.canRedo },
      { type: "separator" },
      { label: "Recortar", role: "cut", enabled: p.editFlags.canCut },
      { label: "Copiar", role: "copy", enabled: p.editFlags.canCopy },
      { label: "Colar", role: "paste", enabled: p.editFlags.canPaste },
      { label: "Colar sem formatação", role: "pasteAndMatchStyle", enabled: p.editFlags.canPaste },
      { type: "separator" },
      { label: "Selecionar tudo", role: "selectAll" }
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    t.push({ label: "Copiar", role: "copy" });
  }
  while (t.length && t[t.length - 1].type === "separator") t.pop();
  if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
}

function createShortcuts() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const startLnk = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "ForeverNote.lnk");
  try { if (fs.existsSync(startLnk) && shell.readShortcutLink(startLnk).target === process.execPath) return; } catch (e) {}
  try {
    const opts = { target: process.execPath, icon: fs.existsSync(ICON) ? ICON : process.execPath, iconIndex: 0, appUserModelId: APP_ID, description: "Notas com cadernos" };
    shell.writeShortcutLink(path.join(app.getPath("desktop"), "ForeverNote.lnk"), "create", opts);
    const start = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
    fs.mkdirSync(start, { recursive: true });
    shell.writeShortcutLink(path.join(start, "ForeverNote.lnk"), "create", opts);
  } catch (e) { console.error("atalhos", e); }
}

/* ---------------- IPC ---------------- */
ipcMain.handle("data:load", () => loadData());
ipcMain.handle("note:save", (e, n) => { const id = safeId(n && n.id); if (!id) return false; writeJSON(path.join(D.notes(), id + ".json"), n); return true; });
ipcMain.handle("note:delete", (e, id) => { archiveNote(id); return true; });
ipcMain.handle("notebooks:save", (e, list) => { writeJSON(D.notebooks(), Array.isArray(list) ? list : []); return true; });
ipcMain.handle("session:save", (e, s) => { config.session = s || {}; saveConfig(); return true; });
ipcMain.handle("prefs:save", (e, p) => {
  config.prefs = p || {};
  nativeTheme.themeSource = ["dark", "light"].includes(config.prefs.theme) ? config.prefs.theme : "system";
  saveConfig(); return true;
});
ipcMain.on("flush", (e, payload) => {
  try {
    (payload.notes || []).forEach((n) => { const id = safeId(n.id); if (id) writeJSON(path.join(D.notes(), id + ".json"), n); });
    (payload.deleted || []).forEach((id) => archiveNote(id));
    if (payload.notebooks) writeJSON(D.notebooks(), payload.notebooks);
    if (payload.session) config.session = payload.session;
    saveConfig(true);
  } catch (er) { console.error(er); }
  e.returnValue = true;
});
ipcMain.handle("image:save", (e, dataUrl) => {
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Imagem inválida");
  fs.mkdirSync(D.images(), { recursive: true });
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + "." + ext;
  fs.writeFileSync(path.join(D.images(), name), Buffer.from(m[2], "base64"));
  return name;
});
ipcMain.handle("folder:choose", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Escolha a pasta das notas", properties: ["openDirectory", "createDirectory"], defaultPath: config.dataDir });
  if (r.canceled || !r.filePaths[0]) return null;
  let dest = r.filePaths[0];
  if (path.resolve(dest) === path.resolve(config.dataDir)) return null;
  const hasData = fs.existsSync(path.join(dest, "cadernos.json"));
  if (!hasData) {
    if (fs.readdirSync(dest).length) dest = path.join(dest, "ForeverNote");
    fs.mkdirSync(dest, { recursive: true });
    if (fs.existsSync(D.notebooks())) fs.copyFileSync(D.notebooks(), path.join(dest, "cadernos.json"));
    for (const sub of ["notas", "anexos"]) {
      const src = path.join(config.dataDir, sub);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, sub), { recursive: true });
    }
  }
  config.dataDir = dest; saveConfig(true);
  return { dataDir: dest, usedExisting: hasData };
});
ipcMain.handle("folder:open", (e, which) => {
  const p = which === "backups" ? D.backups() : D.root();
  fs.mkdirSync(p, { recursive: true });
  return shell.openPath(p);
});
ipcMain.handle("link:open", (e, url) => openExternal(url));
ipcMain.handle("image:dataurl", async (e, name) => {
  try {
    const file = path.join(D.images(), path.basename(String(name || "")));
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext];
    if (!type) return null;
    const buf = await fs.promises.readFile(file);
    return "data:" + type + ";base64," + buf.toString("base64");
  } catch (err) { return null; }
});
ipcMain.handle("win:fullscreen", (e, on) => { if (win) win.setFullScreen(!!on); return win ? win.isFullScreen() : false; });
ipcMain.handle("win:reload", (e) => { e.sender.reload(); return true; });
ipcMain.handle("win:focus", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
ipcMain.handle("note:export", async (e, { title, html, text, format }) => {
  const clean = String(title || "Nota").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Nota";
  const ext = format === "txt" ? "txt" : "html";
  const r = await dialog.showSaveDialog(win, { title: "Exportar nota", defaultPath: path.join(app.getPath("documents"), clean + "." + ext), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return false;
  if (ext === "txt") { fs.writeFileSync(r.filePath, String(text || "").replace(/\r?\n/g, "\r\n"), "utf8"); return true; }
  const body = String(html || "").replace(/anexo:\/\/img\/([a-z0-9.]+)/gi, (m, f) => {
    try {
      const file = path.join(D.images(), path.basename(f));
      const ex = path.extname(file).slice(1).replace("jpg", "jpeg");
      return `data:image/${ex};base64,` + fs.readFileSync(file).toString("base64");
    } catch (er) { return m; }
  });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  fs.writeFileSync(r.filePath, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(clean)}</title><style>body{font:16px/1.6 "Segoe UI",system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1a1d23}img{max-width:100%;border-radius:12px}blockquote{border-left:3px solid #ccd;margin:0;padding-left:14px;color:#555}pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto}a{color:#3f63e0}</style></head><body><h1>${esc(title || "")}</h1>${body}</body></html>`, "utf8");
  return true;
});

/* ---------------- áudio e transcrição ---------------- */
ipcMain.handle("audio:save", (e, buf, ext) => {
  fs.mkdirSync(D.images(), { recursive: true });
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + "." + (ext === "ogg" ? "ogg" : "webm");
  fs.writeFileSync(path.join(D.images(), name), Buffer.from(buf));
  return name;
});
const WHISPER_DIR = path.join(__dirname, "whisper");
const WHISPER_BIN = path.join(WHISPER_DIR, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
const MODEL_NAME = "ggml-small-q5_1.bin";
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + MODEL_NAME;
const modelPath = () => path.join(userDir(), "voz", MODEL_NAME);
ipcMain.handle("whisper:status", () => ({ bin: fs.existsSync(WHISPER_BIN), model: fs.existsSync(modelPath()), size: 190 }));
let downloading = null;
ipcMain.handle("whisper:download", (e) => {
  if (downloading) return downloading;
  const dest = modelPath(), part = dest + ".part";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const wc = e.sender;
  downloading = new Promise((resolve, reject) => {
    const req = net.request({ url: MODEL_URL, redirect: "follow" });
    req.on("response", (res) => {
      if (res.statusCode !== 200) { reject(new Error("O servidor respondeu " + res.statusCode)); return; }
      const total = parseInt(res.headers["content-length"], 10) || 0;
      let got = 0, last = 0;
      const out = fs.createWriteStream(part);
      res.on("data", (c) => {
        out.write(c); got += c.length;
        const now = Date.now();
        if (now - last > 150 && !wc.isDestroyed()) { last = now; wc.send("whisper:progress", { got, total }); }
      });
      res.on("end", () => out.end(() => { try { fs.renameSync(part, dest); resolve(true); } catch (er) { reject(er); } }));
      res.on("error", (er) => { out.destroy(); reject(er); });
    });
    req.on("error", reject);
    req.end();
  }).finally(() => { downloading = null; });
  return downloading;
});
ipcMain.handle("whisper:remove", () => { try { fs.unlinkSync(modelPath()); } catch (e) {} return true; });

/* ---------- atualização automática (GitHub) ---------- */
const UPDATE_REPO = "DaviGerhardt/ForeverNote";
function verGt(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: "follow" });
    req.setHeader("User-Agent", "ForeverNote-Updater");
    req.setHeader("Accept", "application/vnd.github+json");
    let data = "";
    const tm = setTimeout(() => { try { req.abort(); } catch (e) {} reject(new Error("tempo esgotado")); }, 15000);
    req.on("response", (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { clearTimeout(tm); reject(new Error("HTTP " + res.statusCode)); return; }
      res.on("data", (c) => (data += c));
      res.on("end", () => { clearTimeout(tm); try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on("error", (e) => { clearTimeout(tm); reject(e); });
    req.end();
  });
}
const UPDATE_BRANCH = "main";
const API_LATEST = `https://api.github.com/repos/${UPDATE_REPO}/contents/latest.json?ref=${UPDATE_BRANCH}`;
const RAW_LATEST = `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/latest.json`;
const CODE_ZIP_URL = `https://codeload.github.com/${UPDATE_REPO}/zip/refs/heads/${UPDATE_BRANCH}`;
async function readLatest() {
  /* a API reflete a última versão na hora; o raw é reserva caso a API falhe */
  try {
    const r = await fetchJSON(API_LATEST + "&t=" + Date.now());
    if (r && r.content) return JSON.parse(Buffer.from(r.content, r.encoding || "base64").toString("utf8"));
    if (r && r.version) return r;
  } catch (e) {}
  return await fetchJSON(RAW_LATEST + "?t=" + Date.now());
}
async function checkUpdate() {
  const meta = await readLatest();
  const v = meta && meta.version;
  if (!v || !verGt(v, app.getVersion())) return null;
  return { version: String(v).replace(/^v/i, ""), notes: meta.notes || "" };
}
ipcMain.on("app:version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("update:check", async () => { try { return await checkUpdate(); } catch (e) { return { error: e.message }; } });
ipcMain.handle("update:install", async (e, info) => {
  if (process.platform !== "win32") return { error: "A atualização automática funciona no Windows." };
  const wc = e.sender;
  const dir = path.join(os.tmpdir(), "ForeverNote-update");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "code.zip"), ext = path.join(dir, "extracted");
  try {
    /* baixa só o código do app (poucos MB), direto do repositório */
    await new Promise((resolve, reject) => {
      const req = net.request({ url: CODE_ZIP_URL, redirect: "follow" });
      req.setHeader("User-Agent", "ForeverNote-Updater");
      req.on("response", (res) => {
        if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
        const total = parseInt(res.headers["content-length"], 10) || 0;
        let got = 0, last = 0;
        const out = fs.createWriteStream(zip);
        res.on("data", (c) => { out.write(c); got += c.length; const now = Date.now(); if (now - last > 120 && !wc.isDestroyed()) { last = now; wc.send("update:progress", { got, total }); } });
        res.on("end", () => out.end(() => { if (!wc.isDestroyed()) wc.send("update:progress", { got: 1, total: 1 }); resolve(); }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
    await new Promise((resolve, reject) => {
      const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${ext.replace(/'/g, "''")}' -Force`]);
      ps.on("error", reject);
      ps.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("falha ao extrair (" + code + ")"))));
    });
    /* o zip do GitHub vem como ForeverNote-main/app/... */
    const top = fs.readdirSync(ext).map((n) => path.join(ext, n)).find((p) => fs.statSync(p).isDirectory());
    const srcApp = top && path.join(top, "app");
    if (!srcApp || !fs.existsSync(path.join(srcApp, "main.js"))) return { error: "pacote de atualização inválido" };
    const destApp = app.getAppPath();              // <instalação>/resources/app
    const exe = process.execPath;                   // <instalação>/ForeverNote.exe
    const q = (s) => '"' + s + '"';
    /* ping no lugar de timeout (funciona sem console); start desacopla o app; a janela roda escondida e o .bat se apaga no fim */
    const batContent = [
      "@echo off",
      "chcp 65001 >nul",
      'taskkill /im "ForeverNote.exe" /f >nul 2>&1',
      "ping -n 3 127.0.0.1 >nul",
      `robocopy ${q(srcApp)} ${q(destApp)} /MIR /NFL /NDL /NJH /NJS /NP >nul`,
      `start "" ${q(exe)}`,
      `rmdir /s /q ${q(dir)} >nul 2>&1`,
      '(goto) 2>nul & del "%~f0"'
    ].join("\r\n") + "\r\n";
    const bat = path.join(os.tmpdir(), "fn-update-" + Date.now() + ".bat");
    fs.writeFileSync(bat, batContent, "latin1");
    setTimeout(() => {
      try { spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch (er) {}
      app.isQuitting = true; app.quit();
    }, 400);
    return { ok: true };
  } catch (er) { return { error: er.message }; }
});
ipcMain.handle("whisper:transcribe", (e, wav, lang) => new Promise((resolve, reject) => {
  if (!fs.existsSync(WHISPER_BIN)) return reject(new Error("Ferramenta de transcrição não encontrada."));
  if (!fs.existsSync(modelPath())) return reject(new Error("Reconhecimento de voz não instalado."));
  const tmp = path.join(os.tmpdir(), "forevernote-" + Date.now() + ".wav");
  fs.writeFileSync(tmp, Buffer.from(wav));
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
  const p = spawn(WHISPER_BIN, ["-m", modelPath(), "-f", tmp, "-l", /^(pt|en|es|auto)$/.test(lang || "") ? lang : "pt", "-nt", "-np", "-t", threads], { cwd: WHISPER_DIR, windowsHide: true });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d.toString("utf8")));
  p.stderr.on("data", (d) => (err += d.toString("utf8")));
  p.on("error", (er) => { try { fs.unlinkSync(tmp); } catch (x) {} reject(er); });
  p.on("close", (code) => {
    try { fs.unlinkSync(tmp); } catch (x) {}
    if (code !== 0) return reject(new Error(code === 3221225781 || /vcruntime|msvcp/i.test(err) ? "Falta um componente do Windows (Visual C++). Instale o 'Microsoft Visual C++ Redistributable' e tente de novo." : "A transcrição falhou (código " + code + ")."));
    const text = out.split(/\r?\n/).map((l) => l.replace(/^\s*\[.*?\]\s*/, "").trim()).filter((l) => l && !/^\[(BLANK_AUDIO|Música|Music|MÚSICA)\]$/i.test(l)).join(" ").replace(/\s+/g, " ").trim();
    resolve(text);
  });
}));

/* ---------------- restaurar cópias ---------------- */
ipcMain.handle("backup:list", () => {
  const out = { days: [], deleted: [] };
  if (!fs.existsSync(D.backups())) return out;
  for (const d of fs.readdirSync(D.backups()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse()) {
    const nd = path.join(D.backups(), d, "notas"); let count = 0;
    try { count = fs.readdirSync(nd).filter((f) => f.endsWith(".json")).length; } catch (e) {}
    out.days.push({ date: d, count });
  }
  const books = readJSON(D.notebooks(), []);
  if (fs.existsSync(B.gone())) for (const f of fs.readdirSync(B.gone())) {
    const n = readJSON(path.join(B.gone(), f), null); if (!n) continue;
    const nbk = books.find((b) => b.id === n.nb);
    out.deleted.push({ id: n.id, title: n.title || "Sem título", snippet: String(n.text || "").replace(/\s+/g, " ").slice(0, 120), nb: nbk ? nbk.name : "", deletedAt: n.deletedAt, expires: n.deletedAt + KEEP_DAYS * 864e5, hasFiles: attachNames(n.html).length });
  }
  out.deleted.sort((a, b) => b.deletedAt - a.deletedAt);
  return out;
});
ipcMain.handle("backup:restoreNote", (e, id) => {
  const fp = path.join(B.gone(), safeId(id) + ".json"); const n = readJSON(fp, null);
  if (!n) throw new Error("Essa nota não está mais disponível.");
  delete n.deletedAt; n.trashed = false; n.updated = Date.now();
  restoreAttachments(n.html);
  writeJSON(path.join(D.notes(), safeId(n.id) + ".json"), n);
  try { fs.unlinkSync(fp); } catch (er) {}
  return n;
});
ipcMain.handle("backup:restoreDay", (e, date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data inválida");
  const src = path.join(D.backups(), date);
  if (!fs.existsSync(path.join(src, "notas"))) throw new Error("Essa cópia não existe mais.");
  // guarda o estado atual antes de voltar, para poder desfazer
  const safe = path.join(D.backups(), "antes-de-restaurar-" + Date.now());
  fs.mkdirSync(safe, { recursive: true });
  if (fs.existsSync(D.notebooks())) fs.copyFileSync(D.notebooks(), path.join(safe, "cadernos.json"));
  if (fs.existsSync(D.notes())) fs.cpSync(D.notes(), path.join(safe, "notas"), { recursive: true });
  // notas atuais que não existem na cópia vão para "excluídas" (recuperáveis)
  const keepIds = new Set(fs.readdirSync(path.join(src, "notas")).map((f) => f.replace(/\.json$/, "")));
  if (fs.existsSync(D.notes())) for (const f of fs.readdirSync(D.notes())) { const id = f.replace(/\.json$/, ""); if (!keepIds.has(id)) archiveNote(id); }
  for (const f of fs.readdirSync(path.join(src, "notas"))) { const n = readJSON(path.join(src, "notas", f), null); if (n) { restoreAttachments(n.html); writeJSON(path.join(D.notes(), f), n); } }
  if (fs.existsSync(path.join(src, "cadernos.json"))) fs.copyFileSync(path.join(src, "cadernos.json"), D.notebooks());
  // mantém só a cópia de segurança mais recente "antes de restaurar"
  fs.readdirSync(D.backups()).filter((x) => x.startsWith("antes-de-restaurar-")).sort().slice(0, -1).forEach((x) => fs.rmSync(path.join(D.backups(), x), { recursive: true, force: true }));
  return true;
});

/* ---------------- importar do Evernote (.enex) ---------------- */
const crypto = require("crypto");
const decodeEnt = (t) => String(t || "").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tagText = (blk, tag) => { const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(blk); return m ? decodeEnt(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : ""; };
const enDate = (t) => { const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(t || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0; };
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/amr": "amr", "audio/webm": "webm", "audio/ogg": "ogg", "application/pdf": "pdf" };
function parseEnex(file) {
  const xml = fs.readFileSync(file, "utf8");
  const notes = [];
  let res = 0;
  fs.mkdirSync(D.images(), { recursive: true });
  for (const part of xml.split(/<note>/).slice(1)) {
    const blk = part.slice(0, part.lastIndexOf("</note>") >= 0 ? part.lastIndexOf("</note>") : part.length);
    const tasks = [...blk.matchAll(/<task>([\s\S]*?)<\/task>/g)].map((m) => ({ title: tagText(m[1], "title"), done: /completed/i.test(tagText(m[1], "taskStatus")), group: tagText(m[1], "taskGroupNoteLevelID"), order: tagText(m[1], "sortWeight") }));
    const head = blk.replace(/<resource>[\s\S]*?<\/resource>/g, "").replace(/<task>[\s\S]*?<\/task>/g, "").replace(/<content>[\s\S]*?<\/content>/, "");
    const cm = /<content>([\s\S]*?)<\/content>/.exec(blk);
    let enml = cm ? cm[1].trim() : "";
    enml = /<!\[CDATA\[/.test(enml) ? enml.replace(/<!\[CDATA\[|\]\]>/g, "") : decodeEnt(enml);
    const resources = {};
    for (const rm of blk.matchAll(/<resource>([\s\S]*?)<\/resource>/g)) {
      const r = rm[1];
      const dm = /<data[^>]*>([\s\S]*?)<\/data>/.exec(r); if (!dm) continue;
      const buf = Buffer.from(dm[1].replace(/\s+/g, ""), "base64"); if (!buf.length) continue;
      const hash = crypto.createHash("md5").update(buf).digest("hex");
      const mime = tagText(r, "mime").toLowerCase() || "application/octet-stream";
      const orig = tagText(r, "file-name") || "";
      let ext = EXT[mime] || (path.extname(orig).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "")) || "bin";
      const name = hash + "." + ext;
      const fp = path.join(D.images(), name);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf);
      resources[hash] = { file: name, mime, name: orig || name, size: buf.length };
      res++;
    }
    notes.push({
      title: tagText(head, "title"), created: enDate(tagText(head, "created")), updated: enDate(tagText(head, "updated")),
      tags: [...head.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map((m) => decodeEnt(m[1]).trim()).filter(Boolean),
      sourceUrl: tagText(head, "source-url"), enml, resources, tasks
    });
  }
  return { notes, resources: res };
}
ipcMain.handle("enex:pick", async () => {
  const r = process.env.FN_TEST_ENEX && !app.isPackaged ? { canceled: false, filePaths: process.env.FN_TEST_ENEX.split("|") } : await dialog.showOpenDialog(win, { title: "Escolha os arquivos exportados do Evernote", properties: ["openFile", "multiSelections"], filters: [{ name: "Evernote (.enex)", extensions: ["enex"] }] });
  if (r.canceled || !r.filePaths.length) return null;
  const out = [];
  for (const f of r.filePaths) {
    try { const p = parseEnex(f); out.push({ fileName: path.basename(f), notebook: path.basename(f, path.extname(f)), ...p }); }
    catch (e) { out.push({ fileName: path.basename(f), error: String(e.message || e) }); }
  }
  return out;
});
ipcMain.handle("attach:open", (e, name) => { const fp = path.join(D.images(), path.basename(String(name))); if (fs.existsSync(fp)) return shell.openPath(fp); return "missing"; });

/* ---------------- limpeza de anexos sem uso ---------------- */
ipcMain.handle("attachments:cleanup", (e, keepList, minAgeMs) => {
  const keep = new Set([...(keepList || []), ...((config.quickAudios || []).map((a) => a.file))].map((x) => path.basename(String(x))));
  let removed = 0, bytes = 0;
  try {
    if (!fs.existsSync(D.images())) return { removed, bytes };
    const now = Date.now();
    for (const f of fs.readdirSync(D.images())) {
      if (keep.has(f) || f.startsWith(".")) continue;
      const fp = path.join(D.images(), f);
      try {
        const st = fs.statSync(fp); if (!st.isFile()) continue;
        if (minAgeMs && now - st.mtimeMs < minAgeMs) continue;
        toPool(f); fs.unlinkSync(fp); removed++; bytes += st.size;
      } catch (er) {}
    }
  } catch (er) { console.error(er); }
  return { removed, bytes };
});

/* ---------------- revisão online (LanguageTool) ---------------- */
ipcMain.handle("grammar:check", async (e, text, lang) => {
  const chunks = []; let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + 15000);
    if (end < text.length) { const nl = text.lastIndexOf("\n", end); if (nl > i + 2000) end = nl + 1; }
    chunks.push([i, text.slice(i, end)]); i = end;
  }
  const out = [];
  for (const [base, part] of chunks) {
    const body = new URLSearchParams({ text: part, language: lang || "pt-BR", enabledOnly: "false" }).toString();
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await net.fetch("https://api.languagetool.org/v2/check", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: ctl.signal });
      if (res.status === 429) throw new Error("limite");
      if (!res.ok) throw new Error("http " + res.status);
      const j = await res.json();
      (j.matches || []).forEach((m) => {
        if (!m.replacements || !m.replacements.length) return;
        out.push({ offset: base + m.offset, length: m.length, replacement: m.replacements[0].value, alts: m.replacements.slice(1, 10).map((r) => r.value), message: m.message || m.shortMessage || "", kind: (m.rule && m.rule.issueType) || "grammar" });
      });
    } finally { clearTimeout(tm); }
  }
  return out;
});

/* ---------------- início ---------------- */
app.on("second-instance", () => showMain());

/* ---------------- bandeja e nota rápida ---------------- */
let tray = null, quick = null, quickHideAt = 0;
function showMain(noteId) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setSkipTaskbar(false); win.show(); win.focus();
  if (noteId) win.webContents.send("quick:open", noteId);
}
function hideToTray() {
  if (!win) return;
  win.hide();
  if (!config.trayTipShown && tray && process.platform === "win32") {
    config.trayTipShown = true; saveConfig();
    try { tray.displayBalloon({ iconType: "info", title: "O ForeverNote continua aqui", content: "Clique no ícone para uma nota rápida. Para sair de vez, clique com o botão direito e escolha Sair." }); } catch (e) {}
  }
}
function trayIcon() {
  const img = nativeImage.createFromPath(fs.existsSync(ICON) ? ICON : ICON_PNG);
  return process.platform === "win32" ? img : img.resize({ width: 22, height: 22 });
}
function createTray() {
  try { tray = new Tray(trayIcon()); } catch (e) { tray = null; return; }
  tray.setToolTip("ForeverNote · clique para uma nota rápida");
  tray.on("click", () => toggleQuick());
  tray.on("double-click", () => showMain());
  const menu = Menu.buildFromTemplate([
    { label: "Nota rápida", accelerator: "CommandOrControl+Alt+N", click: () => showQuick() },
    { label: "Abrir o ForeverNote", click: () => showMain() },
    { label: "Nova nota", click: () => { showMain(); win.webContents.send("quick:new"); } },
    { type: "separator" },
    { label: "Sair", click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.on("right-click", () => tray.popUpContextMenu(menu));
}
function createQuick() {
  quick = new BrowserWindow({
    width: 420, height: 480, show: false, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, title: "Nota rápida", backgroundColor: overlay().color,
    icon: fs.existsSync(ICON) ? ICON : ICON_PNG,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, spellcheck: true, devTools: !app.isPackaged }
  });
  quick.loadFile(path.join(__dirname, "renderer", "quick.html"));
  quick.on("blur", () => { if (!quick.pinned && quick.isVisible() && !quick.webContents.isDevToolsOpened()) { quickHideAt = Date.now(); quick.webContents.send("quick:hide"); setTimeout(() => quick && quick.hide(), 160); } });
  quick.on("close", (e) => { if (!app.isQuitting) { e.preventDefault(); quick.hide(); } });
  quick.webContents.on("context-menu", (e, p) => { const t = []; if (p.misspelledWord) { (p.dictionarySuggestions || []).slice(0, 5).forEach((x) => t.push({ label: x, click: () => quick.webContents.replaceMisspelling(x) })); t.push({ type: "separator" }); } if (p.isEditable) t.push({ label: "Recortar", role: "cut" }, { label: "Copiar", role: "copy" }, { label: "Colar", role: "paste" }, { type: "separator" }, { label: "Selecionar tudo", role: "selectAll" }); if (t.length) Menu.buildFromTemplate(t).popup({ window: quick }); });
  quick.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
}
function placeQuick() {
  const [w, h] = quick.getSize();
  const tb = tray && tray.getBounds ? tray.getBounds() : null;
  const pt = tb && tb.width ? { x: tb.x + tb.width / 2, y: tb.y } : screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt), wa = d.workArea;
  let x = Math.round(pt.x - w / 2), y;
  if (pt.y > wa.y + wa.height / 2) y = wa.y + wa.height - h - 12; else y = wa.y + 12;
  x = Math.max(wa.x + 12, Math.min(x, wa.x + wa.width - w - 12));
  quick.setPosition(x, y);
}
function showQuick() {
  if (!quick) createQuick();
  placeQuick(); quick.show(); quick.focus();
  if (quick.webContents.isLoading()) quick.webContents.once("did-finish-load", () => quick.webContents.send("quick:show"));
  else quick.webContents.send("quick:show");
}
function toggleQuick() {
  if (quick && quick.isVisible()) { quick.webContents.send("quick:hide"); setTimeout(() => quick.hide(), 160); return; }
  if (Date.now() - quickHideAt < 300) return; // o clique no ícone acabou de esconder a janela
  showQuick();
}
ipcMain.handle("quick:info", () => ({ notebooks: readJSON(D.notebooks(), []), draft: config.quickDraft || "", audios: config.quickAudios || [], nb: config.quickNb || "", pinned: !!(quick && quick.pinned), prefs: { micId: config.prefs.micId || "", lang: config.prefs.lang || "pt", afterRec: config.prefs.afterRec || "ask", anim: config.prefs.anim !== false } }));
ipcMain.handle("quick:audios", (e, list) => { config.quickAudios = Array.isArray(list) ? list : []; saveConfig(); return true; });
ipcMain.handle("quick:draft", (e, text) => { config.quickDraft = text; saveConfig(); return true; });
ipcMain.handle("quick:setnb", (e, id) => { config.quickNb = id; saveConfig(); return true; });
ipcMain.handle("quick:pin", (e, on) => { if (quick) quick.pinned = !!on; return !!on; });
ipcMain.handle("quick:close", () => { if (quick) { quick.webContents.send("quick:hide"); setTimeout(() => quick.hide(), 160); } });
ipcMain.handle("quick:convert", (e, { text, nb, open, audios }) => new Promise((resolve) => {
  if (!win) return resolve(null);
  const rid = Date.now() + "" + Math.random();
  const done = (ev, r) => { if (r && r.rid === rid) { ipcMain.removeListener("quick:added", done); resolve(r); } };
  ipcMain.on("quick:added", done);
  win.webContents.send("quick:add", { text, nb, rid, audios: audios || [] });
  setTimeout(() => { ipcMain.removeListener("quick:added", done); resolve(null); }, 4000);
  if (open) { if (quick) quick.hide(); }
}));
ipcMain.handle("quick:openapp", (e, noteId) => { if (quick) quick.hide(); showMain(noteId); });
ipcMain.handle("login:set", (e, on) => { try { app.setLoginItemSettings({ openAtLogin: !!on, args: ["--bandeja"] }); } catch (er) {} return true; });
app.whenReady().then(() => {
  loadConfig();
  nativeTheme.themeSource = ["dark", "light"].includes(config.prefs.theme) ? config.prefs.theme : "system";
  Menu.setApplicationMenu(null);
  try { session.defaultSession.setSpellCheckerLanguages(["pt-BR"]); } catch (e) {}
  const okPerm = (perm, details) => perm === "notifications" || perm === "clipboard-sanitized-write" || (perm === "media" && (!details || !details.mediaTypes || details.mediaTypes.every((t) => t === "audio")));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(okPerm(perm, details)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === "media" || perm === "notifications" || perm === "clipboard-sanitized-write");
  protocol.handle("anexo", async (req) => {
    const u = new URL(req.url);
    const file = path.join(D.images(), path.basename(decodeURIComponent(u.pathname)));
    try {
      const buf = await fs.promises.readFile(file);
      const ext = path.extname(file).slice(1).toLowerCase();
      const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" }[ext] || "application/octet-stream";
      return new Response(buf, { headers: { "content-type": type } });
    } catch (e) { return new Response("", { status: 404 }); }
  });
  nativeTheme.on("updated", () => { if (win && !win.isDestroyed()) { try { win.setTitleBarOverlay(overlay()); win.setBackgroundColor(overlay().color); } catch (e) {} } });
  dailyBackup();
  createWindow();
  createShortcuts();
  createTray();
  try { globalShortcut.register("CommandOrControl+Alt+N", () => (quick && quick.isVisible() ? quick.focus() : showQuick())); } catch (e) {}
  if (process.argv.includes("--bandeja") && tray) win.once("ready-to-show", () => setTimeout(() => win.hide(), 50));
  if (process.argv.includes("--quick")) setTimeout(showQuick, 1500);
  else setTimeout(() => { if (!quick) createQuick(); }, 4000);
  if (app.isPackaged) setTimeout(() => { checkUpdate().then((info) => { if (info && win && !win.isDestroyed()) win.webContents.send("update:available", info); }).catch(() => {}); }, 8000);
});
app.on("before-quit", () => { app.isQuitting = true; });
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on("window-all-closed", () => { if (!tray) app.quit(); });
