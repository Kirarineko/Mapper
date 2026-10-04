import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const extensions = process.platform === 'win32' ? ['exe'] : process.platform === 'linux' ? ['AppImage', 'rpm'] : []
if (extensions.length === 0 || process.arch !== 'x64') throw new Error('Installer verification requires Windows/Linux x64')
const platform = process.platform === 'win32' ? 'win' : 'linux'
// electron-builder expands x64 to x86_64 for AppImage and RPM artifacts.
const artifactArch = process.platform === 'win32' ? 'x64' : 'x86_64'
const lines = []
for (const extension of extensions) {
  const filename = `mapper-${version}-${platform}-${artifactArch}.${extension}`
  const path = join(root, 'release', filename)
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty installer: ${filename}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  lines.push(`${hash.digest('hex')}  ${filename}`)
}
await writeFile(join(root, 'release', 'SHA256SUMS'), `${lines.join('\n')}\n`)
console.log(`Verified mapper ${version} ${platform} ${artifactArch} installers and wrote SHA256SUMS`)
