# Chicoutimi — Carte interactive des zones

Application web légère et moderne pour explorer l'arrondissement de Chicoutimi (Saguenay, Québec) découpé en **9** ou **12** zones équilibrées, avec quartiers et rues nommés.

## Fonctionnalités

- Bascule entre **9 zones** et **12 zones**
- 3 fonds de carte : **Clair (CARTO)**, **OpenStreetMap**, **Satellite (Esri)**
- Activation/désactivation de chaque couche : zones, limite, quartiers, rues
- **Navigation rapide** : grille colorée des zones — un clic zoome dessus
- **Recherche** : tape un nom de quartier ou de rue, l'app y vole
- **Statistiques** : popup d'une zone affiche le nombre de quartiers et rues qu'elle contient
- Interface responsive, sombre, soft, avec sidebar repliable
- Géolocalisation, échelle, navigation/pitch

## Structure du projet

```
chicoutimi-webapp/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
├── data/
│   ├── chicoutimi_limite.geojson
│   ├── chicoutimi_9_zones.geojson
│   ├── chicoutimi_12_zones.geojson
│   ├── quartiers_dans_zones.geojson
│   └── rues_dans_zones.geojson
└── README.md
```

## Tester en local

L'app charge les GeoJSON via `fetch()` — elle a besoin d'un serveur HTTP (pas en `file://`).

```bash
cd chicoutimi-webapp
python -m http.server 8000
```

Puis ouvre <http://localhost:8000>.

## Mettre en ligne (gratuit)

### Option 1 — Netlify Drop (le plus simple, 30 secondes)
1. Va sur <https://app.netlify.com/drop>
2. Glisse-dépose le **dossier `chicoutimi-webapp/` entier**
3. Tu obtiens un lien public partageable du type `https://xxx.netlify.app`

### Option 2 — GitHub Pages
1. Crée un repo GitHub, pousse le contenu du dossier
2. Settings → Pages → Source: `main` branch, `/ (root)` → Save
3. URL publiée à `https://<user>.github.io/<repo>/`

### Option 3 — Cloudflare Pages / Vercel
Déploiement statique en glisser-déposer également supporté.

## Mise à jour des données

Régénère les GeoJSON avec les scripts QGIS (`chicoutimi_zones.py`, `chicoutimi_zone_contents.py`), puis copie-les dans `data/` et relance `_reproject.py` (les zones/quartiers/rues doivent être en **WGS84 / EPSG:4326**).

```bash
python data/_reproject.py
```

## Stack

- [MapLibre GL JS](https://maplibre.org/) 4.7.1 — moteur de carte vectorielle
- CARTO / OpenStreetMap / Esri — tuiles raster
- Inter (Google Fonts)
- Aucune dépendance de build, aucun framework — vanilla JS pur
