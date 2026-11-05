(function () {
  "use strict";
  const SUPA_URL = "https://dltfppkltlbyfrescrrh.supabase.co";
  const SUPA_KEY = "sb_publishable_aPoOIFs518bclT_KEwWm_g_6wtmzYFJ";
  const main = document.getElementById("v");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const token = new URLSearchParams(location.search).get("n") || location.hash.replace(/^#n?=?/, "");
  let lastUpdated = 0;

  function toast(msg) {
    const t = document.getElementById("vToast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function fmt(t) {
    try { return new Date(t).toLocaleString("pt-BR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às"); } catch (e) { return ""; }
  }
  function fail(title, text) {
    document.title = "ForeverNote";
    main.innerHTML = `<div class="v-card v-fail"><div class="v-fic"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 7.5h6M7 10.5h6M7 13.5h3.5"/></svg></div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`;
  }

  /* ---------- limpeza do conteúdo (só o que é seguro) ---------- */
  const OK = new Set("P H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE B STRONG I EM U S STRIKE DEL A IMG HR BR SPAN DIV TABLE THEAD TBODY TFOOT TR TD TH MARK SUB SUP FONT SMALL CAPTION COLGROUP COL".split(" "));
  const DROP = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|FORM|INPUT|BUTTON|TEXTAREA|SELECT|SVG|MATH|TEMPLATE|AUDIO|VIDEO|SOURCE|NOSCRIPT|BASE)$/;
  const OK_STYLE = /^(color|background-color|font-family|font-size|font-weight|font-style|text-align|text-decoration|text-decoration-line|text-indent|line-height|width|margin-left|padding-left)$/;
  function clean(node) {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) { c.remove(); continue; }
      const t = c.tagName;
      if (DROP.test(t)) { c.remove(); continue; }
      if (!OK.has(t)) { clean(c); c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) {
        const n = a.name.toLowerCase(), v = (a.value || "").trim();
        if (["class", "data-done", "colspan", "rowspan", "alt", "title"].includes(n)) continue;
        if (n === "href" && t === "A" && /^(https?:|mailto:)/i.test(v)) continue;
        if (n === "src" && t === "IMG" && /^(data:image\/(png|jpe?g|gif|webp);|https:)/i.test(v)) continue;
        if (n === "style") {
          const st = c.style, keep = [];
          for (let i = 0; i < st.length; i++) { const p = st[i], val = st.getPropertyValue(p); if (OK_STYLE.test(p) && !/url\(|expression|javascript/i.test(val)) keep.push(p + ":" + val); }
          if (keep.length) c.setAttribute("style", keep.join(";")); else c.removeAttribute("style");
          continue;
        }
        c.removeAttribute(a.name);
      }
      if (t === "IMG" && !c.getAttribute("src")) { c.remove(); continue; }
      if (t === "A") { c.setAttribute("target", "_blank"); c.setAttribute("rel", "noopener noreferrer nofollow"); }
      clean(c);
    }
  }

  /* ---------- telas ---------- */
  function renderNote(d, upd) {
    const box = new DOMParser().parseFromString("<div>" + (d.html || "") + "</div>", "text/html").body.firstChild;
    clean(box);
    const title = (d.title || "").trim() || "Sem título";
    document.title = title + " · ForeverNote";
    main.innerHTML = `<article class="v-card v-note"><h1 class="v-title">${esc(title)}</h1><div class="v-meta">Atualizada em ${esc(fmt(upd))}</div><div class="doc v-doc"></div></article>`;
    const doc = main.querySelector(".v-doc");
    doc.append(...box.childNodes);
    if (!doc.textContent.trim() && !doc.querySelector("img")) doc.innerHTML = '<p class="v-empty">Esta nota ainda está vazia.</p>';
    doc.querySelectorAll("img").forEach((im) => { im.loading = "lazy"; im.addEventListener("click", () => zoom(im.src)); });
  }
  function renderBoard(d, upd) {
    const title = (d.title || "").trim() || "Moodboard";
    document.title = title + " · ForeverNote";
    const okImg = /^data:image\/(png|jpe?g|webp);/i.test(d.img || "");
    const cols = (Array.isArray(d.colors) ? d.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    const file = title.replace(/[\\/:*?"<>|]+/g, "").trim() || "moodboard";
    main.innerHTML = `<article class="v-card v-board">
      <h1 class="v-title">${esc(title)}</h1><div class="v-meta">Moodboard · atualizado em ${esc(fmt(upd))}</div>
      ${okImg ? `<figure class="v-fig"><img alt="${esc(title)}" width="${+d.w || ""}" height="${+d.h || ""}"></figure>` : ""}
      ${cols.length ? `<div class="v-ptitle">Paleta de cores <span>toque para copiar o código</span></div><div class="v-pal">${cols.map((c) => `<button class="v-sw" data-c="${c}"><i style="background:${c}"></i><span>${c.toUpperCase()}</span></button>`).join("")}</div>` : ""}
      ${okImg ? `<div class="v-acts"><a class="v-btn" download="${esc(file)}.jpg"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 15h12"/></svg>Baixar imagem</a></div>` : ""}
    </article>`;
    const im = main.querySelector(".v-fig img"); if (im) { im.src = d.img; im.addEventListener("click", () => zoom(im.src)); }
    const dl = main.querySelector(".v-acts a"); if (dl) dl.href = d.img;
    main.querySelectorAll(".v-sw").forEach((b) => b.addEventListener("click", () => {
      const c = b.dataset.c.toUpperCase();
      const done = () => { toast("Código " + c + " copiado"); b.classList.add("ok"); setTimeout(() => b.classList.remove("ok"), 900); };
      try { navigator.clipboard.writeText(c).then(done, () => toast(c)); } catch (e) { toast(c); }
    }));
  }
  function zoom(src) {
    const z = document.createElement("div"); z.className = "v-zoom"; const zi = document.createElement("img"); zi.alt = ""; zi.src = src; z.appendChild(zi);
    z.addEventListener("click", () => { z.classList.add("out"); setTimeout(() => z.remove(), 200); });
    document.body.appendChild(z);
  }

  /* ---------- carregar ---------- */
  if (!token || !/^[A-Za-z0-9]{10,64}$/.test(token)) { fail("Link incompleto", "Confira se o link foi copiado inteiro."); return; }
  if (!window.supabase) { fail("Não foi possível abrir", "Recarregue a página para tentar de novo."); return; }
  const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  async function load(quiet) {
    try {
      const { data, error } = await sb.rpc("get_share", { token });
      if (error) throw error;
      if (!data || !data.data) { if (!quiet) fail("Esta nota não está mais compartilhada", "Quem enviou o link desligou o compartilhamento — peça um link novo."); return; }
      const upd = data.updated || data.data.updated || Date.now();
      if (quiet && upd === lastUpdated) return;
      lastUpdated = upd;
      document.getElementById("vBadge").hidden = false;
      const y = window.scrollY;
      if (data.data.kind === "moodboard") renderBoard(data.data, upd); else renderNote(data.data, upd);
      if (quiet) window.scrollTo(0, y);
    } catch (e) {
      if (!quiet) fail(navigator.onLine === false ? "Sem internet" : "Não foi possível abrir agora", navigator.onLine === false ? "Conecte-se e recarregue a página." : "Tente recarregar a página em alguns instantes.");
    }
  }
  load(false);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && lastUpdated) load(true); });
  setInterval(() => { if (!document.hidden && lastUpdated) load(true); }, 30000);
})();
