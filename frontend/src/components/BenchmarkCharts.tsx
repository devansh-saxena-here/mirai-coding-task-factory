import React, { useMemo, useState } from 'react';
import type {
  LeaderboardFailureBucket,
  LeaderboardModelEntry,
  Rate,
} from '../types/evaluation';

export interface ModelColorSpec {
  primary: string;
  secondary: string;
  providerLabel: string;
}

const FALLBACK_PALETTE: Array<{ primary: string; secondary: string }> = [
  { primary: '#7c3aed', secondary: '#c4b5fd' },
  { primary: '#0284c7', secondary: '#7dd3fc' },
  { primary: '#e11d48', secondary: '#fda4af' },
  { primary: '#2563eb', secondary: '#93c5fd' },
];

export function getModelColor(model: Pick<LeaderboardModelEntry, 'provider' | 'model_key'>, index: number): ModelColorSpec {
  if (model.provider === 'gemini') {
    return { primary: '#4f46e5', secondary: '#a5b4fc', providerLabel: 'Google Gemini' };
  }
  if (model.provider === 'groq') {
    return { primary: '#0d9488', secondary: '#5eead4', providerLabel: 'Groq' };
  }
  if (model.provider === 'adaption') {
    return { primary: '#d97706', secondary: '#fcd34d', providerLabel: 'Adaption AI' };
  }
  const fallback = FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
  return { ...fallback, providerLabel: 'External' };
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatFailureLabel(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

type RateMetricKey =
  | 'verified_success'
  | 'partial_score'
  | 'feature_pass'
  | 'regression_pass'
  | 'build_success';

const RATE_TABS: Array<{ key: RateMetricKey; label: string }> = [
  { key: 'verified_success', label: 'Verified Pass' },
  { key: 'partial_score', label: 'Partial Score' },
  { key: 'feature_pass', label: 'Feature Tests' },
  { key: 'regression_pass', label: 'Regression' },
  { key: 'build_success', label: 'Build' },
];

interface BenchmarkChartsProps {
  models: LeaderboardModelEntry[];
  failureBreakdown: LeaderboardFailureBucket[];
}

export const BenchmarkCharts: React.FC<BenchmarkChartsProps> = ({
  models,
  failureBreakdown,
}) => {
  const [rateMetric, setRateMetric] = useState<RateMetricKey>('verified_success');
  const [tokenView, setTokenView] = useState<'total' | 'avg'>('total');

  const colorMap = useMemo(() => {
    const map = new Map<string, ModelColorSpec>();
    models.forEach((m, idx) => map.set(m.model_key, getModelColor(m, idx)));
    return map;
  }, [models]);

  const modelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m) => map.set(m.model_key, m.display_name));
    return map;
  }, [models]);

  // Latency bounds
  const latencyEntries = useMemo(
    () =>
      models.map((m, idx) => ({
        model: m,
        color: getModelColor(m, idx),
        seconds: m.mean_agent_seconds,
      })),
    [models]
  );

  const latencyNumbers = latencyEntries
    .map((e) => e.seconds)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const maxLatency = latencyNumbers.length > 0 ? Math.max(...latencyNumbers) : 0;
  const minLatency = latencyNumbers.length > 0 ? Math.min(...latencyNumbers) : 0;

  // Token bounds
  const tokenEntries = useMemo(
    () =>
      models.map((m, idx) => {
        const denom = Math.max(1, m.scored || m.scheduled || 1);
        const inputVal =
          m.input_tokens_total === null
            ? null
            : tokenView === 'avg'
              ? Math.round(m.input_tokens_total / denom)
              : m.input_tokens_total;
        const outputVal =
          m.output_tokens_total === null
            ? null
            : tokenView === 'avg'
              ? Math.round(m.output_tokens_total / denom)
              : m.output_tokens_total;
        const totalVal =
          inputVal !== null || outputVal !== null ? (inputVal || 0) + (outputVal || 0) : null;
        return {
          model: m,
          color: getModelColor(m, idx),
          inputVal,
          outputVal,
          totalVal,
        };
      }),
    [models, tokenView]
  );

  const maxTokens = useMemo(() => {
    const totals = tokenEntries
      .map((e) => e.totalVal)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    return totals.length > 0 ? Math.max(...totals) : 0;
  }, [tokenEntries]);

  // Failure bounds
  const topFailures = useMemo(() => failureBreakdown.slice(0, 8), [failureBreakdown]);
  const maxFailureTotal = useMemo(
    () => (topFailures.length > 0 ? Math.max(...topFailures.map((f) => f.total)) : 0),
    [topFailures]
  );

  return (
    <div className="leaderboard-charts-grid">
      {/* 1. Pass Rate & Sub-Gate Bar Chart */}
      <section className="card leaderboard-chart-card" aria-label="Pass rate comparison chart">
        <div className="leaderboard-chart-header">
          <div>
            <h3>Pass Rate Comparison</h3>
            <p className="leaderboard-chart-subtitle">
              Percentage of scored trials passing across evaluated tasks · whisker shows 95% Wilson CI
            </p>
          </div>
          <div className="leaderboard-segmented" role="tablist" aria-label="Pass rate metric">
            {RATE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={rateMetric === tab.key}
                className={`leaderboard-seg-btn ${rateMetric === tab.key ? 'is-active' : ''}`}
                onClick={() => setRateMetric(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="leaderboard-bar-list">
          {models.map((model, idx) => {
            const color = getModelColor(model, idx);
            const isPartial = rateMetric === 'partial_score';
            const rate: Rate | null = isPartial ? null : model[rateMetric];
            const pct = isPartial
              ? typeof model.mean_partial_score === 'number'
                ? model.mean_partial_score * 100
                : null
              : rate && rate.value !== null
                ? rate.value * 100
                : null;
            const ciLow = rate?.wilson95 ? rate.wilson95[0] * 100 : null;
            const ciHigh = rate?.wilson95 ? rate.wilson95[1] * 100 : null;
            const totalCasePassed =
              (model.feature_cases_passed || 0) + (model.regression_cases_passed || 0);
            const totalCases =
              (model.feature_cases_total || 0) + (model.regression_cases_total || 0);

            return (
              <div key={model.model_key} className="leaderboard-bar-row">
                <div className="leaderboard-bar-row-head">
                  <div className="leaderboard-bar-label">
                    <span
                      className="leaderboard-swatch"
                      style={{ backgroundColor: color.primary }}
                      aria-hidden="true"
                    />
                    <span className="leaderboard-model-name">{model.display_name}</span>
                    <span className="leaderboard-model-meta">{color.providerLabel}</span>
                  </div>
                  <div className="leaderboard-bar-value">
                    {pct === null ? (
                      <span className="leaderboard-muted-val">Unscored</span>
                    ) : (
                      <>
                        <strong>{pct.toFixed(1)}%</strong>
                        <span className="leaderboard-sub-val">
                          {isPartial
                            ? totalCases > 0
                              ? `(${totalCasePassed}/${totalCases} cases)`
                              : '(granular)'
                            : `(${rate!.numerator}/${rate!.denominator})`}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="leaderboard-track" aria-hidden="true">
                  <div className="leaderboard-gridlines">
                    <span style={{ left: '25%' }} />
                    <span style={{ left: '50%' }} />
                    <span style={{ left: '75%' }} />
                  </div>
                  {pct !== null && (
                    <div
                      className="leaderboard-fill"
                      style={{
                        width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%`,
                        backgroundColor: color.primary,
                      }}
                    />
                  )}
                  {ciLow !== null && ciHigh !== null && (
                    <div
                      className="leaderboard-whisker"
                      style={{
                        left: `${ciLow}%`,
                        width: `${Math.max(0.8, ciHigh - ciLow)}%`,
                      }}
                      title={`95% Wilson CI: ${ciLow.toFixed(1)}% – ${ciHigh.toFixed(1)}%`}
                    />
                  )}
                </div>

                <div className="leaderboard-bar-foot">
                  <span>
                    {model.tasks_evaluated} {model.tasks_evaluated === 1 ? 'task' : 'tasks'} · {model.scored}/{model.scheduled} scored
                  </span>
                  {ciLow !== null && ciHigh !== null && (
                    <span>95% CI {ciLow.toFixed(0)}%–{ciHigh.toFixed(0)}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="leaderboard-axis" aria-hidden="true">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </section>

      {/* 2. Average Latency Bar Chart */}
      <section className="card leaderboard-chart-card" aria-label="Average latency comparison chart">
        <div className="leaderboard-chart-header">
          <div>
            <h3>Average Latency</h3>
            <p className="leaderboard-chart-subtitle">
              Weighted mean agent execution time per trial · lower is faster
            </p>
          </div>
        </div>

        {maxLatency <= 0 ? (
          <div className="leaderboard-chart-empty">
            No execution latency measurements recorded yet for the current filter selection.
          </div>
        ) : (
          <div className="leaderboard-bar-list">
            {latencyEntries.map(({ model, color, seconds }) => {
              const widthPct = seconds !== null && maxLatency > 0 ? (seconds / maxLatency) * 100 : 0;
              const ratio =
                seconds !== null && minLatency > 0 ? seconds / minLatency : null;

              return (
                <div key={model.model_key} className="leaderboard-bar-row">
                  <div className="leaderboard-bar-row-head">
                    <div className="leaderboard-bar-label">
                      <span
                        className="leaderboard-swatch"
                        style={{ backgroundColor: color.primary }}
                        aria-hidden="true"
                      />
                      <span className="leaderboard-model-name">{model.display_name}</span>
                    </div>
                    <div className="leaderboard-bar-value">
                      {seconds === null ? (
                        <span className="leaderboard-muted-val">Unavailable</span>
                      ) : (
                        <>
                          <strong>{seconds.toFixed(2)}s</strong>
                          {ratio !== null && (
                            <span className="leaderboard-sub-val">
                              {ratio <= 1.01 ? 'fastest' : `${ratio.toFixed(2)}x`}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="leaderboard-track" aria-hidden="true">
                    {seconds !== null && (
                      <div
                        className="leaderboard-fill"
                        style={{
                          width: `${Math.max(3, Math.min(100, widthPct))}%`,
                          backgroundColor: color.primary,
                        }}
                      />
                    )}
                  </div>

                  <div className="leaderboard-bar-foot">
                    <span className="leaderboard-mono-truncate">{model.model}</span>
                    <span>
                      {model.campaigns_count} {model.campaigns_count === 1 ? 'run' : 'runs'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Token Usage Stacked Bar Chart */}
      <section className="card leaderboard-chart-card" aria-label="Token usage comparison chart">
        <div className="leaderboard-chart-header">
          <div>
            <h3>Token Usage</h3>
            <p className="leaderboard-chart-subtitle">
              Input (solid) vs. output (tinted) token consumption per model
            </p>
          </div>
          <div className="leaderboard-segmented" role="tablist" aria-label="Token aggregation view">
            <button
              type="button"
              role="tab"
              aria-selected={tokenView === 'total'}
              className={`leaderboard-seg-btn ${tokenView === 'total' ? 'is-active' : ''}`}
              onClick={() => setTokenView('total')}
            >
              Total
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tokenView === 'avg'}
              className={`leaderboard-seg-btn ${tokenView === 'avg' ? 'is-active' : ''}`}
              onClick={() => setTokenView('avg')}
            >
              Avg / Trial
            </button>
          </div>
        </div>

        {maxTokens <= 0 ? (
          <div className="leaderboard-chart-empty">
            Token telemetry was not reported by providers for the selected campaigns.
          </div>
        ) : (
          <>
            <div className="leaderboard-bar-list">
              {tokenEntries.map(({ model, color, inputVal, outputVal, totalVal }) => {
                const inputPct =
                  inputVal !== null && maxTokens > 0 ? (inputVal / maxTokens) * 100 : 0;
                const outputPct =
                  outputVal !== null && maxTokens > 0 ? (outputVal / maxTokens) * 100 : 0;

                return (
                  <div key={model.model_key} className="leaderboard-bar-row">
                    <div className="leaderboard-bar-row-head">
                      <div className="leaderboard-bar-label">
                        <span
                          className="leaderboard-swatch"
                          style={{ backgroundColor: color.primary }}
                          aria-hidden="true"
                        />
                        <span className="leaderboard-model-name">{model.display_name}</span>
                      </div>
                      <div className="leaderboard-bar-value">
                        {totalVal === null ? (
                          <span className="leaderboard-muted-val">Unavailable</span>
                        ) : (
                          <strong>{formatTokens(totalVal)}</strong>
                        )}
                      </div>
                    </div>

                    <div className="leaderboard-track leaderboard-track--stacked" aria-hidden="true">
                      {inputVal !== null && inputVal > 0 && (
                        <div
                          className="leaderboard-stack-seg"
                          style={{
                            width: `${Math.max(1.5, inputPct)}%`,
                            backgroundColor: color.primary,
                          }}
                          title={`Input tokens: ${inputVal.toLocaleString()}`}
                        />
                      )}
                      {outputVal !== null && outputVal > 0 && (
                        <div
                          className="leaderboard-stack-seg"
                          style={{
                            width: `${Math.max(1.5, outputPct)}%`,
                            backgroundColor: color.secondary,
                          }}
                          title={`Output tokens: ${outputVal.toLocaleString()}`}
                        />
                      )}
                    </div>

                    <div className="leaderboard-bar-foot">
                      <span>
                        In {formatTokens(inputVal)} · Out {formatTokens(outputVal)}
                      </span>
                      {model.cost_usd_total !== null && (
                        <span>Est. ${model.cost_usd_total.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="leaderboard-legend">
              <span>
                <span className="leaderboard-swatch" style={{ backgroundColor: 'var(--text-primary)' }} />
                Solid bar: Input tokens
              </span>
              <span>
                <span className="leaderboard-swatch" style={{ backgroundColor: 'var(--border-strong)' }} />
                Lighter bar: Output tokens
              </span>
            </div>
          </>
        )}
      </section>

      {/* 4. Failure Categories Comparison Bar Chart */}
      <section className="card leaderboard-chart-card" aria-label="Failure categories comparison chart">
        <div className="leaderboard-chart-header">
          <div>
            <h3>Failure Categories</h3>
            <p className="leaderboard-chart-subtitle">
              Distribution of failure reasons segmented by model across evaluated trials
            </p>
          </div>
        </div>

        {topFailures.length === 0 ? (
          <div className="leaderboard-chart-empty">
            Zero failure categories recorded across the selected evaluation runs.
          </div>
        ) : (
          <>
            <div className="leaderboard-bar-list">
              {topFailures.map((bucket) => {
                const orderedSegments = models
                  .map((m) => ({
                    modelKey: m.model_key,
                    name: m.display_name,
                    count: bucket.by_model[m.model_key] || 0,
                    color: colorMap.get(m.model_key)?.primary || '#64748b',
                  }))
                  .filter((seg) => seg.count > 0);

                // Include any extra model key not in models list just in case
                for (const [mKey, count] of Object.entries(bucket.by_model)) {
                  if (count > 0 && !orderedSegments.some((s) => s.modelKey === mKey)) {
                    orderedSegments.push({
                      modelKey: mKey,
                      name: modelNameMap.get(mKey) || mKey,
                      count,
                      color: '#64748b',
                    });
                  }
                }

                return (
                  <div key={bucket.category} className="leaderboard-bar-row">
                    <div className="leaderboard-bar-row-head">
                      <div className="leaderboard-bar-label">
                        <span className="leaderboard-model-name">
                          {formatFailureLabel(bucket.category)}
                        </span>
                      </div>
                      <div className="leaderboard-bar-value">
                        <strong>{bucket.total}</strong>
                        <span className="leaderboard-sub-val">
                          {bucket.total === 1 ? 'trial' : 'trials'}
                        </span>
                      </div>
                    </div>

                    <div className="leaderboard-track leaderboard-track--stacked" aria-hidden="true">
                      {orderedSegments.map((seg) => {
                        const widthPct = maxFailureTotal > 0 ? (seg.count / maxFailureTotal) * 100 : 0;
                        return (
                          <div
                            key={seg.modelKey}
                            className="leaderboard-stack-seg"
                            style={{
                              width: `${Math.max(2, widthPct)}%`,
                              backgroundColor: seg.color,
                            }}
                            title={`${seg.name}: ${seg.count}`}
                          />
                        );
                      })}
                    </div>

                    <div className="leaderboard-bar-foot">
                      <span>
                        {orderedSegments
                          .map((seg) => `${seg.name}: ${seg.count}`)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="leaderboard-legend">
              {models.map((m, idx) => {
                const color = getModelColor(m, idx);
                return (
                  <span key={m.model_key}>
                    <span className="leaderboard-swatch" style={{ backgroundColor: color.primary }} />
                    {m.display_name}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
};
