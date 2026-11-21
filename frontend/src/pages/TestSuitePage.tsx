import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Sparkles,
  ArrowRight,
  Shield,
  FileCode,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { CodeViewer } from '../components/CodeViewer';
import { useProject } from '../context/ProjectContext';


export const TestSuitePage: React.FC = () => {
  const navigate = useNavigate();
  const { task, solution, testSuite, queue, active, job } = useProject();

  const isLoading = active && job?.kind === 'tests';
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'feature' | 'regression'>('feature');
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  const handleGenerateTestSuite = async () => {
    if (!task?.snapshot_id || !solution || active) return;
    setErrorMessage(null);
    try {
      await queue('tests');
      setSelectedFileIndex(0);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const featureFiles = testSuite?.feature_test_files || [];
  const regressionFiles = testSuite?.regression_test_files || [];
  const activeFileList = activeTab === 'feature' ? featureFiles : regressionFiles;
  const activeFile = activeFileList[selectedFileIndex] || activeFileList[0];

  return (
    <div>
      <PageHeader
        title="Automated Test Suite Engine"
        description="Synthesizes distinct feature tests (validating acceptance criteria) and regression tests (protecting baseline behavior) adhering to repository test conventions."
      />

      {/* Task & Solution Requirement Check */}
      {!task ? (
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <AlertCircle size={28} style={{ color: 'var(--warning)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            No Active Task Specification
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '440px', margin: '0 auto 20px' }}>
            Test generation requires a task specification. Generate a task first to synthesize targeted tests.
          </p>
          <Link to="/task-generator" className="btn btn-primary">
            <span>Go to Task Generator</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          {/* Action Card */}
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
                  onClick={handleGenerateTestSuite}
                  disabled={active || !task?.snapshot_id || !solution}
                  className="btn btn-primary"
                >
                  <Sparkles size={14} />
                  <span>{testSuite ? 'Regenerate Tests' : 'Synthesize Test Suite'}</span>
                </button>

                {testSuite && (
                  <button
                    onClick={() => navigate('/validation')}
                    className="btn btn-secondary"
                  >
                    <span>Proceed to Validation</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Loading & Error States */}
          {!solution && <p className="workflow-hint">Save a reference solution before generating tests.</p>}
          {isLoading && (
            <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
              <LoadingState
                message="Synthesizing repository-aware test suite with Gemini AI..."
                subtext="Deriving feature assertion cases from acceptance criteria and generating regression protection checks."
              />
            </div>
          )}

          {errorMessage && (
            <div style={{ marginBottom: '24px' }}>
              <ErrorState
                title="Test Synthesis Failed"
                message={errorMessage}
                onRetry={handleGenerateTestSuite}
              />
            </div>
          )}

          {/* Test Suite View */}
          {testSuite && !isLoading && (
            <div>
              <p role="status" style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                {testSuite.quality_status === 'structurally_checked'
                  ? 'Static checks completed. Execution status is Not run.'
                  : 'Draft suite. Snapshot checks and execution remain outstanding.'}
              </p>
              {/* Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(155px, 100%), 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>FEATURE TESTS</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--accent-primary)', marginTop: '2px' }}>
                    {testSuite.total_feature_tests} test cases
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {testSuite.feature_test_files.length} test files
                  </div>
                </div>

                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>GENERATED REGRESSION TESTS</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--success)', marginTop: '2px' }}>
                    {testSuite.total_regression_tests} test cases
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {testSuite.regression_test_files.length} test files
                  </div>
                </div>

                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>TEST FRAMEWORK</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
                    {testSuite.repository.test_framework}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {testSuite.repository.project_name}
                  </div>
                </div>

                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>EXECUTION COMMAND</div>
                  <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {testSuite.execution_plan?.feature[0]?.argv.join(' ') || testSuite.execution_instructions}
                  </div>
                </div>
              </div>

              {testSuite.coverage_matrix && testSuite.coverage_matrix.length > 0 && (
                <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                  <h3>Acceptance criteria coverage</h3>
                  <ul style={{ paddingLeft: '18px', fontSize: '12.5px' }}>
                    {testSuite.coverage_matrix.map((row) => (
                      <li key={row.id}>
                        <strong>{row.id}</strong> {row.text}
                        <ul style={{ paddingLeft: '18px' }}>
                          {row.feature_tests.map((item) => (
                            <li key={item.case_id}><code>{item.file_path} · {item.selector}</code></li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Boolean(testSuite.requirement_coverage?.length) && (
                <div className="card workflow-panel">
                  <h3>Requirement coverage</h3>
                  {testSuite.requirement_coverage?.map(row => (
                    <div key={row.id}>
                      <strong>{row.id}</strong> {row.text}
                      <ul style={{ paddingLeft: '18px' }}>
                        {row.feature_tests.map(item => <li key={item.case_id}><code>{item.file_path} · {item.selector}</code></li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {testSuite.original_regression_files && testSuite.original_regression_files.length > 0 && (
                <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                  <h3>Original regression files</h3>
                  <ul style={{ paddingLeft: '18px', fontSize: '12.5px' }}>
                    {testSuite.original_regression_files.map((file) => (
                      <li key={file.path} title={file.sha256}><code>{file.path}</code></li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Architectural Separation: Feature Tests vs Regression Tests */}
              <div className="card workflow-panel">
                {/* Category Selector Tabs */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px', borderBottom: '1px solid var(--border-default)', paddingBottom: '12px' }}>
                  <button
                    onClick={() => {
                      setActiveTab('feature');
                      setSelectedFileIndex(0);
                    }}
                    className={`btn ${activeTab === 'feature' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Sparkles size={13} />
                    <span>Feature Tests ({featureFiles.length} files)</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('regression');
                      setSelectedFileIndex(0);
                    }}
                    className={`btn ${activeTab === 'regression' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <Shield size={13} />
                    <span>Generated Regression ({regressionFiles.length} files)</span>
                  </button>
                </div>

                {/* File Selector Tabs within Active Category */}
                {activeFileList.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', overflowX: 'auto', maxWidth: '100%', paddingBottom: '2px', WebkitOverflowScrolling: 'touch' }}>
                    {activeFileList.map((file, idx) => (
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
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          ({file.test_cases.length} cases)
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Active Test File Code Preview */}
                {activeFile ? (
                  <CodeViewer
                    code={activeFile.code}
                    language={activeFile.framework || 'python'}
                    filePath={activeFile.path}
                    maxHeight="440px"
                  />
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No test files in this category.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};


