import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Download,
  RefreshCw,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  BenchmarkCharts,
  formatFailureLabel,
  formatTokens,
  getModelColor,
} from '../components/BenchmarkCharts';
import { useProject } from '../context/ProjectContext';
import { workflow } from '../services/workflowService';
import type {
  LeaderboardResponse,
  LeaderboardScope,
  Rate,
} from '../types/evaluation';

function formatPercent(rate: Rate): string {
  if (rate.value === null) return '–';
  return `${(rate.value * 100).toFixed(1)}%`;
}

function formatDateShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '–';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectTask } = useProject();

  const [scope, setScope] = useState<LeaderboardScope>('latest_per_task');
  const [language, setLanguage] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [category, setCategory] = useState('');

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('scope', scope);
    if (language) params.set('language', language);
    if (difficulty) params.set('difficulty', difficulty);
    if (category) params.set('category', category);
    return params;
  }, [scope, language, difficulty, category]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    workflow
      .leaderboard(queryParams, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setData(res);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError((err as Error).message || 'Failed to load model leaderboard.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [queryParams, reloadCounter]);

  const hasActiveFilters = Boolean(language || difficulty || category);

  const handleResetFilters = useCallback(() => {
    setLanguage('');
    setDifficulty('');
    setCategory('');
  }, []);

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const qs = queryParams.toString();
      await workflow.download('/evaluation/leaderboard.csv' + (qs ? `?${qs}` : ''));
    } catch (err) {
      setError((err as Error).message || 'Could not export leaderboard CSV.');
    } finally {
      setExporting(false);
    }
  };

  const handleInspectTask = (taskId: string) => {
    selectTask(taskId);
    navigate('/evaluation');
  };

  const hasEvaluations = Boolean(data && data.models.length > 0);

  return (
    <div className="leaderboard-page">
      <PageHeader
        title="Model Leaderboard & Benchmark Analytics"
        description="Aggregate pass rates, execution latency, token efficiency, and failure categories across all evaluated tasks in your workspace."
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReloadCounter((n) => n + 1)}
              disabled={loading}
            >
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleExportCsv()}
              disabled={!hasEvaluations || exporting}
            >
              <Download size={14} />
              <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
            </button>
          </>
        }
      />

      {/* Filter & Scope Toolbar */}
      <section className="card leaderboard-toolbar" aria-label="Leaderboard filters">
        <div className="leaderboard-toolbar-group">
          <span className="leaderboard-toolbar-label">Aggregation</span>
          <div className="leaderboard-segmented" role="tablist" aria-label="Aggregation scope">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'latest_per_task'}
              className={`leaderboard-seg-btn ${scope === 'latest_per_task' ? 'is-active' : ''}`}
              onClick={() => setScope('latest_per_task')}
            >
              Latest per task
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all_runs'}
              className={`leaderboard-seg-btn ${scope === 'all_runs' ? 'is-active' : ''}`}
              onClick={() => setScope('all_runs')}
            >
              All runs
            </button>
          </div>
        </div>

        <div className="leaderboard-toolbar-filters">
          <label className="leaderboard-select-wrap">
            <span>Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Filter by language"
            >
              <option value="">All languages</option>
              {(data?.available_filters.languages || []).map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </label>

          <label className="leaderboard-select-wrap">
            <span>Difficulty</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              aria-label="Filter by difficulty"
            >
              <option value="">All difficulties</option>
              {(data?.available_filters.difficulties || []).map((diff) => (
                <option key={diff} value={diff}>
                  {diff}
                </option>
              ))}
            </select>
          </label>

          <label className="leaderboard-select-wrap">
            <span>Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {(data?.available_filters.categories || []).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-subtle"
              onClick={handleResetFilters}
              style={{ padding: '6px 10px', fontSize: '12px' }}
            >
              <RotateCcw size={13} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="card workflow-panel" role="alert">
          <div className="workflow-row workflow-spread">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReloadCounter((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !data && (
        <div className="leaderboard-skeleton-stack" aria-busy="true" aria-label="Loading benchmark analytics">
          <div className="card leaderboard-kpi-strip">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="leaderboard-kpi-cell">
                <div className="leaderboard-skel-line" style={{ width: '55%', height: '11px' }} />
                <div className="leaderboard-skel-line" style={{ width: '72%', height: '24px', marginTop: '8px' }} />
                <div className="leaderboard-skel-line" style={{ width: '64%', height: '11px', marginTop: '6px' }} />
              </div>
            ))}
          </div>
          <div className="leaderboard-charts-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card leaderboard-chart-card">
                <div className="leaderboard-skel-line" style={{ width: '44%', height: '15px' }} />
                <div className="leaderboard-skel-line" style={{ width: '100%', height: '14px', marginTop: '18px' }} />
                <div className="leaderboard-skel-line" style={{ width: '84%', height: '14px', marginTop: '12px' }} />
                <div className="leaderboard-skel-line" style={{ width: '68%', height: '14px', marginTop: '12px' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && data && !hasEvaluations && (
        <section className="card leaderboard-empty-state">
          <div className="leaderboard-empty-icon">
            <Trophy size={24} />
          </div>
          <h2>
            {hasActiveFilters
              ? 'No evaluation campaigns match these filters'
              : 'No multi-model evaluations recorded yet'}
          </h2>
          <p>
            {hasActiveFilters
              ? 'Clear or broaden your language, difficulty, or category filters to inspect benchmark results.'
              : 'Run at least one Stage 5 live agent evaluation (Gemini, GPT-OSS 120B, Qwen 3.5 397B) on any validated task to populate cross-task pass rates, latency, token usage, and failure charts.'}
          </p>
          <div className="workflow-row" style={{ justifyContent: 'center', marginTop: '6px' }}>
            {hasActiveFilters ? (
              <button type="button" className="btn btn-primary" onClick={handleResetFilters}>
                Clear filters
              </button>
            ) : (
              <Link to="/evaluation" className="btn btn-primary">
                Go to Agent Evaluation
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Populated Leaderboard */}
      {data && hasEvaluations && (
        <>
          {/* 4-Column KPI Summary Strip */}
          <section className="card leaderboard-kpi-strip" aria-label="Benchmark summary">
            <div className="leaderboard-kpi-cell">
              <span className="leaderboard-kpi-label">Evaluated Tasks</span>
              <strong className="leaderboard-kpi-value">{data.summary.tasks_evaluated}</strong>
              <span className="leaderboard-kpi-sub">
                {data.summary.campaigns_count}{' '}
                {data.summary.campaigns_count === 1 ? 'campaign' : 'campaigns'} ·{' '}
                {data.models.length} {data.models.length === 1 ? 'model' : 'models'}
              </span>
            </div>

            <div className="leaderboard-kpi-cell">
              <span className="leaderboard-kpi-label">Leading Model</span>
              <strong className="leaderboard-kpi-value">
                {data.summary.leading_model?.display_name || '–'}
              </strong>
              <span className="leaderboard-kpi-sub">
                {data.summary.leading_model?.pass_rate !== null &&
                data.summary.leading_model?.pass_rate !== undefined
                  ? `${(data.summary.leading_model.pass_rate * 100).toFixed(1)}% verified pass`
                  : 'Awaiting scored trials'}
              </span>
            </div>

            <div className="leaderboard-kpi-cell">
              <span className="leaderboard-kpi-label">Scored Trials</span>
              <strong className="leaderboard-kpi-value">
                {data.summary.total_trials_passed} / {data.summary.total_trials_scored}
              </strong>
              <span className="leaderboard-kpi-sub">
                {data.summary.overall_pass_rate !== null
                  ? `${(data.summary.overall_pass_rate * 100).toFixed(1)}% aggregate pass`
                  : `${data.summary.total_trials_scheduled} scheduled`}
              </span>
            </div>

            <div className="leaderboard-kpi-cell">
              <span className="leaderboard-kpi-label">Fastest Average Model</span>
              <strong className="leaderboard-kpi-value">
                {data.summary.fastest_model
                  ? `${data.summary.fastest_model.mean_agent_seconds.toFixed(2)}s`
                  : '–'}
              </strong>
              <span className="leaderboard-kpi-sub">
                {data.summary.fastest_model
                  ? data.summary.fastest_model.display_name
                  : 'No latency data'}
              </span>
            </div>
          </section>

          {/* 4 Visual Comparison Bar Charts */}
          <BenchmarkCharts
            models={data.models}
            failureBreakdown={data.failure_breakdown}
          />

          {/* Overall Model Rankings Table */}
          <section className="card leaderboard-table-card" aria-label="Overall model rankings">
            <div className="leaderboard-section-head">
              <div>
                <h2>Overall Model Rankings</h2>
                <p>
                  Ranked by verified pass rate, feature pass rate, and average latency across{' '}
                  {data.summary.tasks_evaluated}{' '}
                  {data.summary.tasks_evaluated === 1 ? 'task' : 'tasks'}.
                </p>
              </div>
            </div>

            <div className="table-scroll-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th style={{ width: '56px' }}>Rank</th>
                    <th>Model</th>
                    <th className="num">Tasks</th>
                    <th className="num">Scored</th>
                    <th className="num">Verified Pass</th>
                    <th className="num">Partial Score</th>
                    <th className="num">95% CI</th>
                    <th className="num">Feature</th>
                    <th className="num">Regression</th>
                    <th className="num">Build</th>
                    <th className="num">Avg Latency</th>
                    <th className="num">Tokens (In / Out)</th>
                    <th>Primary Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m, idx) => {
                    const color = getModelColor(m, idx);
                    const ciText = m.verified_success.wilson95
                      ? `${(m.verified_success.wilson95[0] * 100).toFixed(0)}%–${(
                          m.verified_success.wilson95[1] * 100
                        ).toFixed(0)}%`
                      : '–';

                    return (
                      <tr key={m.model_key}>
                        <td className="num leaderboard-rank">#{idx + 1}</td>
                        <td>
                          <div className="leaderboard-table-model">
                            <span
                              className="leaderboard-swatch"
                              style={{ backgroundColor: color.primary }}
                              aria-hidden="true"
                            />
                            <div style={{ minWidth: 0 }}>
                              <div className="leaderboard-model-name">{m.display_name}</div>
                              <div className="leaderboard-model-id">{m.model}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num">{m.tasks_evaluated}</td>
                        <td className="num">
                          {m.scored}/{m.scheduled}
                        </td>
                        <td className="num leaderboard-strong-cell">
                          {formatPercent(m.verified_success)}
                          {m.verified_success.denominator > 0 && (
                            <span className="leaderboard-cell-sub">
                              {' '}
                              ({m.verified_success.numerator}/{m.verified_success.denominator})
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {typeof m.mean_partial_score === 'number' ? (
                            <>
                              <strong>{(m.mean_partial_score * 100).toFixed(1)}%</strong>
                              {typeof m.feature_cases_total === 'number' && m.feature_cases_total > 0 && (
                                <span className="leaderboard-cell-sub">
                                  {' '}
                                  ({m.feature_cases_passed ?? 0}/{m.feature_cases_total} feat)
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="leaderboard-muted-cell">–</span>
                          )}
                        </td>
                        <td className="num leaderboard-muted-cell">{ciText}</td>
                        <td className="num">{formatPercent(m.feature_pass)}</td>
                        <td className="num">{formatPercent(m.regression_pass)}</td>
                        <td className="num">{formatPercent(m.build_success)}</td>
                        <td className="num">
                          {m.mean_agent_seconds === null ? '–' : `${m.mean_agent_seconds.toFixed(2)}s`}
                        </td>
                        <td className="num leaderboard-muted-cell">
                          {formatTokens(m.input_tokens_total)} / {formatTokens(m.output_tokens_total)}
                        </td>
                        <td className="leaderboard-failure-cell">
                          {m.top_failure ? formatFailureLabel(m.top_failure) : 'None'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-Task Comparison Matrix */}
          <section className="card leaderboard-table-card" aria-label="Per-task evaluation matrix">
            <div className="leaderboard-section-head">
              <div>
                <h2>Per-Task Benchmark Matrix</h2>
                <p>
                  Compare model outcomes task by task. Select any task to open its full trial logs and verifier evidence.
                </p>
              </div>
            </div>

            <div className="table-scroll-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Metadata</th>
                    {data.models.map((m, idx) => {
                      const color = getModelColor(m, idx);
                      return (
                        <th key={m.model_key} className="num">
                          <span className="leaderboard-th-model">
                            <span
                              className="leaderboard-swatch"
                              style={{ backgroundColor: color.primary }}
                              aria-hidden="true"
                            />
                            {m.display_name}
                          </span>
                        </th>
                      );
                    })}
                    <th className="num">Evaluated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.task_matrix.map((row) => (
                    <tr key={`${row.task_id}-${row.evaluation_id}`}>
                      <td>
                        <button
                          type="button"
                          className="leaderboard-task-link"
                          onClick={() => handleInspectTask(row.task_id)}
                        >
                          <span>{row.task_title}</span>
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                      </td>
                      <td className="leaderboard-muted-cell">
                        {row.project_name} · {row.language} · {row.difficulty}
                      </td>
                      {data.models.map((m) => {
                        const cell = row.models[m.model_key];
                        if (!cell) {
                          return (
                            <td key={m.model_key} className="num leaderboard-muted-cell">
                              –
                            </td>
                          );
                        }
                        const rateColor =
                          cell.pass_rate === null
                            ? 'var(--text-muted)'
                            : cell.pass_rate >= 0.99
                              ? 'var(--success-text)'
                              : cell.pass_rate > 0
                                ? 'var(--warning-text)'
                                : 'var(--danger-text)';
                        return (
                          <td key={m.model_key} className="num">
                            <div style={{ fontWeight: 600, color: rateColor }}>
                              {cell.pass_rate === null
                                ? cell.top_failure
                                  ? formatFailureLabel(cell.top_failure)
                                  : 'Unscored'
                                : `${(cell.pass_rate * 100).toFixed(0)}% (${cell.passed}/${cell.scored})`}
                            </div>
                            <div className="leaderboard-cell-sub">
                              {cell.mean_agent_seconds !== null ? `${cell.mean_agent_seconds.toFixed(1)}s` : '–'}
                              {cell.total_tokens !== null ? ` · ${formatTokens(cell.total_tokens)} tok` : ''}
                            </div>
                          </td>
                        );
                      })}
                      <td className="num leaderboard-muted-cell">
                        {formatDateShort(row.evaluated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
