import type { BenchmarkMetrics, Trial } from '../../types/evaluation';

export const formatBenchmarkRate = (rate: BenchmarkMetrics['verified_success']) =>
  rate.value === null
    ? 'Unavailable'
    : `${(100 * rate.value).toFixed(1)}% (${rate.numerator}/${rate.denominator})`;

interface ComparisonMatrixTableProps {
  metrics: BenchmarkMetrics[];
  trials: Trial[];
}

export function ComparisonMatrixTable({ metrics, trials }: ComparisonMatrixTableProps) {
  if (metrics.length === 0) return null;

  return (
    <div
      className="table-scroll-wrap"
      style={{ borderTop: '1px solid var(--border-default)', paddingTop: '14px' }}
    >
      <h3 style={{ marginBottom: '10px' }}>Head-to-head model comparison</h3>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12.5px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--border-strong)',
              color: 'var(--text-muted)',
              textAlign: 'left',
            }}
          >
            <th style={{ padding: '8px 10px', fontWeight: 600 }}>Agent</th>
            <th style={{ padding: '8px 10px', fontWeight: 600 }}>Model ID</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Scored</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Verified pass</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Feature cases</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Regression cases</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Partial score</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Mean latency</th>
            <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Tokens (in / out)</th>
            <th style={{ padding: '8px 10px', fontWeight: 600 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const matchedTrial = trials.find((t) => t.label === metric.label);
            const modelDisplay =
              metric.model ||
              matchedTrial?.configuration?.model ||
              matchedTrial?.resolved_models[0] ||
              '–';
            const unavailableCount = metric.failure_counts.provider_unavailable || 0;
            const errorCount = metric.failure_counts.provider_error || 0;
            const statusLabel =
              metric.scored > 0
                ? metric.verified_success.value === 1
                  ? 'Passed'
                  : 'Evaluated'
                : unavailableCount > 0
                  ? 'Key required'
                  : errorCount > 0
                    ? 'Provider error'
                    : 'Unscored';
            const statusColor =
              metric.scored > 0
                ? 'var(--success-text)'
                : unavailableCount > 0
                  ? 'var(--warning-text)'
                  : 'var(--danger-text)';
            const featCasesText =
              typeof metric.feature_cases_total === 'number' && metric.feature_cases_total > 0
                ? `${metric.feature_cases_passed ?? 0}/${metric.feature_cases_total}`
                : '–';
            const regCasesText =
              typeof metric.regression_cases_total === 'number' && metric.regression_cases_total > 0
                ? `${metric.regression_cases_passed ?? 0}/${metric.regression_cases_total}`
                : '–';
            const partialPct =
              typeof metric.mean_partial_score === 'number'
                ? metric.mean_partial_score * 100
                : null;

            return (
              <tr
                key={metric.label}
                style={{
                  borderBottom: '1px solid var(--border-default)',
                  height: '42px',
                }}
              >
                <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {metric.label}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {modelDisplay}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {metric.scored}/{metric.scheduled}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatBenchmarkRate(metric.verified_success)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {featCasesText}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {regCasesText}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {partialPct === null ? (
                    <span style={{ color: 'var(--text-muted)' }}>–</span>
                  ) : (
                    <div className="eval-mini-bar-cell">
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {partialPct.toFixed(1)}%
                      </span>
                      <div className="eval-mini-bar-track" aria-hidden="true">
                        <div
                          className="eval-mini-bar-fill"
                          style={{
                            width: `${Math.max(partialPct > 0 ? 4 : 0, Math.min(100, partialPct))}%`,
                            backgroundColor:
                              partialPct >= 99.9
                                ? 'var(--success)'
                                : partialPct > 0
                                  ? 'var(--accent-primary)'
                                  : 'var(--danger)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {metric.mean_agent_seconds === null ? '–' : `${metric.mean_agent_seconds.toFixed(2)} s`}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {metric.input_tokens_total ?? '–'} / {metric.output_tokens_total ?? '–'}
                </td>
                <td style={{ padding: '8px 10px', fontWeight: 500, color: statusColor }}>
                  {statusLabel}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
