import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight,
  Sparkles,
  FileCode,
  BookOpen,
  Terminal,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { CodeViewer } from '../components/CodeViewer';
import { useProject } from '../context/ProjectContext';


export const ReferenceSolutionPage: React.FC = () => {
  const navigate = useNavigate();
  const { task, solution, queue, active, job } = useProject();

  const isLoading = active && job?.kind === 'solution';
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  const handleGenerateSolution = async () => {
    if (!task?.snapshot_id || active) return;
    setErrorMessage(null);
    try {
      await queue('solution');
      setSelectedFileIndex(0);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const activeFile = solution?.files[selectedFileIndex] || solution?.files[0];

  return (
    <div>
      <PageHeader
        title="Reference Solution Engine"
        description="Generates a reference implementation and checks whether the file changes apply to the starting snapshot."
      />

      {/* Task Context Check */}
      {!task ? (
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <AlertCircle size={28} style={{ color: 'var(--warning)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            No Active Task Specification
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '440px', margin: '0 auto 20px' }}>
            A reference solution is derived directly from a structured task specification. Generate or select a task first.
          </p>
          <Link to="/task-generator" className="btn btn-primary">
            <span>Go to Task Generator</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          {/* Active Task Banner & Action */}
          <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Target Task
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {task.title}
                </h3>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  onClick={handleGenerateSolution}
                  disabled={active || !task?.snapshot_id}
                  className="btn btn-primary"
                >
                  <Sparkles size={14} />
                  <span>{solution ? 'Regenerate Solution' : 'Synthesize Reference Solution'}</span>
                </button>

                {solution && (
                  <button
                    onClick={() => navigate('/test-suite')}
                    className="btn btn-secondary"
                  >
                    <span>Proceed to Test Suite</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Loading & Error States */}
          {!task.snapshot_id && <p className="workflow-hint">Generate a task from a repository snapshot to create a reference solution.</p>}
          {isLoading && (
            <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
              <LoadingState
                message="Synthesizing reference solution with Gemini AI..."
                subtext="Preparing complete file changes and checking their structure."
              />
            </div>
          )}

          {errorMessage && (
            <div style={{ marginBottom: '24px' }}>
              <ErrorState
                title="Solution Generation Failed"
                message={errorMessage}
                onRetry={handleGenerateSolution}
              />
            </div>
          )}

          {/* Solution Inspection View */}
          {solution && !isLoading && (
            <div>
              <p role="status" style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                {solution.structural_check?.status === 'applied_to_snapshot'
                  ? 'File changes applied to a disposable snapshot.'
                  : 'Snapshot application has not been checked.'}{' '}
                Execution and tests are pending.
              </p>
              {/* Architecture Notes & Verification Guide */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="card" style={{ padding: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                    <BookOpen size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <span>Architecture Notes</span>
                  </div>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                    {solution.architecture_notes}
                  </p>
                </div>

                <div className="card" style={{ padding: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                    <Terminal size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span>Testing Guide & Verification</span>
                  </div>
                  <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: '8px', backgroundColor: 'var(--bg-muted)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', overflowWrap: 'anywhere' }}>
                    {solution.testing_guide}
                  </div>
                  <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {solution.verification_steps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Solution File Selector and Code Viewer */}
              <div className="card workflow-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Solution Files ({solution.files.length})
                  </div>

                  {/* File Tabs */}
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', maxWidth: '100%', paddingBottom: '2px', WebkitOverflowScrolling: 'touch' }}>
                    {solution.files.map((file, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedFileIndex(idx)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          minHeight: '36px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          borderRadius: 'var(--radius-md)',
                          fontSize: '12px',
                          fontWeight: 500,
                          backgroundColor: selectedFileIndex === idx ? 'var(--accent-primary-light)' : 'var(--bg-muted)',
                          color: selectedFileIndex === idx ? 'var(--accent-primary)' : 'var(--text-secondary)',
                          border: `1px solid ${selectedFileIndex === idx ? 'var(--accent-primary-border)' : 'var(--border-default)'}`,
                        }}
                      >
                        <FileCode size={13} />
                        <span>{file.path}</span>
                        <StatusBadge status={file.status} size="sm" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* File Explanation */}
                {activeFile && (
                  <div style={{ marginBottom: '14px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    <strong>File Summary:</strong> {activeFile.explanation}
                  </div>
                )}

                {/* Code Preview */}
                {activeFile && activeFile.status !== 'delete' && (
                  <CodeViewer
                    code={activeFile.code}
                    language={activeFile.language}
                    filePath={activeFile.path}
                    maxHeight="460px"
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

