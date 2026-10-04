import sharp from 'sharp'

// libvips' operation cache can retain decoder-owned file handles after an awaited
// metadata/decode call (notably WebP), preventing replacement/deletion on Windows.
// Disable retained operations as well as tracked files; keep the default 50 MB
// memory limit. Catalog fingerprints and completed tiles already cache results.
sharp.cache({ files: 0, items: 0 })
sharp.concurrency(2)

export default sharp
