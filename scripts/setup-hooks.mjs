import { execFileSync, spawnSync } from 'node:child_process';

// Local Git configuration, never the user's global hooks setting.
const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
if (![0, 1].includes(result.status)) throw new Error('Cannot read Git hooks configuration.');
const current = result.stdout.trim();
if (current && current !== '.githooks') {
  throw new Error('Existing Git hooks are configured. Integrate the privacy checks with those hooks before changing core.hooksPath.');
}
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
console.log('ARI privacy checks installed for commits and pushes.');
