"""Hermetic scheduler/audit tests: no provider calls or real user data."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import subprocess
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('pool', Path(__file__).parents[1] / 'scripts/zcode-pool.py')
pool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pool)


class PoolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zcode-pool-test-', dir='F:/AI/tmp')
        self.root = Path(self.temp.name)
        self.c = dict(concurrency=8, account_concurrency=8, max_concurrency=16,
                      account_lock_root=str(self.root/'slots'), provider_cooldown_seconds=60,
                      max_repair_rounds=2, timeout_ms=1000, validation_timeout_seconds=10)

    def tearDown(self):
        self.temp.cleanup()

    def task(self, id='one', name='result.md'):
        root=self.root/id
        ws=root/'workspace'
        ws.mkdir(parents=True)
        home=root/'home'
        (home/'tmp').mkdir(parents=True)
        return dict(id=id, objective='Write bounded report', validation='node --version',
                    allowed_files=[name], input_files=[], workspace=str(ws), home=str(home),
                    root=str(root), baseline={name:None}, status='queued', revision=0, review=None)

    def fake_call(self, argv, cwd, env, **kwargs):
        if 'run-packet' in argv:
            out=Path(argv[argv.index('--out')+1])
            packet=pool.read(argv[argv.index('--packet')+1])
            ws=Path(cwd)
            (ws/packet['allowed_files'][0]).write_text('worker output\n',encoding='utf8')
            if self.outside:
                (ws/'forbidden.txt').write_text('unexpected')
            pool.write(out, {'ok':True,'validation_ok':True,'supervisor_state':'success',
                             'response':'completed','audit':{'ok':True,'scope_safety':'pass'}})
            return 0
        if 'packet' in argv:
            pool.write(argv[argv.index('--out')+1], {'allowed_files':[argv[argv.index('--allowed')+1]]})
        return b''

    def execute(self, task, outside=False, repair=None):
        self.outside=outside
        with patch.object(pool, 'call', side_effect=self.fake_call):
            return pool.execute_task(task, self.c, repair=repair)

    def test_configured_workers_really_overlap(self):
        for count in (8,16):
            with self.subTest(concurrency=count):
                c=dict(self.c,concurrency=count,account_concurrency=count)
                barrier=threading.Barrier(count)
                active=peak=0
                lock=threading.Lock()
                def worker(task,c,**kw):
                    nonlocal active,peak
                    with lock:
                        active+=1; peak=max(peak,active)
                    barrier.wait(timeout=8)
                    time.sleep(.05)
                    with lock: active-=1
                    return dict(task,status='awaiting_review')
                state={'run':str(self.root),'tasks':[{'id':str(i)} for i in range(count)]}
                with patch.object(pool,'execute_task',side_effect=worker):
                    pool.schedule(state,c)
                self.assertEqual(peak,count)
                self.assertEqual(state['final_acceptance'],'pending_codex_review')

    def test_account_limit_shared_by_schedulers(self):
        for count in (8,16):
            with self.subTest(account_concurrency=count):
                c=dict(self.c,concurrency=count,account_concurrency=count)
                barrier=threading.Barrier(count)
                active=peak=0
                lock=threading.Lock()
                def work(i):
                    nonlocal active,peak
                    with pool.account_slot(c):
                        with lock:
                            active+=1; peak=max(active,peak)
                        barrier.wait(timeout=8)
                        time.sleep(.12)
                        with lock: active-=1
                with ThreadPoolExecutor(max_workers=count*2) as workers:
                    list(workers.map(work,range(count*2)))
                self.assertEqual(peak,count)
                self.assertEqual(list(Path(c['account_lock_root']).glob('slot-*.lock')),[])

    def test_overlapping_paths_and_unsafe_paths_blocked(self):
        base={'id':'one','allowed_files':['a.md'],'objective':'Write report','validation':'node --version'}
        with self.assertRaisesRegex(ValueError,'conflicting'):
            pool.manifest_tasks({'tasks':[base,dict(base,id='two',allowed_files=['A.md'])]})
        for name in ['../escape','/absolute','C:/secret','.env','data/state.json','AGENTS.md','x/*']:
            with self.subTest(name=name),self.assertRaises(ValueError):
                pool.relative_file(name)
        self.assertEqual(pool.relative_file('web/data/manifest.json'),'web/data/manifest.json')
        with self.assertRaisesRegex(ValueError,'shell wrappers'):
            pool.manifest_tasks({'tasks':[dict(base,validation='powershell Remove-Item') ]})

    def test_outside_allowed_refused_even_if_upstream_says_success(self):
        t=self.execute(self.task(),outside=True)
        self.assertEqual(t['status'],'failed')
        self.assertEqual(t['outside_allowed'],['forbidden.txt'])
        self.assertIsNone(t['review'])

    def test_worker_success_needs_review_and_untracked_diff_is_collected(self):
        t=self.execute(self.task())
        self.assertEqual(t['status'],'awaiting_review')
        self.assertIn('+worker output', (Path(t['root'])/'diff-1.patch').read_text())
        with self.assertRaisesRegex(ValueError,'Codex approval'):
            pool.verify_approval({'tasks':[t]})

    def test_original_validation_reruns_despite_claimed_worker_pass(self):
        task=self.task()
        task['validation']='node -e "process.exit(1)"'
        t=self.execute(task)
        self.assertEqual(t['status'],'failed')
        self.assertTrue(t['scope_ok'])
        self.assertFalse(t['codex_validation']['ok'])

    def test_idempotent_smoke_requires_explicit_allow_no_change(self):
        t=self.execute(self.task())
        t2=self.execute(t)
        self.assertEqual(t2['status'],'failed')
        t['allow_no_change']=True
        t3=self.execute(t)
        self.assertEqual(t3['status'],'awaiting_review')

    def approve(self,t):
        t['review']={'decision':'approve','revision':t['revision'],
                     'result_fingerprint':t['result_fingerprint'],'reason':'Codex inspected diff and validation'}

    def test_stale_result_output_or_workspace_blocks_acceptance(self):
        t=self.execute(self.task()); self.approve(t)
        pool.verify_approval({'tasks':[t]})
        (Path(t['workspace'])/'other.md').write_text('post-review edit')
        with self.assertRaisesRegex(ValueError,'Workspace changed'):
            pool.verify_approval({'tasks':[t]})
        (Path(t['workspace'])/'other.md').unlink()
        (Path(t['workspace'])/'result.md').write_text('post-review edit')
        with self.assertRaisesRegex(ValueError,'output changed'):
            pool.verify_approval({'tasks':[t]})

    def test_provider_error_opens_circuit_and_preserves_locks(self):
        pool.pause_provider(self.c,{'provider_code':'1309'})
        with self.assertRaisesRegex(RuntimeError,'cooldown'):
            with pool.account_slot(self.c): pass
        self.assertTrue(pool.cooldown(self.c))

    def test_source_conflict_blocks_integration(self):
        t=self.execute(self.task()); self.approve(t)
        source=self.root/'source'; source.mkdir()
        (source/'result.md').write_text('concurrent user change')
        with self.assertRaisesRegex(ValueError,'Source conflict'):
            pool.integrate({'source':str(source),'tasks':[t]},'node --version',False,self.c)
        self.assertEqual((source/'result.md').read_text(),'concurrent user change')

    def test_repair_keeps_all_changes_and_requires_new_review(self):
        t=self.execute(self.task())
        t2=self.execute(t,repair='Polish existing report only')
        self.assertEqual(t2['changed_files'],['result.md'])
        self.assertEqual(t2['revision'],2)
        self.assertIsNone(t2['review'])

    def test_failed_final_tests_roll_back_only_pool_files(self):
        t=self.execute(self.task()); self.approve(t)
        source=self.root/'source'; source.mkdir()
        (source/'user.md').write_text('preserve me')
        state={'run':str(self.root),'source':str(source),'tasks':[t]}
        with self.assertRaisesRegex(RuntimeError,'rolled back'):
            pool.integrate(state,'node -e "process.exit(1)"',True,self.c)
        self.assertFalse((source/'result.md').exists())
        self.assertEqual((source/'user.md').read_text(),'preserve me')
        self.assertFalse(pool.read(self.root/'final-tests.json')['ok'])

    def test_worktrees_preserve_current_tracked_edits_and_are_independent(self):
        source=self.root/'git-source'; source.mkdir()
        def git(*args):
            subprocess.run(['git',*args],cwd=source,check=True,capture_output=True)
        git('init','--initial-branch=main')
        (source/'sample.mjs').write_text('export const value=1;\n')
        git('add','sample.mjs')
        git('-c','user.name=Pool Test','-c','user.email=pool-test@localhost','commit','-m','fixture')
        (source/'sample.mjs').write_text('export const value=2;\n')
        (source/'context.md').write_text('explicit untracked input')
        run=self.root/'worktree-run'; run.mkdir()
        tasks=pool.manifest_tasks({'tasks':[
            {'id':'one','allowed_files':['result-one.md'],'input_files':['context.md'],
             'objective':'Write one','validation':'node --version'},
            {'id':'two','allowed_files':['result-two.md'],'objective':'Write two','validation':'node --version'}]})
        state=pool.prepare(run,source,tasks,{'isolation':'worktree'})
        a,b=[Path(x['workspace']) for x in state['tasks']]
        self.assertNotEqual(a,b)
        self.assertEqual((a/'sample.mjs').read_text(),'export const value=2;\n')
        self.assertEqual((b/'sample.mjs').read_text(),'export const value=2;\n')
        self.assertTrue((a/'context.md').exists())
        self.assertFalse((b/'context.md').exists())
        self.assertNotEqual(state['tasks'][0]['home'],state['tasks'][1]['home'])
        self.assertEqual((source/'sample.mjs').read_text(),'export const value=2;\n')

    def test_duplicate_or_stale_review_rejected(self):
        t=self.execute(self.task())
        d={'id':t['id'],'revision':0,'result_fingerprint':t['result_fingerprint'],
           'decision':'approve','reason':'test'}
        with self.assertRaisesRegex(ValueError,'stale'):
            pool.review({'tasks':[t],'run':str(self.root)},{'tasks':[d]},self.c)
        with self.assertRaisesRegex(ValueError,'exactly once'):
            pool.review({'tasks':[t],'run':str(self.root)},{'tasks':[d,d]},self.c)


if __name__=='__main__':
    unittest.main()
