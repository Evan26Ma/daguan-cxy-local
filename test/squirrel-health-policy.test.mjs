import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./squirrel_update_e2e.py', import.meta.url));
const python = process.env.DAGUAN_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const bootstrap = `
import ast
import asyncio
import contextlib
import http.server
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

source = Path(sys.argv[1])
tree = ast.parse(source.read_text(encoding='utf-8'), filename=str(source))
helper_names = {
    '_qa_service_endpoint', '_NoQaRedirects', '_qa_service_opener',
    '_open_qa_health', '_open_qa_stop', 'wait_for_health',
}
helpers = [node for node in tree.body
           if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
           and node.name in helper_names]
assert {node.name for node in helpers} == helper_names, 'QA HTTP policy helpers must be present'
# Never import the E2E module: its top-level asyncio.run(main()) installs/uninstalls the app.
exec(compile(ast.Module(body=helpers, type_ignores=[]), str(source), 'exec'))

@contextlib.contextmanager
def qa_server(status=200, location=None):
    requests = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append({
                'method': self.command, 'path': self.path,
                'host': self.headers.get('Host'), 'origin': self.headers.get('Origin'),
                'contentType': self.headers.get('Content-Type'),
                'body': self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode(),
            })
            payload = json.dumps({'ok': True, 'qa': 'isolated'}).encode()
            self.send_response(status)
            if location is not None:
                self.send_header('Location', location)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            self.do_GET()

        def log_message(self, *_args):
            pass

    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        thread.start()
        try:
            yield server.server_port, requests
        finally:
            server.shutdown()
            thread.join(timeout=2)
            assert not thread.is_alive(), 'Temporary HTTP server must stop'

@contextlib.contextmanager
def local_connections_only(port):
    denied = []
    connect = socket.create_connection
    resolve = socket.getaddrinfo

    def guarded_connect(address, *args, **kwargs):
        if address != ('127.0.0.1', port):
            denied.append(['connect', *address])
            raise OSError('Test blocked non-QA connection before DNS or socket creation')
        return connect(address, *args, **kwargs)

    def guarded_resolve(host, target_port, *args, **kwargs):
        if (host, target_port) != ('127.0.0.1', port):
            denied.append(['dns', host, target_port])
            raise OSError('Test blocked non-QA DNS lookup')
        return resolve(host, target_port, *args, **kwargs)

    with patch.object(socket, 'create_connection', guarded_connect), patch.object(socket, 'getaddrinfo', guarded_resolve):
        yield denied
`;

function checkPython(body) {
  const env = { ...process.env, TEMP: 'F:/AI/tmp', TMP: 'F:/AI/tmp' };
  delete env.DAGUAN_DATA_DIR;
  const result = spawnSync(python, ['-I', '-B', '-X', 'utf8', '-c', `${bootstrap}\n${body}`, script], {
    input: '',
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('QA 服务地址只由有效整数端口和固定 IPv4 回环地址生成', () => {
  const actual = checkPython(`
ports = [1, 9449, 65535]
print(json.dumps([_qa_service_endpoint(port) for port in ports]))
`);
  assert.deepEqual(actual, [
    'http://127.0.0.1:1',
    'http://127.0.0.1:9449',
    'http://127.0.0.1:65535',
  ]);
});

test('布尔、非整数、越界和 URL 注入端口在请求或重试前拒绝', () => {
  const actual = checkPython(`
class FormattedPort(int):
    def __format__(self, _spec):
        raise AssertionError('Untrusted port formatting must not run')

ports = [
    True, False, None, 0, -1, 65536, 2**100, 9449.0, 1.5,
    float('nan'), float('inf'), '', '9449', ' 9449', '９４４９', b'9449', [], {},
    '9449@qa-redirect.invalid', '9449/path', '9449?next=escape', '9449#fragment',
    '9449\\\\escape', '9449\\r\\nHost: qa-redirect.invalid',
    'http://qa-redirect.invalid', '//qa-redirect.invalid', FormattedPort(9449),
]
checks = [_qa_service_endpoint, _open_qa_health, _open_qa_stop,
          lambda port: asyncio.run(wait_for_health(port, timeout=0.01))]
rejected = 0
with patch.object(urllib.request, 'build_opener', side_effect=AssertionError('No opener for an invalid port')) as opener, patch.object(socket, 'create_connection') as connect, patch.object(socket, 'getaddrinfo') as resolve:
    for port in ports:
        for check in checks:
            try:
                check(port)
            except ValueError:
                rejected += 1
            else:
                raise AssertionError('Invalid port accepted: ' + repr(port))
    opener.assert_not_called()
    connect.assert_not_called()
    resolve.assert_not_called()
print(json.dumps({'ports': len(ports), 'rejected': rejected}))
`);
  assert.deepEqual(actual, { ports: 27, rejected: 108 });
});

test('健康请求和轮询实际访问固定 /api/health，忽略环境代理', () => {
  const actual = checkPython(`
with qa_server() as (port, requests), local_connections_only(port) as denied, patch.object(urllib.request, 'getproxies', return_value={'http': 'http://qa-proxy.invalid:8080'}) as proxies:
    with _open_qa_health(port) as response:
        assert response.status == 200
        assert json.loads(response.read()) == {'ok': True, 'qa': 'isolated'}
    assert asyncio.run(wait_for_health(port, timeout=1)) == {'ok': True, 'qa': 'isolated'}
    proxies.assert_not_called()
    assert denied == [], denied
    assert [request['method'] for request in requests] == ['GET', 'GET']
    assert [request['path'] for request in requests] == ['/api/health', '/api/health']
    assert all(request['host'] == f'127.0.0.1:{port}' for request in requests)
    print(json.dumps({'requests': len(requests), 'nonLocalAttempts': len(denied)}))
`);
  assert.deepEqual(actual, { requests: 2, nonLocalAttempts: 0 });
});

test('健康和关闭请求拒绝 301/302/303/307/308 外部重定向且不尝试外发', () => {
  const actual = checkPython(`
blocked = 0
for status in [301, 302, 303, 307, 308]:
    with qa_server(status, 'http://qa-redirect.invalid/escape') as (port, requests), local_connections_only(port) as denied:
        for request in [_open_qa_health, _open_qa_stop]:
            try:
                with request(port):
                    raise AssertionError('Redirect returned a successful response')
            except urllib.error.HTTPError as error:
                assert error.code == status
                error.close()
                blocked += 1
        assert [request['path'] for request in requests] == ['/api/health', '/api/runtime/stop']
        assert denied == [], denied
print(json.dumps({'blocked': blocked, 'nonLocalAttempts': 0}))
`);
  assert.deepEqual(actual, { blocked: 10, nonLocalAttempts: 0 });
});

test('轮询不会跟随相对路径或 HTTPS、协议相对 URL 的重定向', () => {
  const actual = checkPython(`
blocked = 0
for location in ['/escape', 'https://qa-redirect.invalid/escape', '//qa-redirect.invalid/escape']:
    with qa_server(302, location) as (port, requests), local_connections_only(port) as denied:
        try:
            asyncio.run(wait_for_health(port, timeout=0.01))
        except TimeoutError:
            blocked += 1
        else:
            raise AssertionError('Health polling accepted a redirected response')
        assert requests and all(request['path'] == '/api/health' for request in requests)
        assert denied == [], denied
print(json.dumps({'blocked': blocked, 'nonLocalAttempts': 0}))
`);
  assert.deepEqual(actual, { blocked: 3, nonLocalAttempts: 0 });
});

test('Setup 原始调用点保留固定关闭路径、POST 内容和 Origin', () => {
  const actual = checkPython(`
main = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'main')
stop = next(node for node in ast.walk(main) if isinstance(node, ast.With)
            and any(isinstance(item.context_expr, ast.Call)
                    and isinstance(item.context_expr.func, ast.Name)
                    and item.context_expr.func.id == '_open_qa_stop' for item in node.items))
with qa_server() as (port, requests), local_connections_only(port) as denied:
    owner = {'port': port}
    exec(compile(ast.Module(body=[stop], type_ignores=[]), str(source), 'exec'))
    assert requests == [{
        'method': 'POST', 'path': '/api/runtime/stop', 'host': f'127.0.0.1:{port}',
        'origin': f'http://127.0.0.1:{port}', 'contentType': 'application/json', 'body': '{}',
    }], requests
    assert denied == [], denied
    print(json.dumps({'requests': len(requests), 'nonLocalAttempts': len(denied)}))
`);
  assert.deepEqual(actual, { requests: 1, nonLocalAttempts: 0 });
});

test('浏览器离线验收的健康调用同样固定地址、路径并禁止重定向', () => {
  const actual = checkPython(`
main = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'main')
service_assignment = next(node for node in ast.walk(main) if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'service_url' for target in node.targets))
health_check = next(node for node in ast.walk(main) if isinstance(node, ast.Assert)
                    and any(isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute)
                            and isinstance(child.func.value, ast.Name) and child.func.value.id == 'health_api'
                            and child.func.attr == 'get' for child in ast.walk(node)))
calls = []
class HealthApi:
    async def get(self, url, *, max_redirects):
        assert url == 'http://127.0.0.1:9449/api/health'
        assert max_redirects == 0
        calls.append(url)
        return type('Response', (), {'ok': True})()

owner = {'port': 9449}
health_api = HealthApi()
check = ast.AsyncFunctionDef(name='check_offline_health', args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]), body=[service_assignment, health_check], decorator_list=[])
module = ast.fix_missing_locations(ast.Module(body=[check], type_ignores=[]))
exec(compile(module, str(source), 'exec'))
asyncio.run(check_offline_health())
print(json.dumps(calls))
`);
  assert.deepEqual(actual, ['http://127.0.0.1:9449/api/health']);
});
