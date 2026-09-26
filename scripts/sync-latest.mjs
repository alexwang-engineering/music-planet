import { execFileSync } from 'node:child_process';

const run = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const branch = run(['branch', '--show-current']);
const dirty = run(['status', '--porcelain']);

run(['fetch', 'origin', 'main', '--prune']);
const [ahead, behind] = run(['rev-list', '--left-right', '--count', 'HEAD...origin/main'])
  .split(/\s+/)
  .map(Number);

if (dirty) {
  console.warn('Nebula has local changes; fetched origin/main but did not overwrite them.');
  console.warn(`Current branch: ${branch || '(detached)'} · local ahead ${ahead} · remote ahead ${behind}`);
  process.exitCode = 2;
} else if (branch === 'main' && behind > 0) {
  run(['merge', '--ff-only', 'origin/main']);
  console.log(`Nebula fast-forwarded main by ${behind} commit(s).`);
} else {
  console.log(`Nebula is ready: ${branch || '(detached)'} · local ahead ${ahead} · remote ahead ${behind}`);
}
