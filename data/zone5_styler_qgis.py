# -*- coding: utf-8 -*-
"""
Stylage complet de la Zone 5 dans QGIS.

À CHARGER AVANT EXÉCUTION (panneau Couches) :
  - zone5_9_zones.geojson
  - zone5_9_landmarks.geojson
  - zone5_12_zones.geojson
  - zone5_12_landmarks.geojson
  - rues_dans_zones.geojson  ← nécessaire 1 seule fois pour générer zone5_rues
                                (peut être supprimé après)

Ce script :
  1. Colore chaque sous-zone d'une couleur distincte, opacité ~25 % (on voit
     le fond de carte au travers).
  2. Affiche un GROS numéro de sous-zone centré.
  3. Style les points stratégiques en étoile orange + nom étiqueté.
  4. Génère ou met à jour la couche `zone5_rues` (rues clippées à la Zone 5),
     teintées selon leur sous-zone.
  5. Active les bulles d'info au survol (map tips) sur les rues et points
     stratégiques pour voir le nom au passage du curseur.
  6. Écrit deux CSV dans data/ :
       - zone5_rues_par_sous_zone_9.csv
       - zone5_rues_par_sous_zone_12.csv

Lancer :
    from pathlib import Path
    exec(Path(r'C:\\Users\\fgotl\\Downloads\\chicoutimi-webapp\\data\\zone5_styler_qgis.py').read_text(encoding='utf-8'))
"""

import os
import csv
from qgis.core import (
    QgsProject, QgsVectorLayer, QgsFeature, QgsField, QgsFields, QgsGeometry,
    QgsPointXY, QgsCategorizedSymbolRenderer, QgsRendererCategory,
    QgsFillSymbol, QgsMarkerSymbol, QgsPalLayerSettings, QgsTextFormat,
    QgsTextBufferSettings, QgsVectorLayerSimpleLabeling,
    QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsVectorFileWriter,
    QgsSimpleMarkerSymbolLayerBase,
)
from qgis.PyQt.QtGui import QColor, QFont
from qgis.PyQt.QtCore import QVariant
from qgis.utils import iface

DATA_DIR = r"C:\Users\fgotl\Downloads\chicoutimi-webapp\data"
PALETTE = [
    "#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#264653",
    "#8338ec", "#3a86ff", "#ff006e", "#06a77d", "#ef476f",
    "#118ab2", "#ffd166",
]


# -------------------- helpers ---------------------------------------------- #

def find_layer(name):
    L = QgsProject.instance().mapLayersByName(name)
    return L[0] if L else None


def find_first_with(substr):
    s = substr.lower()
    for l in QgsProject.instance().mapLayers().values():
        if isinstance(l, QgsVectorLayer) and s in l.name().lower():
            return l
    return None


def text_format(size, bold, color="#111", halo_size=1.4, halo_color="#fff"):
    tf = QgsTextFormat()
    f = QFont("Inter", size); f.setBold(bold)
    tf.setFont(f); tf.setSize(size); tf.setColor(QColor(color))
    b = QgsTextBufferSettings(); b.setEnabled(True)
    b.setSize(halo_size); b.setColor(QColor(halo_color))
    tf.setBuffer(b)
    return tf


# -------------------- 1) sous-zones colorées + numéros --------------------- #

def style_subzones(layer):
    has_color = layer.fields().indexOf("color") >= 0
    cats = []
    for feat in layer.getFeatures():
        num = int(feat["_num"])
        hexcol = feat["color"] if has_color and feat["color"] else PALETTE[(num - 1) % len(PALETTE)]
        sym = QgsFillSymbol.createSimple({
            "outline_color": "#222",
            "outline_width": "0.5",
            "outline_style": "solid",
        })
        # couleur de remplissage avec alpha
        qc = QColor(hexcol); qc.setAlpha(70)  # ~27 % opacité
        sym.symbolLayer(0).setColor(qc)
        cats.append(QgsRendererCategory(num, sym, f"Sous-zone {num}"))

    layer.setRenderer(QgsCategorizedSymbolRenderer("_num", cats))
    layer.setOpacity(1.0)

    # gros numéro centré
    pal = QgsPalLayerSettings()
    pal.fieldName = "_num"
    pal.placement = QgsPalLayerSettings.Horizontal
    pal.centroidInside = True
    pal.setFormat(text_format(size=24, bold=True, color="#000", halo_size=2.5))
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)
    layer.triggerRepaint()
    print(f"  ✓ {layer.name()} : {layer.featureCount()} sous-zones colorées + numérotées")


# -------------------- 2) landmarks ----------------------------------------- #

def style_landmarks(layer):
    sym = QgsMarkerSymbol.createSimple({
        "name": "star", "color": "#ffb703",
        "outline_color": "#1a1a1a", "outline_width": "0.5",
        "size": "6.5",
    })
    sl = sym.symbolLayer(0)
    if hasattr(sl, "setShape"):
        sl.setShape(QgsSimpleMarkerSymbolLayerBase.Star)
    layer.renderer().setSymbol(sym)

    pal = QgsPalLayerSettings()
    pal.fieldName = "name"
    pal.placement = QgsPalLayerSettings.AroundPoint
    pal.dist = 2.5
    pal.setFormat(text_format(size=11, bold=True, color="#1a1a1a", halo_size=1.6))
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)

    # bulle d'info au survol
    layer.setMapTipTemplate(
        '<b>Sous-zone [% "_num" %]</b><br>'
        '<i>[% "kind" %]</i> · [% "name" %]'
    )
    layer.triggerRepaint()
    print(f"  ✓ {layer.name()} : étoiles + noms + bulles d'info")


# -------------------- 3) rues clippées par Zone 5 + colorées -------------- #

def build_zone5_rues_layer(rues_full, subzones_9):
    """Crée (ou réutilise) zone5_rues.geojson : rues contenues dans la Zone 5,
    avec les colonnes name, kind, sz9, sz12, color9, color12.
    Si rues_full est None, on essaie de réutiliser zone5_rues.geojson existant
    (et on l'enrichit s'il manque les colonnes sz9/sz12).
    """
    out_path = os.path.join(DATA_DIR, "zone5_rues.geojson")

    if not rues_full:
        if os.path.exists(out_path):
            print("  ℹ rues_dans_zones absent — réutilisation de zone5_rues.geojson "
                  "(enrichissement sz9/sz12 si nécessaire).")
            rues_full = QgsVectorLayer(out_path, "_rues_tmp", "ogr")
            if not rues_full.isValid():
                print("  ⚠ zone5_rues.geojson illisible : abandon.")
                return None
        else:
            print("  ⚠ rues_dans_zones non chargé ET zone5_rues.geojson absent.")
            return None

    z9 = find_layer("zone5_9_zones")
    z12 = find_layer("zone5_12_zones")
    if not z9 or not z12:
        print("  ⚠ zone5_9_zones / zone5_12_zones manquants.")
        return None

    # tout en EPSG:4326 (geojson source)
    target_crs = QgsCoordinateReferenceSystem("EPSG:4326")

    def reproj_geom(geom, src_crs):
        if src_crs.authid() != target_crs.authid():
            xf = QgsCoordinateTransform(src_crs, target_crs, QgsProject.instance())
            g = QgsGeometry(geom); g.transform(xf); return g
        return geom

    sz9 = [(int(f["_num"]), f["color"], reproj_geom(f.geometry(), z9.crs()))
           for f in z9.getFeatures()]
    sz12 = [(int(f["_num"]), f["color"], reproj_geom(f.geometry(), z12.crs()))
            for f in z12.getFeatures()]

    fields = QgsFields()
    fields.append(QgsField("name",    QVariant.String))
    fields.append(QgsField("kind",    QVariant.String))
    fields.append(QgsField("sz9",     QVariant.Int))
    fields.append(QgsField("sz12",    QVariant.Int))
    fields.append(QgsField("color9",  QVariant.String))
    fields.append(QgsField("color12", QVariant.String))

    out = QgsVectorLayer("Point?crs=EPSG:4326", "zone5_rues", "memory")
    out.dataProvider().addAttributes(fields); out.updateFields()

    feats = []
    rues_crs = rues_full.crs()
    for rf in rues_full.getFeatures():
        rg = rf.geometry()
        if not rg or rg.isEmpty():
            continue
        rg4326 = reproj_geom(rg, rues_crs)
        sz9_match = next(((n, c) for n, c, g in sz9 if g.contains(rg4326)), (None, None))
        if sz9_match[0] is None:
            continue  # pas dans Zone 5
        sz12_match = next(((n, c) for n, c, g in sz12 if g.contains(rg4326)), (None, None))
        nf = QgsFeature(out.fields())
        nf.setGeometry(rg4326)
        nf.setAttributes([
            rf["name"] if rf.fieldNameIndex("name") >= 0 else "",
            rf["kind"] if rf.fieldNameIndex("kind") >= 0 else "",
            sz9_match[0], sz12_match[0],
            sz9_match[1], sz12_match[1],
        ])
        feats.append(nf)
    out.dataProvider().addFeatures(feats); out.updateExtents()

    # libérer les éventuelles couches qui pointent sur le fichier
    for old in QgsProject.instance().mapLayersByName("zone5_rues"):
        QgsProject.instance().removeMapLayer(old.id())
    rues_full = None  # libère le handle OGR

    # écrire sur disque pour persistance
    if os.path.exists(out_path):
        try: os.remove(out_path)
        except OSError: pass
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = "GeoJSON"
    opts.layerOptions = ["RFC7946=YES", "COORDINATE_PRECISION=6"]
    QgsVectorFileWriter.writeAsVectorFormatV3(
        out, out_path, QgsProject.instance().transformContext(), opts)
    print(f"  ✓ zone5_rues.geojson écrit ({out.featureCount()} rues)")

    # on AJOUTE la couche mémoire (déjà enrichie) au projet et on la renvoie.
    # Les CSV / clones travailleront dessus directement → pas de cache OGR.
    out.setName("zone5_rues")
    QgsProject.instance().addMapLayer(out)
    return out


def style_rues(layer, k):
    """Colore par sous-zone du découpage k, étiquette au zoom, bulle d'info."""
    field = f"sz{k}"
    cats = []
    for num in range(1, k + 1):
        col = PALETTE[(num - 1) % len(PALETTE)]
        sym = QgsMarkerSymbol.createSimple({
            "name": "circle", "size": "1.8",
            "color": col, "outline_color": "#fff", "outline_width": "0.3",
        })
        cats.append(QgsRendererCategory(num, sym, f"Sous-zone {num}"))
    layer.setRenderer(QgsCategorizedSymbolRenderer(field, cats))

    pal = QgsPalLayerSettings()
    pal.fieldName = "name"
    pal.placement = QgsPalLayerSettings.AroundPoint
    pal.dist = 1.4
    pal.setFormat(text_format(size=8, bold=False, color="#222", halo_size=1.0))
    pal.scaleVisibility = True
    pal.minimumScale = 25000   # noms visibles à partir de ~1:25 000
    pal.maximumScale = 0
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)

    layer.setMapTipTemplate(
        '<b>[% "name" %]</b><br>'
        'Sous-zone (9) : [% "sz9" %] · Sous-zone (12) : [% "sz12" %]'
    )
    layer.triggerRepaint()


def clone_layer_styled(source, new_name, k):
    """Duplique la couche zone5_rues sous un nouveau nom et applique le style k."""
    cloned = source.clone()
    cloned.setName(new_name)
    QgsProject.instance().addMapLayer(cloned)
    style_rues(cloned, k)
    return cloned


# -------------------- 4) CSV des rues par sous-zone ------------------------ #

def export_csv(rues_layer, k):
    out_path = os.path.join(DATA_DIR, f"zone5_rues_par_sous_zone_{k}.csv")
    field = f"sz{k}"
    by_zone = {}
    for f in rues_layer.getFeatures():
        sz = f[field]
        if sz is None:
            continue
        by_zone.setdefault(int(sz), set()).add(f["name"])

    landmarks = find_layer(f"zone5_{k}_landmarks")
    lm_by_num = {}
    if landmarks:
        for f in landmarks.getFeatures():
            lm_by_num[int(f["_num"])] = (f["kind"], f["name"])

    with open(out_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["sous_zone", "point_strategique_kind",
                    "point_strategique_nom", "rue"])
        for sz in sorted(by_zone.keys()):
            kind, nom = lm_by_num.get(sz, ("?", "?"))
            for rue in sorted(by_zone[sz]):
                w.writerow([sz, kind, nom, rue])
    print(f"  ✓ CSV : {os.path.basename(out_path)} "
          f"({sum(len(v) for v in by_zone.values())} lignes)")


# -------------------- main ------------------------------------------------- #

def main():
    print("=== Stylage Zone 5 ===")

    # 1) sous-zones
    for k in (9, 12):
        z = find_layer(f"zone5_{k}_zones")
        l = find_layer(f"zone5_{k}_landmarks")
        if z: style_subzones(z)
        else: print(f"  ⚠ zone5_{k}_zones non chargé")
        if l: style_landmarks(l)
        else: print(f"  ⚠ zone5_{k}_landmarks non chargé")

    # 2) rues
    rues_full = (find_layer("rues_dans_zones") or
                 find_first_with("rues_dans"))
    base = build_zone5_rues_layer(rues_full, find_layer("zone5_9_zones"))

    if base:
        # supprimer anciennes versions stylées
        for nm in ("zone5_rues_9", "zone5_rues_12"):
            for old in QgsProject.instance().mapLayersByName(nm):
                QgsProject.instance().removeMapLayer(old.id())
        clone_layer_styled(base, "zone5_rues_9", 9)
        clone_layer_styled(base, "zone5_rues_12", 12)
        # cacher la couche brute
        QgsProject.instance().layerTreeRoot().findLayer(base.id()).setItemVisibilityChecked(False)
        print("  ✓ zone5_rues_9 / zone5_rues_12 stylées")

        # 3) CSV
        for k in (9, 12):
            export_csv(base, k)

    # activer les bulles d'info dans le canvas (mapTips)
    try:
        iface.actionMapTips().setChecked(True)
    except Exception:
        pass

    print("\n✓ Terminé.")
    print("  Astuce : passe le curseur sur une rue ou une étoile pour voir")
    print("           son nom (les bulles d'info sont activées).")


main()
