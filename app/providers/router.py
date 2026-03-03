from __future__ import annotations

from typing import Dict, Any, List, Tuple, Optional
import os
import httpx


class OSRMRouter:
    """OSRM demo router.

    Note: the public demo server (router.project-osrm.org) is great for prototyping but
    it does NOT support all OSRM features (e.g. exclude=motorway often returns 400).
    """

    def __init__(self, base_url: str = "https://router.project-osrm.org"):
        self.base_url = base_url.rstrip("/")

    async def route_points(self, points_lonlat: List[Tuple[float, float]], alternatives: int = 1) -> Dict[str, Any]:
        if len(points_lonlat) < 2:
            raise ValueError("Need at least 2 points for routing")

        coords = ";".join([f"{lon},{lat}" for lon, lat in points_lonlat])
        url = f"{self.base_url}/route/v1/bicycle/{coords}"
        params = {
            "overview": "full",
            "geometries": "polyline",
            "steps": "true",
            "alternatives": "true" if alternatives > 1 else "false",
        }

        timeout = httpx.Timeout(connect=5.0, read=20.0, write=20.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()

    async def route(
        self, start_lon: float, start_lat: float, end_lon: float, end_lat: float, alternatives: int = 1
    ) -> Dict[str, Any]:
        return await self.route_points([(start_lon, start_lat), (end_lon, end_lat)], alternatives=alternatives)


class ValhallaRouter:
    """Valhalla router (OSRM-compatible output).

    Default public instance used here: https://valhalla1.openstreetmap.de
    (same one backing https://valhalla.openstreetmap.de). citeturn5view0turn6search0

    We request `format=osrm` so the response looks like OSRM: routes[].geometry, legs[].steps, etc.
    """

    def __init__(self, base_url: str = "https://valhalla1.openstreetmap.de"):
        self.base_url = base_url.rstrip("/")

    async def route_points(
        self,
        points_lonlat: List[Tuple[float, float]],
        alternatives: int = 1,
        avoid_highways: bool = True,
    ) -> Dict[str, Any]:
        if len(points_lonlat) < 2:
            raise ValueError("Need at least 2 points for routing")

        locations = [{"lat": lat, "lon": lon} for lon, lat in points_lonlat]

        costing_options: Dict[str, Any] = {}
        if avoid_highways:
            # Valhalla bicycle has many knobs; 'use_highways' is the key one for this use-case.
            # 0.0 = strongly avoid, 1.0 = neutral.
            costing_options = {"bicycle": {"use_highways": 0.0}}

        payload: Dict[str, Any] = {
            "format": "osrm",
            "locations": locations,
            "costing": "bicycle",
            "shape_format": "polyline5",
            "alternates": max(0, alternatives - 1),
        }
        if costing_options:
            payload["costing_options"] = costing_options

        url = f"{self.base_url}/route"
        timeout = httpx.Timeout(connect=6.0, read=30.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
            r.raise_for_status()
            return r.json()

    async def route(
        self,
        start_lon: float,
        start_lat: float,
        end_lon: float,
        end_lat: float,
        alternatives: int = 1,
        avoid_highways: bool = True,
    ) -> Dict[str, Any]:
        return await self.route_points(
            [(start_lon, start_lat), (end_lon, end_lat)], alternatives=alternatives, avoid_highways=avoid_highways
        )


def get_router() -> Any:
    """Factory driven by env vars.

    ROUTER_PROVIDER: 'valhalla' (default) or 'osrm'
    VALHALLA_BASE_URL / OSRM_BASE_URL: override upstream base URL.
    """
    provider = (os.getenv("ROUTER_PROVIDER") or "valhalla").strip().lower()
    if provider == "osrm":
        return OSRMRouter(base_url=os.getenv("OSRM_BASE_URL") or "https://router.project-osrm.org")
    # default = valhalla
    return ValhallaRouter(base_url=os.getenv("VALHALLA_BASE_URL") or "https://valhalla1.openstreetmap.de")
