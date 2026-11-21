import { useEffect, useState } from 'react';
import { workflow } from '../services/workflowService';
import type { HistoryItem, Kind } from '../types/workflow';
import { StatusBadge } from './StatusBadge';

export function EvidenceHistory({ taskId, kind, current, onSelect, version }: {
  taskId: string; kind: Kind; current?: string; onSelect: (id: string) => void; version?: string | null;
}) {
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError('');
    workflow.history(taskId, kind, offset, controller.signal).then(result => {
      if (!controller.signal.aborted) setItems(result.items);
    }).catch(err => {
      if (!controller.signal.aborted) setError((err as Error).message);
    });
    return () => controller.abort();
  }, [taskId, kind, offset, version, retry]);

  return <section className="card workflow-panel">
    <h2>Saved {kind === 'export' ? 'packages' : kind === 'evaluation' ? 'evaluations' : 'validation runs'}</h2>
    {error && <p role="alert">{error} <button className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!error && !items && <p role="status">Loading history…</p>}
    {items?.length === 0 && <p>{offset ? 'End of history.' : 'No saved results yet.'}</p>}
    {items?.map(item => <div className="workflow-row history-row" key={item.id}>
      <button className="btn btn-secondary" aria-pressed={item.id === current} onClick={() => onSelect(item.id)}>
        {new Date(item.created_at).toLocaleString()}
      </button>
      <code>{item.id.slice(0, 8)}</code>
      {item.status && <StatusBadge status={item.status} />}
    </div>)}
    {(offset > 0 || items?.length === 20) && <div className="workflow-row">
      <button className="btn btn-secondary" disabled={!offset} onClick={() => setOffset(n => n - 20)}>Previous</button>
      <button className="btn btn-secondary" disabled={items?.length !== 20} onClick={() => setOffset(n => n + 20)}>Next</button>
    </div>}
  </section>;
}
