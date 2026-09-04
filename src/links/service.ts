import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinkState } from '../types.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(process.env.LAB_TOPOLOGY_DATA_DIR ?? join(MODULE_DIR, '..', 'data', 'topology'))
const LINKS_FILE = join(DATA_ROOT, 'links.json')

interface Store { version: 1; links: LinkState[] }

const isSwitchId = (value: string): boolean => /^sw[1-9][0-9]*$/.test(value)
const isPort = (value: string): boolean => /^Ethernet(?:[0-9]|[12][0-9]|3[01])$/.test(value)
const pairKey = (a: { sw: string; port: string }, b: { sw: string; port: string }): string => {
	const first = a.sw + ':' + a.port
	const second = b.sw + ':' + b.port
	return first < second ? first + '~' + second : second + '~' + first
}

const readStore = async (): Promise<Store> => {
	try { const parsed = JSON.parse(await readFile(LINKS_FILE, 'utf8')) as Partial<Store>; return { version: 1, links: Array.isArray(parsed.links) ? parsed.links : [] } } catch { return { version: 1, links: [] } }
}
const writeStore = async (store: Store): Promise<void> => {
	await mkdir(DATA_ROOT, { recursive: true })
	const temp = LINKS_FILE + '.tmp'
	await writeFile(temp, JSON.stringify(store, null, 2), 'utf8')
	await rename(temp, LINKS_FILE)
}

export async function listManualLinks(): Promise<LinkState[]> {
	const store = await readStore()
	return store.links.map((link) => ({ ...link }))
}

export async function addManualLink(input: { aSw: string; aPort: string; bSw: string; bPort: string; note?: string }): Promise<LinkState[]> {
	for (const [sw, port] of [[input.aSw, input.aPort], [input.bSw, input.bPort]] as const) {
		if (!isSwitchId(sw) || !isPort(port)) throw new Error('invalid endpoint: ' + sw + ' ' + port)
	}
	if (input.aSw === input.bSw && input.aPort === input.bPort) throw new Error('两端不能是同一个端口')
	const store = await readStore()
	const key = pairKey({ sw: input.aSw, port: input.aPort }, { sw: input.bSw, port: input.bPort })
	if (store.links.some((link) => link.id === 'manual:' + key)) return store.links
	const cleanNote = input.note?.replace(/[\r\n\0]+/g, ' ').trim().slice(0, 120)
	store.links.push({ id: 'manual:' + key, a: { sw: input.aSw, port: input.aPort }, b: { sw: input.bSw, port: input.bPort }, source: 'manual', note: cleanNote || undefined })
	await writeStore(store)
	return store.links
}

export async function removeManualLink(id: string): Promise<LinkState[]> {
	if (!id.startsWith('manual:')) throw new Error('只能删除手工登记的链路')
	const store = await readStore()
	store.links = store.links.filter((link) => link.id !== id)
	await writeStore(store)
	return store.links
}

export { pairKey }
