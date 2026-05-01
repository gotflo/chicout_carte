# -*- coding: utf-8 -*-
"""
Génère `zone5_rues.geojson` en interrogeant OpenStreetMap (Overpass API)
pour toutes les voies nommées contenues dans la Zone 5.

Aucun fichier source nécessaire — il suffit que `zone5_9_zones.geojson` soit
chargé dans QGIS (ou présent sur disque).

Lancement (console Python QGIS) :
    from pathlib import Path
    exec(Path(r'C:\\Users\\fgotl\\Downloads\\chicoutimi-webapp\\data\\zone5_fetch_rues_qgis.py').read_text(encoding='utf-8'))
"""

import os
import json
import urllib.request
import urllib.parse
from qgis.core import (
    QgsProject, QgsVectorLayer, QgsFeature, QgsField, QgsFields, QgsGeometry,
    QgsPointXY, QgsCoordinateReferenceSystem, QgsCoordinateTransform,
    QgsVectorFileWriter,
)
from qgis.PyQt.QtCore import QVariant

DATA_DIR = r"C:\Users\fgotl\Downloads\chicoutimi-webapp\data"
OVERPASS = "https://overpass-api.de/api/interpreter"
OUT_PATH = os.path.join(DATA_DIR, "zone5_rues.geojson")


def find_layer(name):
    L = QgsProject.instance().mapLayersByName(name)
    return L[0] if L else None


def union_zone5(layer):
    """Retourne la géométrie unique (4326) de la Zone 5 = union des sous-zones."""
    target = QgsCoordinateReferenceSystem("EPSG:4326")
    src = layer.crs()
    geoms = []
    for f in layer.getFeatures():
        g = QgsGeometry(f.geometry())
        if src.authid() != target.authid():
            xf = QgsCoordinateTransform(src, target, QgsProject.instance())
            g.transform(xf)
        geoms.append(g)
    return QgsGeometry.unaryUnion(geoms)


def overpass_query(bbox):
    """bbox = (south, west, north, east). Retourne la liste des voies nommées."""
    s, w, n, e = bbox
    q = (
        f"[out:json][timeout:90];"
        f"(way[\"highway\"][\"name\"]({s},{w},{n},{e}););"
        f"out center tags;"
    )
    data = urllib.parse.urlencode({"data": q}).encode("utf-8")
    print("  ⏳ requête Overpass… (peut prendre 20-60 s)")
    req = urllib.request.Request(OVERPASS, data=data,
            headers={"User-Agent": "QGIS/zone5-fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    z9 = find_layer("zone5_9_zones")
    if not z9:
        # tenter le chargement direct
        path = os.path.join(DATA_DIR, "zone5_9_zones.geojson")
        z9 = QgsVectorLayer(path, "zone5_9_zones", "ogr")
        if not z9.isValid():
            raise SystemExit("✗ zone5_9_zones introuvable.")
        QgsProject.instance().addMapLayer(z9)

    print("Calcul de l'emprise de Zone 5…")
    zone_geom = union_zone5(z9)
    bb = zone_geom.boundingBox()
    bbox = (bb.yMinimum(), bb.xMinimum(), bb.yMaximum(), bb.xMaximum())
    print(f"  bbox = {bbox}")

    js = overpass_query(bbox)
    elements = js.get("elements", [])
    print(f"  ← {len(elements)} voies brutes récupérées")

    # construire la couche en mémoire
    fields = QgsFields()
    fields.append(QgsField("name", QVariant.String))
    fields.append(QgsField("kind", QVariant.String))
    lyr = QgsVectorLayer("Point?crs=EPSG:4326", "zone5_rues_raw", "memory")
    lyr.dataProvider().addAttributes(fields); lyr.updateFields()

    feats, seen = [], set()
    for el in elements:
        c = el.get("center")
        tags = el.get("tags", {})
        name = tags.get("name", "")
        kind = tags.get("highway", "")
        if not c or not name:
            continue
        pt = QgsPointXY(c["lon"], c["lat"])
        gpt = QgsGeometry.fromPointXY(pt)
        if not zone_geom.contains(gpt):
            continue
        key = name  # déduplication par nom unique
        if key in seen:
            continue
        seen.add(key)
        f = QgsFeature(lyr.fields())
        f.setGeometry(gpt)
        f.setAttributes([name, kind])
        feats.append(f)
    lyr.dataProvider().addFeatures(feats); lyr.updateExtents()
    print(f"  ✓ {len(feats)} rues uniques contenues dans Zone 5")

    # écrire sur disque
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = "GeoJSON"
    opts.layerOptions = ["RFC7946=YES", "COORDINATE_PRECISION=6"]
    err = QgsVectorFileWriter.writeAsVectorFormatV3(
        lyr, OUT_PATH, QgsProject.instance().transformContext(), opts)
    if err[0] != QgsVectorFileWriter.NoError:
        raise SystemExit(f"✗ Échec écriture : {err}")
    print(f"  ✓ écrit : {OUT_PATH}")

    # remplacer la couche en projet par celle sur disque
    for old in QgsProject.instance().mapLayersByName("zone5_rues"):
        QgsProject.instance().removeMapLayer(old.id())
    disk = QgsVectorLayer(OUT_PATH, "zone5_rues", "ogr")
    QgsProject.instance().addMapLayer(disk)
    print("  ✓ couche `zone5_rues` ajoutée au projet")


main()
