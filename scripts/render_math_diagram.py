"""Render a small allow-listed math diagram from structured JSON parameters."""
import ast
import json
import math
import sys


MAX_EXPRESSION_LENGTH = 160
MAX_EXPRESSION_NODES = 80
MAX_EXPRESSION_DEPTH = 16
MAX_EXPONENT = 100.0
CONSTANTS = {"pi": math.pi, "e": math.e}
ALLOWED_FUNCS = {"sin": math.sin, "cos": math.cos, "tan": math.tan, "exp": math.exp, "log": math.log, "sqrt": math.sqrt, "abs": abs}
BINARY_OPERATORS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)


class ExpressionLimitError(ValueError):
    """The expression exceeds a computation budget, rather than a math domain."""


def _number(value):
    if type(value) not in (int, float):
        raise ValueError("表达式只允许数值")
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError("表达式数值超出范围") from exc
    if not math.isfinite(number):
        raise ValueError("表达式数值必须有限")
    return number


def _validate(node, depth=0):
    if depth > MAX_EXPRESSION_DEPTH:
        raise ExpressionLimitError("表达式嵌套过深")
    if isinstance(node, ast.Constant):
        _number(node.value)
    elif isinstance(node, ast.Name):
        if node.id != "x" and node.id not in CONSTANTS:
            raise ValueError("表达式包含未允许的名称")
    elif isinstance(node, ast.BinOp) and isinstance(node.op, BINARY_OPERATORS):
        _validate(node.left, depth + 1)
        _validate(node.right, depth + 1)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        _validate(node.operand, depth + 1)
    elif isinstance(node, ast.Call):
        if (not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCS
                or node.keywords or len(node.args) not in ((1, 2) if node.func.id == "log" else (1,))):
            raise ValueError("表达式函数或参数不在白名单中")
        for argument in node.args:
            _validate(argument, depth + 1)
    else:
        raise ValueError("表达式包含未允许的运算")


def _check_exponent(value):
    if abs(value) > MAX_EXPONENT:
        raise ExpressionLimitError("表达式指数超出限制")


def _calculate(node, x):
    # Every operand and result is a finite float; integer powers never run.
    if isinstance(node, ast.Constant):
        return _number(node.value)
    if isinstance(node, ast.Name):
        return x if node.id == "x" else CONSTANTS[node.id]
    if isinstance(node, ast.UnaryOp):
        value = _calculate(node.operand, x)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.Call):
        arguments = [_calculate(argument, x) for argument in node.args]
        return _number(ALLOWED_FUNCS[node.func.id](*arguments))
    if isinstance(node, ast.BinOp):
        right = _calculate(node.right, x)
        if isinstance(node.op, ast.Pow):
            _check_exponent(right)
        left = _calculate(node.left, x)
        if isinstance(node.op, ast.Add):
            value = left + right
        elif isinstance(node.op, ast.Sub):
            value = left - right
        elif isinstance(node.op, ast.Mult):
            value = left * right
        elif isinstance(node.op, ast.Div):
            value = left / right
        elif isinstance(node.op, ast.Mod):
            value = left % right
        else:
            value = math.pow(left, right)
        return _number(value)
    raise ValueError("表达式包含未允许的运算")


def safe_expression(source):
    """Return a bounded, numeric-only function of x without executing Python code."""
    if not isinstance(source, str):
        raise ValueError("表达式必须是字符串")
    if len(source) > MAX_EXPRESSION_LENGTH:
        raise ExpressionLimitError("表达式过长")
    tree = ast.parse(source.strip() or "0", mode="eval")
    if sum(1 for _ in ast.walk(tree)) > MAX_EXPRESSION_NODES:
        raise ExpressionLimitError("表达式节点过多")
    _validate(tree.body)
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            if any(isinstance(child, ast.Name) and child.id == "x" for child in ast.walk(node.right)):
                continue
            try:
                _check_exponent(_calculate(node.right, 0.0))
            except ExpressionLimitError:
                raise
            except (ArithmeticError, ValueError):
                # A domain error becomes NaN at sampling time, as for log(x).
                pass

    def expression(x):
        return _calculate(tree.body, _number(x))

    return expression


def sample_function(spec):
    """Validate a function diagram and sample it without importing graphics libraries."""
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
    ys = []
    for x in xs:
        try:
            y = expression(x)
        except ExpressionLimitError:
            raise
        except (ArithmeticError, ValueError):
            y = float("nan")
        ys.append(y if math.isfinite(y) and abs(y) < 1e5 else float("nan"))
    return xs, ys


def render(spec):
    xs, ys = sample_function(spec)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

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


def main():
    try:
        render(json.load(sys.stdin))
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
