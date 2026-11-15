import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/render_math_diagram.py', import.meta.url));
const python = process.env.DAGUAN_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const bootstrap = `
import importlib.abc
import importlib.util
import json
import math
import sys

class NoPlottingLibrary(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'matplotlib' or fullname.startswith('matplotlib.'):
            raise AssertionError('Pure expression tests must not load matplotlib')
        return None

sys.meta_path.insert(0, NoPlottingLibrary())
spec = importlib.util.spec_from_file_location('math_diagram', sys.argv[1])
diagram = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagram)
`;

function checkPython(body) {
  const result = spawnSync(python, ['-I', '-B', '-X', 'utf8', '-c', `${bootstrap}\n${body}`, script], {
    input: '',
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, TEMP: 'F:\\AI\\tmp', TMP: 'F:\\AI\\tmp' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('数学表达式无需图形库即可求值并采样正常函数与多项式', () => {
  const actual = checkPython(`
xs, ys = diagram.sample_function({'kind': 'function', 'expression': 'x**2-2*x+1', 'x': [-2, 2], 'samples': 81})
values = [diagram.safe_expression(source)(x) for source, x in [
    ('sin(x)', math.pi / 2), ('cos(x)', 0), ('tan(x)', 0),
    ('exp(x)', 0), ('log(e)', 0), ('log(8, 2)', 0), ('sqrt(9)', 0), ('abs(-3)', 0),
    ('2+3*4', 0), ('-(x%3)+2', 4), ('x**-2', 2),
]]
print(json.dumps({'samples': len(xs), 'xs': xs[::20], 'ys': ys[::20], 'values': values}))
`);
  assert.deepEqual(actual, {
    samples: 81,
    xs: [-2, -1, 0, 1, 2],
    ys: [9, 4, 1, 0, 1],
    values: [1, 1, 0, 1, 1, 3, 3, 3, 14, 1, 0.25],
  });
});

test('数学表达式拒绝非数值、属性访问和任意调用', () => {
  const actual = checkPython(`
sources = [
    "'1'", "b'1'", 'True', 'False', 'None', '1j', '1e309',
    'x.real', 'x[0]', '(1).__class__.__mro__', '__import__("os")',
    'open("forbidden")', 'getattr(sin,"__globals__")', 'sin.__globals__', 'pow(x,2)',
    '[x for x in (1,2)]', '(x for x in (1,2))', '(lambda: 1)()', '(x:=1)',
    'f"{x}"', '1;2', 'x or 1', '1 if x else 0', 'sin', 'sin()',
    'sin(x,1)', 'log(8,2,3)', 'sin(x=1)', 'sin(*x)', True, None, 1, [1],
]
rejected = 0
for index, source in enumerate(sources):
    try:
        diagram.safe_expression(source)
    except (ValueError, SyntaxError):
        rejected += 1
    else:
        raise AssertionError('Accepted illegal expression at index ' + str(index))
print(json.dumps({'rejected': rejected}))
`);
  assert.deepEqual(actual, { rejected: 33 });
});

test('超长、复杂表达式及巨幂在求值前快速拒绝，变量指数同样受限', () => {
  const actual = checkPython(`
import time

# Resource-bomb strings are validated only: never call the returned function.
sources = [
    '1' * 161, '+'.join(['x'] * 25), 'sin(' * 18 + 'x' + ')' * 18,
    'x**101', 'x**-101', '2**(50+51)', '9**9**9', '9**(9**9**9)',
    "'1'*1000000000", "b'1'*1000000000",
]
started = time.perf_counter()
rejected = 0
for index, source in enumerate(sources):
    try:
        diagram.safe_expression(source)
    except (ValueError, SyntaxError):
        rejected += 1
    else:
        raise AssertionError('Accepted over-budget expression at index ' + str(index))
assert time.perf_counter() - started < 1.0, 'Over-budget validation must finish promptly'
expression = diagram.safe_expression('2**(x+100)')
assert math.isfinite(expression(0))
try:
    expression(1)  # Exponent 101 is harmless even if the limit were regressed.
except diagram.ExpressionLimitError:
    dynamic_rejected = True
else:
    dynamic_rejected = False
try:
    diagram.sample_function({'kind': 'function', 'expression': '2**(x+100)', 'x': [1, 2]})
except diagram.ExpressionLimitError:
    sampling_rejected = True
else:
    sampling_rejected = False
print(json.dumps({'rejected': rejected, 'dynamicRejected': dynamic_rejected, 'samplingRejected': sampling_rejected}))
`);
  assert.deepEqual(actual, { rejected: 10, dynamicRejected: true, samplingRejected: true });
});

test('常量和嵌套幂只产生浮点结果，数值溢出不产生大整数', () => {
  const actual = checkPython(`
values = [diagram.safe_expression(source)(0) for source in ['2', '2**100', '(2**10)**10', '2**-100']]
_, ys = diagram.sample_function({'kind': 'function', 'expression': '(2**100)**100', 'x': [0, 1]})
print(json.dumps({'allFloat': all(type(value) is float for value in values), 'allFinite': all(math.isfinite(value) for value in values), 'overflowIsNan': all(math.isnan(y) for y in ys)}))
`);
  assert.deepEqual(actual, { allFloat: true, allFinite: true, overflowIsNan: true });
});

test('对数、平方根和除零的域错误保留为NaN采样', () => {
  const actual = checkPython(`
results = {}
for label, source in [('sqrt', 'sqrt(x)'), ('log', 'log(x)'), ('reciprocal', '1/x')]:
    _, ys = diagram.sample_function({'kind': 'function', 'expression': source, 'x': [-1, 1], 'samples': 81})
    results[label] = [None if math.isnan(ys[index]) else ys[index] for index in [0, 40, 80]]
for label, source in [('negativePower', '(-1)**0.5'), ('expOverflow', 'exp(1000)'), ('nonfiniteProduct', '1e308*1e308'), ('constantDomain', '2**log(-1)')]:
    _, ys = diagram.sample_function({'kind': 'function', 'expression': source, 'x': [0, 1]})
    results[label] = all(math.isnan(y) for y in ys)
print(json.dumps(results))
`);
  assert.deepEqual(actual, {
    sqrt: [null, 0, 1],
    log: [null, null, 0],
    reciprocal: [-1, null, 1],
    negativePower: true,
    expOverflow: true,
    nonfiniteProduct: true,
    constantDomain: true,
  });
});

test('函数采样保持点数上限并拒绝无效绘图区间', () => {
  const actual = checkPython(`
counts = [len(diagram.sample_function({'kind': 'function', 'expression': 'x', 'x': [0, 1], 'samples': count})[0]) for count in [1, 81, 1000000]]
invalid_specs = [
    {'kind': 'polyline'},
    {'kind': 'function', 'x': [0]},
    {'kind': 'function', 'x': [1, 1]},
    {'kind': 'function', 'x': [2, 1]},
    {'kind': 'function', 'x': [-21, 21]},
    {'kind': 'function', 'x': [0, float('inf')]},
]
rejected = 0
for spec in invalid_specs:
    try:
        diagram.sample_function(spec)
    except ValueError:
        rejected += 1
    else:
        raise AssertionError('Accepted invalid diagram bounds or kind')
print(json.dumps({'counts': counts, 'rejected': rejected}))
`);
  assert.deepEqual(actual, { counts: [80, 81, 1000], rejected: 6 });
});

test('绘图入口在导入后可调用并在加载图形库前拒绝非法表达式', () => {
  const actual = checkPython(`
import contextlib
import io

original_stdin = sys.stdin
error = io.StringIO()
try:
    sys.stdin = io.StringIO(json.dumps({'kind': 'function', 'expression': "'1'*1000000000"}))
    with contextlib.redirect_stderr(error):
        status = diagram.main()
finally:
    sys.stdin = original_stdin
print(json.dumps({'status': status, 'reportedError': bool(error.getvalue())}))
`);
  assert.deepEqual(actual, { status: 2, reportedError: true });
});
