// Gom văn bản do người yêu cầu cung cấp (data/seed/policies/provided/*.json) vào index.json để đóng gói cùng Worker.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'seed', 'policies', 'provided')
const docs = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
writeFileSync(join(dir, 'index.json'), JSON.stringify(docs, null, 2) + '\n')
console.log(`Đã gom ${docs.length} văn bản do người yêu cầu cung cấp`)
