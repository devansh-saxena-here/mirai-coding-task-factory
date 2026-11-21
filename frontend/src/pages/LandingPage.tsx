import { Link } from 'react-router-dom';
import { ArrowRight, GitBranch, FileCode2, ListChecks, ShieldCheck, Package, ChartNoAxesCombined, Check, LockKeyhole } from 'lucide-react';

const features = [
  { icon: GitBranch, title: 'An exact starting point', text: 'Import a GitHub repository or ZIP. Preserve an immutable snapshot, its checksum, and the source commit when available.', color: 'blue' },
  { icon: FileCode2, title: 'Source-aware solutions', text: 'Generate feature requirements and reference changes grounded in real source files, with reviewable file-level changes.', color: 'green' },
  { icon: ListChecks, title: 'Tests with traceability', text: 'Connect acceptance criteria to feature tests and keep the original regression tests separately identifiable.', color: 'yellow' },
  { icon: ShieldCheck, title: 'Validation with evidence', text: 'Run baseline, build, feature, regression, and negative-control checks in fresh isolated workspaces with recorded commands and logs.', color: 'red' },
  { icon: Package, title: 'Harbor-ready packaging', text: 'Package the starting repository, Dockerfile, instructions, oracle, and verifier for reproducible Harbor 1.4 execution.', color: 'blue' },
  { icon: ChartNoAxesCombined, title: 'Agent evaluation', text: 'Compare coding-agent runs against the same task artifacts. Inspect rewards, failures, logs, and available usage metrics.', color: 'green' },
];

export function LandingPage() {
  return <>
    <section className="mirai-hero mirai-container">
      <div className="mirai-hero-copy">
        <p className="mirai-eyebrow"><span /> A workspace for AI coding evaluation</p>
        <h1>Real code.<br />Meaningful tasks.<br /><em>Measurable progress.</em></h1>
        <p className="mirai-lead">Turn working repositories into reproducible feature-development tasks. Generate, test, and evaluate with evidence at every step.</p>
        <div className="mirai-actions"><Link className="mirai-button" to="/new-project">Start with a repository <ArrowRight size={18} /></Link><Link className="mirai-text-link" to="/#workflow">Explore the workflow <ArrowRight size={17} /></Link></div>
        <p className="mirai-hero-note">GitHub or ZIP input · Python &amp; Node.js execution · Cloud Firestore persistence</p>
      </div>
      <div className="mirai-preview">
        <div className="mirai-preview-top"><span className="mirai-preview-dot" /> FROM SOURCE TO EVIDENCE <span>01 → 05</span></div>
        <div className="mirai-logo-panel"><img src="/mirai-logo.jpg" alt="MIRAI" width="260" height="250" /><p>A clearer view of what coding agents can do.</p></div>
        <div className="mirai-pipeline">{['Snapshot', 'Generate', 'Test', 'Validate', 'Evaluate'].map((step, i) => <div key={step}><span>{String(i + 1).padStart(2, '0')}</span><strong>{step}</strong></div>)}</div>
        <div className="mirai-preview-foot"><LockKeyhole size={15} /> Versioned artifacts. Traceable results.</div>
      </div>
    </section>
    <div className="mirai-principles"><span>Built on real source code</span><span>Preserve regression tests</span><span>Verify before scoring</span><span>Keep failure evidence</span></div>
    <section id="features" className="mirai-section mirai-container">
      <div className="mirai-section-heading"><div><p className="mirai-eyebrow">THE TOOLKIT</p><h2>A complete path from<br />repository to benchmark.</h2></div><p>Keep requirements, code changes, tests, and execution evidence connected in one workspace.</p></div>
      <div className="mirai-feature-grid">{features.map(({ icon: Icon, title, text, color }) => <article className="mirai-feature" key={title}><div className={'mirai-icon ' + color}><Icon size={23} /></div><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    <section id="workflow" className="mirai-workflow"><div className="mirai-container">
      <p className="mirai-eyebrow">HOW IT WORKS</p><h2>Build the task.<br />Then put it to the test.</h2>
      <div className="mirai-steps">{[
        ['Bring your code', 'Import a repository and inspect its languages, files, and immutable starting version.'],
        ['Define the change', 'Generate a feature task, review the reference solution, and map requirements to tests.'],
        ['Verify the task', 'Run isolated validation and check that feature tests detect the missing implementation.'],
        ['Evaluate and compare', 'Export to Harbor, run an agent, and review the recorded outcomes and evidence.'],
      ].map(([title, text], i) => <article key={title}><span className="mirai-step-number">0{i + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      <p className="mirai-runtime-note">Python and Node.js validation runs live in isolated temporary workspaces with stripped secrets. Exported Harbor 1.4 archives include an environment Dockerfile for local Docker/Harbor CLI execution. Unavailable runtimes or provider quotas are reported transparently.</p>
    </div></section>
    <section className="mirai-section mirai-container mirai-evidence"><div><p className="mirai-eyebrow">EVIDENCE OVER ASSUMPTIONS</p><h2>A result you can<br />actually inspect.</h2><p className="mirai-lead">A valid schema is only the start. MIRAI keeps structural checks separate from real execution, so a generated answer never becomes a passing benchmark by default.</p><Link className="mirai-text-link" to="/about">Meet MIRAI <ArrowRight size={17} /></Link></div><ul>{['Exact snapshot and artifact identities', 'Independent oracle and negative-control runs', 'Actual commands, exit codes, and logs', 'Feature and regression outcomes', 'Explicit blocked and unverified states'].map(text => <li key={text}><Check size={19} />{text}</li>)}</ul></section>
    <section className="mirai-cta mirai-container"><div><p className="mirai-eyebrow">START BUILDING</p><h2>Your next benchmark starts<br />with a repository.</h2><p>Bring a small Python project and follow the guided workflow.</p></div><Link className="mirai-button" to="/new-project">Create a project <ArrowRight size={18} /></Link></section>
  </>;
}
