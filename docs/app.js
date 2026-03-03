/**
 * SwissBike – GitHub Pages static app
 * All backend logic ported to client-side JS:
 *  - Routing : Valhalla public API (valhalla1.openstreetmap.de)
 *  - Elevation: OpenTopoData (api.opentopodata.org/v1/srtm90m)
 *  - Surface  : Overpass API (overpass-api.de)
 */

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";
// Swisstopo height REST API — explicit CORS support, browser-native, free.
// Only covers Switzerland; returns null for points outside CH (we fall back to 0m).
const ELEVATION_BASE = "https://api3.geo.admin.ch/rest/services/height";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const SWISSTOPO_STYLE = {
  version: 8,
  sources: {
    swisstopo: {
      type: "raster",
      tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"],
      tileSize: 256,
      attribution: "© swisstopo"
    }
  },
  layers: [{ id: "swisstopo", type: "raster", source: "swisstopo" }]
};

const SURF_COLORS = {
  "Asphalte": "#22d3ee",
  "Pavés": "#a855f7",
  "Compact": "#4ade80",
  "Gravier": "#fb923c",
  "Terre": "#a78bfa",
  "Sentier": "#64748b",
  "Inconnu": "#334155",
};

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const el = id => document.getElementById(id);
const errBox = el("error");
const statusBox = el("status");
const summary = el("summary");
const btnCompute = el("btnCompute");
const btnGPX = el("btnGPX");
const chart = el("chart");
const chartLegend = el("chartLegend");
const chartHint = el("chartHint");
const wpsBox = el("wps");
const btnClearWps = el("btnClearWps");
const gpxFile = el("gpxFile");
const btnGPXProfile = el("btnGPXProfile");
const btnAnalyze = el("btnAnalyze");
const banner = el("instructionBanner");
const bottomPanel = el("bottomPanel");

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let start = null;
let end = null;
let waypoints = [];
let lastRoutePoints = null; // for GPX export
let clickState = 0; // 0=need start, 1=need end, 2=computed

function updateBanner() {
  if (clickState === 0) {
    banner.textContent = "📍 Cliquez sur la carte pour choisir le point de DÉPART";
    banner.classList.remove("hidden");
  } else if (clickState === 1) {
    banner.textContent = "🏁 Maintenant, cliquez pour le point d'ARRIVÉE";
    banner.classList.remove("hidden");
  } else if (clickState === 2) {
    banner.textContent = "🚴 Itinéraire calculé. Cliquez pour ajouter des points de passage.";
    setTimeout(() => banner.classList.add("hidden"), 4000);
  }
}
updateBanner();

// ─────────────────────────────────────────────
// Map
// ─────────────────────────────────────────────
const map = new maplibregl.Map({
  container: "map",
  style: SWISSTOPO_STYLE,
  center: [8.2275, 46.8182], // Center of CH
  zoom: 8
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

let startMarker = new maplibregl.Marker({ color: "#4ade80", draggable: true });
let endMarker = new maplibregl.Marker({ color: "#f87171", draggable: true });
let wpMarkers = [];

// Element for the interactive blue cursor
const hoverEl = document.createElement("div");
hoverEl.className = "hover-pointer";
let hoverMarker = new maplibregl.Marker({ element: hoverEl });

map.on("load", () => {
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    paint: {
      "line-width": 5,
      "line-color": ["get", "color"],
      "line-opacity": 0.9
    }
  });

  // Make the route clickable to add waypoints
  map.on("mouseenter", "route-line", () => {
    if (clickState === 2) map.getCanvasContainer().classList.add("route-clickable");
  });
  map.on("mouseleave", "route-line", () => {
    map.getCanvasContainer().classList.remove("route-clickable");
  });
  map.on("click", "route-line", (e) => {
    if (clickState !== 2) return;
    // Prevent the generic map click from firing and double-adding
    e.originalEvent.stopPropagation();

    // Find the closest point in the route to insert the waypoint
    let bestIdx = -1;
    let bestDist = Infinity;
    if (currentRawRoute) {
      for (let i = 0; i < currentRawRoute.length - 1; i++) {
        const pCount = Math.floor(currentRawRoute.length / 20); // sample
        if (i % (pCount > 0 ? pCount : 1) !== 0) continue; // too slow to check all 
        // Just a rough estimation
        const d = haversineM(e.lngLat.lat, e.lngLat.lng, currentRawRoute[i][1], currentRawRoute[i][0]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }

    const newWp = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (bestIdx > -1 && bestIdx > 0 && waypoints.length > 0) {
      // Very naive insertion: just determine if it's closer to start or end of waypoints
      waypoints.push(newWp); // Proper insertion requires full coordinate matching, just pushing for now as requested
    } else {
      waypoints.push(newWp);
    }

    refreshWpMarkers();
    refreshWpsUI();
    banner.textContent = "⏱️ Recalcul de l'itinéraire...";
    banner.classList.remove("hidden");
    calcRoute();
  });

  startMarker.on("dragend", () => {
    const ll = startMarker.getLngLat();
    start = { lat: ll.lat, lon: ll.lng };
    if (clickState === 2) calcRoute();
  });
  endMarker.on("dragend", () => {
    const ll = endMarker.getLngLat();
    end = { lat: ll.lat, lon: ll.lng };
    if (clickState === 2) calcRoute();
  });

  refreshWpsUI();
});

map.on("click", (e) => {
  if (clickState === 0) {
    start = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    startMarker.setLngLat([start.lon, start.lat]).addTo(map);
    clickState = 1;
    updateBanner();
    setStatus("Départ défini.");
  } else if (clickState === 1) {
    end = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    endMarker.setLngLat([end.lon, end.lat]).addTo(map);
    clickState = 2;
    updateBanner();
    setStatus("Arrivée définie, calcul en cours...");
    calcRoute(); // Auto-calculate
  } else {
    // State 2: already computed, add waypoint
    waypoints.push({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    refreshWpMarkers();
    refreshWpsUI();
    banner.textContent = "⏱️ Recalcul de l'itinéraire...";
    banner.classList.remove("hidden");
    calcRoute(); // Auto-recalculate
  }
});

// Loop toggle
el("isLoop").addEventListener("change", () => {
  el("loopOptions").style.display = el("isLoop").checked ? "grid" : "none";
});

// Waypoints
btnClearWps.addEventListener("click", () => {
  waypoints = [];
  refreshWpMarkers();
  refreshWpsUI();
  setStatus("Points de passage effacés.");
  if (clickState === 2) calcRoute();
});

function refreshWpsUI() {
  if (!waypoints.length) { wpsBox.textContent = "Points de passage: aucun"; return; }
  wpsBox.textContent = "Via: " + waypoints.map((p, i) => `${i + 1}) ${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(" › ");
}
function refreshWpMarkers() {
  wpMarkers.forEach(m => { try { m.remove(); } catch { } });
  wpMarkers = waypoints.map((p, i) => {
    const m = new maplibregl.Marker({ color: "#fb923c", draggable: true })
      .setLngLat([p.lon, p.lat]).addTo(map);
    m.on("dragend", () => {
      const ll = m.getLngLat();
      waypoints[i] = { lat: ll.lat, lon: ll.lng };
      if (clickState === 2) calcRoute();
    });
    return m;
  });
}

// ─────────────────────────────────────────────
// Status / error helpers
// ─────────────────────────────────────────────
function setStatus(t, loading = false) {
  statusBox.textContent = t || "";
  statusBox.className = loading ? "loading" : "";
}
function setError(t) { errBox.textContent = t || ""; }
function setBusy(busy) {
  btnCompute.disabled = busy;
  btnCompute.innerHTML = busy
    ? `<span class="spinner"></span>Calcul…`
    : "Calculer l'itinéraire";
}

// ─────────────────────────────────────────────
// Utility: decode Valhalla/OSRM polyline5
// ─────────────────────────────────────────────
function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resamplePoints(coords, maxSamples) {
  if (coords.length <= maxSamples) return coords;
  const step = (coords.length - 1) / (maxSamples - 1);
  return Array.from({ length: maxSamples }, (_, i) => coords[Math.round(i * step)]);
}

function computeSlopes(points) {
  let ascent = 0, descent = 0, slopeMax = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    const dEle = (points[i].ele_m || 0) - (points[i - 1].ele_m || 0);
    const slope = d > 0 ? Math.abs(dEle / d) * 100 : 0;
    points[i].slope_pct = (d > 0 ? dEle / d * 100 : 0);
    if (dEle > 0) ascent += dEle;
    if (dEle < 0) descent -= dEle;
    if (slope > slopeMax) slopeMax = slope;
  }
  points[0].slope_pct = 0;
  return { ascent_m: ascent, descent_m: descent, slope_max_pct: slopeMax };
}

function breakdownSurface(points) {
  const result = {};
  for (let i = 1; i < points.length; i++) {
    const cat = points[i].surface_category || "Inconnu";
    const d = haversineM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    result[cat] = (result[cat] || 0) + d;
  }
  return result;
}

function formatKm(m) { return (m / 1000).toFixed(1) + " km"; }
function formatHrs(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return (h ? `${h}h ` : "") + `${m}m`;
}

// ─────────────────────────────────────────────
// API: Routing via Valhalla
// ─────────────────────────────────────────────
async function fetchRoute(startPt, endPt, viaPoints, options = {}) {
  const locations = [
    { lat: startPt.lat, lon: startPt.lon },
    ...viaPoints.map(p => ({ lat: p.lat, lon: p.lon })),
    { lat: endPt.lat, lon: endPt.lon }
  ];

  const costingOptions = {
    bicycle: {
      use_highways: 1 - (options.avoidHighways ?? 0),
      use_trails: options.profile === "mtb" ? 1.0 : options.profile === "gravel" ? 0.6 : 0.1,
    }
  };
  if (options.profile === "road") {
    costingOptions.bicycle.bicycle_type = "Road";
    costingOptions.bicycle.use_hills = 0;
  }

  const payload = {
    format: "osrm",
    locations,
    costing: "bicycle",
    shape_format: "polyline5",
    alternates: Math.max(0, (options.alternatives || 1) - 1),
    costing_options: costingOptions,
  };

  const r = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Valhalla error ${r.status}: ${await r.text()}`);
  return await r.json();
}

// Loop: single waypoint offset from start
function destinationPoint(lat, lon, distM, bearingDeg) {
  const R = 6371000, brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180, dr = distM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180 };
}

// ─────────────────────────────────────────────
// API: Elevation via Swisstopo (CORS-enabled, LV95 coordinates)
// Official approximation formula: WGS84 → LV95 (MN95)
// ─────────────────────────────────────────────

/** Convert WGS84 (lat, lon) to Swiss LV95 (E, N). Returns null if far outside CH. */
function wgs84ToLV95(lat, lon) {
  // Auxiliary values (arcsec)
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lam = (lon * 3600 - 26782.5) / 10000;
  // E (easting)  in LV95
  const E = 2600072.37
    + 211455.93 * lam
    - 10938.51 * lam * phi
    - 0.36 * lam * phi * phi
    - 44.54 * lam * lam * lam;
  // N (northing) in LV95
  const N = 1200147.07
    + 308807.95 * phi
    + 3745.25 * lam * lam
    + 76.63 * phi * phi
    - 194.56 * lam * lam * phi
    + 119.79 * phi * phi * phi;
  // Rough bounding box for Switzerland
  if (E < 2485000 || E > 2834000 || N < 1075000 || N > 1296000) return null;
  return { E: Math.round(E), N: Math.round(N) };
}

async function fetchOneElevation(lat, lon) {
  const lv95 = wgs84ToLV95(lat, lon);
  if (!lv95) return 0; // outside Switzerland – no data
  try {
    const url = `${ELEVATION_BASE}?easting=${lv95.E}&northing=${lv95.N}`;
    const r = await fetch(url);
    if (!r.ok) return 0;
    const d = await r.json();
    return parseFloat(d.height) || 0;
  } catch { return 0; }
}

async function fetchElevations(points) {
  const CONCURRENCY = 8;
  const results = new Array(points.length).fill(0);
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const batch = points.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((p, bi) => fetchOneElevation(p.lat, p.lon).then(h => ({ idx: i + bi, h })))
    );
    for (const s of settled) {
      if (s.status === "fulfilled") results[s.value.idx] = s.value.h;
    }
  }
  return results;
}

// ─────────────────────────────────────────────
// Surface categorisation (port of surface.py)
// ─────────────────────────────────────────────
function surfaceCategory(tags) {
  const surface = (tags.surface || "").toLowerCase().trim();
  const tracktype = (tags.tracktype || "").toLowerCase().trim();
  const smoothness = (tags.smoothness || "").toLowerCase().trim();
  const highway = (tags.highway || "").toLowerCase().trim();

  if (surface) {
    if (["asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes"].includes(surface)) return ["Asphalte", 0.85];
    if (["paving_stones", "sett", "cobblestone"].includes(surface)) return ["Pavés", 0.75];
    if (["compacted", "fine_gravel", "gravel", "pebblestone"].includes(surface)) return ["Gravier", 0.85];
    if (["dirt", "earth", "ground", "mud", "sand"].includes(surface)) return ["Terre", 0.85];
    if (["grass", "woodchips"].includes(surface)) return ["Sentier", 0.70];
    return ["Inconnu", 0.5];
  }
  if (tracktype) {
    if (tracktype === "grade1") return ["Compact", 0.65];
    if (["grade2", "grade3"].includes(tracktype)) return ["Gravier", 0.65];
    if (["grade4", "grade5"].includes(tracktype)) return ["Terre", 0.65];
  }
  if (smoothness) {
    if (["excellent", "good"].includes(smoothness)) return ["Asphalte", 0.55];
    if (smoothness === "intermediate") return ["Compact", 0.55];
    if (["bad", "very_bad", "horrible", "very_horrible", "impassable"].includes(smoothness)) return ["Terre", 0.5];
  }
  if (highway) {
    if (["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service"].includes(highway)) return ["Asphalte", 0.35];
    if (["cycleway", "path"].includes(highway)) return ["Compact", 0.25];
    if (highway === "track") return ["Gravier", 0.30];
  }
  return ["Inconnu", 0.2];
}

// ─────────────────────────────────────────────
// API: Surface via Overpass
// ─────────────────────────────────────────────
const _surfCache = new Map();
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter"
];

async function fetchSurfacePoint(lat, lon, radiusM = 50) {
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${radiusM}`;
  if (_surfCache.has(key)) return _surfCache.get(key);

  const query = `[out:json][timeout:12];(way(around:${radiusM},${lat},${lon})["highway"];);out tags center 20;`;
  let resultObj = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of OVERPASS_URLS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(3000 + attempt * 2000)
        });
        if (!r.ok) continue;
        const data = await r.json();
        const elements = data.elements || [];

        let best = null;
        for (const el of elements) {
          const tags = el.tags || {};
          if (tags.surface || tags.tracktype || tags.smoothness) {
            const [cat, conf] = surfaceCategory(tags);
            if (!best || conf > best.confidence) {
              best = { category: cat, confidence: conf, tags };
            }
          }
        }
        if (!best && elements.length) {
          const tags = elements[0].tags || {};
          const [cat, conf] = surfaceCategory(tags);
          best = { category: cat, confidence: conf, tags };
        }
        resultObj = best;
        break; // Success on this URL
      } catch (e) {
        // Timeout or network error, let it loop to the next URL
      }
    }
    if (resultObj) break; // Total success
    await new Promise(r => setTimeout(r, 500)); // wait before next attempt
  }

  const result = resultObj || { category: "Inconnu", confidence: 0, tags: {} };
  _surfCache.set(key, result);
  return result;
}

async function fetchSurfaces(points, sampleEvery = 5, radiusM = 50) {
  const results = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i += sampleEvery) {
    const res = await fetchSurfacePoint(points[i].lat, points[i].lon, radiusM);
    for (let j = i; j < Math.min(points.length, i + sampleEvery); j++) {
      results[j] = res;
    }
    // Small delay to respect Overpass rate limits for sequential queries
    await new Promise(r => setTimeout(r, 100));
  }
  return results.map(r => r || { category: "Inconnu", confidence: 0, tags: {} });
}

// ─────────────────────────────────────────────
// Build full profile from [lat,lon] array
// ─────────────────────────────────────────────
async function buildProfile(latlons, maxSamples, onProgress) {
  const sampled = resamplePoints(latlons, maxSamples).map(([lon, lat]) => ({ lat, lon }));

  onProgress?.("Altitude en cours…");
  const elevations = await fetchElevations(sampled);
  sampled.forEach((p, i) => { p.ele_m = elevations[i] || 0; });

  onProgress?.("Surface en cours…");
  const surfaces = await fetchSurfaces(sampled, 5, 50);
  sampled.forEach((p, i) => {
    p.surface_category = surfaces[i].category;
    p.surface_confidence = surfaces[i].confidence;
  });

  const slopes = computeSlopes(sampled);
  const breakdown = breakdownSurface(sampled);

  let distM = 0;
  const profile = sampled.map((p, i) => {
    if (i > 0) distM += haversineM(sampled[i - 1].lat, sampled[i - 1].lon, p.lat, p.lon);
    return { ...p, dist_m: distM };
  });

  return { profile, slopes, breakdown, total_m: distM };
}

// ─────────────────────────────────────────────
// Map drawing
// ─────────────────────────────────────────────
function drawRouteLine(coords, color = "#4ade80") {
  const src = map.getSource?.("route");
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: coords } }]
  });
  if (coords.length > 1) {
    const b = coords.reduce((acc, c) => ({
      minX: Math.min(acc.minX, c[0]), minY: Math.min(acc.minY, c[1]),
      maxX: Math.max(acc.maxX, c[0]), maxY: Math.max(acc.maxY, c[1])
    }), { minX: coords[0][0], minY: coords[0][1], maxX: coords[0][0], maxY: coords[0][1] });
    map.fitBounds([[b.minX, b.minY], [b.maxX, b.maxY]], { padding: 50, duration: 600 });
  }
}

// ─────────────────────────────────────────────
// Elevation profile chart
// ─────────────────────────────────────────────
function drawProfile(profilePoints) {
  const ctx = chart.getContext("2d");
  const W = chart.offsetWidth || 500, H = chart.offsetHeight || 120;
  chart.width = W; chart.height = H;
  ctx.clearRect(0, 0, W, H);
  if (!profilePoints?.length) return;

  const padL = 48, padR = 10, padT = 10, padB = 22;
  const x0 = padL, y0 = padT, x1 = W - padR, y1 = H - padB;

  const dist = profilePoints.map(p => p.dist_m || 0);
  const ele = profilePoints.map(p => p.ele_m || 0);
  const dMax = dist[dist.length - 1] || 1;
  const eMin = Math.min(...ele), eMax = Math.max(...ele);
  const eRange = (eMax - eMin) || 1;

  const xp = d => x0 + (d / dMax) * (x1 - x0);
  const yp = e => y1 - ((e - eMin) / eRange) * (y1 - y0);

  // Surface background bands
  for (let i = 1; i < profilePoints.length; i++) {
    const cat = profilePoints[i].surface_category || "Inconnu";
    const col = SURF_COLORS[cat] || SURF_COLORS["Inconnu"];
    ctx.fillStyle = col + "28";
    ctx.fillRect(xp(dist[i - 1]), y0, Math.max(1, xp(dist[i]) - xp(dist[i - 1])), y1 - y0);
  }

  // Axes
  ctx.strokeStyle = "#1e2130"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.stroke();

  // Elevation fill
  ctx.beginPath();
  ctx.moveTo(xp(dist[0]), yp(ele[0]));
  for (let i = 1; i < ele.length; i++) ctx.lineTo(xp(dist[i]), yp(ele[i]));
  ctx.lineTo(xp(dist[dist.length - 1]), y1);
  ctx.lineTo(xp(dist[0]), y1);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, "#4ade8040");
  grad.addColorStop(1, "#4ade8008");
  ctx.fillStyle = grad;
  ctx.fill();

  // Elevation line
  ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xp(dist[0]), yp(ele[0]));
  for (let i = 1; i < ele.length; i++) ctx.lineTo(xp(dist[i]), yp(ele[i]));
  ctx.stroke();

  // Labels
  ctx.fillStyle = "#64748b"; ctx.font = "11px Inter, system-ui";
  ctx.fillText(`${Math.round(eMax)} m`, 4, y0 + 12);
  ctx.fillText(`${Math.round(eMin)} m`, 4, y1);
  ctx.fillText(`0`, x0, H - 6);
  ctx.fillText(`${(dMax / 1000).toFixed(1)} km`, x1 - 40, H - 6);

  // Legend
  const cats = [...new Set(profilePoints.map(p => p.surface_category || "Inconnu"))];
  chartLegend.innerHTML = cats.map(k => {
    const col = SURF_COLORS[k] || "#334155";
    return `<span class="badge" style="color:${col};border-color:${col}30;background:${col}18">${k}</span>`;
  }).join("");
  chartHint.textContent = "Survolez le graphique pour voir l'altitude, la pente et la surface.";

  // Save base graph image data
  const imageData = ctx.getImageData(0, 0, W, H);

  // Hover interaction
  chart.onmousemove = ev => {
    const r = chart.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (W / r.width);
    const targetD = ((mx - x0) / (x1 - x0)) * dMax;
    let idx = 0;
    while (idx < dist.length - 1 && dist[idx] < targetD) idx++;
    idx = Math.max(0, Math.min(dist.length - 1, idx));
    const p = profilePoints[idx];
    const km = ((p.dist_m || 0) / 1000).toFixed(2);
    const slope = (p.slope_pct || 0).toFixed(1);
    const sign = slope > 0 ? "+" : "";
    chartHint.textContent = `${km} km › ${Math.round(p.ele_m || 0)} m alt › pente ${sign}${slope}% › ${p.surface_category || "Inconnu"}`;

    // Crosshair
    ctx.putImageData(imageData, 0, 0); // Restore pristine graph
    const cx = xp(dist[idx]);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
    ctx.setLineDash([]);

    // Also move map marker
    hoverMarker.setLngLat([p.lon, p.lat]).addTo(map);
  };
  chart.onmouseleave = () => {
    chartHint.textContent = "Survolez le graphique pour voir l'altitude, la pente et la surface.";
    ctx.putImageData(imageData, 0, 0); // Restore pristine graph
    hoverMarker.remove();
  };
}

// ─────────────────────────────────────────────
// Summary panel
// ─────────────────────────────────────────────
function renderSummary(dist_m, ascent_m, descent_m, slope_max, duration_s, breakdown) {
  summary.style.display = "flex";
  const rows = Object.entries(breakdown || {});
  summary.innerHTML = `
    <div class="card-title">Résumé</div>
    <div class="kv"><span class="key">Distance</span><span class="badge">${formatKm(dist_m)}</span></div>
    ${duration_s ? `<div class="kv"><span class="key">Durée estimée</span><span class="badge">${formatHrs(duration_s)}</span></div>` : ""}
    <div class="kv"><span class="key">Dénivelé +</span><span class="badge">${ascent_m.toFixed(0)} m</span></div>
    <div class="kv"><span class="key">Dénivelé −</span><span class="badge">${descent_m.toFixed(0)} m</span></div>
    <div class="kv"><span class="key">Pente max</span><span class="badge">${slope_max.toFixed(1)}%</span></div>
    <hr style="border-color:#1e2130;margin:6px 0">
    <div style="font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">Surface</div>
    ${rows.length ? rows.map(([k, v]) => `<div class="kv"><span class="key" style="color:${SURF_COLORS[k] || '#64748b'}">${k}</span><span>${formatKm(v)}</span></div>`).join("") : `<div class="small" style="color:#475569">Données surface indisponibles.</div>`}
  `;
}

// ─────────────────────────────────────────────
// Routing Logic (Step 1)
// ─────────────────────────────────────────────
let currentRawRoute = null; // Store for Step 2

async function calcRoute() {
  if (!start) { setError("Veuillez d'abord définir un point de départ."); return; }
  if (!el("isLoop").checked && !end) { setError("Veuillez définir un point d'arrivée."); return; }

  setError(""); summary.style.display = "none";
  bottomPanel.classList.add("hidden");
  btnAnalyze.style.display = "none";
  setBusy(true);

  try {
    const isLoop = el("isLoop").checked;
    const alternatives = Number(el("alternatives").value) || 1;
    const profile = el("profile").value;

    let raw;
    if (isLoop) {
      const loopKm = Number(el("loopKm").value) || 30;
      const loopBear = Number(el("loopBearing").value) || 45;
      const wp = destinationPoint(start.lat, start.lon, (loopKm * 1000) / 2, loopBear);
      setStatus("Calcul de l'itinéraire (boucle)…", true);
      raw = await fetchRoute(start, start, [wp], { alternatives, profile });
    } else {
      setStatus("Calcul de l'itinéraire…", true);
      raw = await fetchRoute(start, end, waypoints, { alternatives, profile });
    }

    if (raw.code !== "Ok") throw new Error(`Routing: ${JSON.stringify(raw)}`);
    const routes = (raw.routes || []).slice(0, alternatives);
    if (!routes.length) throw new Error("Aucun itinéraire trouvé.");

    const r0 = routes[0];
    const coords = decodePolyline(r0.geometry);
    currentRawRoute = coords; // Save for analysis

    // Create a mock profile with distancing only (for GPX/Fast display)
    let distM = 0;
    lastRoutePoints = coords.map((c, i) => {
      const pt = { lon: c[0], lat: c[1] };
      if (i > 0) distM += haversineM(coords[i - 1][1], coords[i - 1][0], c[1], c[0]);
      pt.dist_m = distM;
      return pt;
    });

    drawRouteLine(coords);
    renderSummary(r0.distance || distM, 0, 0, 0, r0.duration, null);

    btnGPX.disabled = false;
    btnAnalyze.style.display = "inline-flex"; // Show step 2 button
    setStatus("Itinéraire calculé ✓");
    if (clickState === 2) updateBanner();
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
    setStatus("Erreur.");
  } finally {
    setBusy(false);
  }
}

btnCompute.addEventListener("click", calcRoute);

// ─────────────────────────────────────────────
// Analysis Logic (Step 2)
// ─────────────────────────────────────────────
btnAnalyze.addEventListener("click", async () => {
  if (!currentRawRoute) return;
  setError("");
  const btnOriginalText = btnAnalyze.innerHTML;
  btnAnalyze.disabled = true;
  btnAnalyze.innerHTML = `<span class="spinner"></span>Analyse en cours…`;

  try {
    const maxSamples = Number(el("maxSamples").value) || 80;
    const { profile: prof, slopes, breakdown, total_m } = await buildProfile(currentRawRoute, maxSamples, setStatus);
    lastRoutePoints = prof;

    bottomPanel.classList.remove("hidden");
    const r0dist = lastRoutePoints[lastRoutePoints.length - 1].dist_m;

    renderSummary(r0dist, slopes.ascent_m, slopes.descent_m, slopes.slope_max_pct, null, breakdown);
    drawProfile(prof);
    setStatus("Analyse terminée ✓");
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
    setStatus("Erreur pendant l'analyse.");
  } finally {
    btnAnalyze.disabled = false;
    btnAnalyze.innerHTML = btnOriginalText;
  }
});

// ─────────────────────────────────────────────
// GPX Export (client-side generation)
// ─────────────────────────────────────────────
function buildGpx(points, name = "SwissBike") {
  const trkpts = points.map(p => {
    const ele = p.ele_m != null ? `\n      <ele>${p.ele_m.toFixed(1)}</ele>` : "";
    const desc = p.surface_category ? `\n      <desc>${p.surface_category}</desc>` : "";
    return `  <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${ele}${desc}\n  </trkpt>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SwissBike" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

btnGPX.addEventListener("click", () => {
  if (!lastRoutePoints?.length) return;
  const gpxStr = buildGpx(lastRoutePoints, "SwissBike Route");
  const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "swissbike.gpx"; a.click();
  URL.revokeObjectURL(url);
});

// ─────────────────────────────────────────────
// GPX Import + Profile Analysis
// ─────────────────────────────────────────────
function parseGpxPoints(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const trkpts = Array.from(doc.querySelectorAll("trkpt"));
  return trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const eleEl = pt.querySelector("ele");
    const existingEle = eleEl ? parseFloat(eleEl.textContent) : null;
    return [lon, lat, existingEle];
  }).filter(([lon, lat]) => !isNaN(lat) && !isNaN(lon));
}

btnGPXProfile.addEventListener("click", async () => {
  setError(""); summary.style.display = "none";
  if (!gpxFile?.files?.length) { setError("Choisis un fichier .gpx d'abord."); return; }
  btnGPXProfile.disabled = true;
  setStatus("Analyse GPX…", true);

  try {
    const text = await gpxFile.files[0].text();
    const raw = parseGpxPoints(text);
    if (raw.length < 2) throw new Error("GPX: aucun point de trace trouvé.");

    const maxSamples = Number(el("maxSamples").value) || 80;
    const coords = raw.map(([lon, lat]) => [lon, lat]);
    drawRouteLine(coords);

    const latlons = raw.map(([lon, lat]) => [lon, lat]);
    const { profile: prof, slopes, breakdown, total_m } = await buildProfile(latlons, maxSamples, setStatus);
    lastRoutePoints = prof;

    renderSummary(total_m, slopes.ascent_m, slopes.descent_m, slopes.slope_max_pct, null, breakdown);
    drawProfile(prof);
    btnGPX.disabled = false;
    setStatus("GPX analysé ✓");
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
    setStatus("Erreur.");
  } finally {
    btnGPXProfile.disabled = false;
  }
});
