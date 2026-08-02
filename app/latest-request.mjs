export function createLatestRequestCoordinator() {
  let generation = 0;
  let controller = null;

  function begin() {
    controller?.abort();
    controller = new AbortController();
    return Object.freeze({
      generation: ++generation,
      signal: controller.signal,
    });
  }

  function isCurrent(request) {
    return Boolean(
      request
      && request.generation === generation
      && request.signal === controller?.signal
      && !request.signal.aborted
    );
  }

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  return Object.freeze({ begin, invalidate, isCurrent });
}
