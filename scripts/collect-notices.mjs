import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = path.join(root, 'resources', 'notices')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const entries = new Map()
const optionalMissing = new Set()
const licensePattern = /(^|[-_])(licen[cs]e|copying|copyright|notice|third[-_]party[-_]notices)([._-]|$)/i

async function locatePackage(name, from) {
  let directory = from
  while (true) {
    const candidate = path.join(directory, 'node_modules', name)
    try {
      return await realpath(candidate)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

async function visit(name, from, optional = false) {
  const directory = await locatePackage(name, from)
  if (!directory) {
    if (optional) {
      optionalMissing.add(name)
      return
    }
    throw new Error(`Missing production dependency: ${name}`)
  }
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const key = `${metadata.name}@${metadata.version}`
  if (entries.has(key)) return
  const slug = `${metadata.name.replaceAll('/', '__')}@${metadata.version}`
  const output = path.join(destination, 'npm', slug)
  await mkdir(output, { recursive: true })
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !licensePattern.test(entry.name)) continue
    await copyFile(path.join(directory, entry.name), path.join(output, entry.name))
    files.push(`npm/${slug}/${entry.name}`)
  }
  // @img libvips packages supply their upstream notice in README.md.
  if (metadata.name.startsWith('@img/sharp')) {
    for (const filename of ['README.md', 'versions.json']) {
      try {
        await copyFile(path.join(directory, filename), path.join(output, filename))
        files.push(`npm/${slug}/${filename}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  // The published clipper-lib package embeds its notices in the source header.
  if (metadata.name === 'clipper-lib') {
    const source = await readFile(path.join(directory, 'clipper.js'), 'utf8')
    const header = source.slice(0, source.indexOf('(function ()'))
    if (!header.includes('Copyright (c) 2005  Tom Wu') || !header.includes('Boost Software License')) {
      throw new Error('clipper-lib notice header changed; review it before packaging')
    }
    await writeFile(path.join(output, 'NOTICE.source-header.txt'), header)
    files.push(`npm/${slug}/NOTICE.source-header.txt`)
  }
  // Some npm tarballs omit their upstream LICENSE. Keep verified original
  // texts in this repository, keyed by the exact package version.
  const upstream = path.join(destination, 'upstream', 'npm', slug)
  try {
    for (const entry of await readdir(upstream, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      await copyFile(path.join(upstream, entry.name), path.join(output, entry.name))
      files.push(`npm/${slug}/${entry.name}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (files.length === 0) throw new Error(`No original license text found: ${key}`)
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
  const record = {
    name: metadata.name,
    version: metadata.version,
    license: metadata.license ?? 'SEE ORIGINAL NOTICES',
    repository: repository ?? metadata.homepage ?? null,
    files,
    platforms: metadata.os ?? null,
    architectures: metadata.cpu ?? null,
  }
  entries.set(key, record)
  await writeFile(path.join(output, 'metadata.json'), `${JSON.stringify(record, null, 2)}\n`)
  const required = { ...metadata.dependencies }
  const optionalNames = new Set(Object.keys(metadata.optionalDependencies ?? {}))
  for (const dependency of Object.keys(required)) {
    await visit(dependency, directory, optionalNames.has(dependency))
  }
  for (const dependency of optionalNames) {
    if (!(dependency in required)) await visit(dependency, directory, true)
  }
  // Peers can supply runtime code; ignore absent optional/type-only peers.
  for (const dependency of Object.keys(metadata.peerDependencies ?? {})) {
    await visit(dependency, directory, true)
  }
}

for (const name of Object.keys(packageJson.dependencies ?? {})) await visit(name, root)
// Tailwind's generated stylesheet retains its upstream MIT banner.
await visit('tailwindcss', root)

const electron = await locatePackage('electron', root)
if (!electron) throw new Error('Electron is not installed')
const electronMetadata = JSON.parse(await readFile(path.join(electron, 'package.json'), 'utf8'))
await mkdir(path.join(destination, 'electron'), { recursive: true })
for (const filename of ['LICENSE', 'LICENSES.chromium.html']) {
  const input = path.join(electron, 'dist', filename)
  if (!(await stat(input)).isFile()) throw new Error(`Missing Electron runtime notice: ${filename}`)
  await copyFile(input, path.join(destination, 'electron', filename))
}
const sorted = [...entries.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))
const inventory = {
  application: { name: packageJson.name, version: packageJson.version, license: packageJson.license },
  lockfileSha256: createHash('sha256').update(await readFile(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
  electron: { version: electronMetadata.version, files: ['electron/LICENSE', 'electron/LICENSES.chromium.html'] },
  dependencies: sorted,
  unavailableOptionalDependencies: [...optionalMissing].sort(),
}
await writeFile(path.join(destination, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
const rows = sorted.map((record) => `| ${record.name} | ${record.version} | ${typeof record.license === 'string' ? record.license : JSON.stringify(record.license)} | ${record.files.map((filename) => `[${path.basename(filename)}](${filename})`).join(', ')} |`)
await writeFile(path.join(destination, 'README.md'), `# mapper ${packageJson.version} 第三方许可证\n\n由 scripts/collect-notices.mjs 从实际安装的 production 依赖及 Electron 运行时收集。原始文本保持不变。平台原生组件详情及 LGPL 源码说明另见 THIRD_PARTY_NOTICES.md 和 source-manifest.json。\n\n| 包 | 版本 | 元数据许可证 | 原始声明 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nElectron ${electronMetadata.version}：[MIT](electron/LICENSE)；[Chromium 及第三方组件](electron/LICENSES.chromium.html)。\n\n完整版本、锁文件 SHA-256 和未安装的可选平台包见 inventory.json。可选包清单不表示安装包包含这些包；最终分发内容应检查安装包。\n`)
console.log(`Collected original notices for ${entries.size} packages and Electron ${electronMetadata.version}`)
