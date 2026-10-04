# Phase 7 — Alberta Wildfire Insurance Dashboard

This is a React/Vite + MapLibre dashboard package.

MapLibre GL JS is used because it renders large geospatial layers with WebGL.
The current MapLibre documentation supports Vite and recommends bundling the
v6 worker with Vite's `?worker&url` import pattern; this project already does
that.

## 1. Extract

Extract this ZIP into:

```text
C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard
```

Keep the Phase-6 outputs here:

```text
C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\data\alberta\results\insurance
```

## 2. Prepare browser assets

From the dashboard directory:

```powershell
cd C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard

..\ .venv\Scripts\python.exe .\prepare_dashboard_assets.py
```

If PowerShell dislikes the space above, use the exact command:

```powershell
& "..\.venv\Scripts\python.exe" ".\prepare_dashboard_assets.py"
```

Required Python package if missing:

```powershell
& "..\.venv\Scripts\python.exe" -m pip install pillow
```

The script creates lightweight PNG overlays and dashboard JSON/GeoJSON files
under `public\data\`.

## 3. Install and run

```powershell
npm install
npm run dev
```

Open the local URL Vite prints, usually:

```text
http://localhost:5173
```

## 4. Build

```powershell
npm run build
```

The production build goes to `dist\`.

## 5. Deploy to Vercel

Once the local dashboard looks right:

```powershell
git init
git add .
git commit -m "Add Alberta wildfire intelligence dashboard"
```

Then push to GitHub and import the repo in Vercel, or use the Vercel CLI.

## Product semantics

Dashboard shows:
- wildfire relative-risk percentile
- risk band
- model agreement
- retrospective observed burn fraction on high-risk cells
- ROC-AUC / Average Precision
- top-5% and top-10% event capture

It intentionally does NOT show the raw ensemble score as an annual wildfire
probability because the Phase-4 calibration transfer was not stable enough.

## Data rendering

The full province is rendered as a PNG overlay derived from the 2-km risk
GeoTIFF. Only the top-10% cells remain interactive GeoJSON polygons. This keeps
the browser fast while preserving the insurer-facing high-risk inspection layer.
