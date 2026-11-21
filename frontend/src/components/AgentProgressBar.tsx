import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { JobProgressStep } from '../types/workflow';

export interface AgentProgressBarProps {
  title: string;
  stage: string;
  detail?: string | null;
  percent: number;
  completedSteps?: number;
  totalSteps?: number;
  steps?: JobProgressStep[];
  startedAtMs?: number | null;
  onCancel?: () => void;
  cancelLabel?: string;
  cancelDisabled?: boolean;
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

export const AgentProgressBar: React.FC<AgentProgressBarProps> = ({
  title,
  stage,
  detail,
  percent,
  completedSteps,
  totalSteps,
  steps,
  startedAtMs,
  onCancel,
  cancelLabel = 'Cancel',
  cancelDisabled = false,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAtMs) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  const elapsedSeconds = startedAtMs ? (nowMs - startedAtMs) / 1000 : null;

  return (
    <section
      className="card agent-progress-panel"
      aria-live="polite"
      aria-busy={clampedPercent < 100}
    >
      <div className="agent-progress-header">
        <div className="agent-progress-heading">
          <div className="agent-progress-title-row">
            <Loader2
              size={15}
              className="agent-progress-spinner"
              aria-hidden="true"
            />
            <h3>{title}</h3>
          </div>
          <p className="agent-progress-stage">{stage}</p>
          {detail && <p className="agent-progress-detail">{detail}</p>}
        </div>

        <div className="agent-progress-meta">
          <div className="agent-progress-stats">
            <span className="agent-progress-pct">{clampedPercent}%</span>
            {typeof completedSteps === 'number' && typeof totalSteps === 'number' && totalSteps > 0 && (
              <>
                <span aria-hidden="true" className="agent-progress-sep">·</span>
                <span>
                  Step {Math.min(completedSteps + (clampedPercent < 100 ? 1 : 0), totalSteps)} of {totalSteps}
                </span>
              </>
            )}
            {elapsedSeconds !== null && (
              <>
                <span aria-hidden="true" className="agent-progress-sep">·</span>
                <span>{formatElapsed(elapsedSeconds)}</span>
              </>
            )}
          </div>
          {onCancel && (
            <button
              type="button"
              className="btn btn-secondary agent-progress-cancel"
              disabled={cancelDisabled}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>

      <div
        className="agent-progress-track"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedPercent}
      >
        <div
          className="agent-progress-fill"
          style={{ transform: `scaleX(${clampedPercent / 100})` }}
        />
        {clampedPercent > 0 && clampedPercent < 100 && (
          <div className="agent-progress-shimmer" aria-hidden="true" />
        )}
      </div>

      {steps && steps.length > 0 && (
        <ol className="agent-progress-steps">
          {steps.map((step) => {
            const stateClass = `agent-progress-step agent-progress-step--${step.status}`;
            return (
              <li key={step.id} className={stateClass}>
                <span className="agent-progress-step-icon" aria-hidden="true">
                  {step.status === 'completed' ? (
                    <CheckCircle2 size={14} />
                  ) : step.status === 'failed' ? (
                    <XCircle size={14} />
                  ) : step.status === 'running' ? (
                    <Loader2 size={14} className="agent-progress-spinner" />
                  ) : (
                    <Circle size={14} />
                  )}
                </span>
                <span className="agent-progress-step-label">{step.label}</span>
                {step.detail && (
                  <span className="agent-progress-step-detail">{step.detail}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
