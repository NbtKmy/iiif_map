# IIIF Allmaps Editor


Es gibt bereits einen [offiziellen Editor von Allmaps](https://editor.allmaps.org/) - Aber wenn man noch bequemer eine IIIF-Karte zu Allmaps-Karte umwandeln möchte, kann man diesen Editor verwenden.

URL: https://nbtkmy.github.io/iiif_map/

Bsp-Ergebnis: https://gist.github.com/NbtKmy/ff30336c97a1ce5609da8415de2d0c90

Auf Allmaps: https://viewer.allmaps.org/?url=https%3A%2F%2Fgist.githubusercontent.com%2FNbtKmy%2Fff30336c97a1ce5609da8415de2d0c90%2Fraw%2F2a809db8e476d3f7d87c05301956175048b408d7%2Fallmaps-annotation-page.json


## Verwendete Plugins

- [leaflet.distortableimage](https://github.com/publiclab/Leaflet.DistortableImage) - v0.13.6
- [leaflet.toolbar](https://github.com/Leaflet/Leaflet.toolbar) - v0.4.0-alpha.2
- [leaflet.draw](https://leaflet.github.io/Leaflet.draw/docs/leaflet-draw-latest.html) - v0.4.14


## Hintergrund

Es sind 2 IIIF-Extensions für die geographische Information offiziell publiziert:

1. [**navPlace Extension**](https://iiif.io/api/extension/navplace/)


2. [**IIIF Georeference Extension**](https://iiif.io/api/extension/georef/) wurde 2023 entwickelt und publiziert.
[Allmaps Viewer](https://viewer.allmaps.org/) ist ein Produkt mit dieser Erweiterung.
Die Entwickler von Allmaps bieten noch mehr tools - Näheres [hier](https://allmaps.org/).

Die IIIF Georeferenz-Erweiterung besteht aus den folgenden Elementen:

| Data | Georeference Annotation |
|------|-------------------------|
| Resource and selector | IIIF Presentation API Canvas or Image API Image Service with an optional SVG Selector or Image API Selector |
| GCPs (Ground Control Points) | A GeoJSON Feature Collection where each GCP is stored as a GeoJSON Feature with Point geometry and a resourceCoords property in the Feature’s properties object |
| Transformation algorithm | A transformation property defined on the GeoJSON Feature Collection that holds the GCPs |


**Beispiel**: https://annotations.allmaps.org/manifests/631b96e4d6d3f421

