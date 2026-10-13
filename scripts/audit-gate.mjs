// Fails on any high or critical npm advisory except the reviewed exceptions below.
// Each exception must name the advisory and why this app cannot reach it.
import { execFileSync } from 'node:child_process'

const ACCEPTED = {
  // node-forge <=1.4.0 (no patched release): PKCS#1 v1.5 *signature verification*
  // accepts extra DigestAlgorithm elements. NeteaseCloudMusicApi only uses
  // forge.pki.publicKeyFromPem(...).encrypt(...) in util/crypto.js and never
  // verifies signatures. Remove once node-forge ships a fix.
  'https://github.com/advisories/GHSA-86w9-cpqp-85rv': 'node-forge signature verification is not used',
}

let raw
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' })
} catch (err) {
  raw = err.stdout // npm audit exits non-zero when it finds anything
}
const { vulnerabilities = {} } = JSON.parse(raw)

const blocking = []
for (const [name, vuln] of Object.entries(vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue // a parent package; its advisory is listed under the child
    if (!['high', 'critical'].includes(via.severity)) continue
    if (ACCEPTED[via.url]) {
      console.log(`accepted  ${name} ${via.url} (${ACCEPTED[via.url]})`)
      continue
    }
    blocking.push(`${via.severity.padEnd(8)}  ${name} ${via.url} ${via.title}`)
  }
}

if (blocking.length) {
  console.error(`npm audit: ${blocking.length} unaccepted high/critical advisories\n${blocking.join('\n')}`)
  process.exit(1)
}
console.log('npm audit: no unaccepted high/critical advisories')
