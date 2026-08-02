import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatestRequestCoordinator } from '../app/latest-request.mjs';

test('a newer playback request aborts and invalidates the previous request', () => {
  const requests = createLatestRequestCoordinator();
  const first = requests.begin();
  const second = requests.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(requests.isCurrent(first), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(requests.isCurrent(second), true);
});

test('explicit invalidation prevents delayed callbacks from committing', () => {
  const requests = createLatestRequestCoordinator();
  const request = requests.begin();

  requests.invalidate();

  assert.equal(request.signal.aborted, true);
  assert.equal(requests.isCurrent(request), false);
});
