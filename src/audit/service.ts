import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditSessionMeta } from '../types.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(process.env.LAB_AUDIT_DATA_DIR ?? join(MODULE_DIR, '..', 'data', 'audit'))
const SESSIONS_DIR = join(DATA_ROOT, 'sessions')
const MAX_CHUNK = 8 * 1024
const MAX_OUTPUT_PER_SESSION = 512 * 1024
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionRecorder {
	id: string
	input(chunk: string): void
	output(chunk: string): void
	end(): void
}

const sessionPath = (id: string): string => join(SESSIONS_DIR, id + '.jsonl')
const metaPath = (id: string): string => join(SESSIONS_DIR, id + '.meta.json')

const writeMeta = async (meta: AuditSessionMeta): Promise<void> => {
	await mkdir(SESSIONS_DIR, { recursive: true })
	await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8')
}

/** Start recording one interactive SSH session (append-only JSONL + meta sidecar). */
export function startSession(username: string, switchId: string): SessionRecorder {
	const id = 's_' + randomUUID()
	const meta: AuditSessionMeta = { id, username, switchId, startedAt: Date.now(), bytesIn: 0, bytesOut: 0, outputCapped: false, closed: false }
	let closed = false
	let lastMetaWrite = 0
	// Appends must wait for the sessions directory to exist; without this
	// chain the very first session loses its opening events to ENOENT races.
	let ready: Promise<void> = mkdir(SESSIONS_DIR, { recursive: true }).then(() => undefined, () => undefined)
	const append = (event: AuditEvent): void => {
		if (closed) return
		void ready.then(() => appendFile(sessionPath(id), JSON.stringify(event) + String.fromCharCode(10), 'utf8')).catch(() => undefined)
	}
	const touchMeta = (): void => {
		if (Date.now() - lastMetaWrite < 5_000 && !closed) return
		lastMetaWrite = Date.now()
		void writeMeta(meta).catch(() => undefined)
	}
	append({ at: Date.now(), k: 'open', d: username + '@' + switchId })
	touchMeta()
	return {
		id,
		input(chunk) { if (chunk.length === 0 || closed) return; const capped = chunk.slice(0, MAX_CHUNK); meta.bytesIn += capped.length; append({ at: Date.now(), k: 'in', d: capped }); touchMeta() },
		output(chunk) {
			if (chunk.length === 0 || closed || meta.outputCapped) return
			if (meta.bytesOut + chunk.length > MAX_OUTPUT_PER_SESSION) {
				const remaining = Math.max(0, MAX_OUTPUT_PER_SESSION - meta.bytesOut)
				if (remaining > 0) { meta.bytesOut += remaining; append({ at: Date.now(), k: 'out', d: chunk.slice(0, remaining) }) }
				meta.outputCapped = true
				append({ at: Date.now(), k: 'cap', d: 'output recording capped at ' + String(MAX_OUTPUT_PER_SESSION) + ' bytes' })
				return
			}
			meta.bytesOut += chunk.length
			append({ at: Date.now(), k: 'out', d: chunk.slice(0, MAX_CHUNK) })
			touchMeta()
		},
		end() {
			if (closed) return
			append({ at: Date.now(), k: 'close' })
			closed = true
			meta.closed = true
			meta.endedAt = Date.now()
			void writeMeta(meta).catch(() => undefined)
		},
	}
}

const isId = (value: string): boolean => /^s_[a-f0-9-]{8,}$/.test(value)

/** Recent sessions, newest first, with a best-effort retention sweep. */
export async function listSessions(limit = 50): Promise<AuditSessionMeta[]> {
	await mkdir(SESSIONS_DIR, { recursive: true })
	const names = await readdir(SESSIONS_DIR).catch(() => [] as string[])
	const metas: AuditSessionMeta[] = []
	const now = Date.now()
	const expired: string[] = []
	for (const name of names) {
		if (!name.endsWith('.meta.json')) continue
		const raw = await readFile(join(SESSIONS_DIR, name), 'utf8').then((text) => JSON.parse(text) as AuditSessionMeta).catch(() => undefined)
		if (raw === undefined || typeof raw.id !== 'string') continue
		if (now - raw.startedAt > RETENTION_MS) { expired.push(raw.id); continue }
		metas.push(raw)
	}
	metas.sort((a, b) => b.startedAt - a.startedAt)
	if (expired.length > 0) {
		void Promise.allSettled(expired.map(async (id) => {
			await rename(sessionPath(id), sessionPath(id) + '.expired').catch(() => undefined)
			await rename(metaPath(id), metaPath(id) + '.expired').catch(() => undefined)
		}))
	}
	return metas.slice(0, Math.min(Math.max(1, limit), 200))
}

/** Full event stream of one session. */
export async function readSession(id: string, kinds?: Set<AuditEvent['k']>): Promise<{ meta: AuditSessionMeta; events: AuditEvent[] } | undefined> {
	if (!isId(id)) return undefined
	const meta = await readFile(metaPath(id), 'utf8').then((text) => JSON.parse(text) as AuditSessionMeta).catch(() => undefined)
	if (meta === undefined) return undefined
	const text = await readFile(sessionPath(id), 'utf8').catch(() => '')
	const events: AuditEvent[] = []
	for (const line of text.split(String.fromCharCode(10))) {
		if (line.length === 0) continue
		try {
			const parsed = JSON.parse(line) as AuditEvent
			if (kinds === undefined || kinds.has(parsed.k)) events.push(parsed)
		} catch { /* truncated tail line during an active write */ }
	}
	return { meta, events }
}
