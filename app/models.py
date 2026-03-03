from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Literal

BikeProfile = Literal["road", "gravel", "mtb", "balanced"]

class LatLon(BaseModel):
    lat: float
    lon: float

class RouteRequest(BaseModel):
    start: LatLon
    end: LatLon
    waypoints: List[LatLon] = Field(default_factory=list)
    profile: BikeProfile = "balanced"
    alternatives: int = Field(default=1, ge=1, le=3)
    avoid_gravel: float = Field(default=0.2, ge=0, le=1)
    avoid_steep: float = Field(default=0.2, ge=0, le=1)
    max_samples: int = Field(default=140, ge=30, le=500)

class RouteEnriched(BaseModel):
    geometry_polyline: str
    distance_m: float
    duration_s: float
    ascent_m: float
    descent_m: float
    slope_max_pct: float
    slope_avg_pct: float
    surface_breakdown_m: Dict[str, float]
    points: List[Dict[str, Any]]
    steps: List[Dict[str, Any]]

class RouteResponse(BaseModel):
    routes: List[RouteEnriched]
    provider: str


class LoopRequest(BaseModel):
    start: LatLon
    distance_km: float = Field(default=30.0, ge=1.0, le=300.0)
    bearing_deg: float = Field(default=45.0, ge=0.0, le=359.9)
    alternatives: int = Field(default=1, ge=1, le=3)
    max_samples: int = Field(default=140, ge=30, le=500)


class ProfilePoint(BaseModel):
    lat: float
    lon: float
    dist_m: float
    ele_m: float
    slope_pct: float
    surface_category: str
    surface_confidence: float

class ProfileResponse(BaseModel):
    provider: str
    distance_m: float
    ascent_m: float
    descent_m: float
    slope_max_pct: float
    slope_avg_pct: float
    surface_breakdown_m: Dict[str, float]
    points: List[ProfilePoint]
