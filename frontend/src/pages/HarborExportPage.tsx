import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EvidenceHistory } from '../components/EvidenceHistory';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useProject } from '../context/ProjectContext';
import { workflow } from '../services/workflowService';

export function HarborExportPage() {
  const { task, solution, testSuite, validationReport, savedExport, active, queue, job } = useProject();
  const [prefix, setPrefix] = useState('ctf');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const ready = Boolean(task?.snapshot_id && solution && testSuite);
  const verified = validationReport?.overall_verdict === 'VALIDATED';
  useEffect(() => { setNotice(''); setError(''); }, [task?.id]);
  const generate = async () => {
    setError('');
    setNotice('');
    try { await queue('export', { task_prefix: prefix }); }
    catch (err) { setError((err as Error).message); }
  };
  const download = async (id: string) => {
    setError('');
    setNotice('');
    setDownloading(true);
    try {
      await workflow.download('/history/export/' + id + '/download');
      setNotice('Download started.');
    } catch (err) { setError((err as Error).message); }
    finally { setDownloading(false); }
  };
  return <>
    <PageHeader title="Harbor Export" description="Package the saved task, starting snapshot, reference solution, and verifier." />
    <section className="card workflow-panel">
      <div className="workflow-row workflow-spread">
        <h2>{task?.title || 'No task selected'}</h2>
        {ready && <StatusBadge status={verified ? 'VALIDATED' : 'Unverified package'} />}
      </div>
      {!ready ? <p>Select a snapshot-backed task with a saved solution and test suite.</p> : <>
        <p>{verified ? 'The package will include the current server-verified validation record.' : 'You can export an unverified package or run validation first.'}</p>
        <div className="workflow-row">
          <label>Task name prefix <input value={prefix} maxLength={40} onChange={e => setPrefix(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={active || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(prefix)} onClick={() => void generate()}>Build Harbor package</button>
          {savedExport && <button className="btn btn-secondary" disabled={downloading} onClick={() => void download(savedExport.id)}>Download package</button>}
        </div>
        {savedExport && <div className="snapshot-details">
          <dl><dt>Archive</dt><dd>{savedExport.filename}</dd><dt>SHA-256</dt><dd><code>{savedExport.sha256}</code></dd></dl>
        </div>}
      </>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="workflow-row">
        <Link className="btn btn-secondary" to="/validation">Validation evidence</Link>
        <Link className="btn btn-secondary" to="/evaluation">Agent evaluation</Link>
      </div>
    </section>
    {task && <EvidenceHistory key={task.id} taskId={task.id} kind="export" current={savedExport?.id}
      onSelect={id => { if (!downloading) void download(id); }} version={job?.result_id} />}
  </>;
}
