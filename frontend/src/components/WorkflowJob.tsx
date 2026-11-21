import { useState } from 'react';
import { useProject } from '../context/ProjectContext';
import { isActive } from '../types/workflow';
import { StatusBadge } from './StatusBadge';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

export function WorkflowJob() {
  const { job, cancelJob, loadError, refresh, loading, task } = useProject();
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const cancel = async () => {
    setCancelError('');
    setCanceling(true);
    try { await cancelJob(); }
    catch (error) { setCancelError((error as Error).message); }
    finally { setCanceling(false); }
  };
  return <>
    {loadError && <ErrorState title="Could not sync saved work" message={loadError} onRetry={refresh} />}
    {loading && !task && <LoadingState message="Loading saved work…" />}
    {job && <section className="card workflow-panel job-panel" aria-label="Workflow job">
      <div className="workflow-row">
        <strong>
          {job.kind === 'tests'
            ? 'Test suite'
            : job.kind === 'repair'
              ? 'Auto-repair'
              : job.kind.replace(/^./, c => c.toUpperCase())}{' '}
          job
        </strong>
        <span role="status"><StatusBadge status={job.cancel_requested && isActive(job) ? 'Cancel requested' : job.state} /></span>
        {isActive(job) && <button className="btn btn-secondary" disabled={canceling || job.cancel_requested} onClick={() => void cancel()}>
          {canceling ? 'Canceling…' : 'Cancel job'}
        </button>}
      </div>
      {job.error && <p role="alert">{job.error}</p>}
      {cancelError && <p role="alert">{cancelError}</p>}
    </section>}
  </>;
}
