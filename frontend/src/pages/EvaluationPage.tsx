import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, RotateCcw, ShieldCheck, Trophy } from 'lucide-react';
import { AgentProgressBar } from '../components/AgentProgressBar';
import { EvidenceHistory } from '../components/EvidenceHistory';
import { EvidenceLog } from '../components/EvidenceLog';
import {
  findModelSpec,
  MODEL_PRESETS_BY_SLOT,
  ModelInfoTooltip,
} from '../components/ModelInfoTooltip';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useProject } from '../context/ProjectContext';
import { workflow } from '../services/workflowService';
import { isActive } from '../types/workflow';
import type {
  BenchmarkMetrics,
  EvaluationProvidersStatus,
  EvaluationReport,
  SuiteBreakdown,
  Trial,
} from '../types/evaluation';

interface ModelSlot {
  id: 'gemini' | 'gpt_oss' | 'qwen';
  label: string;
  displayName: string;
  family: string;
  provider: 'gemini' | 'groq' | 'adaption';
  enabled: boolean;
  model: string;
  placeholder: string;
  customMode?: boolean;
}

const DEFAULT_SLOTS: ModelSlot[] = [
  {
    id: 'gemini',
    label: 'gemini',
    displayName: 'Gemini',
    family: 'Google Gemini',
    provider: 'gemini',
    enabled: true,
    model: 'gemini/gemini-4-hydrogen',
    placeholder: 'gemini/gemini-4-hydrogen',
  },
  {
    id: 'gpt_oss',
    label: 'gpt-oss-120b',
    displayName: 'GPT-OSS 120B',
    family: 'OpenAI Open-Weight · Groq',
    provider: 'groq',
    enabled: true,
    model: 'groq/openai/gpt-oss-120b',
    placeholder: 'groq/openai/gpt-oss-120b',
  },
  {
    id: 'qwen',
    label: 'qwen',
    displayName: 'Qwen 3.5 397B',
    family: 'Alibaba Qwen · Adaption AI',
    provider: 'adaption',
    enabled: true,
    model: 'adaption/qwen3.5-397b',
    placeholder: 'adaption/qwen3.5-397b',
  },
];

const MAX_CAMPAIGN_TRIALS = 9;

const displayRate = (rate: BenchmarkMetrics['verified_success']) =>
  rate.value === null
    ? 'Unavailable'
    : `${(100 * rate.value).toFixed(1)}% (${rate.numerator}/${rate.denominator})`;

function normalizeModelId(raw: string): string {
  const trimmed = raw.trim();
  if (/^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,89}$/.test(trimmed)) {
    return `gemini/${trimmed}`;
  }
  if (/^(?:qwen3\.5-|qwen-SEA-LION-)[A-Za-z0-9._-]{1,89}$/i.test(trimmed)) {
    return `adaption/${trimmed}`;
  }
  return trimmed;
}

function isValidModelId(raw: string): boolean {
  const normalized = normalizeModelId(raw);
  if (/^(?:gemini|openai)\/[A-Za-z0-9][A-Za-z0-9._-]{0,89}$/.test(normalized)) {
    return true;
  }
  if (/^(?:groq|adaption)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(normalized)) {
    return true;
  }
  if (/^huggingface\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?::[A-Za-z0-9_-]{1,40})?$/.test(normalized)) {
    return true;
  }
  return false;
}

function inferProvider(modelId: string): 'gemini' | 'groq' | 'adaption' | 'other' {
  const lower = normalizeModelId(modelId).toLowerCase();
  if (lower.startsWith('gemini/')) return 'gemini';
  if (lower.startsWith('groq/')) return 'groq';
  if (lower.startsWith('adaption/')) return 'adaption';
  return 'other';
}

function SuiteCaseList({ title, suite }: { title: string; suite: SuiteBreakdown }) {
  if (suite.total === 0 && suite.cases.length === 0) return null;
  const pct = suite.pass_rate !== null ? `${(suite.pass_rate * 100).toFixed(0)}%` : '–';
  return (
    <div className="eval-breakdown-suite">
      <div className="eval-breakdown-suite-head">
        <span>{title}</span>
        <span className="eval-breakdown-counts">
          {suite.passed}/{suite.total} passed ({pct})
          {suite.failed > 0 ? ` · ${suite.failed} failed` : ''}
          {suite.errors > 0 ? ` · ${suite.errors} errors` : ''}
          {suite.skipped > 0 ? ` · ${suite.skipped} skipped` : ''}
        </span>
      </div>
      {suite.cases.length > 0 && (
        <ul className="eval-case-list">
          {suite.cases.map((tc) => (
            <li key={`${tc.kind}-${tc.name}`} className="eval-case-row">
              <span className={`eval-case-status eval-case-status--${tc.status}`}>
                {tc.status.toUpperCase()}
              </span>
              <code className="eval-case-name">{tc.name}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrialEvidence({ trial, id }: { trial: Trial; id: string }) {
  const tb = trial.test_breakdown;
  const featChip = tb && tb.feature.total > 0 ? `Feature ${tb.feature.passed}/${tb.feature.total}` : null;
  const regChip = tb && tb.regression.total > 0 ? `Regression ${tb.regression.passed}/${tb.regression.total}` : null;
  const partialChip =
    tb && tb.partial_score !== null ? `Partial ${(tb.partial_score * 100).toFixed(0)}%` : null;

  return (
    <details className="history-row">
      <summary>
        {trial.role} · {trial.label} · Run {trial.attempt} ·{' '}
        {trial.reward === null ? 'Unscored' : `Reward ${trial.reward}`}
        {featChip ? ` · ${featChip}` : ''}
        {regChip ? ` · ${regChip}` : ''}
        {partialChip ? ` · ${partialChip}` : ''}
        {trial.failure ? ` · ${trial.failure.replace(/_/g, ' ')}` : ''}
      </summary>
      <div className="workflow-panel">
        <p>
          {trial.origin === 'harbor' ? 'Isolated sandbox verifier evidence' : 'Unscored provider/sandbox event'} ·{' '}
          {trial.trustworthy ? 'Verified execution' : 'Unscored evidence'}
        </p>
        {trial.configuration && (
          <p>
            Model <code className="code-inline">{trial.configuration.model}</code>
          </p>
        )}
        {trial.requested_model && trial.requested_model !== trial.configuration?.model && (
          <p>Requested {trial.requested_model}</p>
        )}
        {trial.failure && <p>Failure category: {trial.failure.replace(/_/g, ' ')}</p>}

        {tb && (
          <div className="eval-breakdown-box">
            <div className="eval-breakdown-summary">
              <span>
                <strong>Granular Test Breakdown</strong>
                {tb.partial_score !== null ? ` · Partial score ${(tb.partial_score * 100).toFixed(1)}%` : ''}
              </span>
              <span
                style={{
                  color: tb.protected_guard_passed ? 'var(--success-text)' : 'var(--danger-text)',
                  fontWeight: 500,
                }}
              >
                {tb.protected_guard_passed
                  ? 'Protected-test guard passed'
                  : `Protected test modified: ${tb.protected_files_touched.join(', ')}`}
              </span>
            </div>
            <SuiteCaseList title="Feature Tests" suite={tb.feature} />
            <SuiteCaseList title="Regression Tests" suite={tb.regression} />
          </div>
        )}

        {trial.agent_name && (
          <p>
            {trial.agent_name} {trial.agent_version}
            {trial.resolved_models.length > 0 ? ` · ${trial.resolved_models.join(', ')}` : ''}
          </p>
        )}
        {trial.flags.length > 0 && (
          <ul>
            {trial.flags.map((flag) => (
              <li key={flag}>{flag.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        )}
        {trial.process && (
          <>
            <p>
              {trial.process.timed_out
                ? 'Timed out'
                : trial.process.exit_code === null
                  ? 'No exit code'
                  : `Exit ${trial.process.exit_code}`}
            </p>
            <pre className="evidence-command">{trial.process.argv.join(' ')}</pre>
            {trial.process.console_log && (
              <EvidenceLog
                path={`/history/evaluation/${id}/logs/${encodeURIComponent(trial.process.console_log)}`}
              />
            )}
          </>
        )}
        {trial.submitted_files !== null && (
          <div>
            <strong>
              {trial.submitted_files.length} changed{' '}
              {trial.submitted_files.length === 1 ? 'file' : 'files'}
            </strong>
            <ul>
              {trial.submitted_files.map((file) => (
                <li key={`${file.operation}-${file.path}`}>
                  {file.operation} <code>{file.path}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function EvaluationPage() {
  const { repoAnalysis, task, solution, testSuite, validationReport, active, queue, cancelJob, job } = useProject();
  const [mode, setMode] = useState<'control' | 'agent'>('agent');
  const [slots, setSlots] = useState<ModelSlot[]>(DEFAULT_SLOTS);
  const [repeats, setRepeats] = useState(1);
  const [providers, setProviders] = useState<EvaluationProvidersStatus | null>(null);
  const [selected, setSelected] = useState<{ taskId: string; id: string } | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [retry, setRetry] = useState(0);
  const [evalStartedAtMs, setEvalStartedAtMs] = useState<number | null>(null);
  const [cancelingEval, setCancelingEval] = useState(false);

  const evaluationRunning = Boolean(job && job.kind === 'evaluation' && isActive(job));
  const pendingResult = job?.kind === 'evaluation' ? job.result_id : null;
  const reportId = selected?.taskId === task?.id ? selected?.id : pendingResult;

  useEffect(() => {
    if (evaluationRunning) {
      const parsedStart = job?.created_at ? Date.parse(job.created_at) : NaN;
      setEvalStartedAtMs((prev) => prev ?? (Number.isFinite(parsedStart) ? parsedStart : Date.now()));
    } else {
      setEvalStartedAtMs(null);
      setCancelingEval(false);
    }
  }, [evaluationRunning, job?.created_at]);

  useEffect(() => {
    const controller = new AbortController();
    workflow
      .evaluationProviders(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) {
          setProviders(status);
        }
      })
      .catch(() => {
        // Non-blocking: UI still works with default slot hints
      });
    return () => controller.abort();
  }, []);

  const enabledSlots = slots.filter((slot) => slot.enabled);
  const totalScheduledTrials = enabledSlots.length * repeats;
  const maxRepeatsAllowed = Math.max(1, Math.min(5, Math.floor(MAX_CAMPAIGN_TRIALS / Math.max(1, enabledSlots.length))));

  const hasEnabledGroqSlot = enabledSlots.some((s) => inferProvider(s.model) === 'groq');
  const hasEnabledAdaptionSlot = enabledSlots.some((s) => inferProvider(s.model) === 'adaption');
  const groqMissingKey = providers !== null && !providers.groq.configured && hasEnabledGroqSlot;
  const adaptionMissingKey = providers !== null && !providers.adaption?.configured && hasEnabledAdaptionSlot;
  const geminiMissingKey =
    providers !== null &&
    !providers.gemini.configured &&
    enabledSlots.some((s) => inferProvider(s.model) === 'gemini');

  const invalidSlot = enabledSlots.find((s) => !isValidModelId(s.model));
  const ready = Boolean(
    task?.snapshot_id && solution && testSuite && validationReport?.overall_verdict === 'VALIDATED'
  );

  const disabledReason = !ready
    ? 'Validate the current task, reference solution, and test suite first.'
    : active
      ? 'Wait for the current evaluation job to finish.'
      : mode === 'agent' && enabledSlots.length === 0
        ? 'Enable at least one model slot (Gemini, GPT-OSS 120B, or Qwen) to run a live campaign.'
        : mode === 'agent' && invalidSlot
          ? `Enter a valid model identifier for ${invalidSlot.displayName} (for example ${invalidSlot.placeholder}).`
          : mode === 'agent' && totalScheduledTrials > MAX_CAMPAIGN_TRIALS
            ? `Reduce repeats to at most ${maxRepeatsAllowed} when running ${enabledSlots.length} models (max ${MAX_CAMPAIGN_TRIALS} trials per campaign).`
            : '';

  useEffect(() => {
    if (pendingResult) setSelected(null);
  }, [pendingResult]);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setLoadingError('');
    if (reportId) {
      workflow
        .artifact<EvaluationReport>('evaluation', reportId, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setReport(result);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setLoadingError((err as Error).message);
        });
    }
    return () => controller.abort();
  }, [reportId, retry]);

  const toggleSlot = (slotId: ModelSlot['id']) => {
    setSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? { ...slot, enabled: !slot.enabled } : slot))
    );
  };

  const updateSlotModel = (slotId: ModelSlot['id'], value: string) => {
    setSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? { ...slot, model: value } : slot))
    );
  };

  const selectSlotPreset = (slotId: ModelSlot['id'], selectedValue: string) => {
    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== slotId) return slot;
        if (selectedValue === '__custom__') {
          return { ...slot, customMode: true };
        }
        return { ...slot, model: selectedValue, customMode: false };
      })
    );
  };

  const resetDefaults = () => {
    setSlots(DEFAULT_SLOTS);
    setRepeats(1);
  };

  const run = async () => {
    if (disabledReason) return;
    setError('');
    setSelected(null);
    setEvalStartedAtMs(Date.now());
    try {
      const agents =
        mode === 'agent'
          ? enabledSlots.map((slot) => ({
              label: slot.label,
              model: normalizeModelId(slot.model),
              max_turns: 5,
            }))
          : [];
      await queue('evaluation', { mode, repeats, agents });
    } catch (err) {
      setEvalStartedAtMs(null);
      setError((err as Error).message);
    }
  };

  const handleCancelEvaluation = async () => {
    if (!evaluationRunning || cancelingEval) return;
    setError('');
    setCancelingEval(true);
    try {
      await cancelJob();
    } catch (err) {
      setError((err as Error).message);
      setCancelingEval(false);
    }
  };

  const exportCSV = async (name: 'summary.csv' | 'trials.csv') => {
    if (!report) return;
    setError('');
    try {
      await workflow.download(`/history/evaluation/${report.id}/${name}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const displayed = report?.id === reportId ? report : null;

  const getSlotStatus = (slot: ModelSlot) => {
    const inferred = inferProvider(slot.model);
    if (!providers) {
      return { tone: 'muted' as const, text: 'Checking server readiness…' };
    }
    if (inferred === 'gemini') {
      return providers.gemini.configured
        ? { tone: 'success' as const, text: 'Gemini API ready' }
        : { tone: 'warning' as const, text: 'Awaiting GEMINI_API_KEY in Secrets' };
    }
    if (inferred === 'groq') {
      return providers.groq.configured
        ? { tone: 'success' as const, text: 'Groq API ready' }
        : { tone: 'warning' as const, text: 'Awaiting GROQ_API_KEY in Secrets' };
    }
    if (inferred === 'adaption') {
      return providers.adaption?.configured
        ? { tone: 'success' as const, text: 'Adaption AI ready' }
        : { tone: 'warning' as const, text: 'Awaiting ADAPTION_API_KEY in Secrets' };
    }
    return { tone: 'warning' as const, text: 'External provider (unconfigured)' };
  };

  const runButtonLabel =
    mode === 'control'
      ? 'Run Harbor controls'
      : enabledSlots.length === 1
        ? `Run ${enabledSlots[0].displayName} evaluation`
        : `Run ${enabledSlots.length}-model evaluation (${totalScheduledTrials} ${totalScheduledTrials === 1 ? 'trial' : 'trials'})`;

  return (
    <>
      <PageHeader
        title="Agent Evaluation"
        description="Benchmark Gemini, GPT-OSS 120B (Groq), and Qwen 3.5 397B (Adaption AI) head-to-head over the same validated snapshot and test verifier."
        actions={
          <Link to="/leaderboard" className="btn btn-secondary">
            <Trophy size={14} />
            <span>Model Leaderboard</span>
          </Link>
        }
      />

      <section className="card workflow-panel">
        <div className="workflow-row workflow-spread">
          <div>
            <h2>{task?.title || 'No task selected'}</h2>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Stage 5 multi-model arena · Oracle (1.0) and baseline no-op (0.0) controls run automatically with every campaign.
            </p>
          </div>
          {mode === 'agent' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={resetDefaults}
              style={{ fontSize: '12px', padding: '6px 10px' }}
              title="Restore Gemini, GPT-OSS 120B, and Qwen defaults"
            >
              <RotateCcw size={13} />
              <span>Reset defaults</span>
            </button>
          )}
        </div>

        {!ready && (
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Run <Link to="/validation" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>Validation</Link> successfully on the current reference solution and test suite to unlock Stage 5 evaluation.
          </p>
        )}

        <div className="workflow-row">
          <label>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Run type
            </span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'control' | 'agent')}
            >
              <option value="agent">Live coding agents (3-model arena)</option>
              <option value="control">Harbor controls only</option>
            </select>
          </label>

          <label>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Independent repeats per model
            </span>
            <select
              value={repeats}
              onChange={(e) => setRepeats(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'repeat' : 'repeats'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mode === 'agent' ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
                gap: '12px',
              }}
            >
              {slots.map((slot, index) => {
                const status = getSlotStatus(slot);
                const statusColor =
                  status.tone === 'success'
                    ? 'var(--success-text)'
                    : status.tone === 'warning'
                      ? 'var(--warning-text)'
                      : 'var(--text-muted)';
                const presets = MODEL_PRESETS_BY_SLOT[slot.id];
                const matchedPreset = presets.find(
                  (preset) => preset.id.toLowerCase() === slot.model.trim().toLowerCase()
                );
                const isCustom = Boolean(slot.customMode || !matchedPreset);
                const dropdownValue = isCustom ? '__custom__' : matchedPreset!.id;
                const activeSpec = findModelSpec(slot.model);

                return (
                  <div
                    key={slot.id}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${slot.enabled ? 'var(--border-strong)' : 'var(--border-default)'}`,
                      backgroundColor: slot.enabled ? 'var(--bg-card)' : 'var(--bg-muted)',
                      opacity: slot.enabled ? 1 : 0.72,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      transition: 'border-color 0.15s ease, opacity 0.15s ease',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '4px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={() => toggleSlot(slot.id)}
                          style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {index + 1}. {slot.displayName}
                        </span>
                      </span>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {slot.family}
                      </span>
                    </label>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="model-select-label-row">
                        <label
                          htmlFor={`model-select-${slot.id}`}
                          style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}
                        >
                          Model selection
                        </label>
                        <ModelInfoTooltip
                          slotId={slot.id}
                          selectedModelId={slot.model}
                          slotDisplayName={slot.displayName}
                        />
                      </div>

                      <select
                        id={`model-select-${slot.id}`}
                        value={dropdownValue}
                        disabled={!slot.enabled}
                        onChange={(e) => selectSlotPreset(slot.id, e.target.value)}
                        title={
                          activeSpec
                            ? `${activeSpec.label} — ${activeSpec.parameters} · ${activeSpec.contextWindow} context. ${activeSpec.bestFor}`
                            : `Custom model identifier (${slot.model || slot.placeholder})`
                        }
                        style={{
                          fontSize: '12.5px',
                          width: '100%',
                        }}
                      >
                        {presets.map((preset) => (
                          <option
                            key={preset.id}
                            value={preset.id}
                            title={`${preset.parameters} · ${preset.contextWindow} · ${preset.bestFor}`}
                          >
                            {preset.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom model identifier…</option>
                      </select>

                      {isCustom ? (
                        <input
                          aria-label={`${slot.displayName} custom model identifier`}
                          value={slot.model}
                          maxLength={140}
                          disabled={!slot.enabled}
                          placeholder={slot.placeholder}
                          onChange={(e) => updateSlotModel(slot.id, e.target.value)}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            width: '100%',
                          }}
                        />
                      ) : activeSpec ? (
                        <div className="model-spec-caption">
                          <span>{activeSpec.parameters}</span>
                          <span>· {activeSpec.contextWindow} context</span>
                        </div>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11.5px',
                        color: statusColor,
                        fontWeight: 500,
                      }}
                    >
                      {status.tone === 'success' ? (
                        <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                      ) : status.tone === 'warning' ? (
                        <AlertCircle size={13} style={{ flexShrink: 0 }} />
                      ) : (
                        <Info size={13} style={{ flexShrink: 0 }} />
                      )}
                      <span>{status.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {(groqMissingKey || adaptionMissingKey || geminiMissingKey) && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--warning-light)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning-text)',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  {groqMissingKey && (
                    <span>
                      <strong>GROQ_API_KEY</strong> is not configured in server secrets yet — Groq slots (GPT-OSS 120B) will be recorded as{' '}
                      <code>provider_unavailable</code> until you add <code>GROQ_API_KEY</code> in <strong>Settings &gt; Secrets</strong>.
                    </span>
                  )}
                  {adaptionMissingKey && (
                    <span>
                      {groqMissingKey ? ' ' : ''}
                      <strong>ADAPTION_API_KEY</strong> is not configured in server secrets yet — Adaption AI Qwen slots will be recorded as{' '}
                      <code>provider_unavailable</code> until you add <code>ADAPTION_API_KEY</code> in <strong>Settings &gt; Secrets</strong>.
                    </span>
                  )}
                  {geminiMissingKey && (
                    <span>
                      {groqMissingKey || adaptionMissingKey ? ' ' : ''}
                      <strong>GEMINI_API_KEY</strong> is not configured on the server.
                    </span>
                  )}
                </div>
              </div>
            )}

            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Enabled: {enabledSlots.length} of 3 models · Scheduled trials: {totalScheduledTrials} / {MAX_CAMPAIGN_TRIALS} max · Supports{' '}
              <code>gemini/*</code>, <code>groq/*</code>, and <code>adaption/*</code> identifiers.
            </p>

            {(repoAnalysis?.existing_test_files?.length || 0) > 0 && (
              <div className="eval-guard-bar">
                <ShieldCheck size={15} style={{ color: 'var(--success-text)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Protected-Test Guard Active
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' '}
                    · {repoAnalysis!.existing_test_files.length} original test{' '}
                    {repoAnalysis!.existing_test_files.length === 1 ? 'file' : 'files'} explicitly passed as read-only to all Stage 5 agents to prevent unfair{' '}
                    <code>modified_protected_tests</code> penalties.
                  </span>
                  <details style={{ marginTop: '4px' }}>
                    <summary style={{ fontSize: '11.5px', color: 'var(--accent-primary)', cursor: 'pointer' }}>
                      View guarded test paths ({repoAnalysis!.existing_test_files.length})
                    </summary>
                    <div className="eval-guard-paths">
                      {repoAnalysis!.existing_test_files.map((fp) => (
                        <code key={fp} className="code-inline">
                          {fp}
                        </code>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Controls verify the reference oracle (expected reward 1.0) and untreated no-op baseline (expected reward 0.0) without invoking external LLM endpoints.
          </p>
        )}

        {disabledReason && (
          <p id="evaluation-disabled-reason" role="status" style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            {disabledReason}
          </p>
        )}

        <div className="workflow-row">
          <button
            className="btn btn-primary"
            disabled={Boolean(disabledReason)}
            aria-describedby={disabledReason ? 'evaluation-disabled-reason' : undefined}
            onClick={() => void run()}
          >
            {runButtonLabel}
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
      </section>

      {evaluationRunning && (
        <AgentProgressBar
          title={
            mode === 'agent'
              ? `Running live evaluation campaign (${enabledSlots.length} ${enabledSlots.length === 1 ? 'model' : 'models'})`
              : 'Running Harbor control verification'
          }
          stage={
            job?.cancel_requested
              ? 'Cancellation requested — stopping after current step'
              : job?.progress?.stage || (job?.state === 'queued' ? 'Queued for execution' : 'Running evaluation trials')
          }
          detail={
            job?.progress?.detail ||
            'Executing isolated sandbox verifiers and live model trials against the validated snapshot.'
          }
          percent={job?.progress?.percent ?? (job?.state === 'queued' ? 3 : 8)}
          completedSteps={job?.progress?.completed_steps}
          totalSteps={job?.progress?.total_steps}
          steps={job?.progress?.steps}
          startedAtMs={evalStartedAtMs}
          onCancel={() => void handleCancelEvaluation()}
          cancelLabel={cancelingEval || job?.cancel_requested ? 'Canceling…' : 'Cancel run'}
          cancelDisabled={cancelingEval || Boolean(job?.cancel_requested)}
        />
      )}

      {task && (
        <EvidenceHistory
          key={task.id}
          taskId={task.id}
          kind="evaluation"
          current={reportId || undefined}
          version={pendingResult}
          onSelect={(id) => setSelected({ taskId: task.id, id })}
        />
      )}

      {loadingError && (
        <p role="alert">
          {loadingError}{' '}
          <button className="btn btn-secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}

      {reportId && !displayed && !loadingError && <p role="status">Loading benchmark report…</p>}

      {displayed && (
        <section className="card workflow-panel">
          <div className="workflow-row workflow-spread">
            <div>
              <h2>Benchmark report</h2>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {displayed.mode === 'agent'
                  ? `${displayed.metrics.length}-model agent campaign`
                  : 'Control campaign'}{' '}
                · <code className="code-inline">{displayed.id}</code>
              </p>
            </div>
            <StatusBadge status={displayed.state} />
          </div>

          {displayed.failure && <p>Failure category: {displayed.failure.replace(/_/g, ' ')}</p>}
          {displayed.detail && (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{displayed.detail}</p>
          )}

          <div className="workflow-row">
            <button className="btn btn-secondary" onClick={() => void exportCSV('summary.csv')}>
              Download Summary CSV
            </button>
            <button className="btn btn-secondary" onClick={() => void exportCSV('trials.csv')}>
              Download Trials CSV
            </button>
          </div>

          {/* Head-to-Head Multi-Model Comparison Matrix */}
          {displayed.metrics.length > 0 && (
            <div className="table-scroll-wrap" style={{ borderTop: '1px solid var(--border-default)', paddingTop: '14px' }}>
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
                  {displayed.metrics.map((metric) => {
                    const matchedTrial = displayed.trials.find((t) => t.label === metric.label);
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
                          {displayRate(metric.verified_success)}
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
          )}

          {displayed.package && (
            <details className="snapshot-details">
              <summary>Artifact versions and environment</summary>
              <dl>
                <dt>Snapshot</dt>
                <dd>
                  <code>{displayed.package.snapshot_id}</code>
                </dd>
                <dt>Snapshot checksum</dt>
                <dd>
                  <code>{displayed.package.snapshot_sha256}</code>
                </dd>
                <dt>Starting commit</dt>
                <dd>{displayed.package.starting_commit_sha || 'ZIP baseline'}</dd>
                <dt>Reference checksum</dt>
                <dd>
                  <code>{displayed.package.solution_sha256}</code>
                </dd>
                <dt>Test suite checksum</dt>
                <dd>
                  <code>{displayed.package.test_suite_sha256}</code>
                </dd>
                <dt>Package checksum</dt>
                <dd>
                  <code>{displayed.package.package_sha256}</code>
                </dd>
                <dt>Runtime image</dt>
                <dd>{displayed.package.runtime_image}</dd>
                <dt>Harbor / Docker</dt>
                <dd>
                  {displayed.harbor_version || 'Unavailable'} /{' '}
                  {displayed.docker_engine || 'Unavailable'}
                </dd>
                {displayed.package.protected_test_files && (
                  <>
                    <dt>Protected tests</dt>
                    <dd>
                      {displayed.package.protected_test_files.length === 0
                        ? 'None in snapshot'
                        : displayed.package.protected_test_files.join(', ')}
                    </dd>
                  </>
                )}
              </dl>
            </details>
          )}

          {displayed.metrics.map((metric) => (
            <div className="history-row" key={metric.label}>
              <h3>
                {metric.label}
                {metric.model ? ` · ${metric.model}` : ''} · {metric.scored}/{metric.scheduled} scored
              </h3>
              <dl className="metrics-grid" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <div>
                  <dt>Verified success</dt>
                  <dd>{displayRate(metric.verified_success)}</dd>
                </div>
                <div>
                  <dt>Partial test score</dt>
                  <dd>
                    {typeof metric.mean_partial_score === 'number'
                      ? `${(metric.mean_partial_score * 100).toFixed(1)}%`
                      : 'Unavailable'}
                  </dd>
                </div>
                <div>
                  <dt>Feature cases</dt>
                  <dd>
                    {typeof metric.feature_cases_total === 'number' && metric.feature_cases_total > 0
                      ? `${metric.feature_cases_passed ?? 0}/${metric.feature_cases_total} passed`
                      : displayRate(metric.feature_pass)}
                  </dd>
                </div>
                <div>
                  <dt>Regression cases</dt>
                  <dd>
                    {typeof metric.regression_cases_total === 'number' && metric.regression_cases_total > 0
                      ? `${metric.regression_cases_passed ?? 0}/${metric.regression_cases_total} passed`
                      : displayRate(metric.regression_pass)}
                  </dd>
                </div>
                <div>
                  <dt>Build success</dt>
                  <dd>{displayRate(metric.build_success)}</dd>
                </div>
                <div>
                  <dt>Mean duration</dt>
                  <dd>
                    {metric.mean_agent_seconds === null
                      ? 'Unavailable'
                      : `${metric.mean_agent_seconds.toFixed(2)} s`}
                  </dd>
                </div>
                <div>
                  <dt>Input / output tokens</dt>
                  <dd>
                    {metric.input_tokens_total ?? '–'} / {metric.output_tokens_total ?? '–'}
                  </dd>
                </div>
                <div>
                  <dt>Success 95% interval</dt>
                  <dd>
                    {metric.verified_success.wilson95
                      ?.map((x) => `${(x * 100).toFixed(1)}%`)
                      .join('–') || 'Unavailable'}
                  </dd>
                </div>
              </dl>
              {Object.entries(metric.failure_counts).map(([failure, count]) => (
                <p key={failure} style={{ fontSize: '12.5px', color: 'var(--warning-text)' }}>
                  {failure.replace(/_/g, ' ')} · {count}
                </p>
              ))}
            </div>
          ))}

          {displayed.oracle && <TrialEvidence trial={displayed.oracle} id={displayed.id} />}
          {displayed.baseline_control && (
            <TrialEvidence trial={displayed.baseline_control} id={displayed.id} />
          )}
          {displayed.trials.map((trial) => (
            <TrialEvidence
              trial={trial}
              id={displayed.id}
              key={`${trial.label}-${trial.attempt}`}
            />
          ))}
        </section>
      )}
    </>
  );
}
