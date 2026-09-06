"""Render a small allow-listed math diagram from JSON.

This process intentionally accepts structured parameters only.  It never
executes Python supplied by a model or by the browser.
"""
import ast
import json
import math
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


ALLOWED_NAMES = {"x", "sin", "cos", "tan", "exp", "log", "sqrt", "abs", "pi", "e"}
ALLOWED_FUNCS = {"sin": math.sin, "cos": math.cos, "tan": math.tan, "exp": math.exp, "log": math.log, "sqrt": math.sqrt, "abs": abs}


def safe_expression(source):
    text = str(source or "").strip()
    if len(text) > 160 or any(token in text for token in ("__", "import", "lambda", ";", "[", "]", "{", "}")):
        raise ValueError("表达式不符合安全限制")
    tree = ast.parse(text or "0", mode="eval")
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id not in ALLOWED_NAMES:
            raise ValueError("表达式包含未允许的名称")
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCS):
            raise ValueError("表达式包含未允许的函数")
        if not isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Call,
                                 ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.USub,
                                 ast.UAdd, ast.Load)):
            raise ValueError("表达式包含未允许的运算")
    return compile(tree, "<diagram>", "eval")


def render(spec):
    if not isinstance(spec, dict) or spec.get("kind") != "function":
        raise ValueError("Python 绘图目前只接受 function 模板")
    expression = safe_expression(spec.get("expression", "sin(x)"))
    bounds = spec.get("x", [-6.28, 6.28])
    if not isinstance(bounds, list) or len(bounds) != 2:
        raise ValueError("x 范围无效")
    left, right = float(bounds[0]), float(bounds[1])
    if not math.isfinite(left) or not math.isfinite(right) or right <= left or right - left > 40:
        raise ValueError("x 范围超出限制")
    count = min(1000, max(80, int(spec.get("samples", 400))))
    xs = [left + (right - left) * i / (count - 1) for i in range(count)]
    env = {**ALLOWED_FUNCS, "pi": math.pi, "e": math.e}
    ys = []
    for x in xs:
        try:
            y = float(eval(expression, {"__builtins__": {}}, {**env, "x": x}))
        except Exception:
            y = float("nan")
        ys.append(y if math.isfinite(y) and abs(y) < 1e5 else float("nan"))
    fig, ax = plt.subplots(figsize=(6.2, 3.6), dpi=130)
    fig.patch.set_alpha(0)
    ax.set_facecolor("#fffdf9")
    ax.plot(xs, ys, color="#1f5364", linewidth=2.2)
    ax.axhline(0, color="#a8a39a", linewidth=.7)
    ax.axvline(0, color="#a8a39a", linewidth=.7)
    ax.grid(True, color="#e8e2d8", linewidth=.6, alpha=.9)
    ax.set_title(str(spec.get("title", "函数图像"))[:80], fontsize=11)
    fig.tight_layout(pad=1.2)
    fig.savefig(sys.stdout.buffer, format="svg", transparent=True)
    plt.close(fig)


try:
    render(json.load(sys.stdin))
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(2)
