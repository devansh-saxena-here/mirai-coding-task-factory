import { useEffect, useState } from 'react';
import { requestText } from '../services/api';

export function EvidenceLog({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLog(null);
    setError('');
    requestText(path, controller.signal).then(value => {
      if (!controller.signal.aborted) setLog(value);
    }).catch(err => {
      if (!controller.signal.aborted) setError((err as Error).message);
    });
    return () => controller.abort();
  }, [open, path]);
  return <div>
    <button className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Close log' : 'View log'}
    </button>
    {open && (error ? <p role="alert">{error}</p> : log === null ? <p role="status">Loading log…</p> : <pre className="evidence-log">{log || '(Empty log)'}</pre>)}
  </div>;
}
