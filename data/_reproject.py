"""Reproject EPSG:32198 GeoJSON files to WGS84 (EPSG:4326) for web mapping."""
import json
from pathlib import Path
from pyproj import Transformer

SRC = Path(__file__).parent
TRANSFORMER = Transformer.from_crs("EPSG:32198", "EPSG:4326", always_xy=True)


def reproject_coords(coords):
    if isinstance(coords[0], (int, float)):
        x, y = TRANSFORMER.transform(coords[0], coords[1])
        return [x, y]
    return [reproject_coords(c) for c in coords]


def reproject_file(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    crs_name = data.get("crs", {}).get("properties", {}).get("name", "")
    if "4326" in crs_name or "CRS84" in crs_name:
        return False
    for feat in data["features"]:
        geom = feat.get("geometry")
        if geom and "coordinates" in geom:
            geom["coordinates"] = reproject_coords(geom["coordinates"])
    data["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return True


for f in SRC.glob("*.geojson"):
    changed = reproject_file(f)
    print(f"{'reprojected' if changed else 'skipped     '} {f.name}")
