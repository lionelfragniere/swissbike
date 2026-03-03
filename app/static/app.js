const SWISSTOPO_STYLE = {
  version: 8,
  sources: {
    swisstopo: {
      type: "raster",
      tiles: [
        "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"
      ],
      tileSize: 256,
      attribution: "© swisstopo"
    }
  },
  layers: [{ id: "swisstopo", type: "raster", source: "swisstopo" }]
};

function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

function haversineM(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function formatKm(m){ return (m/1000).toFixed(1) + " km"; }
function formatHrs(s){
  const h = Math.floor(s/3600);
  const m = Math.round((s%3600)/60);
  return (h? `${h}h ` : "") + `${m}m`;
}

const el = (id)=>document.getElementById(id);
const errBox = el("error");
const statusBox = el("status");
const summary = el("summary");
const btnCompute = el("btnCompute");
const chart = el("chart");
const chartLegend = el("chartLegend");
const chartHint = el("chartHint");
const wpsBox = el("wps");
const btnClearWps = el("btnClearWps");
const gpxFile = el("gpxFile");
const btnGPXProfile = el("btnGPXProfile");

let start = { lat: 46.5191, lon: 6.6339 };
let end   = { lat: 46.2044, lon: 6.1432 };
let waypoints = []; // array of {lat, lon}

const map = new maplibregl.Map({
  container: "map",
  style: SWISSTOPO_STYLE,
  center: [start.lon, start.lat],
  zoom: 9
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

let startMarker, endMarker;
let wpMarkers = [];

function setStatus(t){ statusBox.textContent = t || ""; }
function setError(t){ errBox.textContent = t || ""; }

function refreshWpsUI(){
  if(!wpsBox) return;
  if(!waypoints.length){
    wpsBox.textContent = "Points de passage: aucun";
    return;
  }
  wpsBox.textContent = "Points de passage: " + waypoints.map((p,i)=>`${i+1}) ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`).join(" | ");
}

function refreshWpMarkers(){
  for(const m of wpMarkers){ try{ m.remove(); }catch{} }
  wpMarkers = waypoints.map((p, idx)=>{
    const mk = new maplibregl.Marker({color:"#ff7f0e"}).setLngLat([p.lon, p.lat]).addTo(map);
    return mk;
  });
}

map.on("load", () => {
  map.addSource("route", { type: "geojson", data: { type:"FeatureCollection", features:[] } });
  map.addLayer({ id:"route-line", type:"line", source:"route", paint:{ "line-width":5, "line-opacity":0.85 } });

  startMarker = new maplibregl.Marker({ draggable:true }).setLngLat([start.lon, start.lat]).addTo(map);
  endMarker   = new maplibregl.Marker({ draggable:true }).setLngLat([end.lon, end.lat]).addTo(map);

  startMarker.on("dragend", ()=>{
    const ll = startMarker.getLngLat();
    start = { lat: ll.lat, lon: ll.lng };
    setStatus("Départ déplacé.");
  });
  endMarker.on("dragend", ()=>{
    const ll = endMarker.getLngLat();
    end = { lat: ll.lat, lon: ll.lng };
    setStatus("Arrivée déplacée.");
  });

  refreshWpsUI();
});

map.on("click", (e) => {
  if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
    // waypoint
    waypoints.push({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    refreshWpMarkers();
    refreshWpsUI();
    setStatus("Point de passage ajouté.");
    return;
  }
  if (e.originalEvent.shiftKey) {
    start = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    startMarker?.setLngLat([start.lon, start.lat]);
    setStatus("Départ défini (Shift+clic).");
  } else {
    end = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    endMarker?.setLngLat([end.lon, end.lat]);
    setStatus("Arrivée définie (clic).");
  }
});

btnClearWps?.addEventListener("click", ()=>{
  waypoints = [];
  refreshWpMarkers();
  refreshWpsUI();
  setStatus("Points de passage effacés.");
});

async function apiJson(path, payload){
  const r = await fetch(path, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok){
    const txt = await r.text();
    throw new Error(txt || `HTTP ${r.status}`);
  }
  return await r.json();
}

async function apiForm(path, formData){
  const r = await fetch(path, { method:"POST", body: formData });
  if(!r.ok){
    const txt = await r.text();
    throw new Error(txt || `HTTP ${r.status}`);
  }
  return await r.json();
}

function renderSummaryGeneric(distance_m, ascent_m, slope_max_pct, surface_breakdown_m){
  summary.style.display = "block";
  const rows = Object.entries(surface_breakdown_m || {});
  summary.innerHTML = `
    <div class="kv"><div>Distance</div><div><span class="badge">${formatKm(distance_m)}</span></div></div>
    <div class="kv"><div>D+</div><div><span class="badge">${ascent_m.toFixed(0)} m</span></div></div>
    <div class="kv"><div>Pente max</div><div><span class="badge">${slope_max_pct.toFixed(1)}%</span></div></div>
    <hr/>
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">Surface (approx.)</div>
    ${rows.length ? rows.map(([k,v])=>`<div class="kv"><div>${k}</div><div>${formatKm(v)}</div></div>`).join("") : `<div class="small">Pas de données surface.</div>`}
  `;
}

function drawRouteLineFromCoords(coords){
  const src = map.getSource && map.getSource("route");
  if (!src) return;
  const feature = { type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates: coords } };
  src.setData({ type:"FeatureCollection", features:[feature] });
  if(coords.length){
    const b = coords.reduce((acc,c)=>({
      minX: Math.min(acc.minX,c[0]),
      minY: Math.min(acc.minY,c[1]),
      maxX: Math.max(acc.maxX,c[0]),
      maxY: Math.max(acc.maxY,c[1])
    }), {minX:coords[0][0], minY:coords[0][1], maxX:coords[0][0], maxY:coords[0][1]});
    map.fitBounds([[b.minX,b.minY],[b.maxX,b.maxY]], {padding: 40, duration: 600});
  }
}

const SURF_COLORS = {
  "Asphalte": "#2c7fb8",
  "Pavés": "#7b3294",
  "Compact": "#1a9850",
  "Gravier": "#fdae61",
  "Terre": "#a6611a",
  "Sentier": "#4d4d4d",
  "Inconnu": "#999999",
};

function drawProfileFromPoints(profilePoints){
  const ctx = chart.getContext("2d");
  if (!profilePoints || !profilePoints.length) { ctx.clearRect(0,0,chart.width,chart.height); chartHint.textContent=""; return; }

  const W = chart.width, H = chart.height;
  ctx.clearRect(0,0,W,H);

  const padL=44, padR=10, padT=10, padB=22;
  const x0=padL, y0=padT, x1=W-padR, y1=H-padB;

  const dist = profilePoints.map(p=>Number(p.dist_m||0));
  const ele = profilePoints.map(p=>Number(p.ele_m||0));

  const dMax = dist[dist.length-1] || 1;
  const eMin = Math.min(...ele), eMax = Math.max(...ele);
  const eRange = (eMax-eMin) || 1;

  const x = (d)=> x0 + (d/dMax)*(x1-x0);
  const y = (e)=> y1 - ((e-eMin)/eRange)*(y1-y0);

  // background: surface segments
  for(let i=1;i<profilePoints.length;i++){
    const cat = profilePoints[i].surface_category || "Inconnu";
    const c = SURF_COLORS[cat] || SURF_COLORS["Inconnu"];
    ctx.fillStyle = c + "22";
    ctx.fillRect(x(dist[i-1]), y0, Math.max(1, x(dist[i]) - x(dist[i-1])), y1-y0);
  }

  // axes
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0,y0); ctx.lineTo(x0,y1); ctx.lineTo(x1,y1);
  ctx.stroke();

  // elevation line
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(dist[0]), y(ele[0]));
  for(let i=1;i<ele.length;i++){
    ctx.lineTo(x(dist[i]), y(ele[i]));
  }
  ctx.stroke();

  // labels
  ctx.fillStyle = "#333";
  ctx.font = "12px system-ui";
  ctx.fillText(`${Math.round(eMax)} m`, 6, y0+12);
  ctx.fillText(`${Math.round(eMin)} m`, 6, y1);
  ctx.fillText(`0 km`, x0, H-6);
  ctx.fillText(`${(dMax/1000).toFixed(1)} km`, x1-42, H-6);

  // legend
  const cats = {};
  for(const p of profilePoints){ cats[p.surface_category||"Inconnu"] = true; }
  const keys = Object.keys(cats).slice(0,6);
  chartLegend.innerHTML = keys.map(k=>`<span class="badge" style="border-color:${SURF_COLORS[k]||"#999"}">${k}</span>`).join(" ");
  chartHint.textContent = "Survole le graphique pour voir altitude / pente / surface.";

  chart.onmousemove = (ev)=>{
    const r = chart.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (W / r.width);
    const targetD = ((mx-x0)/(x1-x0))*dMax;
    let idx = 0;
    while(idx < dist.length-1 && dist[idx] < targetD) idx++;
    idx = Math.max(0, Math.min(dist.length-1, idx));
    const p = profilePoints[idx];
    const km = (Number(p.dist_m||0)/1000).toFixed(2);
    chartHint.textContent = `${km} km — ${Math.round(p.ele_m||0)} m — pente ${Number(p.slope_pct||0).toFixed(1)}% — ${p.surface_category||"Inconnu"}`;
  };
}

btnCompute.addEventListener("click", async ()=>{
  setError("");
  summary.style.display = "none";
  btnCompute.disabled = true;
  setStatus("Calcul en cours…");
  try{
    const payload = {
      start, end,
      waypoints,
      profile: el("profile").value,
      alternatives: Number(el("alternatives").value),
      avoid_gravel: Number(el("avoidGravel").value),
      avoid_steep: Number(el("avoidSteep").value),
      max_samples: Number(el("maxSamples").value),
    };
    const data = await apiJson("/api/route", payload);
    const r0 = (data.routes || [])[0];
    if(!r0) throw new Error("No route returned");
    renderSummaryGeneric(r0.distance_m, r0.ascent_m, r0.slope_max_pct, r0.surface_breakdown_m);
    setStatus("Itinéraire calculé.");

    // draw map
    const coords = decodePolyline(r0.geometry_polyline);
    drawRouteLineFromCoords(coords);

    // build profile from API points (dicts) -> dist
    const pts = r0.points || [];
    let dist_m = 0;
    const prof = pts.map((p,i)=>{
      if(i>0){
        dist_m += haversineM(pts[i-1].lat, pts[i-1].lon, p.lat, p.lon);
      }
      return { dist_m, ele_m: p.ele_m, slope_pct: p.slope_pct||0, surface_category: p.surface_category||"Inconnu" };
    });
    drawProfileFromPoints(prof);
  }catch(e){
    console.error(e);
    setError(String(e?.message || e));
    setStatus("Erreur.");
  }finally{
    btnCompute.disabled = false;
  }
});

btnGPXProfile?.addEventListener("click", async ()=>{
  setError("");
  summary.style.display = "none";
  if(!gpxFile?.files?.length){
    setError("Choisis un fichier .gpx d'abord.");
    return;
  }
  btnGPXProfile.disabled = true;
  setStatus("Analyse GPX en cours…");
  try{
    const fd = new FormData();
    fd.append("file", gpxFile.files[0]);
    const data = await apiForm("/api/gpx/profile?max_samples=220", fd);
    renderSummaryGeneric(data.distance_m, data.ascent_m, data.slope_max_pct, data.surface_breakdown_m);
    drawProfileFromPoints(data.points || []);
    setStatus("GPX analysé.");

    // draw line on map too
    const coords = (data.points || []).map(p=>[p.lon, p.lat]);
    if(coords.length>1) drawRouteLineFromCoords(coords);
  }catch(e){
    console.error(e);
    setError(String(e?.message || e));
    setStatus("Erreur.");
  }finally{
    btnGPXProfile.disabled = false;
  }
});
