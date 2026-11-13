// Regenerate PNG app icons from public/icons/icon.svg:  node scripts/gen-icons.mjs
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
const p = (n) => fileURLToPath(new URL(`../public/icons/${n}`, import.meta.url))
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(p('icon.svg'), { density: 300 }).resize(size, size).png().toFile(p(name))
  console.log('wrote', name)
}
