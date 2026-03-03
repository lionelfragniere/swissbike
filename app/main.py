from __future__ import annotations

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from typing import Any, Dict, List
from pathlib import Path
import math
import os

from .models import RouteRequest, RouteResponse, RouteEnriched, ProfileResponse, ProfilePoint, LoopRequest
from .providers.router import get_router
from .providers.elevation import OpenTopoDataElevation
from .providers.surface import surface_for_points
from .utils import decode_polyline, resample_points, compute_slopes, breakdown_surface, haversine_m
from .gpx import route_to_gpx

app = FastAPI(title="SwissBike", version="3.0.4")
app.add_middleware(GZipMiddleware, minimum_size=1000)

router = get_router()
elev = OpenTopoDataElevation()
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

async def build_profile(sampled_latlons, max_samples: int):
    # sampled_latlons: list[(lat,lon)]
    sampled = resample_points(sampled_latlons, max_samples)
    sampled_latlons2 = [(lat, lon) for (lat, lon, _idx) in sampled]

    try:
        elevations = await elev.elevations(sampled_latlons2, batch_size=60)
    except Exception:
        elevations = [0.0 for _ in sampled_latlons2]

    try:
        surfaces = await surface_for_points(OVERPASS_URL, sampled_latlons2, radius_m=25, sample_every=5)
    except Exception:
        surfaces = [{"category":"Inconnu","confidence":0.0,"tags":{}} for _ in sampled_latlons2]

    points = []
    for (lat, lon, original_index), ele_m, surf in zip(sampled, elevations, surfaces):
        points.append({
            "lat": float(lat),
            "lon": float(lon),
            "ele_m": float(ele_m) if ele_m is not None and not (isinstance(ele_m, float) and math.isnan(ele_m)) else 0.0,
            "surface_category": surf.get("category", "Inconnu"),
            "surface_confidence": float(surf.get("confidence", 0.0)),
            "surface_tags": surf.get("tags", {}),
            "step_index": int(original_index),
        })

    slope_stats = compute_slopes(points)
    surface_breakdown = breakdown_surface(points)

    # Compute cumulative distance for profile points + slope per point (already attached by compute_slopes)
    dist_m = 0.0
    prof = []
    for i, p in enumerate(points):
        if i > 0:
            dist_m += haversine_m(points[i-1]["lat"], points[i-1]["lon"], p["lat"], p["lon"])
        prof.append(ProfilePoint(
            lat=p["lat"], lon=p["lon"], dist_m=float(dist_m),
            ele_m=float(p["ele_m"]), slope_pct=float(p.get("slope_pct", 0.0)),
            surface_category=p.get("surface_category","Inconnu"),
            surface_confidence=float(p.get("surface_confidence",0.0)),
        ))

    return points, prof, slope_stats, surface_breakdown, dist_m


def destination_point(lat: float, lon: float, distance_m: float, bearing_deg: float):
    # Spherical earth approximation; good enough for loop waypoint.
    R = 6371000.0
    brng = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    dr = distance_m / R

    lat2 = math.asin(math.sin(lat1) * math.cos(dr) + math.cos(lat1) * math.sin(dr) * math.cos(brng))
    lon2 = lon1 + math.atan2(math.sin(brng) * math.sin(dr) * math.cos(lat1),
                             math.cos(dr) - math.sin(lat1) * math.sin(lat2))
    return (math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180)  # normalize lon


STATIC_DIR = Path(__file__).parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"

@app.get("/api/health")
async def health():
    return {"ok": True, "version": app.version, "router": (os.getenv("ROUTER_PROVIDER") or "valhalla"), "elevation":"opentopodata"}

@app.post("/api/route", response_model=RouteResponse)
async def route(req: RouteRequest):
    points = [(req.start.lon, req.start.lat)] + [(p.lon, p.lat) for p in (req.waypoints or [])] + [(req.end.lon, req.end.lat)]
    try:
        raw = await router.route_points(points, alternatives=req.alternatives, avoid_highways=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Routing provider failed: {e}")

    if raw.get("code") != "Ok":
        raise HTTPException(status_code=400, detail=f"Routing error: {raw}")

    routes = raw.get("routes", [])[: req.alternatives]
    if not routes:
        raise HTTPException(status_code=404, detail="No route found")

    enriched: List[RouteEnriched] = []
    for r in routes:
        pl = r.get("geometry")
        if not pl:
            continue

        latlons = decode_polyline(pl)
        points, prof, slope_stats, surface_breakdown, dist_m = await build_profile(latlons, req.max_samples)

        steps=[]
        legs=(r.get("legs") or [])
        if legs:
            for s in (legs[0].get("steps") or []):
                steps.append({
                    "name": s.get("name"),
                    "distance_m": s.get("distance"),
                    "duration_s": s.get("duration"),
                    "maneuver": (s.get("maneuver") or {}).get("type"),
                })

        enriched.append(RouteEnriched(
            geometry_polyline=pl,
            distance_m=float(r.get("distance",0.0)),
            duration_s=float(r.get("duration",0.0)),
            ascent_m=slope_stats["ascent_m"],
            descent_m=slope_stats["descent_m"],
            slope_max_pct=slope_stats["slope_max_pct"],
            slope_avg_pct=slope_stats["slope_avg_pct"],
            surface_breakdown_m=surface_breakdown,
            points=points,
            steps=steps,
        ))

    return RouteResponse(routes=enriched, provider="osrm")


@app.post("/api/route/loop", response_model=RouteResponse)
async def route_loop(req: LoopRequest):
    # Build a triangle-ish loop: start -> waypoint -> start
    wp_lat, wp_lon = destination_point(req.start.lat, req.start.lon, (req.distance_km * 1000.0) / 2.0, req.bearing_deg)
    try:
        pts = [(req.start.lon, req.start.lat), (wp_lon, wp_lat), (req.start.lon, req.start.lat)]
        try:
            raw = await router.route_points(pts, alternatives=req.alternatives, avoid_highways=True)
        except TypeError:
            raw = await router.route_points(pts, alternatives=req.alternatives)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Routing provider failed: {e}")

    # Reuse the normal enrichment logic by mapping into RouteRequest shape-ish
    # We'll call the existing logic inline for minimal code duplication:
    if raw.get("code") != "Ok":
        raise HTTPException(status_code=400, detail=f"Routing error: {raw}")

    routes = raw.get("routes", [])[: req.alternatives]
    if not routes:
        raise HTTPException(status_code=404, detail="No route found")

    enriched: List[RouteEnriched] = []
    for r in routes:
        pl = r.get("geometry")
        if not pl:
            continue

        latlons = decode_polyline(pl)
        sampled = resample_points(latlons, req.max_samples)
        sampled_latlons = [(lat, lon) for (lat, lon, _idx) in sampled]

        try:
            elevations = await elev.elevations(sampled_latlons, batch_size=60)
        except Exception:
            elevations = [0.0 for _ in sampled_latlons]

        try:
            surfaces = await surface_for_points(OVERPASS_URL, sampled_latlons, radius_m=25, sample_every=5)
        except Exception:
            surfaces = [{"category":"Inconnu","confidence":0.0,"tags":{}} for _ in sampled_latlons]

        points: List[Dict[str, Any]] = []
        for (lat, lon, original_index), ele_m, surf in zip(sampled, elevations, surfaces):
            points.append({
                "lat": float(lat),
                "lon": float(lon),
                "ele_m": float(ele_m) if ele_m is not None and not (isinstance(ele_m, float) and math.isnan(ele_m)) else 0.0,
                "surface_category": surf.get("category", "Inconnu"),
                "surface_confidence": float(surf.get("confidence", 0.0)),
                "surface_tags": surf.get("tags", {}),
                "step_index": int(original_index),
            })

        slope_stats = compute_slopes(points)
        surface_breakdown = breakdown_surface(points)

        steps=[]
        legs=(r.get("legs") or [])
        if legs:
            for leg in legs:
                for s in (leg.get("steps") or []):
                    steps.append({
                        "name": s.get("name"),
                        "distance_m": s.get("distance"),
                        "duration_s": s.get("duration"),
                        "maneuver": (s.get("maneuver") or {}).get("type"),
                    })

        enriched.append(RouteEnriched(
            geometry_polyline=pl,
            distance_m=float(r.get("distance",0.0)),
            duration_s=float(r.get("duration",0.0)),
            ascent_m=slope_stats["ascent_m"],
            descent_m=slope_stats["descent_m"],
            slope_max_pct=slope_stats["slope_max_pct"],
            slope_avg_pct=slope_stats["slope_avg_pct"],
            surface_breakdown_m=surface_breakdown,
            points=points,
            steps=steps,
        ))

    return RouteResponse(routes=enriched, provider="osrm")

@app.post("/api/route/gpx")
async def route_gpx(req: RouteRequest):
    resp = await route(req)
    if not resp.routes:
        raise HTTPException(status_code=404, detail="No route found")
    gpx = route_to_gpx(resp.routes[0].points, name=f"SwissBike {req.profile}")
    return Response(content=gpx, media_type="application/gpx+xml")

# --- Frontend (no build) ---
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def index():
    if INDEX_HTML.exists():
        return FileResponse(str(INDEX_HTML))
    raise HTTPException(status_code=404, detail="Frontend missing")

@app.get("/{path:path}")
async def spa(path: str):
    if path.startswith("api/") or path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not Found")
    if INDEX_HTML.exists():
        return FileResponse(str(INDEX_HTML))
    raise HTTPException(status_code=404, detail="Frontend missing")


@app.post("/api/gpx/profile", response_model=ProfileResponse)
async def gpx_profile(file: UploadFile = File(...), max_samples: int = 200):
    data = await file.read()
    latlons = parse_gpx_points(data)
    if len(latlons) < 2:
        raise HTTPException(status_code=400, detail="GPX: no track points found")

    points_dicts, prof, slope_stats, surface_breakdown, dist_m = await build_profile(latlons, max_samples=max_samples)

    return ProfileResponse(
        provider="gpx",
        distance_m=float(dist_m),
        ascent_m=slope_stats["ascent_m"],
        descent_m=slope_stats["descent_m"],
        slope_max_pct=slope_stats["slope_max_pct"],
        slope_avg_pct=slope_stats["slope_avg_pct"],
        surface_breakdown_m=surface_breakdown,
        points=prof,
    )
