const net = require('net')

const LOOPBACK_HOST = '127.0.0.1'

function isValidPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        if (!isValidPort(port)) {
          reject(new Error('Failed to reserve a loopback API port'))
          return
        }
        resolve(port)
      })
    })
  })
}

function buildRendererQuery(apiPort, { performanceDebug = false } = {}) {
  if (!isValidPort(apiPort)) throw new RangeError('Invalid API port')
  return {
    apiPort: String(apiPort),
    ...(performanceDebug ? { perf: '1' } : {}),
  }
}

module.exports = {
  LOOPBACK_HOST,
  buildRendererQuery,
  isValidPort,
  reserveLoopbackPort,
}
