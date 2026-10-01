const sharp = require('sharp')
const fs = require('fs')

async function main() {
  const src = 'app/icon.png'
  const sizes = [16, 32, 48, 256]
  const pngBuffers = await Promise.all(
    sizes.map((s) => sharp(src).resize(s, s).png().toBuffer())
  )

  const headerSize = 6
  const dirEntrySize = 16
  let offset = headerSize + dirEntrySize * sizes.length

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sizes.length, 4) // image count

  const dirEntries = []
  const imageDatas = []
  sizes.forEach((s, i) => {
    const buf = pngBuffers[i]
    const entry = Buffer.alloc(dirEntrySize)
    entry.writeUInt8(s === 256 ? 0 : s, 0) // width
    entry.writeUInt8(s === 256 ? 0 : s, 1) // height
    entry.writeUInt8(0, 2) // color count
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(buf.length, 8) // bytes in resource
    entry.writeUInt32LE(offset, 12) // image offset
    offset += buf.length
    dirEntries.push(entry)
    imageDatas.push(buf)
  })

  const ico = Buffer.concat([header, ...dirEntries, ...imageDatas])
  fs.writeFileSync('app/favicon.ico', ico)
  console.log('Wrote app/favicon.ico,', ico.length, 'bytes, sizes:', sizes.join(','))
}

main().catch((err) => { console.error(err); process.exit(1) })
