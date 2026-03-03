from __future__ import annotations
from typing import List, Tuple, Dict, Any
import httpx
from cachetools import TTLCache
from collections import Counter

_cache = TTLCache(maxsize=4096, ttl=60 * 60)

def _surface_category(tags: Dict[str, Any]):
    surface = (tags.get("surface") or "").lower().strip()
    tracktype = (tags.get("tracktype") or "").lower().strip()
    smoothness = (tags.get("smoothness") or "").lower().strip()

    if surface:
        if surface in {"asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes"}:
            return "Asphalte", 0.85
        if surface in {"paving_stones", "sett", "cobblestone"}:
            return "Pavés", 0.75
        if surface in {"compacted", "fine_gravel", "gravel", "pebblestone"}:
            return "Gravier", 0.85
        if surface in {"dirt", "earth", "ground", "mud", "sand"}:
            return "Terre", 0.85
        if surface in {"grass", "woodchips"}:
            return "Sentier", 0.70
        return "Inconnu", 0.5

    if tracktype:
        if tracktype == "grade1": return "Compact", 0.65
        if tracktype in {"grade2","grade3"}: return "Gravier", 0.65
        if tracktype in {"grade4","grade5"}: return "Terre", 0.65

    if smoothness:
        if smoothness in {"excellent","good"}: return "Asphalte", 0.55
        if smoothness == "intermediate": return "Compact", 0.55
        if smoothness in {"bad","very_bad","horrible","very_horrible","impassable"}: return "Terre", 0.5

    return "Inconnu", 0.2

def _key(lat: float, lon: float, radius_m: int) -> str:
    return f"{round(lat,4)}|{round(lon,4)}|{radius_m}"

async def _surface_single(client: httpx.AsyncClient, overpass_url: str, lat: float, lon: float, radius_m: int) -> Dict[str, Any]:
    k=_key(lat,lon,radius_m)
    if k in _cache:
        return _cache[k]

    query=f'''[out:json][timeout:12];(way(around:{radius_m},{lat},{lon})["highway"];);out tags center 20;'''
    try:
        r=await client.post(overpass_url, data={"data": query})
        r.raise_for_status()
        data=r.json()
        elements=data.get("elements",[])
    except Exception:
        result={"category":"Inconnu","confidence":0.0,"tags":{}}
        _cache[k]=result
        return result

    candidates=[]
    for el in elements:
        tags=el.get("tags",{}) or {}
        if any(t in tags for t in ("surface","tracktype","smoothness")):
            cat,conf=_surface_category(tags)
            candidates.append((conf,cat,tags))
    if candidates:
        candidates.sort(reverse=True, key=lambda x:x[0])
        conf,cat,tags=candidates[0]
        result={"category":cat,"confidence":float(conf),"tags":tags}
    else:
        highway=[]
        for el in elements:
            h=((el.get("tags") or {}).get("highway") or "").lower().strip()
            if h: highway.append(h)
        if highway:
            mode=Counter(highway).most_common(1)[0][0]
            if mode in {"motorway","trunk","primary","secondary","tertiary","residential","service"}:
                result={"category":"Asphalte","confidence":0.35,"tags":{"highway":mode}}
            elif mode in {"cycleway","path"}:
                result={"category":"Compact","confidence":0.25,"tags":{"highway":mode}}
            elif mode=="track":
                result={"category":"Gravier","confidence":0.30,"tags":{"highway":mode}}
            else:
                result={"category":"Inconnu","confidence":0.15,"tags":{"highway":mode}}
        else:
            result={"category":"Inconnu","confidence":0.0,"tags":{}}
    _cache[k]=result
    return result

async def surface_for_points(overpass_url: str, latlons: List[Tuple[float,float]], radius_m: int = 25, sample_every: int = 5) -> List[Dict[str, Any]]:
    """Surface estimation via Overpass.

    Overpass is the slowest & most fragile dependency. To avoid Cloud Run timeouts:
    - we query only 1 point out of N (sample_every), then reuse that value for the
      following points (good enough for a first MVP).
    - hard timeouts and graceful fallback to 'Inconnu'.
    """
    if not latlons:
        return []
    sample_every = max(1, int(sample_every))

    results=[None]*len(latlons)
    timeout = httpx.Timeout(connect=6.0, read=12.0, write=12.0, pool=6.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        i=0
        while i < len(latlons):
            lat,lon = latlons[i]
            res = await _surface_single(client, overpass_url, lat, lon, radius_m)
            # propagate this res to next sample_every points
            for j in range(i, min(len(latlons), i+sample_every)):
                results[j]=res
            i += sample_every

    # fill any None (shouldn't happen)
    return [r if r is not None else {"category":"Inconnu","confidence":0.0,"tags":{}} for r in results]
