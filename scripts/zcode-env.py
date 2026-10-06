"""Windows launcher for upstream ZCode supervisor; configuration stays local."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]


def settings() -> dict:
    return json.loads((REPO / '.codex/zcode-pool.local.json').read_text(encoding='utf-8'))


def child_env(runtime_home: Path | None = None) -> dict[str, str]:
    local = settings()
    home = str(runtime_home or Path(local['runtime_home']))
    temp = str(Path(home, 'tmp')) if runtime_home else local['temp_root']
    Path(temp).mkdir(parents=True, exist_ok=True)
    # Child process compatibility and storage redirection, never global HOME changes.
    env = dict(os.environ, HOME=home, USERPROFILE=home,
               TEMP=temp, TMP=temp,
               PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1',
               ZCODE_CLI_PATH=local['zcode_cli'],
               ZCODE_DATA_BASE_DIR=home,
               ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=local['builtin_provider_config'],
               ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=home + '/.zcode/v2/provider_config.json',
               npm_config_cache=local['npm_cache'],
               XDG_CACHE_HOME=home + '/cache', XDG_DATA_HOME=home + '/data')
    env['PYTHONHOME'] = local['python_home']
    env['PYTHONPATH'] = str(Path(local['supervisor']).parents[2])
    env['PATH'] = local['python_bin'] + os.pathsep + local['tool_bin'] + os.pathsep + env['PATH']
    # Git control variables cannot redirect a worker back into another checkout.
    for key in list(env):
        if key.startswith('GIT_'):
            del env[key]
    return env


def command(name: str, args: list[str]) -> list[str]:
    local = settings()
    if name == 'zcode':
        return ['node', local['zcode_cli'], *args]
    if name == 'zcodectl':
        return ['node', local['controller'], *args]
    if name in {'zcode-supervisor', 'zcode-install-repo', 'zcode-auto-route'}:
        modules = {'zcode-supervisor': 'tools.zcode_supervisor.zcode_supervisor',
                   'zcode-install-repo': 'tools.zcode_supervisor.repo_setup',
                   'zcode-auto-route': 'tools.zcode_supervisor.zcode_supervisor'}
        return [local['python'], '-m', modules[name], *(['auto-route'] if name == 'zcode-auto-route' else []), *args]
    raise ValueError('Unsupported launcher: ' + name)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python scripts/zcode-env.py zcode|zcodectl|zcode-auto-route|zcode-install-repo|zcode-supervisor [args]')
    raise SystemExit(subprocess.call(command(sys.argv[1], sys.argv[2:]), env=child_env()))
