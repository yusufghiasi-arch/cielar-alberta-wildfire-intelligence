# Alberta Wildfire Dashboard v3

v3 replaces the misleading raw-score "Model Agreement" layer with a more
defensible **Wildfire Risk Confidence** layer based on percentile-rank
agreement across the five Transformers.

It also adds a third retrospective layer: **Observed Fire Impact**.

## Public map concepts

### Predicted Risk
Within-year Alberta ensemble risk percentile.

### Wildfire Risk Confidence
Each seed is independently converted to a 0-100 Alberta percentile rank.

For each cell:

```text
mean rank deviation =
mean(abs(seed percentile - ensemble percentile))

Risk Confidence =
clip(100 - 2 * mean rank deviation, 0, 100)
```

This avoids the previous problem where raw-score standard deviation was
mechanically larger in high-risk locations.

It is an ensemble-stability index, not a statistical confidence interval and
not a probability of wildfire.

The interactive high-risk popup also reports:

```text
Top-10 seed votes: X / 5
```

### Observed Fire Impact
Retrospective NBAC burned-area fraction within the 2-km cell:

```text
0%       No mapped burn
<5%      Trace
5-25%    Moderate
25-50%   High
50-100%  Severe
```

This is an observed outcome, not a model prediction.

## Update current deployed dashboard

Extract this ZIP over your existing local folder:

```text
C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard
```

Then regenerate assets:

```powershell
cd C:\Users\Yusof Ghiasi\Documents\canada-wildfire-geoai\alberta-wildfire-dashboard

& "..\.venv\Scripts\python.exe" ".\prepare_dashboard_assets.py"

npm.cmd run build
npm.cmd run dev
```

Hard-refresh and inspect locally.

Then push the changes:

```powershell
git add .
git commit -m "Add wildfire risk confidence and observed impact"
git push
```

Vercel should redeploy automatically from GitHub.
