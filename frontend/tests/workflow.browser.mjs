// Headless Chromium smoke test with a fixture API or a read-only local evidence server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [chrome, distArg = 'dist', screenshotArg] = process.argv.slice(2);
if (!chrome) throw new Error('Usage: node tests/workflow.browser.mjs <Chrome or Edge binary> [dist] [screenshot directory]');
const dist = resolve(distArg);
const liveOrigin = process.env.CTF_BROWSER_API;
const liveTask = process.env.CTF_BROWSER_TASK_ID;
if (liveOrigin && (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(liveOrigin) || !liveTask)) {
  throw new Error('The live smoke test requires a loopback API origin and an exact task ID.');
}
const clock = new Date().toISOString();
const snapshot = {
  project_name: 'Warehouse (browser fixture)', source_type: 'github', detected_languages: ['Python'],
  detected_frameworks: [], file_count: 2, folder_structure: ['warehouse.py', 'tests/test_original.py'],
  readme_summary: 'Synthetic example used to exercise the frontend.', analysis_status: 'completed',
  commit_sha: 'a'.repeat(40), snapshot_id: 'snap_' + 'b'.repeat(64), content_sha256: 'c'.repeat(64),
  repository_identity: 'https://github.com/example/warehouse', retrieved_at: clock,
  test_frameworks: ['unittest'], existing_test_files: ['tests/test_original.py'], baseline_test_commands: [],
};
const task = {
  id: 'fixture-task', title: 'Reserve two warehouse units', topic: 'Warehouse reservations',
  language: 'Python', category: 'backend', difficulty: 'medium', description: 'Update the default reservation.',
  requirements: ['Return two units.'], acceptance_criteria: ['A new reservation returns two units.'],
  snapshot_id: snapshot.snapshot_id, starting_commit_sha: snapshot.commit_sha, generated_at: clock,
  relevant_files: ['warehouse.py'], project_name: snapshot.project_name,
};
const solution = {
  id: 'fixture-solution', task_id: task.id, task_title: task.title, generated_at: clock,
  architecture_notes: 'The fixture changes one return value.',
  files: [{ path: 'warehouse.py', status: 'modify', language: 'python', code: 'def reserve():\n    return 2\n',
    explanation: 'Return the requested quantity.', requirement_ids: ['R1'], acceptance_criteria_ids: ['AC1'] }],
  testing_guide: 'Run the fixture reservation test.', verification_steps: ['Check the reservation quantity.'],
};
const suite = {
  id: 'fixture-tests', task_id: task.id, task_title: task.title, repository: { ...snapshot, test_framework: 'unittest' },
  feature_test_files: [], regression_test_files: [], original_regression_files: [{ path: 'tests/test_original.py', sha256: 'd'.repeat(64) }],
  total_feature_tests: 1, total_regression_tests: 0, coverage_summary: 'One criterion and one feature test.',
  execution_instructions: 'python -m unittest', quality_status: 'structurally_checked', generated_at: clock,
  coverage_matrix: [{ id: 'AC1', text: task.acceptance_criteria[0], feature_tests: [
    { case_id: 'FT1', file_path: 'tests/test_feature.py', selector: 'Feature.test_reservation' },
  ] }],
};
const validation = {
  id: 'fixture-validation', task_id: task.id, solution_id: solution.id, test_suite_id: suite.id,
  overall_verdict: 'VALIDATED', execution_mode: 'docker', execution_duration_ms: 803,
  baseline_status: 'passed', solution_applied_successfully: true, created_files: [], modified_files: ['warehouse.py'],
  mutation_test_status: 'passed', rejection_reasons: [], evidence_location: 'fixture-validation/report.json', created_at: clock,
  gates: ['baseline', 'reference', 'feature', 'regression', 'negative_control'].map(gate => ({
    gate, status: 'passed', detail: 'Synthetic fixture evidence for browser verification.',
    runs: [{ exit_code: gate === 'negative_control' ? 1 : 0, duration_ms: 150, log_location: 'fixture-validation/' + gate + '.log',
      commands: [{ argv: ['python', '-m', 'unittest'], working_directory: '.', exit_code: 0 }] }],
  })),
};
const archive = { id: 'fixture-archive', filename: 'warehouse.zip', sha256: 'e'.repeat(64), validation_status_recorded: 'VALIDATED' };
const evaluation = {
  id: 'fixture-evaluation', task_id: task.id, mode: 'control', state: 'blocked', failure: 'environment_failure',
  detail: 'Synthetic evaluation fixture. No Harbor or provider run was attempted.',
  package: null, oracle: null, baseline_control: null, trials: [], metrics: [],
};
const records = { solution, tests: suite, validation, export: archive, evaluation };
const saved = {};
let project = false;
let taskSaved = false;
let revision = 0;
let job = null;
const calls = [];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://127.0.0.1');
  const json = (value, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  try {
    if (liveOrigin && /^\/(auth|health|tasks|projects|snapshots|history|jobs)(\/|$)/.test(pathname)) {
      if (request.method !== 'GET') return json({ detail: 'The evidence smoke test is read only.' }, 405);
      const upstream = await fetch(liveOrigin + request.url);
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'text/plain' });
      return response.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if (pathname === '/health') return json({ status: 'healthy' });
    if (pathname === '/auth/session') return json({ required: false });
    if (pathname === '/projects') return json({ projects: project ? [{ id: 'project', name: snapshot.project_name, snapshot }] : [] });
    if (pathname === '/snapshots/' + snapshot.snapshot_id) return json(snapshot);
    if (pathname === '/tasks/analyze/github' && request.method === 'POST') { project = true; return json(snapshot); }
    if (pathname === '/tasks/generate/from-repo' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.equal(JSON.parse(body).snapshot_id, snapshot.snapshot_id);
      taskSaved = true;
      return json(task, 201);
    }
    if (pathname === '/tasks/') return json({
      tasks: taskSaved ? [task] : [], states: taskSaved ? [{ verdict: saved.validation?.overall_verdict ?? null }] : [], total: Number(taskSaved),
    });
    if (pathname === '/tasks/' + task.id) return json({
      task, snapshot, project_id: 'project', revision, solution: saved.solution ?? null, test_suite: saved.tests ?? null,
      validation: saved.validation ?? null, export: saved.export ?? null, jobs: job ? [job] : [],
    });
    if (pathname === '/tasks/' + task.id + '/jobs' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { kind, revision: expected, request_key } = JSON.parse(body);
      assert.equal(expected, revision);
      assert.ok(request_key);
      assert.ok(!job || job.state === 'completed');
      calls.push(kind);
      job = { id: 'job-' + kind, kind, state: 'running', result_id: null, cancel_requested: false, error: null };
      setTimeout(() => {
        saved[kind] = records[kind];
        if (['solution', 'tests', 'validation'].includes(kind)) revision++;
        job = { ...job, state: 'completed', result_id: records[kind].id };
      }, kind === 'validation' ? 2600 : 100);
      return json(job, 202);
    }
    if (pathname.startsWith('/jobs/')) return json(job);
    if (pathname.startsWith('/tasks/' + task.id + '/history/')) {
      const kind = pathname.split('/').at(-1);
      return json({ items: saved[kind] ? [{ id: saved[kind].id, created_at: clock, status: saved[kind].state ?? saved[kind].overall_verdict }] : [] });
    }
    if (pathname.startsWith('/history/validation/') && pathname.includes('/logs/')) {
      return response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Fixture log: isolated command evidence.');
    }
    if (pathname === '/history/evaluation/' + evaluation.id) return json(evaluation);
    if (pathname === '/history/validation/' + validation.id) return json(validation);
    if (pathname === '/history/export/' + archive.id + '/download') {
      calls.push('download');
      return response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="warehouse.zip"' }).end('Synthetic ZIP download response');
    }
    if (pathname.startsWith('/tasks/') || pathname.startsWith('/history/')) return json({ detail: 'Fixture route missing' }, 404);
    const file = resolve(dist, '.' + pathname);
    assert.ok(file === dist || file.startsWith(dist + sep));
    const extension = extname(file);
    const bytes = await readFile(extension ? file : resolve(dist, 'index.html'));
    response.writeHead(200, { 'Content-Type': types[extension] ?? 'text/html' }).end(bytes);
  } catch (err) {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err));
  }
});

async function until(fn, label) {
  const expires = Date.now() + 12000;
  while (Date.now() < expires) {
    const result = await fn();
    if (result) return result;
    await sleep(100);
  }
  throw new Error('Timed out waiting for ' + label);
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'ctf-browser-fixture-'));
const browser = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--disable-background-networking',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--no-proxy-server',
  '--disable-extensions', '--no-first-run', '--window-size=1365,960', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  const port = await until(async () => (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0], 'Chromium');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  const pending = new Map();
  let commandId = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const shown = async value => {
    try { await until(() => evaluate('document.body?.innerText.includes(' + JSON.stringify(value) + ')'), value); }
    catch (error) {
      console.error('Page state:', await evaluate('location.href + "\\n" + document.body?.innerText'));
      throw error;
    }
  };
  const click = value => until(() => evaluate(`(() => {
    const element = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(value)} && !e.disabled);
    if (!element) return false; element.click(); return true;
  })()`), value);
  const capture = async name => {
    if (!screenshotArg) return;
    await mkdir(screenshotArg, { recursive: true });
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(screenshotArg, name), Buffer.from(data, 'base64'));
  };
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1365, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  await shown('Measurable progress.');
  assert.equal(await evaluate('document.title'), 'MIRAI — Real repositories. Measurable AI.');
  assert.equal(await evaluate("[...document.images].every(image => image.complete && image.naturalWidth > 0)"), true, 'Logo assets load');
  await capture('mirai-landing-desktop.png');
  await click('Features');
  await shown('A complete path from');
  await click('About');
  await shown('Better coding evaluations');
  await capture('mirai-about-desktop.png');
  await cdp('Page.reload', { ignoreCache: true });
  await shown('Supported scope');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'About fits mobile viewport');
  await capture('mirai-about-mobile.png');
  await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  await shown('Measurable progress.');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Landing fits mobile viewport');
  await capture('mirai-landing-mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1365, height: 960, deviceScaleFactor: 1, mobile: false });
  await click('Open dashboard');
  if (liveOrigin) {
    await shown('Allow opting out of URL-safe token compression');
    await shown('VALIDATED');
    await capture('phase8-dashboard.png');
    await evaluate('localStorage.setItem("ctf.selection.v1", ' + JSON.stringify(JSON.stringify({ task: liveTask })) + ')');
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/validation' });
    await shown('Overall Verdict: VALIDATED');
    await shown('Negative controls');
    await capture('phase8-validation.png');
    await cdp('Page.reload', { ignoreCache: true });
    await shown('Overall Verdict: VALIDATED');
    await click('Agent Evaluation');
    await shown('Benchmark report');
    await shown('Reward 1');
    await shown('Reward 0');
    await capture('phase8-harbor-controls.png');
    console.log('PASS: real SQLite-backed task, validation after reload, and Harbor rewards in the dashboard.');
  } else {
  await shown('No tasks match');
  await click('New project');
  await click('Public GitHub URL');
  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder="https://github.com/owner/repository"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(snapshot.repository_identity)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('Analyze Codebase');
  await shown(snapshot.snapshot_id);
  await click('Task Generator');
  await click('Generate Contextual Task');
  await shown(task.title);
  await click('Proceed to Solution Engine');
  await click('Synthesize Reference Solution');
  await shown('warehouse.py');
  await click('Proceed to Test Suite');
  await click('Synthesize Test Suite');
  await shown('Acceptance criteria coverage');
  await shown('Original regression files');
  await click('Validation');
  await click('Run Validation Gates');
  await shown('RUNNING');
  await cdp('Page.reload', { ignoreCache: true });
  await shown('Overall Verdict: VALIDATED');
  await click('View log');
  await shown('Fixture log: isolated command evidence.');
  await capture('phase7-validation-fixture.png');
  await click('Harbor Export');
  await click('Build Harbor package');
  await click('Download package');
  await shown('Download started.');
  await click('Agent Evaluation');
  await click('Run controls');
  await shown('Synthetic evaluation fixture.');
  await click('Dashboard');
  await shown(task.title);
  await shown('VALIDATED');
  await capture('phase7-dashboard-fixture.png');
  assert.deepEqual(calls, ['solution', 'tests', 'validation', 'export', 'download', 'evaluation']);
  console.log('PASS: MIRAI landing, About, mobile layout, public navigation, repository analysis, generation, solution, coverage, validation reload, logs, export, evaluation and dashboard.');
  }
} finally {
  socket?.close();
  if (browser.exitCode === null && browser.pid) {
    browser.kill();
    await Promise.race([once(browser, 'exit').catch(() => {}), sleep(5000)]);
    browser.unref();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
