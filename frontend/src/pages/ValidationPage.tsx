import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Play,
  XCircle,
  AlertCircle,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { AgentProgressBar } from '../components/AgentProgressBar';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { useProject } from '../context/ProjectContext';

import type { GateName, ValidationReport } from '../types/validation';
import { workflow } from '../services/workflowService';
import { EvidenceHistory } from '../components/EvidenceHistory';
import { EvidenceLog } from '../components/EvidenceLog';

const gateLabels: Record<GateName, string> = {
  baseline: 'Original repository tests',
  reference: 'Reference application and compile',
  feature: 'Generated feature tests',
  regression: 'Regression tests',
  negative_control: 'Negative controls',
};

export const ValidationPage: React.FC = () => {
  const navigate = useNavigate();
  const { task, solution, testSuite, validationReport: currentReport, queue, cancelJob, active, job } = useProject();

  const isValidating = active && job?.kind === 'validation';
  const isRepairing = active && job?.kind === 'repair';
  const isLoading = isValidating || isRepairing;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [canceling, setCanceling] = useState(false);

  const [pastId, setPastId] = useState<string | undefined>();
  const [past, setPast] = useState<ValidationReport | null>(null);
  const [pastError, setPastError] = useState('');
  const validationReport = pastId ? past : currentReport;
  useEffect(() => { setPastId(undefined); }, [task?.id]);
  useEffect(() => {
    if (isLoading) {
      const parsed = job?.created_at ? Date.parse(job.created_at) : NaN;
      setStartedAtMs((prev) => prev ?? (Number.isFinite(parsed) ? parsed : Date.now()));
    } else {
      setStartedAtMs(null);
      setCanceling(false);
    }
  }, [isLoading, job?.created_at]);

  useEffect(() => {
    const controller = new AbortController();
    setPast(null);
    setPastError('');
    if (pastId) workflow.artifact<ValidationReport>('validation', pastId, controller.signal).then(result => {
      if (!controller.signal.aborted) setPast(result);
    }).catch(error => {
      if (!controller.signal.aborted) setPastError((error as Error).message);
    });
    return () => controller.abort();
  }, [pastId]);

  const handleValidate = async () => {
    if (!task || !solution || !testSuite || active) return;
    setErrorMessage(null);
    setStartedAtMs(Date.now());
    try {
      setPastId(undefined);
      await queue('validation');
    } catch (error) {
      setStartedAtMs(null);
      setErrorMessage((error as Error).message);
    }
  };

  const handleAutoRepair = async () => {
    if (!task || !solution || !testSuite || !validationReport || active) return;
    setErrorMessage(null);
    setStartedAtMs(Date.now());
    try {
      setPastId(undefined);
      await queue('repair', { validation_id: validationReport.id });
    } catch (error) {
      setStartedAtMs(null);
      setErrorMessage((error as Error).message);
    }
  };

  const handleCancel = async () => {
    if (!isLoading || canceling) return;
    setErrorMessage(null);
    setCanceling(true);
    try {
      await cancelJob();
    } catch (error) {
      setErrorMessage((error as Error).message);
      setCanceling(false);
    }
  };

  const canAutoRepair = Boolean(
    task &&
      solution &&
      testSuite &&
      validationReport &&
      !pastId &&
      validationReport.overall_verdict !== 'VALIDATED'
  );

  return (
    <div>
      <PageHeader
        title="Validation & Integrity Engine"
        description="Run live build, feature, regression, and negative-control tests in isolated workspaces against the immutable starting repository."
      />

      {/* Dependency check banner */}
      {!task || !solution || !testSuite ? (
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <AlertCircle size={28} style={{ color: 'var(--warning)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Incomplete Task Package
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 20px' }}>
            Full package validation requires a Task Specification, a Reference Solution, and an Automated Test Suite.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
            {!task && (
              <Link to="/task-generator" className="btn btn-secondary">
                Generate Task
              </Link>
            )}
            {!solution && (
              <Link to="/solution" className="btn btn-secondary">
                Synthesize Solution
              </Link>
            )}
            {!testSuite && (
              <Link to="/test-suite" className="btn btn-secondary">
                Synthesize Tests
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Action Bar */}
          <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Validation Candidate
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {task.title}
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Solution files: {solution.files.length} · Feature tests: {testSuite.total_feature_tests} · Regression checks: {testSuite.total_regression_tests}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                {canAutoRepair && (
                  <button
                    onClick={() => void handleAutoRepair()}
                    disabled={active}
                    className="btn btn-primary"
                  >
                    <Wand2 size={14} />
                    <span>Auto-Fix with AI</span>
                  </button>
                )}

                <button
                  onClick={handleValidate}
                  disabled={active || !task || !solution || !testSuite}
                  className={canAutoRepair ? 'btn btn-secondary' : 'btn btn-primary'}
                >
                  <Play size={14} />
                  <span>{validationReport ? 'Re-run Validation Gates' : 'Run Validation Gates'}</span>
                </button>

                {validationReport && (
                  <button
                    onClick={() => navigate('/export')}
                    className="btn btn-secondary"
                  >
                    <span>Proceed to Harbor Export</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Progress Bar for Auto-Repair & Validation */}
          {isLoading && (
            <AgentProgressBar
              title={
                isRepairing
                  ? 'Self-healing Auto-Repair in progress'
                  : 'Running 5 isolated validation gates'
              }
              stage={
                job?.cancel_requested
                  ? 'Cancellation requested'
                  : job?.progress?.stage ||
                    (isRepairing
                      ? 'Diagnosing validation failure logs with Gemini AI'
                      : 'Executing baseline, compile, feature, regression, and negative-control gates')
              }
              detail={
                job?.progress?.detail ||
                (isRepairing
                  ? 'Reading failing gate stderr, synthesizing targeted repair, and re-validating automatically.'
                  : 'Restoring the immutable snapshot in a fresh isolated workspace.')
              }
              percent={job?.progress?.percent ?? (isRepairing ? 12 : 45)}
              completedSteps={job?.progress?.completed_steps}
              totalSteps={job?.progress?.total_steps}
              steps={job?.progress?.steps}
              startedAtMs={startedAtMs}
              onCancel={() => void handleCancel()}
              cancelLabel={canceling || job?.cancel_requested ? 'Canceling…' : 'Cancel'}
              cancelDisabled={canceling || Boolean(job?.cancel_requested)}
            />
          )}

          {errorMessage && (
            <div style={{ marginBottom: '24px' }}>
              <ErrorState
                title={isRepairing ? 'Auto-Repair Failed' : 'Validation Failed'}
                message={errorMessage}
                onRetry={canAutoRepair ? handleAutoRepair : handleValidate}
              />
            </div>
          )}

        </>
      )}

      {task && <EvidenceHistory key={task.id} taskId={task.id} kind="validation" current={pastId || currentReport?.id}
            onSelect={setPastId} version={job?.result_id} />}
          {pastId && <div className="workflow-row workflow-hint">
            <strong>Historical validation</strong>
            <button className="btn btn-secondary" onClick={() => setPastId(undefined)}>Show current validation</button>
            {!past && !pastError && <span role="status">Loading report…</span>}
          </div>}
          {pastError && <ErrorState message={pastError} />}

          {/* Validation Report View */}
          {task && validationReport && !isLoading && (
            <div>
              {/* Verdict Summary Card */}
              <div
                className="card"
                style={{
                  padding: '24px',
                  marginBottom: '24px',
                  borderLeft: `4px solid ${
                    validationReport.overall_verdict === 'VALIDATED'
                      ? 'var(--success)'
                      : validationReport.overall_verdict === 'REJECTED'
                      ? 'var(--danger)'
                      : 'var(--warning)'
                  }`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {validationReport.overall_verdict === 'VALIDATED' ? (
                      <ShieldCheck size={22} style={{ color: 'var(--success)' }} />
                    ) : validationReport.overall_verdict === 'REJECTED' ? (
                      <XCircle size={22} style={{ color: 'var(--danger)' }} />
                    ) : (
                      <ShieldAlert size={22} style={{ color: 'var(--warning)' }} />
                    )}
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Overall Verdict: {validationReport.overall_verdict}
                      </h3>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Execution mode: <code className="code-inline">{validationReport.execution_mode}</code> · Duration: {validationReport.execution_duration_ms}ms
                      </div>
                    </div>
                  </div>

                  <StatusBadge status={validationReport.overall_verdict} />
                </div>

                {/* Truthful explanation banner */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: validationReport.overall_verdict === 'NOT_VALIDATED' ? 'var(--warning-light)' : 'var(--bg-muted)',
                    fontSize: '12.5px',
                    color: validationReport.overall_verdict === 'NOT_VALIDATED' ? 'var(--warning-text)' : 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  {validationReport.evidence_location
                    ? <>Evidence <code className="code-inline">{validationReport.evidence_location}</code></>
                    : 'No isolated execution evidence was recorded.'}
                </div>

                {/* Auto-Repair Applied Summary */}
                {validationReport.auto_repair && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor:
                        validationReport.overall_verdict === 'VALIDATED'
                          ? 'var(--success-light)'
                          : 'var(--info-light)',
                      border: `1px solid ${
                        validationReport.overall_verdict === 'VALIDATED'
                          ? 'var(--success-border)'
                          : 'var(--info-border)'
                      }`,
                      fontSize: '12.5px',
                      color:
                        validationReport.overall_verdict === 'VALIDATED'
                          ? 'var(--success-text)'
                          : 'var(--info-text)',
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Wand2 size={14} />
                      <span>
                        Auto-Repair Applied ({
                          validationReport.auto_repair.repaired_target === 'both'
                            ? 'Reference Solution & Test Suite'
                            : validationReport.auto_repair.repaired_target === 'solution'
                              ? 'Reference Solution'
                              : 'Test Suite'
                        })
                      </span>
                    </div>
                    <p style={{ color: 'inherit' }}>{validationReport.auto_repair.diagnosis}</p>
                  </div>
                )}

                {/* 1-Click Self-Healing Action Bar on Validation Failure */}
                {canAutoRepair && (
                  <div
                    style={{
                      marginTop: '14px',
                      paddingTop: '14px',
                      borderTop: '1px solid var(--border-default)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px 14px',
                    }}
                  >
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', flex: '1 1 260px' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Self-Healing Benchmark Repair:</strong>{' '}
                      Automatically inspect failing gate <code className="code-inline">stderr</code> logs, repair the affected solution or test files with Gemini AI, and re-run all 5 validation gates.
                    </div>
                    <button
                      onClick={() => void handleAutoRepair()}
                      disabled={active}
                      className="btn btn-primary"
                    >
                      <Wand2 size={14} />
                      <span>Auto-Fix with AI</span>
                    </button>
                  </div>
                )}
              </div>

              {Boolean(validationReport.gates?.length) && (
                <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '16px' }}>Validation gates</h4>
                  <div style={{ display: 'grid', gap: '14px' }}>
                    {validationReport.gates?.map((gate) => (
                      <div key={gate.gate}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px' }}>
                          <strong>{gateLabels[gate.gate]}</strong>
                          <span className={`badge ${gate.status === 'passed' ? 'badge-success' : gate.status === 'failed' ? 'badge-danger' : 'badge-default'}`}>
                            {gate.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        {gate.failure_category && <p>{gate.failure_category.replace(/_/g, " ")}</p>}
                        {gate.detail && <p style={{ fontSize: '12px' }}>{gate.detail}</p>}
                        {gate.runs.map((run, index) => (
                          <div key={index} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {run.timed_out ? 'Timed out' : run.oom_killed ? 'Memory limit reached' : run.exit_code === null ? 'No exit code' : `Exit ${run.exit_code}`}
                            {' · '}{run.duration_ms}ms
                                                        {run.commands?.map((command, commandIndex) => (
                              <pre key={commandIndex} className="evidence-command">{command.argv.join(' ')}</pre>
                            ))}
                            {run.log_location && <EvidenceLog key={run.log_location}
                              path={'/history/validation/' + validationReport.id + '/logs/' + encodeURIComponent(run.log_location.split('/').pop() || '')} />}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Rejection / Status Reasons Trail */}
              {validationReport.rejection_reasons.length > 0 && (
                <div className="card" style={{ padding: '18px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                    Audit & Reason Log
                  </div>
                  <ul style={{ paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {validationReport.rejection_reasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
    </div>
  );
};
