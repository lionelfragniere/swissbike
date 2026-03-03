from __future__ import annotations
from typing import List, Dict, Any
from xml.sax.saxutils import escape

def route_to_gpx(points: List[Dict[str, Any]], name: str = "SwissBike route") -> str:
    trkpts=[]
    for p in points:
        trkpts.append(f'<trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}"><ele>{float(p.get("ele_m") or 0.0):.2f}</ele></trkpt>')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SwissBike" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{escape(name)}</name></metadata>
  <trk><name>{escape(name)}</name><trkseg>
    {"".join(trkpts)}
  </trkseg></trk>
</gpx>
'''
