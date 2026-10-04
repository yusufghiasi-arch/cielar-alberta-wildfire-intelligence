import { useEffect, useMemo, useRef, useState } from 'react'
import { Map, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import './styles.css'

setWorkerUrl(workerUrl)

const fmt = (v, d = 3) =>
  v === undefined || v === null || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toFixed(d)

const pct = v => `${(Number(v) * 100).toFixed(1)}%`

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
          year={year}
          setYear={setYear}
          layer={layer}
          setLayer={setLayer}
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
          id: 'osm',
          type: 'raster',
          source: 'osm',
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
      map.fitBounds(
        [
          [bounds[String(year)][0][0], bounds[String(year)][0][1]],
          [bounds[String(year)][1][0], bounds[String(year)][1][1]],
        ],
        { padding: 34, duration: 0 }
      )

      map.on('click', 'top10-fill', e => {
        if (!e.features?.length) return
        const p = e.features[0].properties || {}
        popupRef.current?.remove()
        popupRef.current = new Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="popup">
              <strong>High-risk cell</strong>
              <div><span>Risk percentile</span><b>${fmt(p.risk_percentile, 1)}</b></div>
              <div><span>Risk band</span><b>${p.risk_band ?? '—'}</b></div>
              <div><span>Model agreement</span><b>${p.model_agreement ?? '—'}</b></div>
              <div><span>Observed burn</span><b>${fmt(Number(p.target_burnfrac) * 100, 1)}%</b></div>
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
      mapRef.current.fitBounds(
        [
          [bounds[String(year)][0][0], bounds[String(year)][0][1]],
          [bounds[String(year)][1][0], bounds[String(year)][1][1]],
        ],
        { padding: 34, duration: 500 }
      )
    }
  }, [year, layer, bounds])

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
            Risk percentile
          </button>
          <button className={layer === 'agreement' ? 'active' : ''} onClick={() => setLayer('agreement')}>
            Model agreement
          </button>
        </div>

        {layer === 'risk' ? <RiskLegend /> : <AgreementLegend />}

        <div className="callout">
          <strong>Portfolio screening</strong>
          <p>
            Use the relative-risk surface to identify geographic concentration,
            prioritize review, and compare portfolio exposure across Alberta.
          </p>
        </div>
        <div className="warning">
          Relative risk percentile is <b>not</b> a calibrated annual wildfire probability.
        </div>
      </aside>

      <div className="map-wrap">
        <div ref={mapNode} className="map" />
        <div className="map-badge">
          <b>{year}</b>
          <span>{layer === 'risk' ? 'Relative wildfire risk' : 'Transformer agreement'}</span>
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
  return (
    <>
      <h3>Relative risk bands</h3>
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

function AgreementLegend() {
  return (
    <>
      <h3>Model agreement</h3>
      <div className="legend">
        <div className="legend-row"><span className="swatch agree-high"/><span>High agreement</span><b>0–50</b></div>
        <div className="legend-row"><span className="swatch agree-mid"/><span>Moderate</span><b>50–80</b></div>
        <div className="legend-row"><span className="swatch agree-low"/><span>Low agreement</span><b>80–100</b></div>
      </div>
    </>
  )
}

function Insights({ data }) {
  if (!data) return <div className="loading">Loading model diagnostics…</div>

  const ens = data.ensembleMetrics || []
  const captures = data.capture || []
  const seeds = data.seeds || []
  const xgb = data.xgboost || []
  const arch = data.architecture
  const design = data.dataDesign

  return (
    <section className="insights">
      <div className="insights-intro">
        <div>
          <div className="section-kicker">MODEL CARD</div>
          <h2>Temporal Transformer ensemble</h2>
          <p>
            Five independently initialized models learn 24-month antecedent
            weather sequences and fuse them with fire history, fuel and terrain
            information. The ensemble mean provides the risk ranking; seed-to-seed
            spread provides model-disagreement information.
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
            <thead>
              <tr>
                <th>Year</th><th>Role</th><th>Prevalence</th>
                <th>AP</th><th>ROC-AUC</th><th>Mean seed spread</th>
              </tr>
            </thead>
            <tbody>
              {ens.map(r => (
                <tr key={r.target_year}>
                  <td>{r.target_year}</td>
                  <td>{r.temporal_split}</td>
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
          Variation across seeds quantifies training instability and motivates the ensemble.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Seed</th><th>Best epoch</th>
                <th>2023 AP</th><th>2023 AUC</th>
                <th>2024 AP</th><th>2024 AUC</th>
                <th>2025 AP</th><th>2025 AUC</th>
              </tr>
            </thead>
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

      {xgb.length > 0 && (
        <Section title="Transformer ensemble vs XGBoost baseline">
          <div className="compare-grid">
            {[2023, 2024, 2025].map(y => {
              const e = ens.find(x => Number(x.target_year) === y)
              const x = xgb.find(r => Number(r.target_year) === y)
              return (
                <article className="compare-card" key={y}>
                  <h4>{y}</h4>
                  <CompareBar label="Transformer AUC" value={Number(e?.roc_auc)} max={1}/>
                  <CompareBar label="XGBoost AUC" value={Number(x?.roc_auc)} max={1}/>
                  <div className="compare-ap">
                    <span>AP</span>
                    <b>{fmt(e?.average_precision, 3)} vs {fmt(x?.average_precision, 3)}</b>
                  </div>
                </article>
              )
            })}
          </div>
        </Section>
      )}

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
              <b>Target</b>
              <span>{design.target}</span>
            </div>
          </InfoCard>
        </div>
      </Section>

      <Section title="Interpretation & limitations">
        <div className="limitations">
          <p><b>Relative risk, not literal probability.</b> Phase 4 showed that 2023-based probability calibration transferred poorly to lower-prevalence 2024–2025 seasons.</p>
          <p><b>2025 is the harder year.</b> Skill remains positive, but lower than 2024, highlighting interannual domain shift.</p>
          <p><b>Current use:</b> portfolio screening, geographic accumulation management and prioritization. Property-level underwriting requires exposure/vulnerability information.</p>
          <p><b>Benchmark discipline:</b> 2024–2025 are retrospective Benchmark-v1 test years. Future architecture tuning should be validated on a newly labelled season rather than repeatedly optimizing to these years.</p>
        </div>
      </Section>
    </section>
  )
}

function InfoCard({ title, children }) {
  return <article className="info-card"><h3>{title}</h3>{children}</article>
}

function MetricRows({ rows }) {
  return (
    <div className="metric-rows">
      {rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{String(v)}</b></div>)}
    </div>
  )
}

function Section({ title, children }) {
  return <section className="insight-section"><h3>{title}</h3>{children}</section>
}

function CompareBar({ label, value }) {
  return (
    <div className="compare-bar">
      <div><span>{label}</span><b>{fmt(value, 3)}</b></div>
      <div className="track"><div className="fill" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>
    </div>
  )
}

function updateMap(map, year, layer, bounds) {
  const imageId = 'risk-image'
  const rasterLayer = 'risk-raster'
  const topSource = 'top10'
  const fillLayer = 'top10-fill'
  const lineLayer = 'top10-line'

  if (map.getLayer(lineLayer)) map.removeLayer(lineLayer)
  if (map.getLayer(fillLayer)) map.removeLayer(fillLayer)
  if (map.getSource(topSource)) map.removeSource(topSource)
  if (map.getLayer(rasterLayer)) map.removeLayer(rasterLayer)
  if (map.getSource(imageId)) map.removeSource(imageId)

  const [[west, south], [east, north]] = bounds[String(year)]

  map.addSource(imageId, {
    type: 'image',
    url: `/data/${layer === 'risk' ? 'risk' : 'disagreement'}_${year}.png`,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
  })
  map.addLayer({
    id: rasterLayer,
    type: 'raster',
    source: imageId,
    paint: { 'raster-opacity': 0.72, 'raster-resampling': 'nearest' },
  })

  map.addSource(topSource, { type: 'geojson', data: `/data/top10_${year}.geojson` })
  map.addLayer({
    id: fillLayer,
    type: 'fill',
    source: topSource,
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.01 },
  })
  map.addLayer({
    id: lineLayer,
    type: 'line',
    source: topSource,
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.22, 'line-width': 0.4 },
  })
}
