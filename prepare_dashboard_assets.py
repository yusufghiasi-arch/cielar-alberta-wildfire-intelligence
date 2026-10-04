"""
Phase 7A v2 — Prepare Phase-6 outputs for the Alberta wildfire dashboard.

Fixes:
1) Reprojects EPSG:3400 risk rasters to EPSG:4326 before creating MapLibre
   image overlays. MapLibre image sources require longitude/latitude corners.
2) Builds a richer model-insights JSON payload from ensemble seed summaries,
   ensemble metrics, risk capture, and XGBoost benchmark results when present.

Run from the dashboard folder:
    & "..\.venv\Scripts\python.exe" ".\prepare_dashboard_assets.py"
"""

from pathlib import Path
import json
import shutil

import numpy as np
import pandas as pd
import rasterio
from rasterio.io import MemoryFile
from rasterio.warp import calculate_default_transform, reproject, Resampling
from PIL import Image

HERE = Path(__file__).resolve().parent

PROJECT_CANDIDATES = [HERE, HERE.parent]
PROJECT = None
for p in PROJECT_CANDIDATES:
    if (p / "data" / "alberta").exists():
        PROJECT = p
        break
if PROJECT is None:
    raise FileNotFoundError(
        "Could not find data/alberta. Place this dashboard folder directly "
        "inside canada-wildfire-geoai."
    )

INSURANCE = PROJECT / "data" / "alberta" / "results" / "insurance"
ENSEMBLE = PROJECT / "data" / "alberta" / "results" / "ensemble"
RESULTS = PROJECT / "data" / "alberta" / "results"
OUT = HERE / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

RISK_COLORS = np.array([
    [70, 130, 180, 185],   # Low
    [92, 169, 159, 200],   # Moderate
    [238, 199, 74, 220],   # Elevated
    [235, 139, 48, 230],   # High
    [205, 65, 51, 238],    # Very High
    [116, 24, 49, 245],    # Extreme
], dtype=np.uint8)

AGREE_COLORS = np.array([
    [50, 126, 91, 210],    # High agreement
    [232, 166, 50, 220],   # Moderate
    [169, 52, 52, 235],    # Low agreement
], dtype=np.uint8)


def warp_to_wgs84(src_path):
    with rasterio.open(src_path) as src:
        dst_crs = "EPSG:4326"
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        dst = np.full((height, width), np.nan, dtype=np.float32)

        src_arr = src.read(1).astype(np.float32)
        if src.nodata is not None:
            src_arr[src_arr == src.nodata] = np.nan

        reproject(
            source=src_arr,
            destination=dst,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            src_nodata=np.nan,
            dst_nodata=np.nan,
            resampling=Resampling.nearest,
        )

        left = transform.c
        top = transform.f
        right = left + transform.a * width
        bottom = top + transform.e * height

    return dst, [[left, bottom], [right, top]]


def risk_rgba(arr):
    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    valid = np.isfinite(arr)
    masks = [
        arr < 50,
        (arr >= 50) & (arr < 80),
        (arr >= 80) & (arr < 90),
        (arr >= 90) & (arr < 95),
        (arr >= 95) & (arr < 99),
        arr >= 99,
    ]
    for i, m in enumerate(masks):
        rgba[m & valid] = RISK_COLORS[i]
    return rgba


def disagreement_rgba(arr):
    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    valid = np.isfinite(arr)
    masks = [
        arr <= 50,
        (arr > 50) & (arr <= 80),
        arr > 80,
    ]
    for i, m in enumerate(masks):
        rgba[m & valid] = AGREE_COLORS[i]
    return rgba


def convert(src, out, kind):
    arr, bounds = warp_to_wgs84(src)
    rgba = risk_rgba(arr) if kind == "risk" else disagreement_rgba(arr)
    Image.fromarray(rgba, mode="RGBA").save(out, optimize=True)
    return bounds


bounds_by_year = {}
for year in (2024, 2025):
    bounds_by_year[str(year)] = convert(
        INSURANCE / f"alberta_risk_percentile_{year}.tif",
        OUT / f"risk_{year}.png",
        "risk",
    )
    convert(
        INSURANCE / f"alberta_disagreement_percentile_{year}.tif",
        OUT / f"disagreement_{year}.png",
        "agreement",
    )
    shutil.copy2(
        INSURANCE / f"alberta_top10pct_risk_{year}.geojson",
        OUT / f"top10_{year}.geojson",
    )

metrics = pd.read_csv(INSURANCE / "ensemble_benchmark_metrics.csv")
capture = pd.read_csv(INSURANCE / "ensemble_insurance_capture.csv")

# Per-seed Transformer summaries.
seed_rows = []
for p in sorted(ENSEMBLE.glob("summary_seed_*.json")):
    d = json.loads(p.read_text(encoding="utf-8"))
    row = {
        "seed": int(d["seed"]),
        "best_epoch": int(d["best_epoch"]),
    }
    for m in d.get("year_metrics", []):
        y = int(m["year"])
        row[f"ap_{y}"] = float(m["average_precision"])
        row[f"auc_{y}"] = float(m["roc_auc"])
    seed_rows.append(row)

# XGBoost benchmark, if present.
xgb_rows = []
xgb_file = RESULTS / "xgboost_metrics_by_year.csv"
if xgb_file.exists():
    xgb = pd.read_csv(xgb_file)
    keep = [
        "target_year", "average_precision", "roc_auc",
        "balanced_accuracy", "f1", "precision", "recall", "brier"
    ]
    xgb_rows = xgb[[c for c in keep if c in xgb.columns]].to_dict(orient="records")

payload = {
    "ensembleMetrics": metrics.to_dict(orient="records"),
    "capture": capture.to_dict(orient="records"),
    "seeds": seed_rows,
    "xgboost": xgb_rows,
    "architecture": {
        "model": "Temporal Transformer ensemble",
        "ensembleMembers": 5,
        "sequenceLengthMonths": 24,
        "weatherChannels": 11,
        "dModel": 64,
        "attentionHeads": 4,
        "encoderLayers": 2,
        "feedForwardDim": 128,
        "dropout": 0.10,
        "optimizer": "AdamW",
        "learningRate": 0.0002,
        "weightDecay": 0.0001,
        "loss": "BCEWithLogitsLoss with sqrt class-imbalance positive weight",
        "earlyStopping": "Validation Average Precision, patience = 5 epochs",
    },
    "dataDesign": {
        "grid": "2 km Alberta grid",
        "cellsPerYear": 165624,
        "trainingRows": 1159368,
        "validationRows": 165624,
        "testRows": 331248,
        "trainingYears": "2016–2022",
        "validationYear": "2023",
        "testYears": "2024–2025",
        "target": "At least 5% of a 2-km cell burned in target year",
        "antecedentWindow": "24 months ending Dec 31 before target year",
        "weatherChannels": [
            "2 m temperature",
            "VPD",
            "10 m wind speed",
            "monthly precipitation",
            "monthly snowfall",
            "snow water equivalent",
            "soil water layer 1",
            "soil water layer 2",
            "soil water layer 3",
            "potential evaporation",
            "water balance",
        ],
        "otherPredictors": [
            "Archived 2014 FBP fuel type",
            "NBAC fire-history features",
            "CDEM terrain/elevation/slope",
            "Latitude/longitude and static landscape context",
        ],
    },
    "riskBands": [
        {"label": "Low", "min": 0, "max": 50},
        {"label": "Moderate", "min": 50, "max": 80},
        {"label": "Elevated", "min": 80, "max": 90},
        {"label": "High", "min": 90, "max": 95},
        {"label": "Very High", "min": 95, "max": 99},
        {"label": "Extreme", "min": 99, "max": 100},
    ],
    "notes": {
        "risk": (
            "Within-year Alberta relative wildfire-risk percentile. "
            "Not a calibrated annual probability."
        ),
        "agreement": (
            "Agreement across five independently initialized Transformer models."
        ),
        "testCaveat": (
            "2024 and 2025 are retrospective out-of-time benchmark years for "
            "Benchmark v1. They should not be repeatedly tuned against."
        ),
    },
}

(OUT / "dashboard_metrics.json").write_text(
    json.dumps(payload, indent=2), encoding="utf-8"
)
(OUT / "map_bounds.json").write_text(
    json.dumps(bounds_by_year, indent=2), encoding="utf-8"
)

print("Dashboard assets created successfully.")
print("WGS84 bounds:", bounds_by_year)
for p in sorted(OUT.iterdir()):
    print(" ", p.name)
