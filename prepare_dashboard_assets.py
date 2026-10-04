"""
Phase 7A v3 — Prepare dashboard assets.

Public map concepts
-------------------
1. Predicted Risk:
   Ensemble relative-risk percentile within Alberta for the selected year.

2. Wildfire Risk Confidence:
   A stability index based on agreement among the five Transformers in
   *percentile rank space*, not raw-score standard deviation.

   For every seed:
       raw score -> within-year percentile rank (0-100)

   Then:
       mean_absolute_rank_deviation =
           mean(abs(seed_percentile - ensemble_percentile))

       risk_confidence =
           clip(100 - 2 * mean_absolute_rank_deviation, 0, 100)

   Examples:
       average seed deviation  2.5 percentile points -> confidence 95
       average seed deviation 10.0 percentile points -> confidence 80
       average seed deviation 25.0 percentile points -> confidence 50

   This is an interpretable ensemble-stability index. It is NOT a statistical
   confidence interval and NOT a probability of fire.

3. Observed Fire Impact:
   Retrospective fraction of each 2-km cell mapped as burned by NBAC.

Run:
    & "..\.venv\Scripts\python.exe" ".\prepare_dashboard_assets.py"
"""

from pathlib import Path
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import calculate_default_transform, reproject, Resampling
from PIL import Image

HERE = Path(__file__).resolve().parent

PROJECT = None
for p in [HERE, HERE.parent]:
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

ENSEMBLE_PRED = ENSEMBLE / "ensemble_predictions.parquet"

RISK_COLORS = np.array([
    [248, 243, 212, 170],  # Low: 0-50   light cream
    [241, 209, 84, 210],   # Moderate: 50-80   yellow
    [236, 166, 72, 220],   # Elevated: 80-90   amber/orange
    [226, 117, 54, 230],   # High: 90-95   orange
    [204, 73, 48, 238],    # Very High: 95-99   red-orange
    [110, 29, 43, 245],    # Extreme: 99-100   dark maroon
], dtype=np.uint8)

CONF_COLORS = np.array([
    [169, 52, 52, 230],     # very low
    [221, 120, 53, 225],    # low
    [235, 188, 66, 220],    # moderate
    [91, 164, 143, 215],    # high
    [42, 123, 88, 220],     # very high
], dtype=np.uint8)

IMPACT_COLORS = np.array([
    [0, 0, 0, 0],           # none
    [245, 211, 104, 190],   # trace
    [237, 151, 61, 215],    # moderate
    [201, 70, 51, 235],     # high
    [108, 24, 44, 245],     # severe
], dtype=np.uint8)


def warp_array_to_wgs84(arr, src_transform, src_crs, src_bounds, nodata=np.nan):
    dst_crs = "EPSG:4326"
    transform, width, height = calculate_default_transform(
        src_crs, dst_crs, arr.shape[1], arr.shape[0], *src_bounds
    )
    dst = np.full((height, width), np.nan, dtype=np.float32)

    reproject(
        source=arr.astype(np.float32),
        destination=dst,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=transform,
        dst_crs=dst_crs,
        src_nodata=nodata,
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )

    left = transform.c
    top = transform.f
    right = left + transform.a * width
    bottom = top + transform.e * height
    return dst, [[left, bottom], [right, top]]


def read_and_warp_raster(src_path):
    with rasterio.open(src_path) as src:
        arr = src.read(1).astype(np.float32)
        if src.nodata is not None:
            arr[arr == src.nodata] = np.nan
        return warp_array_to_wgs84(
            arr, src.transform, src.crs, src.bounds, np.nan
        )


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


def confidence_rgba(arr):
    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    valid = np.isfinite(arr)
    masks = [
        arr < 25,
        (arr >= 25) & (arr < 50),
        (arr >= 50) & (arr < 75),
        (arr >= 75) & (arr < 90),
        arr >= 90,
    ]
    for i, m in enumerate(masks):
        rgba[m & valid] = CONF_COLORS[i]
    return rgba


def impact_rgba(arr):
    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    valid = np.isfinite(arr)
    masks = [
        arr <= 0,
        (arr > 0) & (arr < 0.05),
        (arr >= 0.05) & (arr < 0.25),
        (arr >= 0.25) & (arr < 0.50),
        arr >= 0.50,
    ]
    for i, m in enumerate(masks):
        rgba[m & valid] = IMPACT_COLORS[i]
    return rgba


def save_png(arr, path, kind):
    if kind == "risk":
        rgba = risk_rgba(arr)
    elif kind == "confidence":
        rgba = confidence_rgba(arr)
    else:
        rgba = impact_rgba(arr)
    Image.fromarray(rgba, mode="RGBA").save(path, optimize=True)


def confidence_band(v):
    if v < 25:
        return "Very Low"
    if v < 50:
        return "Low"
    if v < 75:
        return "Moderate"
    if v < 90:
        return "High"
    return "Very High"


def compute_confidence(pred):
    seed_cols = [c for c in pred.columns if c.startswith("p_seed_")]
    if len(seed_cols) < 3:
        raise RuntimeError(
            "Expected per-seed prediction columns p_seed_* in "
            "ensemble_predictions.parquet."
        )

    out = pred.copy()

    if "ensemble_risk_percentile" in out.columns:
        ens_pct = 100.0 * out["ensemble_risk_percentile"].astype(float)
    else:
        ens_pct = (
            100.0
            * out.groupby("target_year")["ensemble_mean_raw"]
            .rank(pct=True, method="average")
        )

    out["risk_percentile"] = ens_pct.astype("float32")

    rank_cols = []
    for c in seed_cols:
        rc = f"{c}_pct"
        out[rc] = (
            100.0
            * out.groupby("target_year")[c]
            .rank(pct=True, method="average")
        ).astype("float32")
        rank_cols.append(rc)

    R = out[rank_cols].to_numpy(dtype=np.float32)
    E = out["risk_percentile"].to_numpy(dtype=np.float32)[:, None]

    mad = np.mean(np.abs(R - E), axis=1)
    conf = np.clip(100.0 - 2.0 * mad, 0.0, 100.0)

    out["mean_seed_rank_deviation"] = mad.astype("float32")
    out["risk_confidence"] = conf.astype("float32")
    out["risk_confidence_band"] = pd.Series(conf).map(confidence_band).values

    out["top10_seed_votes"] = (R >= 90.0).sum(axis=1).astype("uint8")
    out["top5_seed_votes"] = (R >= 95.0).sum(axis=1).astype("uint8")

    return out, seed_cols


pred = pd.read_parquet(ENSEMBLE_PRED)
pred, seed_cols = compute_confidence(pred)

# Metrics / insights payload.
metrics = pd.read_csv(INSURANCE / "ensemble_benchmark_metrics.csv")
capture = pd.read_csv(INSURANCE / "ensemble_insurance_capture.csv")

seed_rows = []
for p in sorted(ENSEMBLE.glob("summary_seed_*.json")):
    d = json.loads(p.read_text(encoding="utf-8"))
    row = {"seed": int(d["seed"]), "best_epoch": int(d["best_epoch"])}
    for m in d.get("year_metrics", []):
        y = int(m["year"])
        row[f"ap_{y}"] = float(m["average_precision"])
        row[f"auc_{y}"] = float(m["roc_auc"])
    seed_rows.append(row)

# XGBoost fallback: locate any metrics file that looks like the Phase-3 output.
xgb_rows = []
for candidate in [
    RESULTS / "xgboost_metrics_by_year.csv",
    RESULTS / "xgboost_metrics.csv",
]:
    if candidate.exists():
        xgb = pd.read_csv(candidate)
        xgb_rows = xgb.to_dict(orient="records")
        break

bounds_by_year = {}

for year in (2024, 2025):
    # Risk PNG from Phase-6 GeoTIFF.
    risk_arr, bounds = read_and_warp_raster(
        INSURANCE / f"alberta_risk_percentile_{year}.tif"
    )
    bounds_by_year[str(year)] = bounds
    save_png(risk_arr, OUT / f"risk_{year}.png", "risk")

    # Read geometry + observed burn fraction.
    gdf = gpd.read_file(
        INSURANCE / f"alberta_insurance_risk_{year}.gpkg"
    )

    py = pred[pred["target_year"] == year][
        [
            "cell_id",
            "risk_percentile",
            "risk_confidence",
            "risk_confidence_band",
            "mean_seed_rank_deviation",
            "top10_seed_votes",
            "top5_seed_votes",
        ]
    ].copy()

    gdf = gdf.drop(
        columns=[
            c for c in [
                "risk_percentile",
                "model_agreement",
                "disagreement_percentile",
            ]
            if c in gdf.columns
        ]
    ).merge(py, on="cell_id", how="left", validate="one_to_one")

    # Reconstruct 2-km rasters from the cell polygons for confidence and impact.
    minx, miny, maxx, maxy = gdf.total_bounds
    cell = 2000.0
    width = int(np.ceil((maxx - minx) / cell))
    height = int(np.ceil((maxy - miny) / cell))
    transform = from_origin(minx, maxy, cell, cell)

    conf_native = rasterize(
        (
            (geom, float(v))
            for geom, v in zip(gdf.geometry, gdf["risk_confidence"])
            if geom is not None and not geom.is_empty and np.isfinite(v)
        ),
        out_shape=(height, width),
        transform=transform,
        fill=np.nan,
        dtype="float32",
    )

    impact_native = rasterize(
        (
            (geom, float(v))
            for geom, v in zip(gdf.geometry, gdf["target_burnfrac"])
            if geom is not None and not geom.is_empty and np.isfinite(v)
        ),
        out_shape=(height, width),
        transform=transform,
        fill=np.nan,
        dtype="float32",
    )

    native_bounds = rasterio.coords.BoundingBox(
        left=minx, bottom=miny, right=maxx, top=maxy
    )

    conf_wgs, _ = warp_array_to_wgs84(
        conf_native, transform, gdf.crs, native_bounds, np.nan
    )
    impact_wgs, _ = warp_array_to_wgs84(
        impact_native, transform, gdf.crs, native_bounds, np.nan
    )

    save_png(
        conf_wgs, OUT / f"confidence_{year}.png", "confidence"
    )
    save_png(
        impact_wgs, OUT / f"impact_{year}.png", "impact"
    )

    # Rebuild interactive high-risk cells with the new confidence fields.
    top = gdf[gdf["risk_percentile"] >= 90.0].copy().to_crs(4326)
    top.to_file(
        OUT / f"top10_{year}.geojson",
        driver="GeoJSON",
    )

# Confidence distribution summary for the insights tab.
conf_summary = []
for year, g in pred.groupby("target_year", sort=True):
    conf_summary.append({
        "year": int(year),
        "mean": float(g["risk_confidence"].mean()),
        "median": float(g["risk_confidence"].median()),
        "p10": float(g["risk_confidence"].quantile(0.10)),
        "p90": float(g["risk_confidence"].quantile(0.90)),
        "top10_all5_vote_fraction": float(
            (g.loc[g["risk_percentile"] >= 90, "top10_seed_votes"] == 5).mean()
        ),
    })

payload = {
    "ensembleMetrics": metrics.to_dict(orient="records"),
    "capture": capture.to_dict(orient="records"),
    "seeds": seed_rows,
    "xgboost": xgb_rows,
    "confidenceSummary": conf_summary,
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
    "methodology": {
        "riskConfidence": (
            "Each seed's raw score is converted to a within-year Alberta "
            "percentile rank. Confidence is 100 minus twice the mean absolute "
            "difference between the five seed percentiles and the ensemble "
            "percentile, clipped to 0–100. It is an ensemble-stability index, "
            "not a probability or statistical confidence interval."
        ),
        "observedImpact": (
            "Retrospective NBAC burned-area fraction within each 2-km cell."
        ),
    },
}

(OUT / "dashboard_metrics.json").write_text(
    json.dumps(payload, indent=2), encoding="utf-8"
)
(OUT / "map_bounds.json").write_text(
    json.dumps(bounds_by_year, indent=2), encoding="utf-8"
)

print("Dashboard v3 assets created.")
print("Confidence uses percentile-rank agreement across seeds.")
print("Seed columns:", seed_cols)
for p in sorted(OUT.iterdir()):
    print(" ", p.name)
