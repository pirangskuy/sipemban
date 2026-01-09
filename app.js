
const LS_RECORDS = "sipemban_records_v2";
const LS_SETTINGS = "sipemban_settings_v1";

const REGIONS_KALBAR = [
  "Pontianak (Kota)",
  "Singkawang (Kota)",
  "Kubu Raya",
  "Mempawah",
  "Landak",
  "Sanggau",
  "Sekadau",
  "Sintang",
  "Kapuas Hulu",
  "Melawi",
  "Ketapang",
  "Kayong Utara",
  "Bengkayang",
  "Sambas"
];

const DEFAULT_SETTINGS = {
  thresholds: {
    normalMax: 50,
    waspadaMax: 100,
    siagaMax: 150
  }
};

const $ = (sel) => document.querySelector(sel);

const state = {
  records: [],
  settings: loadSettings(),
  route: "home",
  lastFilter: { from:"", to:"", region:"", category:"", status:"" },
  deferredPrompt: null,

  // map
  map: null,
  mapLayer: null,
  markerLayer: null,
  osmLayer: null,
  gridLayer: null
};

function loadSettings(){
  try{
    const raw = localStorage.getItem(LS_SETTINGS);
    if(!raw) return structuredClone(DEFAULT_SETTINGS);
    const p = JSON.parse(raw);
    return {
      thresholds: {
        normalMax: Number(p?.thresholds?.normalMax ?? DEFAULT_SETTINGS.thresholds.normalMax),
        waspadaMax: Number(p?.thresholds?.waspadaMax ?? DEFAULT_SETTINGS.thresholds.waspadaMax),
        siagaMax: Number(p?.thresholds?.siagaMax ?? DEFAULT_SETTINGS.thresholds.siagaMax),
      }
    };
  }catch{
    return structuredClone(DEFAULT_SETTINGS);
  }
}
function saveSettings(){ localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }

function loadRecords(){
  try{
    const raw = localStorage.getItem(LS_RECORDS);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function saveRecords(){ localStorage.setItem(LS_RECORDS, JSON.stringify(state.records)); }

function uid(){ return "rec_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16); }
function toISODate(d){
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function parseDateSafe(iso){
  const [y,m,dd] = (iso || "").split("-").map(Number);
  if(!y || !m || !dd) return null;
  const dt = new Date(y, m-1, dd);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function calcStatus(mm){
  const t = state.settings.thresholds;
  const x = Number(mm);
  if(!Number.isFinite(x)) return { label:"—", tone:"" };
  if(x < t.normalMax) return { label:"Normal", tone:"ok" };
  if(x < t.waspadaMax) return { label:"Waspada", tone:"warn" };
  if(x < t.siagaMax) return { label:"Siaga", tone:"alert" };
  return { label:"Awas", tone:"danger" };
}

function getRecommendation(category, statusLabel, rain){
  const mm = Number(rain);
  const s = statusLabel;

  const base = {
    Genangan: {
      Normal: "Pantau saluran/drainase. Hindari parkir di titik rawan genangan.",
      Waspada: "Bersihkan drainase sekitar. Hindari melintasi genangan yang tidak diketahui kedalamannya.",
      Siaga: "Siapkan rute alternatif. Amankan kendaraan/barang dari lantai dasar. Koordinasi RT/RW.",
      Awas: "Hindari jalur genangan. Putuskan listrik di area tergenang bila perlu. Hubungi petugas setempat."
    },
    Banjir: {
      Normal: "Pantau prakiraan & kondisi sungai. Pastikan jalur evakuasi keluarga diketahui.",
      Waspada: "Siapkan tas siaga (dokumen, obat, senter). Pindahkan barang berharga ke tempat tinggi.",
      Siaga: "Matikan listrik/gas jika air naik. Siapkan evakuasi lansia/anak. Pantau informasi BPBD.",
      Awas: "Evakuasi segera ke tempat aman. Hindari arus deras. Hubungi BPBD/posko terdekat."
    },
    Longsor: {
      Normal: "Pantau lereng, terutama setelah hujan. Pastikan drainase lereng tidak tersumbat.",
      Waspada: "Hindari area lereng curam. Waspadai retakan tanah/pohon miring. Kurangi aktivitas di bawah tebing.",
      Siaga: "Evakuasi dari zona lereng rawan. Tutup akses jalan rawan. Laporkan tanda longsor ke aparat.",
      Awas: "Segera evakuasi menjauh dari lereng. Jangan melintas jalur tebing. Hubungi BPBD dan aparat."
    }
  };

  const cat = base[category] ? category : "Banjir";
  const text = base[cat][s] || "Pantau situasi dan ikuti arahan petugas.";

  if(Number.isFinite(mm) && mm >= state.settings.thresholds.siagaMax && (cat === "Banjir" || cat === "Genangan")){
    return text + " (Curah hujan tinggi, prioritaskan keselamatan.)";
  }
  return text;
}

function badgeHTML(label, tone){
  const cls = tone ? `badge ${tone}` : "badge";
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function toast(title, msg, kind="info"){
  const t = $("#toast");
  $("#toastTitle").textContent = title;
  $("#toastMsg").textContent = msg;

  const icon = $("#toastIcon");
  icon.innerHTML = `<i class="fa-solid fa-circle-info"></i>`;
  if(kind === "ok") icon.innerHTML = `<i class="fa-solid fa-circle-check"></i>`;
  if(kind === "warn") icon.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
  if(kind === "danger") icon.innerHTML = `<i class="fa-solid fa-circle-xmark"></i>`;

  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=> t.classList.remove("show"), 2800);
}

function setChip(text, tone="ok"){
  $("#chipText").textContent = text;
  const dot = $("#chipStatus .dot");
  dot.style.background = ({ok:"var(--ok)", warn:"var(--warn)", alert:"var(--alert)", danger:"var(--danger)"}[tone] || "var(--ok)");
}

function routeLabel(r){
  return ({
    home:"Beranda",
    new:"Tambah Data",
    data:"Data & Filter",
    map:"Peta",
    analytics:"Analisis",
    settings:"Pengaturan"
  }[r] || "Beranda");
}

/* ---------------- RENDER ---------------- */

function fillRegions(){
  const sel = $("#inpRegion");
  const selF = $("#fRegion");
  if(sel && sel.options.length === 0){
    sel.innerHTML = `<option value="" disabled selected>Pilih wilayah</option>` +
      REGIONS_KALBAR.map(r=> `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  }
  if(selF && selF.options.length === 0){
    selF.innerHTML = `<option value="">Semua</option>` +
      REGIONS_KALBAR.map(r=> `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  }
}

function updateStatusAndRecommendationPreview(){
  const mm = $("#inpRain")?.value;
  const cat = $("#inpCategory")?.value || "Banjir";
  const st = calcStatus(mm);

  const badge = $("#badgePreview");
  const text = $("#previewText");
  badge.className = "badge " + (st.tone || "");
  badge.textContent = st.label;

  text.textContent = Number.isFinite(Number(mm))
    ? `Ambang: Normal < ${state.settings.thresholds.normalMax}, Waspada < ${state.settings.thresholds.waspadaMax}, Siaga < ${state.settings.thresholds.siagaMax}, Awas ≥ ${state.settings.thresholds.siagaMax}.`
    : `Masukkan curah hujan untuk melihat status.`;

  const rec = getRecommendation(cat, st.label, mm);
  $("#badgeRec").className = "badge " + (st.tone || "");
  $("#badgeRec").textContent = cat;
  $("#recText").textContent = rec;
}

function applyFilterToRecords(filter){
  const from = filter.from ? parseDateSafe(filter.from) : null;
  const to = filter.to ? parseDateSafe(filter.to) : null;
  const region = filter.region || "";
  const category = filter.category || "";
  const status = filter.status || "";

  return state.records.filter(r=>{
    const d = parseDateSafe(r.date);
    if(from && (!d || d < from)) return false;
    if(to && (!d || d > to)) return false;
    if(region && r.region !== region) return false;
    if(category && (r.category || "Banjir") !== category) return false;
    if(status){
      const st = calcStatus(r.rain).label;
      if(st !== status) return false;
    }
    return true;
  }).sort((a,b)=> (b.date||"").localeCompare(a.date||""));
}

function renderHome(){
  const all = state.records.slice().sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  $("#statTotal").textContent = String(all.length);

  const counts = { Normal:0, Waspada:0, Siaga:0, Awas:0 };
  for(const r of all){
    const st = calcStatus(r.rain).label;
    if(counts[st] !== undefined) counts[st]++;
  }
  $("#statNormal").textContent = String(counts.Normal);
  $("#statWaspada").textContent = String(counts.Waspada);
  $("#statSiaga").textContent = String(counts.Siaga);
  $("#statAwas").textContent = String(counts.Awas);

  const latest = all.slice(0,5);
  $("#latestList").innerHTML = latest.length ? latest.map(r => {
    const st = calcStatus(r.rain);
    const coord = (r.lat && r.lng) ? `${r.lat}, ${r.lng}` : "—";
    return `
      <div class="item">
        <div class="left">
          <div class="title">${escapeHtml(r.region)} — ${escapeHtml(r.date)}</div>
          <div class="sub">${escapeHtml(r.category || "Banjir")} • ${escapeHtml(r.rain)} mm/hari • ${escapeHtml(coord)}</div>
        </div>
        <div class="right">${badgeHTML(st.label, st.tone)}</div>
      </div>
    `;
  }).join("") : `<div class="muted tiny">Belum ada data. Klik “Isi Data Contoh” atau tambah data baru.</div>`;

  const hot = state.records.slice().sort((a,b)=> Number(b.rain||0) - Number(a.rain||0)).slice(0,7);
  $("#hotList").innerHTML = hot.length ? hot.map(r=>{
    const st = calcStatus(r.rain);
    return `
      <div class="item">
        <div class="left">
          <div class="title">${escapeHtml(r.region)}</div>
          <div class="sub">${escapeHtml(r.date)} • ${escapeHtml(r.category || "Banjir")} • ${escapeHtml(r.rain)} mm/hari</div>
        </div>
        <div class="right">${badgeHTML(st.label, st.tone)}</div>
      </div>
    `;
  }).join("") : `<div class="muted tiny">Belum ada data.</div>`;

  drawDonut(counts);
}

function renderDataTable(list){
  const tbody = $("#dataTbody");
  if(!tbody) return;

  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="10" class="muted">Tidak ada data sesuai filter.</td></tr>`;
    $("#dataCount").textContent = "0 data";
    return;
  }

  tbody.innerHTML = list.map(r=>{
    const st = calcStatus(r.rain);
    const coord = (r.lat && r.lng) ? `${r.lat}, ${r.lng}` : "—";
    const cat = r.category || "Banjir";
    const rec = r.recommendation || getRecommendation(cat, st.label, r.rain);
    const note = r.note ? escapeHtml(r.note) : "—";
    return `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.region)}</td>
        <td><b>${escapeHtml(cat)}</b></td>
        <td><b>${escapeHtml(r.rain)}</b></td>
        <td>${badgeHTML(st.label, st.tone)}</td>
        <td>${escapeHtml(r.source || "—")}</td>
        <td class="muted tiny">${escapeHtml(coord)}</td>
        <td class="muted tiny">${escapeHtml(rec)}</td>
        <td class="muted tiny">${note}</td>
        <td>
          <button class="btn ghost" data-act="del" data-id="${escapeHtml(r.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  $("#dataCount").textContent = `${list.length} data`;
}

function renderSettingsInputs(){
  $("#sNormal").value = state.settings.thresholds.normalMax;
  $("#sWaspada").value = state.settings.thresholds.waspadaMax;
  $("#sSiaga").value = state.settings.thresholds.siagaMax;
  $("#sAwas").value = state.settings.thresholds.siagaMax;
}

/* -------------- CHARTS -------------- */

CanvasRenderingContext2D.prototype.roundRect ||= function(x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  this.beginPath();
  this.moveTo(x+rr, y);
  this.arcTo(x+w, y, x+w, y+h, rr);
  this.arcTo(x+w, y+h, x, y+h, rr);
  this.arcTo(x, y+h, x, y, rr);
  this.arcTo(x, y, x+w, y, rr);
  this.closePath();
  return this;
};

function drawDonut(counts){
  const c = $("#donutCanvas"); if(!c) return;
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);

  const values = [
    {label:"Normal", v:counts.Normal||0, tone:"ok"},
    {label:"Waspada", v:counts.Waspada||0, tone:"warn"},
    {label:"Siaga", v:counts.Siaga||0, tone:"alert"},
    {label:"Awas", v:counts.Awas||0, tone:"danger"},
  ];
  const total = values.reduce((a,b)=> a + b.v, 0);

  const cx = 160, cy = H/2;
  const rOuter = 80, rInner = 46;

  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI*2);
  ctx.arc(cx, cy, rInner, 0, Math.PI*2, true);
  ctx.closePath();
  ctx.fillStyle = "rgba(16,42,67,.06)";
  ctx.fill();

  if(total === 0){
    ctx.fillStyle = "rgba(16,42,67,.55)";
    ctx.font = "600 13px Poppins";
    ctx.fillText("Belum ada data", cx - 44, cy + 4);
    return;
  }

  const toneColor = (tone)=>({
    ok:"rgba(18,184,134,.95)",
    warn:"rgba(245,159,0,.95)",
    alert:"rgba(247,103,7,.95)",
    danger:"rgba(224,49,49,.95)"
  }[tone] || "rgba(11,58,91,.95)");

  let a0 = -Math.PI/2;
  for(const it of values){
    const frac = it.v / total;
    const a1 = a0 + frac * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, a0, a1);
    ctx.arc(cx, cy, rInner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = toneColor(it.tone);
    ctx.fill();
    a0 = a1;
  }

  ctx.fillStyle = "rgba(16,42,67,.9)";
  ctx.font = "800 18px Poppins";
  ctx.fillText(`${total}`, cx - 8, cy + 6);
  ctx.font = "500 12px Poppins";
  ctx.fillStyle = "rgba(16,42,67,.55)";
  ctx.fillText("data", cx - 14, cy + 26);
}

function groupAvgByDate(list){
  const map = new Map();
  for(const r of list){
    if(!r.date) continue;
    const mm = Number(r.rain);
    if(!Number.isFinite(mm)) continue;
    if(!map.has(r.date)) map.set(r.date, {sum:0, n:0});
    const it = map.get(r.date);
    it.sum += mm; it.n += 1;
  }
  return Array.from(map.entries())
    .map(([date, it])=> ({date, avg: it.sum / it.n}))
    .sort((a,b)=> a.date.localeCompare(b.date))
    .slice(-30);
}

function drawLineChart(list){
  const c = $("#lineCanvas"); if(!c) return;
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);

  const points = groupAvgByDate(list);
  if(points.length === 0){
    ctx.fillStyle = "rgba(16,42,67,.55)";
    ctx.font = "600 13px Poppins";
    ctx.fillText("Belum ada data untuk grafik.", 18, 32);
    return;
  }

  const padding = {l:54, r:18, t:18, b:44};
  const innerW = W - padding.l - padding.r;
  const innerH = H - padding.t - padding.b;

  const ys = points.map(p=> p.avg);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const span = Math.max(1, yMax - yMin);

  ctx.strokeStyle = "rgba(16,42,67,.10)";
  ctx.lineWidth = 1;
  const steps = 4;
  for(let i=0;i<=steps;i++){
    const y = padding.t + (innerH/steps)*i;
    ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(W-padding.r, y); ctx.stroke();
    const val = (yMax - (span/steps)*i);
    ctx.fillStyle = "rgba(16,42,67,.55)";
    ctx.font = "500 11px Poppins";
    ctx.fillText(val.toFixed(0), 12, y + 4);
  }

  const x = (i)=> padding.l + (innerW * (points.length === 1 ? 0.5 : i/(points.length-1)));
  const y = (v)=> padding.t + innerH - ((v - yMin)/span)*innerH;

  ctx.strokeStyle = "rgba(11,58,91,.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p,i)=>{
    const xx = x(i), yy = y(p.avg);
    if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
  });
  ctx.stroke();

  ctx.fillStyle = "rgba(14,94,140,.95)";
  points.forEach((p,i)=>{
    const xx = x(i), yy = y(p.avg);
    ctx.beginPath(); ctx.arc(xx,yy,3.2,0,Math.PI*2); ctx.fill();
  });

  ctx.fillStyle = "rgba(16,42,67,.55)";
  ctx.font = "500 11px Poppins";
  const labelStep = Math.max(1, Math.floor(points.length / 6));
  points.forEach((p,i)=>{
    if(i % labelStep !== 0 && i !== points.length-1) return;
    const xx = x(i);
    const txt = p.date.slice(5);
    ctx.fillText(txt, xx - 14, H - 18);
  });
}

/* -------------- ANALYTICS -------------- */

function renderAnalytics(list){
  const rains = list.map(r=> Number(r.rain)).filter(n=> Number.isFinite(n));
  const n = rains.length;
  const avg = n ? (rains.reduce((a,b)=>a+b,0) / n) : 0;
  const mx = n ? Math.max(...rains) : 0;
  const mn = n ? Math.min(...rains) : 0;

  $("#stAvg").textContent = n ? avg.toFixed(1) : "0";
  $("#stMax").textContent = n ? mx.toFixed(1) : "0";
  $("#stMin").textContent = n ? mn.toFixed(1) : "0";
  $("#stN").textContent = String(n);

  const interp = $("#interpretation");
  if(!n){
    interp.textContent = "Tambahkan data untuk melihat interpretasi risiko.";
  }else{
    const st = calcStatus(avg);
    interp.innerHTML = `Rata-rata: <b>${avg.toFixed(1)} mm/hari</b> → ${badgeHTML(st.label, st.tone)}.`;
  }

  drawLineChart(list);
}

/* -------------- MAP (Leaflet offline demo + OSM optional) -------------- */

function toneToColor(tone){
  return ({ok:"#12B886", warn:"#F59F00", alert:"#F76707", danger:"#E03131"}[tone] || "#0B3A5B");
}

function createOfflineGridLayer(){
  const grid = L.gridLayer({ tileSize: 256, noWrap: true });
  grid.createTile = function(coords){
    const tile = document.createElement("canvas");
    tile.width = 256; tile.height = 256;
    const ctx = tile.getContext("2d");

    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillRect(0,0,256,256);

    ctx.strokeStyle = "rgba(16,42,67,.12)";
    ctx.lineWidth = 1;
    for(let i=0;i<=256;i+=32){
      ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(256,i); ctx.stroke();
    }

    ctx.fillStyle = "rgba(16,42,67,.55)";
    ctx.font = "12px system-ui";
    ctx.fillText(`Si Pemban Grid`, 10, 18);
    ctx.fillText(`z:${coords.z} x:${coords.x} y:${coords.y}`, 10, 36);

    return tile;
  };
  return grid;
}

function createOsmLayer(){
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    crossOrigin: true,
    attribution: "&copy; OpenStreetMap"
  });
}

function ensureMap(){
  const mapEl = $("#leafletMap");
  const fallback = $("#mapFallback");
  if(!mapEl) return;

  if(typeof window.L === "undefined"){
    mapEl.style.display = "none";
    if(fallback){
      fallback.style.display = "block";
      renderFallbackMiniMap();
    }
    return;
  }

  if(fallback) fallback.style.display = "none";
  mapEl.style.display = "block";

  if(state.map) return;

  state.map = L.map(mapEl, { zoomControl: true, attributionControl: false });

  state.gridLayer = createOfflineGridLayer();
  state.osmLayer = createOsmLayer();

  if(navigator.onLine){
    state.mapLayer = state.osmLayer.addTo(state.map);
  }else{
    state.mapLayer = state.gridLayer.addTo(state.map);
  }

  state.markerLayer = L.layerGroup().addTo(state.map);

  L.control.layers(
    {
      "Offline Grid": state.gridLayer,
      "OpenStreetMap (Online)": state.osmLayer
    },
    { "Marker": state.markerLayer }
  ).addTo(state.map);

  state.map.setView([0.2, 111.5], 7);

  // auto switch when online/offline changes
  window.addEventListener("online", ()=>{
    try{
      if(state.map && state.osmLayer){
        if(state.map.hasLayer(state.gridLayer)) state.map.removeLayer(state.gridLayer);
        if(!state.map.hasLayer(state.osmLayer)) state.osmLayer.addTo(state.map);
      }
    }catch{}
  });

  window.addEventListener("offline", ()=>{
    try{
      if(state.map && state.gridLayer){
        if(state.map.hasLayer(state.osmLayer)) state.map.removeLayer(state.osmLayer);
        if(!state.map.hasLayer(state.gridLayer)) state.gridLayer.addTo(state.map);
      }
    }catch{}
  });
}

function updateMap(){
  if(!$("#leafletMap")) return;

  ensureMap();

  const withCoord = state.records
    .filter(r => isFinite(parseFloat(r.lat)) && isFinite(parseFloat(r.lng)))
    .sort((a,b)=> (b.date||"").localeCompare(a.date||""));

  const mapList = $("#mapList");
  if(mapList){
    mapList.innerHTML = withCoord.length ? withCoord.slice(0,25).map(r=>{
      const st = calcStatus(r.rain);
      const cat = r.category || "Banjir";
      return `
        <div class="item" data-mapfocus="1" data-lat="${escapeHtml(r.lat)}" data-lng="${escapeHtml(r.lng)}">
          <div class="left">
            <div class="title">${escapeHtml(r.region)} — ${escapeHtml(r.date)}</div>
            <div class="sub">${escapeHtml(cat)} • ${escapeHtml(r.rain)} mm/hari • ${escapeHtml(r.lat)}, ${escapeHtml(r.lng)}</div>
          </div>
          <div class="right">${badgeHTML(st.label, st.tone)}</div>
        </div>
      `;
    }).join("") : `<div class="muted tiny">Belum ada titik koordinat. Tambahkan data dengan GPS.</div>`;
  }

  if(typeof window.L === "undefined" || !state.map || !state.markerLayer) return;

  state.markerLayer.clearLayers();

  const bounds = [];
  withCoord.forEach(r=>{
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lng);
    const st = calcStatus(r.rain);
    const cat = r.category || "Banjir";
    const rec = r.recommendation || getRecommendation(cat, st.label, r.rain);

    const marker = L.circleMarker([lat,lng], {
      radius: 8,
      weight: 2,
      color: toneToColor(st.tone),
      fillColor: toneToColor(st.tone),
      fillOpacity: 0.9
    });

    marker.bindPopup(`
      <div style="min-width:220px">
        <div style="font-weight:800">${escapeHtml(r.region)}</div>
        <div style="color:rgba(16,42,67,.65); font-size:12px; margin-top:2px">${escapeHtml(r.date)} • ${escapeHtml(cat)}</div>
        <div style="margin-top:8px">
          <b>${escapeHtml(r.rain)} mm/hari</b> • ${escapeHtml(st.label)}
        </div>
        <div style="margin-top:8px; font-size:12px; color:rgba(16,42,67,.75)">
          <b>Rekomendasi:</b><br/>${escapeHtml(rec)}
        </div>
      </div>
    `);

    marker.addTo(state.markerLayer);
    bounds.push([lat,lng]);
  });

  if(bounds.length){
    const b = L.latLngBounds(bounds);
    state.map.fitBounds(b.pad(0.25));
  }
}

function renderFallbackMiniMap(){
  const wrap = $("#fallbackCanvasWrap");
  if(!wrap) return;

  const points = state.records
    .filter(r => isFinite(parseFloat(r.lat)) && isFinite(parseFloat(r.lng)))
    .map(r => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lng), st: calcStatus(r.rain) }));

  wrap.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = 720; c.height = 320;
  c.style.width = "100%";
  c.style.borderRadius = "14px";
  c.style.border = "1px solid rgba(16,42,67,.12)";
  c.style.background = "rgba(255,255,255,.85)";
  wrap.appendChild(c);

  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);

  ctx.strokeStyle = "rgba(16,42,67,.10)";
  for(let x=0;x<=c.width;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,c.height); ctx.stroke(); }
  for(let y=0;y<=c.height;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(c.width,y); ctx.stroke(); }

  ctx.fillStyle = "rgba(16,42,67,.7)";
  ctx.font = "700 13px Poppins";
  ctx.fillText("Fallback Map (tanpa Leaflet)", 12, 22);

  if(!points.length){
    ctx.fillStyle = "rgba(16,42,67,.55)";
    ctx.font = "600 12px Poppins";
    ctx.fillText("Belum ada koordinat.", 12, 44);
    return;
  }

  const minLat = -1.5, maxLat = 2.5;
  const minLng = 108.0, maxLng = 114.5;

  const px = (lng)=> 30 + ( (lng - minLng) / (maxLng - minLng) ) * (c.width - 60);
  const py = (lat)=> 30 + ( (maxLat - lat) / (maxLat - minLat) ) * (c.height - 60);

  points.forEach(p=>{
    ctx.fillStyle = toneToColor(p.st.tone);
    ctx.beginPath();
    ctx.arc(px(p.lng), py(p.lat), 5, 0, Math.PI*2);
    ctx.fill();
  });
}

/* -------------- ROUTER -------------- */

function setRoute(route){
  state.route = route || "home";
  $("#crumbs").textContent = routeLabel(state.route);

  document.querySelectorAll(".page").forEach(p=> p.classList.remove("active"));
  const el = $(`#page-${state.route}`);
  (el || $("#page-home")).classList.add("active");

  syncNav();

  if(state.route === "map"){
    setTimeout(()=>{
      updateMap();
      if(state.map) state.map.invalidateSize();
    }, 80);
  }

  if(window.innerWidth <= 860){
    $("#sidebar")?.classList.remove("show");
  }
}

function syncNav(){
  document.querySelectorAll(".navItem").forEach(a=>{
    a.classList.toggle("active", a.dataset.route === state.route);
  });
}

function handleHash(){
  const h = (location.hash || "#/home").replace("#/","");
  const route = h.split("?")[0] || "home";
  setRoute(route);
}

/* -------------- EXPORT -------------- */

function toCSV(list){
  const header = ["date","region","category","rain_mm","status","source","lat","lng","recommendation","note"];
  const rows = list.map(r=>{
    const st = calcStatus(r.rain).label;
    const cat = r.category || "Banjir";
    const rec = r.recommendation || getRecommendation(cat, st, r.rain);
    const cols = [r.date, r.region, cat, r.rain, st, r.source, r.lat, r.lng, rec, r.note]
      .map(v => `"${String(v ?? "").replaceAll('"','""')}"`);
    return cols.join(",");
  });
  return header.join(",") + "\n" + rows.join("\n");
}

function downloadText(text, filename, mime){
  const blob = new Blob([text], {type:mime || "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------- GEO -------------- */

function getGeo(){
  if(!navigator.geolocation){
    toast("GPS", "Browser tidak mendukung geolocation.", "danger");
    return;
  }
  setChip("Mengambil GPS…", "warn");
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const {latitude, longitude} = pos.coords;
      $("#inpLat").value = latitude.toFixed(6);
      $("#inpLng").value = longitude.toFixed(6);
      setChip("GPS didapat", "ok");
      toast("GPS", "Koordinat berhasil diambil.", "ok");
    },
    (err)=>{
      setChip("GPS gagal", "danger");
      toast("GPS gagal", err.message || "Izin ditolak / tidak tersedia.", "danger");
    },
    { enableHighAccuracy:true, timeout:8000, maximumAge: 0 }
  );
}

/* -------------- SEED -------------- */

function seedDemo(){
  const today = new Date();

  const mk = (daysAgo, region, category, rain, lat, lng, note="")=> ({
    id: uid(),
    date: toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo)),
    region,
    category,
    rain,
    source: "Manual",
    lat: lat != null ? String(lat) : "",
    lng: lng != null ? String(lng) : "",
    recommendation: getRecommendation(category, calcStatus(rain).label, rain),
    note
  });

  const demo = [
    mk(0, "Pontianak (Kota)", "Banjir", 140.2, -0.0263, 109.3425, "Hujan deras sore-malam."),
    mk(1, "Kubu Raya", "Banjir", 165.0, -0.2667, 109.4000, "Potensi banjir meningkat."),
    mk(2, "Sambas", "Genangan", 92.4,  1.3667, 109.3000, "Waspada genangan."),
    mk(3, "Sintang", "Genangan", 58.1,  0.0830, 111.5000, "Hujan sedang."),
    mk(4, "Ketapang", "Genangan", 40.0, -1.8330, 109.9830, "Aman relatif."),
    mk(5, "Kapuas Hulu", "Banjir", 180.5,  0.9500, 113.9000, "Curah tinggi, awas."),
    mk(6, "Singkawang (Kota)", "Longsor", 110.3, 0.9070, 108.9840, "Waspada area lereng.")
  ];

  const key = (r)=> `${r.date}__${r.region}__${r.category}`;
  const existing = new Set(state.records.map(key));
  for(const r of demo){
    if(!existing.has(key(r))) state.records.unshift(r);
  }
  saveRecords();
  renderAll();
}

/* -------------- IMPORT MODAL -------------- */

function showImportModal(show){
  const m = $("#modalImport");
  if(!m) return;
  m.classList.toggle("show", !!show);
  m.setAttribute("aria-hidden", show ? "false" : "true");
}

/* -------------- RENDER ALL -------------- */

function renderAll(){
  fillRegions();
  renderHome();

  const list = applyFilterToRecords(state.lastFilter);
  renderDataTable(list);
  renderAnalytics(list);
  renderSettingsInputs();

  updateStatusAndRecommendationPreview();

  if(state.route === "map") updateMap();

  syncNav();
}

/* -------------- EVENTS -------------- */

function bindEvents(){
  $("#btnToggleSidebar")?.addEventListener("click", ()=> $("#sidebar")?.classList.toggle("show"));
  $("#toastClose")?.addEventListener("click", ()=> $("#toast")?.classList.remove("show"));

  $("#btnSeed")?.addEventListener("click", ()=>{
    seedDemo();
    toast("Data contoh dibuat", "Data contoh berhasil ditambahkan.", "ok");
    setChip("Data contoh siap", "ok");
  });

  $("#inpRain")?.addEventListener("input", updateStatusAndRecommendationPreview);
  $("#inpCategory")?.addEventListener("change", updateStatusAndRecommendationPreview);

  $("#btnClearForm")?.addEventListener("click", ()=>{
    $("#formNew")?.reset();
    if($("#inpRegion")) $("#inpRegion").value = "";
    if($("#inpSource")) $("#inpSource").value = "Manual";
    if($("#inpCategory")) $("#inpCategory").value = "Banjir";
    if($("#inpLat")) $("#inpLat").value = "";
    if($("#inpLng")) $("#inpLng").value = "";
    if($("#inpDate")) $("#inpDate").value = toISODate(new Date());
    updateStatusAndRecommendationPreview();
  });

  $("#btnGeo")?.addEventListener("click", getGeo);

  $("#formNew")?.addEventListener("submit", (e)=>{
    e.preventDefault();

    const date = $("#inpDate").value;
    const region = $("#inpRegion").value;
    const rain = Number($("#inpRain").value);
    const source = $("#inpSource").value;
    const category = $("#inpCategory").value || "Banjir";
    const lat = ($("#inpLat").value || "").trim();
    const lng = ($("#inpLng").value || "").trim();
    const note = ($("#inpNote").value || "").trim();

    if(!date || !region || !Number.isFinite(rain)){
      toast("Gagal", "Lengkapi tanggal, wilayah, dan curah hujan.", "danger");
      return;
    }

    const st = calcStatus(rain);
    const recommendation = getRecommendation(category, st.label, rain);

    const rec = {
      id: uid(),
      date,
      region,
      category,
      rain: Number(rain.toFixed(1)),
      source: source || "Manual",
      lat: lat || "",
      lng: lng || "",
      recommendation,
      note: note || ""
    };

    state.records.unshift(rec);
    saveRecords();

    toast("Tersimpan", `Data ${region} (${rain} mm) tersimpan.`, "ok");
    setChip("Data tersimpan", "ok");

    renderAll();
    location.hash = "#/data";
  });

  $("#btnApplyFilter")?.addEventListener("click", ()=>{
    state.lastFilter = {
      from: $("#fFrom").value,
      to: $("#fTo").value,
      region: $("#fRegion").value,
      category: $("#fCategory")?.value || "",
      status: $("#fStatus").value
    };
    const list = applyFilterToRecords(state.lastFilter);
    renderDataTable(list);
    renderAnalytics(list);
    toast("Filter", "Filter diterapkan.", "ok");
  });

  $("#btnClearFilter")?.addEventListener("click", ()=>{
    $("#fFrom").value = "";
    $("#fTo").value = "";
    $("#fRegion").value = "";
    if($("#fCategory")) $("#fCategory").value = "";
    $("#fStatus").value = "";
    state.lastFilter = { from:"", to:"", region:"", category:"", status:"" };
    const list = applyFilterToRecords(state.lastFilter);
    renderDataTable(list);
    renderAnalytics(list);
    toast("Reset", "Filter direset.", "ok");
  });

  $("#dataTbody")?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-act]");
    if(!btn) return;
    const id = btn.dataset.id;
    if(btn.dataset.act === "del"){
      const ok = confirm("Hapus data ini?");
      if(!ok) return;
      state.records = state.records.filter(r=> r.id !== id);
      saveRecords();
      renderAll();
      toast("Dihapus", "Data berhasil dihapus.", "warn");
    }
  });

  $("#btnExportCSV")?.addEventListener("click", ()=>{
    const list = applyFilterToRecords(state.lastFilter);
    downloadText(toCSV(list), `sipemban_kalbar_${Date.now()}.csv`, "text/csv");
    toast("Export CSV", "CSV berhasil dibuat.", "ok");
  });

  $("#btnExportJSON")?.addEventListener("click", ()=>{
    const payload = {
      app: "Si Pemban — Lapor Banjir Kalbar",
      exported_at: new Date().toISOString(),
      settings: state.settings,
      records: state.records
    };
    downloadText(JSON.stringify(payload, null, 2), `sipemban_backup_${Date.now()}.json`, "application/json");
    toast("Export JSON", "Backup JSON berhasil dibuat.", "ok");
  });

  $("#btnImportJSON")?.addEventListener("click", ()=> showImportModal(true));
  $("#btnCloseImport")?.addEventListener("click", ()=> showImportModal(false));
  $("#btnCancelImport")?.addEventListener("click", ()=> showImportModal(false));

  $("#btnDoImport")?.addEventListener("click", ()=>{
    const text = ($("#importText")?.value || "").trim();
    if(!text){ toast("Gagal", "JSON masih kosong.", "danger"); return; }
    try{
      const obj = JSON.parse(text);
      const recs = Array.isArray(obj.records) ? obj.records : Array.isArray(obj) ? obj : null;
      const settings = obj.settings || null;
      if(!recs) throw new Error("Format JSON tidak dikenali.");

      const cleaned = recs.map(r=>{
        const rain = Number(Number(r.rain || 0).toFixed(1));
        const cat = String(r.category || "Banjir");
        const st = calcStatus(rain);
        return {
          id: String(r.id || uid()),
          date: String(r.date || toISODate(new Date())),
          region: String(r.region || "—"),
          category: cat,
          rain,
          source: String(r.source || "Manual"),
          lat: String(r.lat || ""),
          lng: String(r.lng || ""),
          recommendation: String(r.recommendation || getRecommendation(cat, st.label, rain)),
          note: String(r.note || "")
        };
      });

      state.records = cleaned.sort((a,b)=> (b.date||"").localeCompare(a.date||""));
      saveRecords();

      if(settings?.thresholds){
        state.settings.thresholds.normalMax = Number(settings.thresholds.normalMax ?? state.settings.thresholds.normalMax);
        state.settings.thresholds.waspadaMax = Number(settings.thresholds.waspadaMax ?? state.settings.thresholds.waspadaMax);
        state.settings.thresholds.siagaMax = Number(settings.thresholds.siagaMax ?? state.settings.thresholds.siagaMax);
        saveSettings();
      }

      showImportModal(false);
      if($("#importText")) $("#importText").value = "";
      renderAll();
      toast("Import sukses", "Data berhasil diimport.", "ok");
    }catch(err){
      toast("Import gagal", err.message || "JSON tidak valid.", "danger");
    }
  });

  $("#btnResetAll")?.addEventListener("click", ()=>{
    const ok = confirm("Reset semua data & kembali default? (tidak bisa dibatalkan)");
    if(!ok) return;
    state.records = [];
    state.settings = structuredClone(DEFAULT_SETTINGS);
    saveRecords();
    saveSettings();
    renderAll();
    toast("Reset", "Semua data direset.", "warn");
  });

  $("#btnSaveSettings")?.addEventListener("click", ()=>{
    const n = Number($("#sNormal").value);
    const w = Number($("#sWaspada").value);
    const s = Number($("#sSiaga").value);

    if(!Number.isFinite(n) || !Number.isFinite(w) || !Number.isFinite(s)){
      toast("Gagal", "Isi angka ambang dengan benar.", "danger");
      return;
    }
    if(!(n < w && w < s)){
      toast("Gagal", "Pastikan Normal < Waspada < Siaga.", "danger");
      return;
    }

    state.settings.thresholds.normalMax = Math.round(n);
    state.settings.thresholds.waspadaMax = Math.round(w);
    state.settings.thresholds.siagaMax = Math.round(s);
    saveSettings();
    renderAll();
    toast("Tersimpan", "Ambang risiko tersimpan.", "ok");
  });

  $("#btnDefaultSettings")?.addEventListener("click", ()=>{
    state.settings = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
    renderAll();
    toast("Default", "Ambang dikembalikan ke default.", "ok");
  });

  document.addEventListener("click", (e)=>{
    const item = e.target.closest("[data-mapfocus='1']");
    if(!item) return;
    const lat = parseFloat(item.dataset.lat);
    const lng = parseFloat(item.dataset.lng);
    if(state.map && isFinite(lat) && isFinite(lng)){
      state.map.setView([lat,lng], Math.max(10, state.map.getZoom()));
    }
  });

  window.addEventListener("hashchange", handleHash);

  $("#btnInstall")?.addEventListener("click", async ()=>{
    if(!state.deferredPrompt){
      toast("Install", "Browser tidak menyediakan prompt install saat ini.", "warn");
      return;
    }
    state.deferredPrompt.prompt();
    const res = await state.deferredPrompt.userChoice;
    toast("Install", res?.outcome === "accepted" ? "Aplikasi diinstall." : "Install dibatalkan.", res?.outcome === "accepted" ? "ok":"warn");
    state.deferredPrompt = null;
  });

  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    state.deferredPrompt = e;
  });
}


function init(){
  state.records = loadRecords();

  if($("#inpDate")) $("#inpDate").value = toISODate(new Date());
  fillRegions();
  bindEvents();

  handleHash();
  renderAll();
  setChip("Siap", "ok");

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

document.addEventListener("DOMContentLoaded", init);
