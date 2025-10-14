# IIIF Allmaps Editor


Es gibt bereits einen [offiziellen Editor von Allmaps](https://editor.allmaps.org/) - Aber wenn man noch bequemer eine IIIF-Karte zu Allmaps-Karte umwandeln möchte, kann man diesen Editor verwenden.

Bsp-Ergebnis: https://gist.githubusercontent.com/NbtKmy/4b4b488c11c36c180fc9431ab5f81e30/raw/4d49bc33827ba4a3b434b8b1f875451cbaa3bf89/gistfile1.txt

Auf Allmaps: https://viewer.allmaps.org/?url=https%3A%2F%2Fgist.githubusercontent.com%2FNbtKmy%2F4b4b488c11c36c180fc9431ab5f81e30%2Fraw%2F4d49bc33827ba4a3b434b8b1f875451cbaa3bf89%2Fgistfile1.txt


## Verwendete Plugins

- [leaflet.distortableimage](https://github.com/publiclab/Leaflet.DistortableImage) - v0.13.6
- [leaflet.toolbar](https://github.com/Leaflet/Leaflet.toolbar) - v0.4.0-alpha.2
- [leaflet.draw](https://leaflet.github.io/Leaflet.draw/docs/leaflet-draw-latest.html) - v0.4.14


## Hintergrund

[**IIIF Georeference Extension**](https://iiif.io/api/extension/georef/) seit 2023

| Data | Georeference Annotation |
|------|-------------------------|
| Resource and selector | IIIF Presentation API Canvas or Image API Image Service with an optional SVG Selector or Image API Selector |
| GCPs (Ground Control Points) | A GeoJSON Feature Collection where each GCP is stored as a GeoJSON Feature with Point geometry and a resourceCoords property in the Feature’s properties object |
| Transformation algorithm | A transformation property defined on the GeoJSON Feature Collection that holds the GCPs |


**Beispiel**: https://annotations.allmaps.org/manifests/631b96e4d6d3f421

