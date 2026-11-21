import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestFile } from './types.ts';

export interface CommandRunResult {
  argv: string[];
  working_directory: string;
  exit_code: number | null;
  duration_ms: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface PatchApplyResult {
  ok: boolean;
  error?: string;
  appliedPaths: string[];
}

export interface ParsedTestCase {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
}

export interface TestSuiteRunResult {
  supported: boolean;
  passed: boolean;
  skippedReason?: string;
  totalExecuted: number;
  passedCount: number;
  failedCount: number;
  errorCount: number;
  skippedCount?: number;
  cases?: ParsedTestCase[];
  missingDependency?: string;
  command: CommandRunResult;
}

export interface AstVerificationResult {
  ok: boolean;
  syntaxOk: boolean;
  testFunctionCount: number;
  assertionCount: number;
  changedSymbolCount: number;
  preservedExistingSymbols: boolean;
  deletedSymbols: string[];
  referencedTargetSymbols: string[];
  vacuousTests: boolean;
  detail: string;
  command: CommandRunResult;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const SANDBOX_RUNNER_FILENAME = '_mirai_test_runner.py';

let cachedPythonBin: string | null | undefined;
let cachedPytestAvailable: boolean | undefined;

export function detectPythonBinary(): string | null {
  if (cachedPythonBin !== undefined) return cachedPythonBin;
  for (const bin of ['python3', 'python']) {
    const res = spawnSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (!res.error && res.status === 0) {
      cachedPythonBin = bin;
      return bin;
    }
  }
  cachedPythonBin = null;
  return null;
}

export function isPytestAvailable(): boolean {
  if (cachedPytestAvailable !== undefined) return cachedPytestAvailable;
  const py = detectPythonBinary();
  if (!py) {
    cachedPytestAvailable = false;
    return false;
  }
  const res = spawnSync(py, ['-m', 'pytest', '--version'], {
    encoding: 'utf8',
    timeout: 4000,
  });
  cachedPytestAvailable = !res.error && res.status === 0;
  return cachedPytestAvailable;
}

function buildSandboxEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: workspaceDir,
    TMPDIR: workspaceDir,
    TEMP: workspaceDir,
    TMP: workspaceDir,
    PYTHONPATH: workspaceDir,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    NODE_ENV: 'test',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  };
}

export function safeResolveWorkspacePath(workspaceDir: string, relPath: string): string | null {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!cleaned || cleaned.includes('\0')) return null;
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) {
    return null;
  }
  const resolved = path.resolve(workspaceDir, cleaned);
  const normalizedRoot = path.resolve(workspaceDir) + path.sep;
  if (!resolved.startsWith(normalizedRoot)) return null;
  return resolved;
}

export function createIsolatedWorkspace(snapshotFiles: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirai-sandbox-'));
  for (const [relPath, content] of Object.entries(snapshotFiles)) {
    const abs = safeResolveWorkspacePath(tmpDir, relPath);
    if (!abs) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return tmpDir;
}

export function cleanupWorkspace(workspaceDir: string) {
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

export function applyFileChanges(
  workspaceDir: string,
  changes: Array<{ path: string; operation: string; code: string }>
): PatchApplyResult {
  const appliedPaths: string[] = [];
  for (const change of changes) {
    const abs = safeResolveWorkspacePath(workspaceDir, change.path);
    if (!abs) {
      return {
        ok: false,
        error: `Unsafe or invalid file path rejected: "${change.path}"`,
        appliedPaths,
      };
    }
    const op = (change.operation || 'modify').toLowerCase();
    if (op === 'delete') {
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
      }
      appliedPaths.push(change.path);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, change.code ?? '', 'utf8');
      appliedPaths.push(change.path);
    }
  }
  return { ok: true, appliedPaths };
}

export function writeTestFilesToWorkspace(workspaceDir: string, testFiles: TestFile[]): string[] {
  const written: string[] = [];
  for (const tf of testFiles) {
    const cleanRel = tf.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = safeResolveWorkspacePath(workspaceDir, cleanRel);
    if (!abs) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, tf.code || '', 'utf8');
    written.push(cleanRel);
  }
  return written;
}

export function runCommandInSandbox(
  workspaceDir: string,
  argv: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): CommandRunResult {
  const t0 = Date.now();
  const [cmd, ...args] = argv;
  const res = spawnSync(cmd, args, {
    cwd: workspaceDir,
    env: buildSandboxEnv(workspaceDir),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  const duration_ms = Math.max(1, Date.now() - t0);
  const timed_out = Boolean(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  const stdout = (res.stdout || '').slice(0, 64_000);
  const stderr =
    (res.stderr || '') +
    (res.error && !timed_out ? `\n[spawn error] ${res.error.message}` : '');

  return {
    argv,
    working_directory: '.',
    exit_code: timed_out ? null : res.status,
    duration_ms,
    stdout,
    stderr: stderr.slice(0, 64_000),
    timed_out,
  };
}

export function verifyWorkspaceSyntax(
  workspaceDir: string,
  targetPaths: string[]
): { ok: boolean; commands: CommandRunResult[]; detail: string } {
  const commands: CommandRunResult[] = [];
  const pyFiles = targetPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p.endsWith('.py') && fs.existsSync(path.join(workspaceDir, p)));
  const jsFiles = targetPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => /\.(?:m?js|cjs)$/i.test(p) && fs.existsSync(path.join(workspaceDir, p)));
  const jsonFiles = targetPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p.endsWith('.json') && fs.existsSync(path.join(workspaceDir, p)));

  let allOk = true;
  const issues: string[] = [];

  if (pyFiles.length > 0) {
    const py = detectPythonBinary();
    if (py) {
      const cmdRes = runCommandInSandbox(workspaceDir, [py, '-m', 'py_compile', ...pyFiles], 15_000);
      commands.push(cmdRes);
      if (cmdRes.exit_code !== 0 || cmdRes.timed_out) {
        allOk = false;
        issues.push(`Python syntax compilation failed: ${(cmdRes.stderr || cmdRes.stdout).trim().slice(0, 400)}`);
      }
    }
  }

  for (const jsFile of jsFiles.slice(0, 20)) {
    const cmdRes = runCommandInSandbox(workspaceDir, [process.execPath, '--check', jsFile], 10_000);
    commands.push(cmdRes);
    if (cmdRes.exit_code !== 0 || cmdRes.timed_out) {
      allOk = false;
      issues.push(`JavaScript syntax check failed for ${jsFile}: ${(cmdRes.stderr || cmdRes.stdout).trim().slice(0, 300)}`);
    }
  }

  for (const jsonFile of jsonFiles.slice(0, 20)) {
    const t0 = Date.now();
    try {
      JSON.parse(fs.readFileSync(path.join(workspaceDir, jsonFile), 'utf8'));
      commands.push({
        argv: ['json-parse', jsonFile],
        working_directory: '.',
        exit_code: 0,
        duration_ms: Math.max(1, Date.now() - t0),
        stdout: `${jsonFile}: valid JSON\n`,
        stderr: '',
        timed_out: false,
      });
    } catch (err) {
      allOk = false;
      const msg = err instanceof Error ? err.message : 'Invalid JSON';
      issues.push(`JSON syntax error in ${jsonFile}: ${msg}`);
      commands.push({
        argv: ['json-parse', jsonFile],
        working_directory: '.',
        exit_code: 1,
        duration_ms: Math.max(1, Date.now() - t0),
        stdout: '',
        stderr: `${jsonFile}: ${msg}\n`,
        timed_out: false,
      });
    }
  }

  const detail = allOk
    ? commands.length > 0
      ? `Compiled and syntax-checked ${pyFiles.length} Python, ${jsFiles.length} JS, and ${jsonFiles.length} JSON file(s) with 0 errors.`
      : `Applied ${targetPaths.length} file(s) cleanly to isolated workspace.`
    : issues.join(' | ');

  return { ok: allOk, commands, detail };
}

/**
 * Zero-dependency Python 3.11+ test runner supporting both unittest.TestCase
 * and pytest-style test_* functions (including pytest.raises, pytest.approx,
 * pytest.mark.parametrize, pytest.fixture, tmp_path, capsys, monkeypatch).
 */
const PYTHON_TEST_RUNNER_SCRIPT = String.raw`
import contextlib
import importlib.util
import inspect
import io
import itertools
import math
import os
import pathlib
import re
import sys
import tempfile
import time
import traceback
import types
import unittest

# Ensure workspace root (and common src/backend subdirs) are importable
ROOT = os.getcwd()
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
for _sub in ("src", "backend"):
    _sub_dir = os.path.join(ROOT, _sub)
    if os.path.isdir(_sub_dir) and _sub_dir not in sys.path:
        sys.path.insert(0, _sub_dir)


def _install_pytest_shim():
    if "pytest" in sys.modules:
        return
    try:
        import pytest  # noqa: F401
        return
    except ImportError:
        pass

    mod = types.ModuleType("pytest")

    class Skipped(Exception):
        pass

    class Failed(AssertionError):
        pass

    class ExceptionInfo:
        def __init__(self, exc=None):
            self.value = exc
            self.type = type(exc) if exc is not None else None

    class _RaisesCtx:
        def __init__(self, expected, match=None):
            self.expected = expected
            self.match = match
            self.excinfo = ExceptionInfo()

        def __enter__(self):
            return self.excinfo

        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is None:
                raise AssertionError(f"DID NOT RAISE {self.expected}")
            if not issubclass(exc_type, self.expected):
                return False
            self.excinfo.value = exc_val
            self.excinfo.type = exc_type
            if self.match is not None and not re.search(self.match, str(exc_val)):
                raise AssertionError(f"Regex pattern {self.match!r} did not match {str(exc_val)!r}")
            return True

    def raises(expected, *args, match=None, **kwargs):
        if args:
            fn = args[0]
            with _RaisesCtx(expected, match=match) as info:
                fn(*args[1:], **kwargs)
            return info
        return _RaisesCtx(expected, match=match)

    class _Approx:
        def __init__(self, expected, rel=1e-6, abs=1e-12):
            self.expected = expected
            self.rel = rel
            self.abs = abs

        def __eq__(self, actual):
            if isinstance(self.expected, (list, tuple)) and isinstance(actual, (list, tuple)):
                return len(self.expected) == len(actual) and all(
                    _Approx(e, self.rel, self.abs) == a for e, a in zip(self.expected, actual)
                )
            if isinstance(self.expected, dict) and isinstance(actual, dict):
                return self.expected.keys() == actual.keys() and all(
                    _Approx(self.expected[k], self.rel, self.abs) == actual[k] for k in self.expected
                )
            try:
                return math.isclose(float(actual), float(self.expected), rel_tol=self.rel, abs_tol=self.abs)
            except Exception:
                return actual == self.expected

        def __repr__(self):
            return f"approx({self.expected!r})"

    def approx(expected, rel=1e-6, abs=1e-12):
        return _Approx(expected, rel=rel, abs=abs)

    def fail(msg=""):
        raise Failed(msg or "pytest.fail()")

    def skip(msg=""):
        raise Skipped(msg or "pytest.skip()")

    def xfail(msg=""):
        raise Skipped(f"xfail: {msg}")

    def fixture(func=None, **kwargs):
        def decorator(fn):
            fn._mirai_fixture = True
            return fn
        return decorator(func) if callable(func) else decorator

    class _MarkNamespace:
        def parametrize(self, argnames, argvalues, **kwargs):
            names = [a.strip() for a in argnames.split(",")] if isinstance(argnames, str) else list(argnames)
            vals = list(argvalues)
            def decorator(fn):
                existing = getattr(fn, "_mirai_parametrize", [])
                existing.append((names, vals))
                fn._mirai_parametrize = existing
                return fn
            return decorator

        def skip(self, reason=""):
            def decorator(fn):
                fn._mirai_skip = reason or "skipped"
                return fn
            return decorator

        def skipif(self, condition, reason=""):
            def decorator(fn):
                if condition:
                    fn._mirai_skip = reason or "skipif condition true"
                return fn
            return decorator

        def __getattr__(self, _name):
            def marker(*args, **kwargs):
                if len(args) == 1 and callable(args[0]) and not kwargs:
                    return args[0]
                return lambda fn: fn
            return marker

    class _Param:
        def __init__(self, *values, id=None, marks=()):
            self.values = values
            self.id = id
            self.marks = marks

    mod.raises = raises
    mod.approx = approx
    mod.fail = fail
    mod.skip = skip
    mod.xfail = xfail
    mod.fixture = fixture
    mod.mark = _MarkNamespace()
    mod.param = lambda *values, id=None, marks=(): _Param(*values, id=id, marks=marks)
    mod.Skipped = Skipped
    mod.Failed = Failed
    sys.modules["pytest"] = mod


class _MonkeyPatch:
    def __init__(self):
        self._undos = []

    def setattr(self, target, name, value=None, raising=True):
        if isinstance(target, str):
            parts = target.rsplit(".", 1)
            obj = __import__(parts[0], fromlist=[parts[1]])
            attr = parts[1]
            val = name
        else:
            obj, attr, val = target, name, value
        sentinel = object()
        old = getattr(obj, attr, sentinel)
        if old is sentinel and raising:
            raise AttributeError(f"{obj} has no attribute {attr}")
        setattr(obj, attr, val)
        self._undos.append(lambda: delattr(obj, attr) if old is sentinel else setattr(obj, attr, old))

    def setenv(self, name, value, prepend=None):
        old = os.environ.get(name)
        if prepend and old:
            os.environ[name] = str(value) + prepend + old
        else:
            os.environ[name] = str(value)
        self._undos.append(lambda: os.environ.pop(name, None) if old is None else os.environ.__setitem__(name, old))

    def delenv(self, name, raising=True):
        old = os.environ.get(name)
        if old is None and raising:
            raise KeyError(name)
        os.environ.pop(name, None)
        if old is not None:
            self._undos.append(lambda: os.environ.__setitem__(name, old))

    def chdir(self, path):
        old = os.getcwd()
        os.chdir(str(path))
        self._undos.append(lambda: os.chdir(old))

    def setitem(self, mapping, name, value):
        sentinel = object()
        old = mapping.get(name, sentinel)
        mapping[name] = value
        self._undos.append(lambda: mapping.pop(name, None) if old is sentinel else mapping.__setitem__(name, old))

    def undo(self):
        for fn in reversed(self._undos):
            try:
                fn()
            except Exception:
                pass
        self._undos.clear()


class _Capsys:
    def __init__(self):
        self._out = io.StringIO()
        self._err = io.StringIO()

    def readouterr(self):
        res = types.SimpleNamespace(out=self._out.getvalue(), err=self._err.getvalue())
        self._out = io.StringIO()
        self._err = io.StringIO()
        return res


def _resolve_fixtures(fn, bound_kwargs, fixtures, cleanup_stack):
    sig = inspect.signature(fn)
    kwargs = dict(bound_kwargs)
    capsys_obj = None
    for name, param in sig.parameters.items():
        if name in kwargs:
            continue
        if name in ("tmp_path", "tmpdir"):
            td = tempfile.mkdtemp(prefix="mirai_tp_")
            cleanup_stack.append(lambda d=td: _rm_tree(d))
            kwargs[name] = pathlib.Path(td)
        elif name == "monkeypatch":
            mp = _MonkeyPatch()
            cleanup_stack.append(mp.undo)
            kwargs[name] = mp
        elif name == "capsys":
            capsys_obj = _Capsys()
            kwargs[name] = capsys_obj
        elif name in fixtures:
            fix_fn = fixtures[name]
            fix_kwargs, _ = _resolve_fixtures(fix_fn, {}, fixtures, cleanup_stack)
            val = fix_fn(**fix_kwargs)
            if inspect.isgenerator(val):
                yielded = next(val)
                cleanup_stack.append(lambda g=val: _close_gen(g))
                kwargs[name] = yielded
            else:
                kwargs[name] = val
        elif param.default is inspect.Parameter.empty and param.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            raise RuntimeError(f"Unresolved test fixture: {name}")
    return kwargs, capsys_obj


def _close_gen(g):
    try:
        next(g)
    except StopIteration:
        pass


def _rm_tree(d):
    import shutil
    shutil.rmtree(d, ignore_errors=True)


def _expand_parametrize(fn):
    specs = getattr(fn, "_mirai_parametrize", None)
    if not specs:
        return [("", {})]
    all_sets = []
    for names, values in specs:
        group = []
        for idx, raw in enumerate(values):
            val_obj = raw.values if hasattr(raw, "values") and hasattr(raw, "marks") else raw
            if len(names) == 1:
                if isinstance(val_obj, tuple) and hasattr(raw, "values"):
                    mapping = {names[0]: val_obj[0]}
                else:
                    mapping = {names[0]: val_obj}
            else:
                mapping = dict(zip(names, val_obj))
            group.append((str(idx), mapping))
        all_sets.append(group)
    combos = []
    for prod in itertools.product(*all_sets):
        suffix = "-".join(p[0] for p in prod)
        merged = {}
        for _, m in prod:
            merged.update(m)
        combos.append((f"[{suffix}]", merged))
    return combos


def _load_module(file_path, idx):
    mod_name = f"_mirai_test_mod_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '_', os.path.basename(file_path))}"
    spec = importlib.util.spec_from_file_location(mod_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load test module {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


def main():
    _install_pytest_shim()
    pytest_mod = sys.modules.get("pytest")
    skipped_cls = getattr(pytest_mod, "Skipped", unittest.SkipTest)

    test_files = sys.argv[1:]
    if not test_files:
        print("MIRAI_SUMMARY: total=0 passed=0 failed=0 errors=0 skipped=0")
        sys.exit(5)

    t0 = time.time()
    passed = 0
    failed = 0
    errors = 0
    skipped = 0

    for idx, tf in enumerate(test_files):
        abs_tf = os.path.abspath(tf)
        if not os.path.isfile(abs_tf):
            errors += 1
            print(f"ERROR {tf} :: file not found")
            continue
        try:
            mod = _load_module(abs_tf, idx)
        except Exception as exc:
            errors += 1
            print(f"ERROR {tf} :: import failed: {type(exc).__name__}: {exc}")
            traceback.print_exc()
            continue

        fixtures = {
            name: obj
            for name, obj in inspect.getmembers(mod, inspect.isfunction)
            if getattr(obj, "_mirai_fixture", False)
        }

        # 1. Run unittest.TestCase subclasses
        loader = unittest.TestLoader()
        for name, obj in inspect.getmembers(mod, inspect.isclass):
            if obj.__module__ != mod.__name__:
                continue
            if issubclass(obj, unittest.TestCase) and obj is not unittest.TestCase:
                suite = loader.loadTestsFromTestCase(obj)
                for test_case in suite:
                    res = unittest.TestResult()
                    test_case.run(res)
                    label = f"{tf}::{name}::{test_case._testMethodName}"
                    if res.errors:
                        errors += 1
                        print(f"ERROR {label}")
                        print(res.errors[0][1])
                    elif res.failures:
                        failed += 1
                        print(f"FAILED {label}")
                        print(res.failures[0][1])
                    elif res.skipped:
                        skipped += 1
                        print(f"SKIPPED {label}")
                    else:
                        passed += 1
                        print(f"PASSED {label}")
            elif name.startswith("Test"):
                # Pytest-style Test* class (not inheriting unittest.TestCase)
                for mname, mobj in inspect.getmembers(obj, inspect.isfunction):
                    if not mname.startswith("test_"):
                        continue
                    for suffix, bound in _expand_parametrize(mobj):
                        label = f"{tf}::{name}::{mname}{suffix}"
                        if getattr(mobj, "_mirai_skip", None):
                            skipped += 1
                            print(f"SKIPPED {label}")
                            continue
                        cleanup = []
                        try:
                            inst = obj()
                            if hasattr(inst, "setup_method"):
                                inst.setup_method(mobj)
                            bound_method = getattr(inst, mname)
                            kwargs, cap = _resolve_fixtures(bound_method, bound, fixtures, cleanup)
                            if cap is not None:
                                with contextlib.redirect_stdout(cap._out), contextlib.redirect_stderr(cap._err):
                                    bound_method(**kwargs)
                            else:
                                bound_method(**kwargs)
                            if hasattr(inst, "teardown_method"):
                                inst.teardown_method(mobj)
                            passed += 1
                            print(f"PASSED {label}")
                        except (skipped_cls, unittest.SkipTest):
                            skipped += 1
                            print(f"SKIPPED {label}")
                        except AssertionError:
                            failed += 1
                            print(f"FAILED {label}")
                            traceback.print_exc()
                        except Exception:
                            errors += 1
                            print(f"ERROR {label}")
                            traceback.print_exc()
                        finally:
                            for cb in reversed(cleanup):
                                cb()

        # 2. Run module-level test_* functions
        for name, obj in inspect.getmembers(mod, inspect.isfunction):
            if obj.__module__ != mod.__name__ or not name.startswith("test_"):
                continue
            for suffix, bound in _expand_parametrize(obj):
                label = f"{tf}::{name}{suffix}"
                if getattr(obj, "_mirai_skip", None):
                    skipped += 1
                    print(f"SKIPPED {label}")
                    continue
                cleanup = []
                try:
                    kwargs, cap = _resolve_fixtures(obj, bound, fixtures, cleanup)
                    if cap is not None:
                        with contextlib.redirect_stdout(cap._out), contextlib.redirect_stderr(cap._err):
                            obj(**kwargs)
                    else:
                        obj(**kwargs)
                    passed += 1
                    print(f"PASSED {label}")
                except (skipped_cls, unittest.SkipTest):
                    skipped += 1
                    print(f"SKIPPED {label}")
                except AssertionError:
                    failed += 1
                    print(f"FAILED {label}")
                    traceback.print_exc()
                except Exception:
                    errors += 1
                    print(f"ERROR {label}")
                    traceback.print_exc()
                finally:
                    for cb in reversed(cleanup):
                        cb()

    total = passed + failed + errors
    elapsed = time.time() - t0
    print(f"\nMIRAI_SUMMARY: total={total} passed={passed} failed={failed} errors={errors} skipped={skipped} duration={elapsed:.2f}s")
    if errors > 0 or failed > 0:
        sys.exit(1)
    if total == 0:
        sys.exit(5)
    sys.exit(0)


if __name__ == "__main__":
    main()
`;

function parseIndividualTestCases(output: string): ParsedTestCase[] {
  const byName = new Map<string, ParsedTestCase['status']>();
  const lines = output.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. MIRAI Python runner format: "PASSED tests/test_x.py::test_foo"
    const miraiCase = line.match(/^(PASSED|FAILED|ERROR|SKIPPED)\s+([^\s].+)$/);
    if (miraiCase) {
      const status = miraiCase[1].toLowerCase() as ParsedTestCase['status'];
      const name = miraiCase[2].trim();
      if (name && !name.startsWith('MIRAI_SUMMARY')) {
        byName.set(name, status);
      }
      continue;
    }

    // 2. pytest -v format: "tests/test_x.py::test_foo PASSED [ 33%]"
    const pytestCase = line.match(/^([^\s]+::[^\s]+)\s+(PASSED|FAILED|ERROR|SKIPPED)\b/);
    if (pytestCase) {
      const name = pytestCase[1].trim();
      const status = pytestCase[2].toLowerCase() as ParsedTestCase['status'];
      byName.set(name, status);
      continue;
    }

    // 3. Node --test spec reporter: "✔ test name (1.2ms)" / "✖ test name (2.0ms)"
    const nodeSpec = line.match(/^([✔✓✖×])\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?$/);
    if (nodeSpec) {
      const status: ParsedTestCase['status'] =
        nodeSpec[1] === '✔' || nodeSpec[1] === '✓' ? 'passed' : 'failed';
      const name = nodeSpec[2].trim();
      if (name) byName.set(name, status);
      continue;
    }

    // 4. Node --test TAP format: "ok 1 - test name" / "not ok 2 - test name"
    const tapCase = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+)$/);
    if (tapCase) {
      const isSkip = /#\s*SKIP\b/i.test(tapCase[2]);
      const name = tapCase[2].replace(/\s*#\s*(?:SKIP|TODO).*$/i, '').trim();
      const status: ParsedTestCase['status'] = isSkip
        ? 'skipped'
        : tapCase[1] === 'ok'
          ? 'passed'
          : 'failed';
      if (name) byName.set(name, status);
    }
  }

  return Array.from(byName.entries())
    .slice(0, 60)
    .map(([name, status]) => ({ name, status }));
}

function parseSummaryCounts(output: string): {
  totalExecuted: number;
  passedCount: number;
  failedCount: number;
  errorCount: number;
  skippedCount: number;
  cases: ParsedTestCase[];
  missingDependency?: string;
} {
  const missingMatch = output.match(/ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/);
  const missingDependency = missingMatch?.[1];
  const cases = parseIndividualTestCases(output);

  const miraiMatch = output.match(
    /MIRAI_SUMMARY:\s*total=(\d+)\s+passed=(\d+)\s+failed=(\d+)\s+errors=(\d+)(?:\s+skipped=(\d+))?/
  );
  if (miraiMatch) {
    return {
      totalExecuted: Number(miraiMatch[1]),
      passedCount: Number(miraiMatch[2]),
      failedCount: Number(miraiMatch[3]),
      errorCount: Number(miraiMatch[4]),
      skippedCount: miraiMatch[5] ? Number(miraiMatch[5]) : 0,
      cases,
      missingDependency,
    };
  }

  // Parse pytest summary line (e.g. "3 passed, 1 failed in 0.12s")
  const passedMatch = output.match(/(\d+)\s+passed\b/);
  const failedMatch = output.match(/(\d+)\s+failed\b/);
  const errorMatch = output.match(/(\d+)\s+errors?\b/);
  const skippedMatch = output.match(/(\d+)\s+skipped\b/);
  const passedCount = passedMatch ? Number(passedMatch[1]) : 0;
  const failedCount = failedMatch ? Number(failedMatch[1]) : 0;
  const errorCount = errorMatch ? Number(errorMatch[1]) : 0;
  const skippedCount = skippedMatch ? Number(skippedMatch[1]) : 0;
  return {
    totalExecuted: passedCount + failedCount + errorCount,
    passedCount,
    failedCount,
    errorCount,
    skippedCount,
    cases,
    missingDependency,
  };
}

export function executeTestFilesInWorkspace(
  workspaceDir: string,
  testPaths: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): TestSuiteRunResult {
  const existing = testPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => fs.existsSync(path.join(workspaceDir, p)));

  if (existing.length === 0) {
    return {
      supported: true,
      passed: false,
      skippedReason: 'No test files found to execute.',
      totalExecuted: 0,
      passedCount: 0,
      failedCount: 0,
      errorCount: 0,
      command: {
        argv: ['verify-tests', '--empty'],
        working_directory: '.',
        exit_code: 5,
        duration_ms: 1,
        stdout: 'No test files present in workspace.\n',
        stderr: '',
        timed_out: false,
      },
    };
  }

  const pyTests = existing.filter((p) => p.endsWith('.py'));
  const jsTests = existing.filter((p) => /\.(?:m?js|cjs)$/i.test(p));

  if (pyTests.length > 0) {
    const py = detectPythonBinary();
    if (!py) {
      return {
        supported: false,
        passed: false,
        skippedReason: 'Python runtime is not installed in this server environment.',
        totalExecuted: 0,
        passedCount: 0,
        failedCount: 0,
        errorCount: 0,
        command: {
          argv: ['python3', '-m', 'unittest'],
          working_directory: '.',
          exit_code: null,
          duration_ms: 1,
          stdout: '',
          stderr: 'python3 binary not found.',
          timed_out: false,
        },
      };
    }

    if (isPytestAvailable()) {
      const cmdRes = runCommandInSandbox(workspaceDir, [py, '-m', 'pytest', '-v', '--tb=short', ...pyTests], timeoutMs);
      const counts = parseSummaryCounts(`${cmdRes.stdout}\n${cmdRes.stderr}`);
      const passed = !cmdRes.timed_out && cmdRes.exit_code === 0 && counts.totalExecuted > 0;
      return {
        supported: true,
        passed,
        ...counts,
        command: cmdRes,
      };
    }

    const runnerPath = path.join(workspaceDir, SANDBOX_RUNNER_FILENAME);
    fs.writeFileSync(runnerPath, PYTHON_TEST_RUNNER_SCRIPT, 'utf8');
    try {
      const cmdRes = runCommandInSandbox(workspaceDir, [py, SANDBOX_RUNNER_FILENAME, ...pyTests], timeoutMs);
      const counts = parseSummaryCounts(`${cmdRes.stdout}\n${cmdRes.stderr}`);
      const passed = !cmdRes.timed_out && cmdRes.exit_code === 0 && counts.totalExecuted > 0;
      return {
        supported: true,
        passed,
        ...counts,
        command: {
          ...cmdRes,
          argv: [py, '-m', 'mirai_sandbox_runner', ...pyTests],
        },
      };
    } finally {
      try {
        fs.rmSync(runnerPath, { force: true });
      } catch {
        // Ignore
      }
    }
  }

  if (jsTests.length > 0) {
    const cmdRes = runCommandInSandbox(workspaceDir, [process.execPath, '--test', ...jsTests], timeoutMs);
    const combined = `${cmdRes.stdout}\n${cmdRes.stderr}`;
    const passMatch = combined.match(/# pass (\d+)/);
    const failMatch = combined.match(/# fail (\d+)/);
    const skipMatch = combined.match(/# skipped (\d+)/);
    const passedCount = passMatch ? Number(passMatch[1]) : 0;
    const failedCount = failMatch ? Number(failMatch[1]) : 0;
    const skippedCount = skipMatch ? Number(skipMatch[1]) : 0;
    const totalExecuted = passedCount + failedCount;
    const cases = parseIndividualTestCases(combined);
    const passed = !cmdRes.timed_out && cmdRes.exit_code === 0 && totalExecuted > 0;
    return {
      supported: true,
      passed,
      totalExecuted,
      passedCount,
      failedCount,
      errorCount: cmdRes.exit_code !== 0 && failedCount === 0 ? 1 : 0,
      skippedCount,
      cases,
      command: cmdRes,
    };
  }

  return {
    supported: false,
    passed: false,
    skippedReason: `No native execution runtime available in sandbox for test files: ${existing.join(', ')}`,
    totalExecuted: 0,
    passedCount: 0,
    failedCount: 0,
    errorCount: 0,
    command: {
      argv: ['sandbox-verify', ...existing],
      working_directory: '.',
      exit_code: null,
      duration_ms: 1,
      stdout: '',
      stderr: `Unsupported test runtime in sandbox for: ${existing.join(', ')}\n`,
      timed_out: false,
    },
  };
}

/**
 * Returns true when a ModuleNotFoundError refers to a third-party external package
 * (e.g., sqlalchemy, fastapi, pydantic, django) rather than a local repository module.
 */
export function isExternalMissingDependency(
  missingModule: string | undefined,
  workspaceFilePaths: string[]
): boolean {
  if (!missingModule) return false;
  const top = missingModule.split('.')[0].trim().toLowerCase();
  if (!top) return false;

  for (const rawPath of workspaceFilePaths) {
    const norm = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const parts = norm.split('/');
    if (parts.some((seg) => seg === top || seg === `${top}.py`)) {
      return false;
    }
  }
  return true;
}

const PYTHON_AST_VERIFIER_SCRIPT = String.raw`
import ast
import json
import os
import sys

def extract_symbols(source_text):
    tree = ast.parse(source_text)
    symbols = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols[node.name] = ast.dump(node)
    return tree, symbols

def count_test_assertions(tree):
    test_fns = 0
    assertions = 0
    referenced_names = set()
    imported_modules = set()
    trivial_only = True

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_modules.add(alias.name.split(".")[0])
                referenced_names.add(alias.name.split(".")[-1])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_modules.add(node.module.split(".")[0])
                for seg in node.module.split("."):
                    referenced_names.add(seg)
            for alias in node.names:
                referenced_names.add(alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("test_"):
                test_fns += 1
        elif isinstance(node, ast.Assert):
            assertions += 1
            # Check if assertion is non-trivial (not just assert True or assert 1 == 1)
            if not isinstance(node.test, ast.Constant):
                has_name = any(isinstance(sub, (ast.Name, ast.Attribute, ast.Call)) for sub in ast.walk(node.test))
                if has_name:
                    trivial_only = False
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                attr = node.func.attr
                referenced_names.add(attr)
                if attr.startswith("assert") or attr in ("raises", "fail", "approx"):
                    assertions += 1
                    trivial_only = False
            elif isinstance(node.func, ast.Name):
                referenced_names.add(node.func.id)
        elif isinstance(node, ast.Name):
            referenced_names.add(node.id)

    return test_fns, assertions, referenced_names, imported_modules, (assertions == 0 or trivial_only)

def main():
    payload = json.loads(sys.stdin.read())
    test_files = payload.get("test_files", [])
    changed_files = payload.get("changed_files", [])
    baseline_files = payload.get("baseline_files", {})

    syntax_errors = []
    total_test_fns = 0
    total_assertions = 0
    all_refs = set()
    all_imports = set()
    all_vacuous = True if test_files else False

    for tf in test_files:
        if not os.path.isfile(tf):
            syntax_errors.append(f"Missing test file: {tf}")
            continue
        try:
            src = open(tf, "r", encoding="utf-8").read()
            tree = ast.parse(src, filename=tf)
            tfns, asserts, refs, imps, vac = count_test_assertions(tree)
            total_test_fns += tfns
            total_assertions += asserts
            all_refs.update(refs)
            all_imports.update(imps)
            if not vac:
                all_vacuous = False
        except SyntaxError as e:
            syntax_errors.append(f"{tf}:{e.lineno}: {e.msg}")

    changed_symbols = set()
    deleted_symbols = []

    for cf in changed_files:
        if not cf.endswith(".py") or not os.path.isfile(cf):
            continue
        try:
            new_src = open(cf, "r", encoding="utf-8").read()
            _, new_syms = extract_symbols(new_src)
        except SyntaxError as e:
            syntax_errors.append(f"{cf}:{e.lineno}: {e.msg}")
            continue

        old_src = baseline_files.get(cf)
        if old_src is not None:
            try:
                _, old_syms = extract_symbols(old_src)
            except SyntaxError:
                old_syms = {}
            for name, dump in new_syms.items():
                if name not in old_syms or old_syms[name] != dump:
                    changed_symbols.add(name)
            for name in old_syms:
                if not name.startswith("_") and name not in new_syms:
                    deleted_symbols.append(f"{cf}:{name}")
            if new_src.strip() != old_src.strip() and not changed_symbols:
                # Module-level statement / route / config edit
                changed_symbols.add(os.path.splitext(os.path.basename(cf))[0])
        else:
            changed_symbols.update(new_syms.keys())
            if not new_syms:
                changed_symbols.add(os.path.splitext(os.path.basename(cf))[0])

    # Also treat basenames of changed files as target references
    changed_stems = {os.path.splitext(os.path.basename(cf))[0] for cf in changed_files if cf.endswith(".py")}
    target_pool = changed_symbols | changed_stems
    referenced_targets = sorted(target_pool & (all_refs | all_imports))

    result = {
        "syntax_ok": len(syntax_errors) == 0,
        "syntax_errors": syntax_errors,
        "test_function_count": total_test_fns,
        "assertion_count": total_assertions,
        "changed_symbol_count": len(changed_symbols),
        "changed_symbols": sorted(changed_symbols)[:25],
        "preserved_existing_symbols": len(deleted_symbols) == 0,
        "deleted_symbols": deleted_symbols[:15],
        "referenced_target_symbols": referenced_targets[:25],
        "vacuous_tests": all_vacuous,
    }
    print(json.dumps(result))
    sys.exit(0 if result["syntax_ok"] else 1)

if __name__ == "__main__":
    main()
`;

export function verifyPythonAstInWorkspace(params: {
  workspaceDir: string;
  testPaths: string[];
  changedPaths: string[];
  snapshotFiles: Record<string, string>;
}): AstVerificationResult {
  const py = detectPythonBinary();
  if (!py) {
    return {
      ok: false,
      syntaxOk: false,
      testFunctionCount: 0,
      assertionCount: 0,
      changedSymbolCount: 0,
      preservedExistingSymbols: true,
      deletedSymbols: [],
      referencedTargetSymbols: [],
      vacuousTests: true,
      detail: 'Python runtime unavailable for AST verification.',
      command: {
        argv: ['python3', '-m', 'mirai_ast_verifier'],
        working_directory: '.',
        exit_code: null,
        duration_ms: 1,
        stdout: '',
        stderr: 'python3 not found',
        timed_out: false,
      },
    };
  }

  const pyTests = params.testPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p.endsWith('.py'));
  const pyChanged = params.changedPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p.endsWith('.py'));

  const baselineSubset: Record<string, string> = {};
  for (const cf of pyChanged) {
    if (cf in params.snapshotFiles) {
      baselineSubset[cf] = params.snapshotFiles[cf];
    }
  }

  const verifierPath = path.join(params.workspaceDir, '_mirai_ast_verifier.py');
  fs.writeFileSync(verifierPath, PYTHON_AST_VERIFIER_SCRIPT, 'utf8');
  const t0 = Date.now();
  try {
    const res = spawnSync(py, [verifierPath], {
      cwd: params.workspaceDir,
      env: buildSandboxEnv(params.workspaceDir),
      input: JSON.stringify({
        test_files: pyTests,
        changed_files: pyChanged,
        baseline_files: baselineSubset,
      }),
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const duration_ms = Math.max(1, Date.now() - t0);
    const cmd: CommandRunResult = {
      argv: [py, '-m', 'mirai_ast_verifier', ...pyTests, ...pyChanged],
      working_directory: '.',
      exit_code: res.status,
      duration_ms,
      stdout: (res.stdout || '').slice(0, 32_000),
      stderr: (res.stderr || '').slice(0, 32_000),
      timed_out: Boolean(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'),
    };

    const parsed = JSON.parse((res.stdout || '{}').trim()) as {
      syntax_ok?: boolean;
      syntax_errors?: string[];
      test_function_count?: number;
      assertion_count?: number;
      changed_symbol_count?: number;
      preserved_existing_symbols?: boolean;
      deleted_symbols?: string[];
      referenced_target_symbols?: string[];
      vacuous_tests?: boolean;
    };

    const syntaxOk = Boolean(parsed.syntax_ok);
    const testFunctionCount = parsed.test_function_count ?? 0;
    const assertionCount = parsed.assertion_count ?? 0;
    const changedSymbolCount = parsed.changed_symbol_count ?? 0;
    const preservedExistingSymbols = parsed.preserved_existing_symbols ?? true;
    const deletedSymbols = parsed.deleted_symbols ?? [];
    const referencedTargetSymbols = parsed.referenced_target_symbols ?? [];
    const vacuousTests = Boolean(parsed.vacuous_tests);

    const hasTests = pyTests.length === 0 || (testFunctionCount > 0 && assertionCount > 0 && !vacuousTests);
    const ok = syntaxOk && hasTests;
    const detail = !syntaxOk
      ? `Python AST syntax errors: ${(parsed.syntax_errors || []).join('; ')}`
      : `AST verified: ${testFunctionCount} test function(s), ${assertionCount} assertion(s), ${changedSymbolCount} changed target symbol(s), ${referencedTargetSymbols.length} matched symbol reference(s), existing symbols preserved=${preservedExistingSymbols}.`;

    return {
      ok,
      syntaxOk,
      testFunctionCount,
      assertionCount,
      changedSymbolCount,
      preservedExistingSymbols,
      deletedSymbols,
      referencedTargetSymbols,
      vacuousTests,
      detail,
      command: cmd,
    };
  } catch (err) {
    return {
      ok: false,
      syntaxOk: false,
      testFunctionCount: 0,
      assertionCount: 0,
      changedSymbolCount: 0,
      preservedExistingSymbols: true,
      deletedSymbols: [],
      referencedTargetSymbols: [],
      vacuousTests: true,
      detail: `AST verifier error: ${err instanceof Error ? err.message : String(err)}`,
      command: {
        argv: [py, '-m', 'mirai_ast_verifier'],
        working_directory: '.',
        exit_code: 1,
        duration_ms: Math.max(1, Date.now() - t0),
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timed_out: false,
      },
    };
  } finally {
    try {
      fs.rmSync(verifierPath, { force: true });
    } catch {
      // Ignore
    }
  }
}

