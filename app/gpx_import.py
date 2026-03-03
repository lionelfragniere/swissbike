from __future__ import annotations
from typing import List, Tuple
import xml.etree.ElementTree as ET

def parse_gpx_points(gpx_bytes: bytes) -> List[Tuple[float,float]]:
    # Returns list of (lat, lon)
    root = ET.fromstring(gpx_bytes)
    pts: List[Tuple[float,float]] = []

    # GPX may have namespaces; handle by stripping.
    def tag_endswith(el, name: str) -> bool:
        return el.tag.endswith("}" + name) or el.tag == name

    for trk in root.iter():
        if tag_endswith(trk, "trkpt"):
            lat = trk.attrib.get("lat")
            lon = trk.attrib.get("lon")
            if lat is None or lon is None:
                continue
            try:
                pts.append((float(lat), float(lon)))
            except Exception:
                continue

    # Some GPX use rtept
    if not pts:
        for rtept in root.iter():
            if tag_endswith(rtept, "rtept"):
                lat = rtept.attrib.get("lat")
                lon = rtept.attrib.get("lon")
                if lat is None or lon is None:
                    continue
                try:
                    pts.append((float(lat), float(lon)))
                except Exception:
                    continue

    return pts
