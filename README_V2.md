# Alberta Wildfire Dashboard v2

This version fixes the map-color issue and adds a separate **Transformer Insights** tab.

## Why the map was wrong

The first dashboard used EPSG:3400 raster bounds directly as MapLibre image
coordinates. MapLibre expects longitude/latitude for an image source, so the
overlay was spatially distorted.

`prepare_dashboard_assets.py` now reprojects each Phase-6 GeoTIFF to EPSG:4326
before creating the web PNG.

## Replace your current dashboard

Extract this ZIP over:

```text
C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard
```

Then:

```powershell
cd C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard

& "..\.venv\Scripts\python.exe" -m pip install pillow
& "..\.venv\Scripts\python.exe" ".\prepare_dashboard_assets.py"

npm.cmd install
npm.cmd run dev
```

Hard-refresh the browser after Vite reloads:

```text
Ctrl + Shift + R
```

## Tabs

### Risk Map
- 2024 / 2025
- risk percentile
- model agreement
- clickable top-10% risk cells
- corrected blue → yellow → orange → red risk rendering

### Transformer Insights
- full model architecture
- training configuration
- temporal split and record counts
- ensemble AP/AUC by year
- top-risk capture / lift
- five-seed stability table
- Transformer vs XGBoost baseline, if Phase-3 XGBoost metrics are available
- weather channels and static predictors
- limitations and appropriate insurance interpretation

The map page no longer displays AP/AUC/capture metrics across the top.
