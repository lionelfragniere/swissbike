from __future__ import annotations
from typing import List, Tuple, Dict, Any
import polyline as poly
import math

def decode_polyline(pl: str) -> List[Tuple[float, float]]:
    return poly.decode(pl, precision=5)

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R=6371000.0
    phi1,phi2=math.radians(lat1),math.radians(lat2)
    dphi=math.radians(lat2-lat1)
    dl=math.radians(lon2-lon1)
    a=math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def resample_points(latlons: List[Tuple[float,float]], max_samples: int):
    if len(latlons)<=max_samples:
        return [(lat,lon,i) for i,(lat,lon) in enumerate(latlons)]
    step=(len(latlons)-1)/(max_samples-1)
    out=[]
    for i in range(max_samples):
        idx=int(round(i*step))
        idx=max(0,min(len(latlons)-1,idx))
        lat,lon=latlons[idx]
        out.append((lat,lon,idx))
    if out[-1][2]!=len(latlons)-1:
        lat,lon=latlons[-1]
        out[-1]=(lat,lon,len(latlons)-1)
    return out

def compute_slopes(points: List[Dict[str,Any]]) -> Dict[str,float]:
    ascent=0.0; descent=0.0
    slopes=[]
    for i in range(1,len(points)):
        p0,p1=points[i-1],points[i]
        d=haversine_m(p0["lat"],p0["lon"],p1["lat"],p1["lon"])
        if d<=0.1:
            points[i]["slope_pct"]=0.0; slopes.append(0.0); continue
        dz=p1["ele_m"]-p0["ele_m"]
        if dz>0: ascent+=dz
        else: descent+=-dz
        slope=(dz/d)*100.0
        points[i]["slope_pct"]=slope
        slopes.append(slope)
    if points: points[0]["slope_pct"]=0.0
    slope_abs=[abs(s) for s in slopes] if slopes else [0.0]
    return {
        "ascent_m": float(ascent),
        "descent_m": float(descent),
        "slope_max_pct": float(max(slope_abs) if slope_abs else 0.0),
        "slope_avg_pct": float(sum(slope_abs)/len(slope_abs) if slope_abs else 0.0),
    }

def breakdown_surface(points: List[Dict[str,Any]]) -> Dict[str,float]:
    totals={}
    for i in range(1,len(points)):
        p0,p1=points[i-1],points[i]
        cat=p1.get("surface_category") or "Inconnu"
        d=haversine_m(p0["lat"],p0["lon"],p1["lat"],p1["lon"])
        totals[cat]=totals.get(cat,0.0)+d
    return {k: float(v) for k,v in sorted(totals.items(), key=lambda kv:-kv[1])}
