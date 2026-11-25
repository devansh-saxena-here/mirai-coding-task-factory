import { EvidenceLog } from '../EvidenceLog';
import type { SuiteBreakdown, Trial } from '../../types/evaluation';

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

export function TrialEvidencePanel({ trial, id }: { trial: Trial; id: string }) {
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
