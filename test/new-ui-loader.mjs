import fs from 'node:fs';
import vm from 'node:vm';

export const newUiModules = ['safe-render.js', 'new-data.js', 'new-state.js', 'new-ai.js', 'study-journal.js'];
export function loadNewUiModules(context) {
  for (const name of newUiModules) {
    vm.runInContext(fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8'), context, { filename: name });
  }
}
