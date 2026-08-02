const DEFAULT_API_PORT = 3000;

export function resolveLoopbackApiBase(search = '') {
  const params = new URLSearchParams(String(search));
  const port = Number(params.get('apiPort'));
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : DEFAULT_API_PORT;
  return `http://127.0.0.1:${safePort}`;
}

export { DEFAULT_API_PORT };
