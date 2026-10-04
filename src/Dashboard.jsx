import { useEffect, useRef, useState } from 'react'
import { Map, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import './styles.css'

setWorkerUrl(workerUrl)

const fmt = (v, d = 3) =>
  v === undefined || v === null || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toFixed(d)

const pct = v =>
  v === undefined || v === null ? '—' : `${(Number(v) * 100).toFixed(1)}%`

export default function Dashboard() {
  const [tab, setTab] = useState('map')
  const [year, setYear] = useState(2025)
  const [layer, setLayer] = useState('risk')
  const [data, setData] = useState(null)
  const [bounds, setBounds] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch('/data/dashboard_metrics.json').then(r => r.json()),
      fetch('/data/map_bounds.json').then(r => r.json()),
    ]).then(([d, b]) => {
      setData(d)
      setBounds(b)
    })
  }, [])

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">CIELAR · WILDFIRE INTELLIGENCE</div>
          <h1>Alberta Annual Wildfire Risk</h1>
          <p>Five-Transformer ensemble · relative risk ranking · 2 km grid</p>
        </div>
        <nav className="tabs">
          <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
            Risk Map
          </button>
          <button className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>
            Transformer Insights
          </button>
        </nav>
      </header>

      {tab === 'map' ? (
        <MapPage
          year={year} setYear={setYear}
          layer={layer} setLayer={setLayer}
          bounds={bounds}
        />
      ) : (
        <Insights data={data} />
      )}

      <footer>
        <span>Yusof Ghiasi · Cielar</span>
        <span>NBAC · ERA5-Land · CDEM · archived FBP fuels · PyTorch Transformer ensemble</span>
      </footer>
    </main>
  )
}

function MapPage({ year, setYear, layer, setLayer, bounds }) {
  const mapNode = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)

  useEffect(() => {
    if (!mapNode.current || !bounds || mapRef.current) return

    const map = new Map({
      container: mapNode.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{
          id: 'osm', type: 'raster', source: 'osm',
          paint: { 'raster-opacity': 0.72 },
        }],
      },
      center: [-114.5, 55],
      zoom: 4.5,
    })

    map.addControl(new NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      updateMap(map, year, layer, bounds)
      fit(map, bounds, year)

      map.on('click', 'top10-fill', e => {
        if (!e.features?.length) return
        const p = e.features[0].properties || {}
        popupRef.current?.remove()
        popupRef.current = new Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="popup">
              <strong>High-risk cell</strong>
              <div><span>Predicted risk</span><b>${fmt(p.risk_percentile, 1)}th pct.</b></div>
              <div><span>Risk confidence</span><b>${fmt(p.risk_confidence, 0)}/100</b></div>
              <div><span>Confidence band</span><b>${p.risk_confidence_band ?? '—'}</b></div>
              <div><span>Top-10 seed votes</span><b>${p.top10_seed_votes ?? '—'}/5</b></div>
              <div><span>Observed fire impact</span><b>${fmt(Number(p.target_burnfrac) * 100, 1)}%</b></div>
            </div>
          `)
          .addTo(map)
      })
      map.on('mouseenter', 'top10-fill', () => map.getCanvas().style.cursor = 'pointer')
      map.on('mouseleave', 'top10-fill', () => map.getCanvas().style.cursor = '')
    })

    return () => map.remove()
  }, [bounds])

  useEffect(() => {
    if (mapRef.current && bounds && mapRef.current.loaded()) {
      updateMap(mapRef.current, year, layer, bounds)
      fit(mapRef.current, bounds, year)
    }
  }, [year, layer, bounds])

  const label =
    layer === 'risk'
      ? 'Predicted wildfire risk'
      : layer === 'confidence'
      ? 'Wildfire risk confidence'
      : 'Observed fire impact'

  return (
    <section className="map-layout">
      <aside className="panel">
        <div className="year-switch">
          {[2024, 2025].map(y => (
            <button key={y} className={year === y ? 'active' : ''} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>

        <h2>Layer</h2>
        <div className="segmented">
          <button className={layer === 'risk' ? 'active' : ''} onClick={() => setLayer('risk')}>
            Predicted risk
          </button>
          <button className={layer === 'confidence' ? 'active' : ''} onClick={() => setLayer('confidence')}>
            Risk confidence
          </button>
          <button className={layer === 'impact' ? 'active' : ''} onClick={() => setLayer('impact')}>
            Observed fire impact
          </button>
        </div>

        {layer === 'risk' && <RiskLegend />}
        {layer === 'confidence' && <ConfidenceLegend />}
        {layer === 'impact' && <ImpactLegend />}

        <div className="callout">
          <strong>{layer === 'impact' ? 'Retrospective observation' : 'Portfolio screening'}</strong>
          <p>
            {layer === 'risk'
              ? 'Predicted Risk ranks Alberta locations from lower to higher next-season wildfire hazard.'
              : layer === 'confidence'
              ? 'Risk Confidence measures how consistently the five Transformers rank each location.'
              : 'Observed Fire Impact shows the fraction of each 2-km cell actually mapped as burned by NBAC.'}
          </p>
        </div>

        {layer !== 'impact' && (
          <div className="warning">
            {layer === 'risk'
              ? <>Predicted Risk is a <b>relative percentile</b>, not an annual probability.</>
              : <>Risk Confidence is an <b>ensemble-stability index</b>, not a probability of fire.</>}
          </div>
        )}
      </aside>

      <div className="map-wrap">
        <div ref={mapNode} className="map" />
        <div className="map-badge">
          <b>{year}</b>
          <span>{label}</span>
        </div>
      </div>
    </section>
  )
}

function RiskLegend() {
  const rows = [
    ['Low', '0–50', 'risk-0'],
    ['Moderate', '50–80', 'risk-1'],
    ['Elevated', '80–90', 'risk-2'],
    ['High', '90–95', 'risk-3'],
    ['Very High', '95–99', 'risk-4'],
    ['Extreme', '99–100', 'risk-5'],
  ]
  return <Legend title="Predicted risk percentile" rows={rows}/>
}

function ConfidenceLegend() {
  const rows = [
    ['Very Low', '0–25', 'conf-0'],
    ['Low', '25–50', 'conf-1'],
    ['Moderate', '50–75', 'conf-2'],
    ['High', '75–90', 'conf-3'],
    ['Very High', '90–100', 'conf-4'],
  ]
  return <Legend title="Wildfire Risk Confidence" rows={rows}/>
}

function ImpactLegend() {
  const rows = [
    ['No mapped burn', '0%', 'impact-0'],
    ['Trace', '<5%', 'impact-1'],
    ['Moderate', '5–25%', 'impact-2'],
    ['High', '25–50%', 'impact-3'],
    ['Severe', '50–100%', 'impact-4'],
  ]
  return <Legend title="Observed burned fraction" rows={rows}/>
}

function Legend({ title, rows }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="legend">
        {rows.map(([label, range, cls]) => (
          <div className="legend-row" key={label}>
            <span className={`swatch ${cls}`} />
            <span>{label}</span><b>{range}</b>
          </div>
        ))}
      </div>
    </>
  )
}

function Insights({ data }) {
  if (!data) return <div className="loading">Loading model diagnostics…</div>

  const ens = data.ensembleMetrics || []
  const captures = data.capture || []
  const seeds = data.seeds || []
  const arch = data.architecture
  const design = data.dataDesign
  const conf = data.confidenceSummary || []

  return (
    <section className="insights">
      <div className="insights-intro">
        <div>
          <div className="section-kicker">MODEL CARD</div>
          <h2>Temporal Transformer ensemble</h2>
          <p>
            Five independently initialized models learn 24-month antecedent
            weather sequences and fuse them with fire history, fuel and terrain.
            Ensemble averaging provides the risk ranking; percentile-rank
            consistency across seeds provides the Wildfire Risk Confidence index.
          </p>
        </div>
        <div className="hero-number">
          <span>2024 ROC-AUC</span>
          <strong>{fmt(ens.find(x => Number(x.target_year) === 2024)?.roc_auc, 3)}</strong>
          <small>Out-of-time benchmark</small>
        </div>
      </div>

      <div className="insight-grid">
        <InfoCard title="Architecture">
          <MetricRows rows={[
            ['Ensemble members', arch.ensembleMembers],
            ['Sequence length', `${arch.sequenceLengthMonths} months`],
            ['Weather channels', arch.weatherChannels],
            ['Embedding dimension', arch.dModel],
            ['Attention heads', arch.attentionHeads],
            ['Encoder layers', arch.encoderLayers],
            ['Feed-forward dimension', arch.feedForwardDim],
            ['Dropout', arch.dropout],
          ]}/>
        </InfoCard>

        <InfoCard title="Training configuration">
          <MetricRows rows={[
            ['Optimizer', arch.optimizer],
            ['Learning rate', arch.learningRate],
            ['Weight decay', arch.weightDecay],
            ['Loss', arch.loss],
            ['Early stopping', arch.earlyStopping],
          ]}/>
        </InfoCard>

        <InfoCard title="Temporal split">
          <MetricRows rows={[
            ['Training', design.trainingYears],
            ['Validation', design.validationYear],
            ['Test', design.testYears],
            ['Training rows', design.trainingRows.toLocaleString()],
            ['Validation rows', design.validationRows.toLocaleString()],
            ['Test rows', design.testRows.toLocaleString()],
            ['Cells per year', design.cellsPerYear.toLocaleString()],
          ]}/>
        </InfoCard>
      </div>

      <Section title="Ensemble benchmark">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Year</th><th>Role</th><th>Prevalence</th>
              <th>AP</th><th>ROC-AUC</th><th>Mean raw-score spread</th>
            </tr></thead>
            <tbody>
              {ens.map(r => (
                <tr key={r.target_year}>
                  <td>{r.target_year}</td><td>{r.temporal_split}</td>
                  <td>{pct(r.prevalence)}</td>
                  <td>{fmt(r.average_precision, 3)}</td>
                  <td><b>{fmt(r.roc_auc, 3)}</b></td>
                  <td>{fmt(r.mean_model_std, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Wildfire Risk Confidence">
        <p className="section-copy">
          Confidence is based on how closely the five Transformers agree on a
          cell's percentile ranking. It deliberately avoids raw-score spread,
          which can be mechanically larger in high-risk locations.
        </p>
        <div className="capture-grid">
          {conf.filter(x => [2024, 2025].includes(Number(x.year))).map(c => (
            <article className="capture-card" key={c.year}>
              <span>{c.year}</span>
              <strong>{fmt(c.median, 0)}/100</strong>
              <p>median ensemble ranking confidence across Alberta</p>
              <div className="capture-meta">
                <b>{pct(c.top10_all5_vote_fraction)}</b>
                <span>of top-10% cells received 5/5 seed votes</span>
              </div>
            </article>
          ))}
        </div>
        <div className="formula-note">
          <b>Definition:</b> 100 minus twice the average absolute difference,
          in percentile points, between each seed's ranking and the ensemble ranking.
          This is an interpretable stability index—not a statistical confidence interval.
        </div>
      </Section>

      <Section title="Insurance concentration performance">
        <div className="capture-grid">
          {[2024, 2025].map(y => {
            const c5 = captures.find(x => Number(x.target_year) === y && Number(x.top_fraction) === .05)
            const c10 = captures.find(x => Number(x.target_year) === y && Number(x.top_fraction) === .10)
            return (
              <article className="capture-card" key={y}>
                <span>{y} retrospective test</span>
                <strong>{pct(c10?.event_capture)}</strong>
                <p>of burned cells captured inside the highest-risk 10% of Alberta cells</p>
                <div className="capture-meta">
                  <b>{fmt(c10?.lift_vs_baseline, 2)}× lift</b>
                  <span>Top 5% capture {pct(c5?.event_capture)}</span>
                </div>
              </article>
            )
          })}
        </div>
      </Section>

      <Section title="Five-seed stability">
        <p className="section-copy">
          Each row is the same Transformer trained from a different random initialization.
          No single seed dominates every year, which is why the production risk surface
          uses the five-model ensemble rather than selecting one lucky run.
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Seed</th><th>Best epoch</th>
              <th>2023 AP</th><th>2023 AUC</th>
              <th>2024 AP</th><th>2024 AUC</th>
              <th>2025 AP</th><th>2025 AUC</th>
            </tr></thead>
            <tbody>
              {seeds.map(s => (
                <tr key={s.seed}>
                  <td>{s.seed}</td><td>{s.best_epoch}</td>
                  <td>{fmt(s.ap_2023, 3)}</td><td>{fmt(s.auc_2023, 3)}</td>
                  <td>{fmt(s.ap_2024, 3)}</td><td>{fmt(s.auc_2024, 3)}</td>
                  <td>{fmt(s.ap_2025, 3)}</td><td>{fmt(s.auc_2025, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Predictor design">
        <div className="predictor-grid">
          <InfoCard title="Temporal channels">
            <ul className="clean-list">
              {design.weatherChannels.map(x => <li key={x}>{x}</li>)}
            </ul>
          </InfoCard>
          <InfoCard title="Static & historical context">
            <ul className="clean-list">
              {design.otherPredictors.map(x => <li key={x}>{x}</li>)}
            </ul>
            <div className="target-note">
              <b>Target</b><span>{design.target}</span>
            </div>
          </InfoCard>
        </div>
      </Section>

      <Section title="Interpretation">
        <div className="limitations">
          <p><b>Predicted Risk:</b> relative Alberta ranking of next-season wildfire hazard.</p>
          <p><b>Risk Confidence:</b> reproducibility of that ranking across the five Transformers.</p>
          <p><b>Observed Fire Impact:</b> retrospective NBAC burned fraction, shown only because 2024–2025 outcomes are now known.</p>
          <p><b>Not property-level loss:</b> underwriting requires exposure and vulnerability information in addition to hazard.</p>
        </div>
      </Section>
    </section>
  )
}

function InfoCard({ title, children }) {
  return <article className="info-card"><h3>{title}</h3>{children}</article>
}
function MetricRows({ rows }) {
  return <div className="metric-rows">{rows.map(([k,v]) => <div key={k}><span>{k}</span><b>{String(v)}</b></div>)}</div>
}
function Section({ title, children }) {
  return <section className="insight-section"><h3>{title}</h3>{children}</section>
}

function fit(map, bounds, year) {
  const [[west, south], [east, north]] = bounds[String(year)]
  map.fitBounds([[west, south], [east, north]], { padding: 34, duration: 400 })
}

function updateMap(map, year, layer, bounds) {
  const imageId = 'surface-image'
  const rasterLayer = 'surface-raster'
  const topSource = 'top10'
  const fillLayer = 'top10-fill'
  const lineLayer = 'top10-line'

  if (map.getLayer(lineLayer)) map.removeLayer(lineLayer)
  if (map.getLayer(fillLayer)) map.removeLayer(fillLayer)
  if (map.getSource(topSource)) map.removeSource(topSource)
  if (map.getLayer(rasterLayer)) map.removeLayer(rasterLayer)
  if (map.getSource(imageId)) map.removeSource(imageId)

  const [[west, south], [east, north]] = bounds[String(year)]
  const file =
    layer === 'risk'
      ? `risk_${year}.png`
      : layer === 'confidence'
      ? `confidence_${year}.png`
      : `impact_${year}.png`

  map.addSource(imageId, {
    type: 'image',
    url: `/data/${file}`,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
  })

  map.addLayer({
    id: rasterLayer,
    type: 'raster',
    source: imageId,
    paint: { 'raster-opacity': 0.74, 'raster-resampling': 'nearest' },
  })

  map.addSource(topSource, {
    type: 'geojson',
    data: `/data/top10_${year}.geojson`,
  })

  map.addLayer({
    id: fillLayer, type: 'fill', source: topSource,
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.01 },
  })
  map.addLayer({
    id: lineLayer, type: 'line', source: topSource,
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.18, 'line-width': 0.35 },
  })
}
