"""Bounded parallel ZCode workers. Upstream audits; Codex reviews and accepts.

run -> collect diff/validation -> review (optionally repair) -> integrate -> tests
No worker output can grant approval. No branches, commits or pushes are created.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import difflib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

from importlib.util import module_from_spec, spec_from_file_location
spec = spec_from_file_location('zcode_env', Path(__file__).with_name('zcode-env.py'))
launcher = module_from_spec(spec)
spec.loader.exec_module(launcher)
REPO = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def digest(path):
    path = Path(path)
    if path.is_symlink() or path.is_junction():
        raise ValueError('Linked file rejected: ' + str(path))
    if not path.is_file():
        return None
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def f_path(path):
    path = Path(path).resolve()
    if os.name == 'nt' and path.drive.upper() != 'F:':
        raise ValueError('Runtime paths must stay on F: ' + str(path))
    return path


def relative_file(value):
    p = PurePosixPath(value.replace('\\', '/'))
    if p.is_absolute() or '..' in p.parts or not p.parts or any(x in value for x in ':*?'):
        raise ValueError('allowed/input must be an exact relative file: ' + value)
    if p.parts[0].lower() == 'data' or any(x.lower() in {'.git', 'node_modules', '.codex', '.agents', '.zcode'} for x in p.parts):
        raise ValueError('Protected directory: ' + value)
    if any(re.search(r'(^\.env|credential|secret|private[-_]?key|^agents\.md$|^project_rules\.md$)', x, re.I) for x in p.parts):
        raise ValueError('Protected file: ' + value)
    return p.as_posix()


def local_file(root, name):
    root = Path(root).resolve()
    path = root / name
    for cursor in [path, *path.parents]:
        if cursor == root:
            break
        if cursor.is_symlink() or cursor.is_junction():
            raise ValueError('Linked path rejected: ' + str(cursor))
    if not path.resolve().is_relative_to(root):
        raise ValueError('Path escapes workspace')
    return path


def call(argv, cwd, env, *, timeout=180, log=None):
    # Commands are argv, never composed shell strings.
    if log:
        with Path(log).open('w', encoding='utf-8') as out:
            p = subprocess.Popen(argv, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT)
            try:
                return p.wait(timeout=timeout)
            except BaseException:
                if p.poll() is None:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
                    else:
                        p.kill()
                    p.wait()
                raise
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(argv[:3]) + '\n' + (p.stderr + p.stdout).decode('utf-8', 'replace')[-1500:])
    return p.stdout


def config():
    c = read(REPO / '.codex/zcode-pool.json')
    for key in ['run_root', 'account_lock_root']:
        c[key] = str(f_path(c[key]))
    if not 1 <= c['concurrency'] <= c['account_concurrency'] <= c['max_concurrency'] <= 16:
        raise ValueError('Invalid concurrency/account limits')
    return c


def manifest_tasks(manifest):
    tasks = manifest.get('tasks')
    if not isinstance(tasks, list) or not tasks:
        raise ValueError('Manifest requires nonempty tasks')
    ids, owned = set(), set()
    for raw in tasks:
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', raw.get('id', '')) or raw['id'] in ids:
            raise ValueError('Invalid or duplicate task id')
        ids.add(raw['id'])
        allowed = [relative_file(x) for x in raw.get('allowed_files', [])]
        if not allowed or len(allowed) != len(set(x.lower() for x in allowed)):
            raise ValueError('Each task needs unique allowed files')
        if any(a.lower() == b or a.lower().startswith(b + '/') or b.startswith(a.lower() + '/')
               for a in allowed for b in owned):
            raise ValueError('Workers have conflicting allowed files')
        owned.update(x.lower() for x in allowed)
        raw['allowed_files'] = allowed
        raw['input_files'] = [relative_file(x) for x in raw.get('input_files', [])]
        if not raw.get('objective') or not raw.get('validation'):
            raise ValueError('Each task needs objective and validation')
        if raw.get('read_only') and raw.get('backend', 'packet') != 'packet':
            raise ValueError('Read-only tasks use packet backend with Plan mode')
        if raw.get('backend', 'packet') not in {'packet', 'auto-route'}:
            raise ValueError('Unsupported backend')
        import shlex
        argv = shlex.split(raw['validation'])
        if not argv or Path(argv[0]).name.lower() not in {'node', 'node.exe', 'npm.cmd', 'python', 'python.exe', 'python3', 'python3.exe'}:
            raise ValueError('Validation must use an explicit Node/npm/Python executable; shell wrappers require Codex to validate separately')
    return tasks


@contextmanager
def exclusive(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps({'pid': os.getpid(), 'created_at': time.time()}))
    try:
        yield
    finally:
        path.unlink()


def cooldown(c):
    p = Path(c['account_lock_root']) / 'cooldown.json'
    return p.exists() and read(p)['until'] > time.time()


@contextmanager
def account_slot(c):
    root = Path(c['account_lock_root'])
    root.mkdir(parents=True, exist_ok=True)
    lock = None
    while lock is None:
        if cooldown(c):
            raise RuntimeError('Provider cooldown active; queued work paused')
        for i in range(c['account_concurrency']):
            candidate = root / ('slot-' + str(i) + '.lock')
            try:
                with candidate.open('x') as h:
                    h.write(str(os.getpid()))
                lock = candidate
                break
            except FileExistsError:
                continue
        if lock is None:
            time.sleep(0.5)
    try:
        yield
    finally:
        lock.unlink()


def pause_provider(c, result):
    code = str(result.get('provider_code', ''))
    if code in {'1302', '1303', '1305', '1308', '1309', '402', '429'} or result.get('provider_fail_fast') or result.get('supervisor_state') == 'retryable_provider_error':
        write(Path(c['account_lock_root']) / 'cooldown.json', {
            'until': time.time() + c['provider_cooldown_seconds'], 'provider_code': code})
        return True
    return False


def runtime_home(root):
    root = f_path(root)
    root.mkdir(parents=True)
    (root / 'tmp').mkdir()
    source = Path(launcher.settings()['runtime_home']) / '.zcode'
    # Private local credentials are provisioned by Codex, never sent in packets.
    for name in ['cli/config.json', 'v2/config.json', 'v2/provider_config.json', 'v2/credentials.json']:
        src = source / name
        if src.is_file():
            target = root / '.zcode' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
    return root


def prepare(run, source, tasks, manifest):
    env = launcher.child_env()
    base = call(['git', 'rev-parse', 'HEAD'], source, env).decode().strip()
    patch = call(['git', 'diff', '--binary', 'HEAD', '--', '.'], source, env)
    (run / 'source-changes.patch').write_bytes(patch)
    state = {'version': 1, 'run': str(run), 'source': str(source), 'base_commit': base,
             'created_at': datetime.now(timezone.utc).isoformat(), 'status': 'running',
             'final_acceptance': 'pending_codex_review', 'tasks': []}
    for t in tasks:
        root = run / t['id']
        root.mkdir()
        workspace = root / 'workspace'
        if manifest.get('isolation', 'worktree') == 'fixture':
            workspace.mkdir()
            # Explicit input allowlist; no credentials, personal data or broad copy.
            for name in set(t['input_files'] + t['allowed_files']):
                src = local_file(source, name)
                if src.is_file():
                    dst = local_file(workspace, name)
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
        elif manifest.get('isolation', 'worktree') == 'worktree':
            call(['git', 'worktree', 'add', '--detach', str(workspace), base], source, env)
            if patch:
                call(['git', 'apply', '--binary', str(run / 'source-changes.patch')], workspace, env)
            # Untracked context is copied only when explicitly listed by Codex.
            for name in set(t['input_files'] + t['allowed_files']):
                src = local_file(source, name)
                if not src.is_file():
                    if name in t['input_files']:
                        raise ValueError('Missing explicit input: ' + name)
                    continue
                dst = local_file(workspace, name)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        else:
            raise ValueError('Unknown isolation kind')
        shutil.copytree(REPO / '.codex', workspace / '.codex',
                        ignore=shutil.ignore_patterns('zcode', '*.local.json'), dirs_exist_ok=True)
        home = runtime_home(root / 'home')
        baseline = {name: digest(local_file(workspace, name)) for name in t['allowed_files']}
        for name in t['allowed_files']:
            src = local_file(workspace, name)
            if src.is_dir():
                raise ValueError('allowed_files contains a directory: ' + name)
            if src.is_file():
                dst = local_file(root / 'baseline', name)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        # Pool performs an additional complete audit, independent of upstream skip lists.
        item = dict(t, workspace=str(workspace), home=str(home), root=str(root),
                    isolation_kind=manifest.get('isolation', 'worktree'),
                    baseline=baseline, input_hashes={n: digest(local_file(workspace, n)) for n in t['input_files']},
                    status='queued', revision=0, review=None)
        state['tasks'].append(item)
    write(run / 'state.json', state)
    return state


def tree_hashes(root):
    root = Path(root)
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            p = Path(directory) / name
            if p.is_symlink() or p.is_junction():
                raise ValueError('Workspace link rejected: ' + str(p))
        dirs[:] = [x for x in dirs if x != '.git']
        for name in files:
            path = Path(directory) / name
            rel = path.relative_to(root).as_posix()
            if rel == '.git' or rel.startswith('.codex/zcode/'):
                continue
            result[rel] = digest(path)
    return result


def execute_task(item, c, *, repair=None):
    item = dict(item)
    root, workspace = Path(item['root']), Path(item['workspace'])
    revision = item['revision'] + 1
    item.update(revision=revision, review=None, status='running')
    objective = repair or item['objective']
    env = launcher.child_env(Path(item['home']))
    env['TEMP'] = env['TMP'] = str(Path(item['home']) / 'tmp')
    upstream = launcher.settings()
    runfile = root / ('result-' + str(revision) + '.json')
    packet = root / ('packet-' + str(revision) + '.json')
    try:
        before = tree_hashes(workspace)
        head_before = call(['git', 'rev-parse', 'HEAD'], workspace, env).decode().strip() if (workspace / '.git').exists() else None
        with account_slot(c):
            if item.get('backend', 'packet') == 'auto-route':
                args = ['--workspace', str(workspace), '--objective', objective,
                        '--task-kind', 'implementation', '--workspace-kind', item.get('isolation_kind', 'worktree'),
                        '--validation', item['validation'], '--max-changed-files', str(len(item['allowed_files'])),
                        '--run-mode', 'yolo', '--execute',
                        '--timeout-ms', str(c['timeout_ms']), '--max-attempts', '1',
                        '--validation-timeout', str(c['validation_timeout_seconds']),
                        '--no-repair-validation', '--result-verbosity', 'full']
                for name in item['allowed_files']:
                    args += ['--allowed', name]
                if item.get('allow_no_change'):
                    args += ['--allow-no-change']
                log = root / ('route-' + str(revision) + '.json')
                rc = call(launcher.command('zcode-auto-route', args), workspace, env,
                          timeout=c['timeout_ms']/1000 + c['validation_timeout_seconds'] + 60, log=log)
                route = read(log)
                runfile = Path(route['run']) if route.get('run') else None
                if not route.get('executed') or not runfile or not runfile.is_file():
                    raise RuntimeError('Auto-route did not produce an executed run JSON')
            else:
                args = [upstream['python'], upstream['supervisor'], 'packet',
                        '--workspace', str(workspace), '--workspace-kind', 'disposable',
                        '--objective', objective, '--validation', item['validation'],
                        '--mode', 'Plan' if item.get('read_only') else 'Full Access',
                        '--worker-finalization', 'supervisor_owned', '--max-prompt-chars', '12000',
                        '--max-changed-files', str(len(item['allowed_files'])), '--out', str(packet)]
                for name in item['allowed_files']:
                    args += ['--allowed', name]
                args += ['--what-not-to-do', 'Act only as an implementation worker. Codex owns routing and acceptance. Keep Git metadata unchanged. Use only this workspace.']
                call(args, workspace, env)
                rc = call(['node', upstream['controller'], 'run-packet', '--packet', str(packet),
                           '--mode', 'plan' if item.get('read_only') else 'yolo',
                           '--max-attempts', '1', '--no-repair-validation', '--usage-snapshot-source', 'none',
                           '--json',
                           '--timeout-ms', str(c['timeout_ms']), '--validation-timeout', str(c['validation_timeout_seconds']),
                           '--out', str(runfile)], workspace, env,
                          timeout=c['timeout_ms']/1000 + c['validation_timeout_seconds'] + 60,
                          log=root / ('controller-' + str(revision) + '.log'))
        result = read(runfile)
        # Rerun the original Codex validation, independent of mutable packet/result
        # files inside the worker workspace. Worker declarations never grant trust.
        import shlex
        check = subprocess.run(shlex.split(item['validation']), cwd=workspace, env=env,
                               capture_output=True, timeout=c['validation_timeout_seconds'])
        trusted_validation = {'ok': check.returncode == 0, 'returncode': check.returncode,
                              'stdout': check.stdout.decode('utf-8', 'replace')[-4000:],
                              'stderr': check.stderr.decode('utf-8', 'replace')[-4000:]}
        after = tree_hashes(workspace)
        changed = sorted(x for x in before.keys() | after.keys() if before.get(x) != after.get(x))
        head_after = call(['git', 'rev-parse', 'HEAD'], workspace, env).decode().strip() if head_before else None
        extra = sorted(set(changed) - set(item['allowed_files']))
        scope_ok = (result.get('audit', {}).get('scope_safety') == 'pass'
                    and not extra and head_before == head_after and (not item.get('read_only') or not changed))
        audits_ok = (result.get('audit', {}).get('ok') is True and result.get('validation_ok') is True and trusted_validation['ok']
                     and not extra and head_before == head_after and (not item.get('read_only') or not changed))
        cumulative = sorted(set(item.get('changed_files', [])) | set(changed))
        item.update(result=str(runfile), changed_files=cumulative, outside_allowed=extra,
                    result_fingerprint=hashlib.sha256(runfile.read_bytes()).hexdigest(),
                    output_hashes={x: after.get(x) for x in item['allowed_files']},
                    workspace_hashes=after,
                    audit_ok=audits_ok, scope_ok=scope_ok, validation_ok=trusted_validation['ok'],
                    codex_validation=trusted_validation,
                    supervisor_state=result.get('supervisor_state'), response=result.get('response') or result.get('stdout', '')[-4000:],
                    started_at=result.get('created_at'), status='awaiting_review' if rc == 0 and result.get('ok') and audits_ok else 'failed')
        if not item.get('read_only') and not changed and not repair and not item.get('allow_no_change'):
            item.update(status='failed', error='Implementation produced no changes')
        item['provider_paused'] = pause_provider(c, result)
        # Human-readable diff of only this worker's changes against its own baseline.
        parts = []
        for name in cumulative:
            original = local_file(root / 'baseline', name)
            current = local_file(workspace, name)
            try:
                left = original.read_text(encoding='utf-8').splitlines(keepends=True) if original.is_file() else []
                right = current.read_text(encoding='utf-8').splitlines(keepends=True) if current.is_file() else []
                parts.extend(difflib.unified_diff(left, right, fromfile='a/'+name, tofile='b/'+name))
            except UnicodeDecodeError:
                parts.append('Binary file changed: ' + name + '\n')
        (root / ('diff-' + str(revision) + '.patch')).write_text(''.join(parts), encoding='utf-8')
        write(root / ('collection-' + str(revision) + '.json'), item)
    except Exception as exc:
        item.update(status='failed', error=str(exc), review=None)
        write(root / ('collection-' + str(revision) + '.json'), item)
    return item


def schedule(state, c, selected=None, repairs=None):
    indexes = list(range(len(state['tasks']))) if selected is None else selected
    started = time.time()
    with ThreadPoolExecutor(max_workers=c['concurrency']) as pool:
        futures = {pool.submit(execute_task, state['tasks'][i], c, repair=(repairs or {}).get(i)): i for i in indexes}
        for future in as_completed(futures):
            i = futures[future]
            state['tasks'][i] = future.result()
            write(Path(state['run']) / 'state.json', state)
            print(json.dumps({'task': state['tasks'][i]['id'], 'status': state['tasks'][i]['status']}), flush=True)
    state.update(status='awaiting_codex_review', elapsed_seconds=round(time.time()-started, 2),
                 final_acceptance='pending_codex_review')
    write(Path(state['run']) / 'state.json', state)
    return state


def review(state, decisions, c):
    by_id = {x['id']: x for x in decisions['tasks']}
    if len(by_id) != len(decisions['tasks']) or set(by_id) != {x['id'] for x in state['tasks']}:
        raise ValueError('Review must cover every task exactly once')
    repairs, selected = {}, []
    for i, task in enumerate(state['tasks']):
        d = by_id[task['id']]
        if d.get('revision') != task['revision'] or d.get('result_fingerprint') != task.get('result_fingerprint'):
            raise ValueError('Review refers to stale/missing result')
        action = d.get('decision')
        if action not in {'approve', 'request_changes', 'reject'} or not d.get('reason'):
            raise ValueError('Codex decision and reasoning required')
        if action == 'approve' and task['status'] != 'awaiting_review':
            raise ValueError('Cannot approve a failed/unsafe worker')
        if action == 'request_changes':
            if not task.get('scope_ok') or task['revision'] > c['max_repair_rounds'] or not d.get('repair_objective'):
                raise ValueError('Repair needs safe scope, bounded rounds and a Codex objective')
            selected.append(i)
            repairs[i] = d['repair_objective']
        task['review'] = d
    state['final_acceptance'] = 'pending_final_tests' if all(x['review']['decision'] == 'approve' for x in state['tasks']) else 'pending_codex_review'
    write(Path(state['run']) / 'codex-review.json', decisions)
    write(Path(state['run']) / 'state.json', state)
    if selected:
        schedule(state, c, selected, repairs)
    return state


def verify_approval(state):
    for task in state['tasks']:
        result = Path(task.get('result', ''))
        if not task.get('review') or task['review']['decision'] != 'approve' or task['status'] != 'awaiting_review':
            raise ValueError('All tasks require Codex approval')
        if task['review']['revision'] != task['revision'] or digest(result) != task['result_fingerprint']:
            raise ValueError('Stale result/review')
        for name, sha in task['output_hashes'].items():
            if digest(local_file(task['workspace'], name)) != sha:
                raise ValueError('Worker output changed after audit: ' + name)
        if tree_hashes(task['workspace']) != task['workspace_hashes']:
            raise ValueError('Workspace changed after audit')


def integrate(state, validation, apply, c):
    verify_approval(state)
    source = Path(state['source'])
    for task in state['tasks']:
        for name, sha in (task['baseline'] | task.get('input_hashes', {})).items():
            if digest(local_file(source, name)) != sha:
                raise ValueError('Source conflict; Codex must resolve: ' + name)
    changes = [(t, n) for t in state['tasks'] for n in t['changed_files']]
    if not apply:
        return {'ok': True, 'dry_run': True, 'files': [n for _, n in changes], 'final_acceptance': 'pending_final_tests'}
    upstream = launcher.settings()
    # Retain upstream validation safety screening and exact argv semantics.
    sys.path.insert(0, str(Path(upstream['supervisor']).parent))
    import zcode_supervisor as safety
    danger = safety.validation_danger_reason(validation)
    if danger:
        raise ValueError(danger)
    backup = Path(state['run']) / ('integration-backup-' + uuid.uuid4().hex)
    backup.mkdir()
    touched = []
    with exclusive(REPO / '.codex/zcode/integration.lock'):
        try:
            for task in state['tasks']:
                for name, sha in (task['baseline'] | task.get('input_hashes', {})).items():
                    if digest(local_file(source, name)) != sha:
                        raise ValueError('Source conflict after acquiring integration lock: ' + name)
            for task, name in changes:
                dst = local_file(source, name)
                src = local_file(task['workspace'], name)
                saved = local_file(backup, name)
                if dst.exists():
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dst, saved)
                touched.append((dst, saved, dst.exists()))
                if src.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
                elif dst.exists():
                    dst.unlink()
            # Validation runs with F: temp/profile; results are always persisted.
            env = launcher.child_env()
            proc = subprocess.run([upstream['python'], upstream['supervisor'], 'packet', '--workspace', str(source),
                                   '--objective', 'Validate accepted worker integration', '--allowed', changes[0][1] if changes else 'README.md',
                                   '--validation', validation, '--out', str(backup / 'validation-packet.json')],
                                  cwd=source, env=env, capture_output=True, timeout=60)
            if proc.returncode:
                raise ValueError('Final validation rejected by supervisor')
            import shlex
            final = subprocess.run(shlex.split(validation), cwd=source, env=env, capture_output=True,
                                   timeout=c['validation_timeout_seconds'])
            report = {'ok': final.returncode == 0, 'returncode': final.returncode,
                      'stdout': final.stdout.decode('utf-8', 'replace')[-8000:],
                      'stderr': final.stderr.decode('utf-8', 'replace')[-8000:]}
            write(Path(state['run']) / 'final-tests.json', report)
            if not report['ok']:
                raise RuntimeError('Final tests failed; integration rolled back')
            state.update(final_acceptance='accepted_by_codex_after_tests', status='complete')
            write(Path(state['run']) / 'state.json', state)
            return report
        except BaseException:
            for dst, saved, existed in reversed(touched):
                if existed:
                    shutil.copy2(saved, dst)
                elif dst.exists():
                    dst.unlink()
            raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    run = sub.add_parser('run')
    run.add_argument('--manifest', type=Path, required=True)
    for name in ['status', 'review', 'integrate']:
        s = sub.add_parser(name)
        s.add_argument('--run', type=Path, required=True)
        if name == 'review':
            s.add_argument('--decisions', type=Path, required=True)
        if name == 'integrate':
            s.add_argument('--validation', required=True)
            s.add_argument('--apply', action='store_true')
    args = p.parse_args()
    c = config()
    if args.cmd == 'run':
        manifest = read(args.manifest)
        tasks = manifest_tasks(manifest)
        source = f_path(manifest.get('source', str(REPO)))
        run = Path(c['run_root']) / (datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
        run.mkdir(parents=True)
        if os.name == 'nt':
            call(['icacls', str(run), '/inheritance:r', '/grant:r', os.environ['USERDOMAIN']+'\\'+os.environ['USERNAME']+':(OI)(CI)F'], REPO, launcher.child_env())
            # The python3 helper launches at Low integrity on this machine.
            # Provision only this private disposable run tree for that helper.
            call(['icacls', str(run), '/setintegritylevel', '(OI)(CI)L'], REPO, launcher.child_env())
        write(run / 'manifest.json', manifest)
        print(json.dumps({'run': str(run), 'concurrency': c['concurrency']}), flush=True)
        state = prepare(run, source, tasks, manifest)
        write(REPO / '.codex/zcode/latest-run.json', {'run': str(run)})
        schedule(state, c)
        return 0 if all(x['status'] == 'awaiting_review' for x in state['tasks']) else 1
    run = f_path(args.run)
    if not run.is_relative_to(Path(c['run_root'])):
        raise ValueError('Run outside configured root')
    state = read(run / 'state.json')
    if args.cmd == 'status':
        print(json.dumps(state, ensure_ascii=False, indent=2))
    else:
        with exclusive(run / 'control.lock'):
            result = review(state, read(args.decisions), c) if args.cmd == 'review' else integrate(state, args.validation, args.apply, c)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
