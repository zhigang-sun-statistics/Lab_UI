/**
 * lab.json loading + plugin config resolution. lab.json lives next to the
 * built lib/ (shipped in the package files list); an absolute override path
 * arrives through the cordis entry config (config.labFile).
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LabInvariantError } from './invariant.ts'

export interface LabJumpHost {
	host: string
	port?: number
	username: string
	password: string
}

export interface LabSwitch {
	id: string
	name: string
	ip: string
	group: string
	model?: string
	position?: { x: number; y: number }
}

export interface LabLinkEndpoint {
	sw: string
	port: string
}

export interface LabLink {
	a: LabLinkEndpoint
	b: LabLinkEndpoint
	note?: string
}

export interface LabConfig {
	jumphost: LabJumpHost
	switch: { username: string; password: string; port?: number }
	switches: LabSwitch[]
	links: LabLink[]
}

export interface LabPluginConfig {
	labFile?: string
	experimentFile?: string
	cacheTtlMs?: number
	timeoutMs?: number
}

const LIB_DIR = dirname(fileURLToPath(import.meta.url))

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/** Load + validate lab.json. Throws LabInvariantError on a malformed file. */
export async function loadLabConfig(overridePath?: string): Promise<LabConfig> {
	const path = overridePath !== undefined && overridePath.length > 0 && isAbsolute(overridePath)
		? overridePath
		: join(LIB_DIR, '..', 'lab.json')
	const text = await readFile(path, 'utf8')
	const parsed: unknown = JSON.parse(text)
	if (!isRecord(parsed)) throw new LabInvariantError('lab.json: root must be an object')
	const jumphost = parsed.jumphost
	const swCreds = parsed.switch
	const switches = parsed.switches
	const links = parsed.links
	if (!isRecord(jumphost) || typeof jumphost.host !== 'string' || typeof jumphost.username !== 'string') {
		throw new LabInvariantError('lab.json: jumphost {host, username} required')
	}
	if (!isRecord(swCreds) || typeof swCreds.username !== 'string') {
		throw new LabInvariantError('lab.json: switch {username} required')
	}
	if (!Array.isArray(switches) || switches.length === 0) {
		throw new LabInvariantError('lab.json: switches[] required')
	}
	const known = new Set<string>()
	const normSwitches: LabSwitch[] = switches.map((raw: unknown) => {
		if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.ip !== 'string') {
			throw new LabInvariantError('lab.json: every switch needs {id, ip}')
		}
		known.add(raw.id)
		return {
			id: raw.id,
			name: typeof raw.name === 'string' ? raw.name : raw.id,
			ip: raw.ip,
			group: typeof raw.group === 'string' ? raw.group : '?',
			model: typeof raw.model === 'string' ? raw.model : undefined,
			position: isRecord(raw.position) && typeof raw.position.x === 'number' && typeof raw.position.y === 'number'
				? { x: raw.position.x, y: raw.position.y }
				: undefined,
		}
	})
	const normLinks: LabLink[] = Array.isArray(links)
		? links.flatMap((raw: unknown) => {
			if (!isRecord(raw) || !isRecord(raw.a) || !isRecord(raw.b)) return []
			const a = raw.a
			const b = raw.b
			if (typeof a.sw !== 'string' || typeof a.port !== 'string' || typeof b.sw !== 'string' || typeof b.port !== 'string') return []
			if (!known.has(a.sw) || !known.has(b.sw)) return []
			return [{ a: { sw: a.sw, port: a.port }, b: { sw: b.sw, port: b.port }, note: typeof raw.note === 'string' ? raw.note : undefined }]
		})
		: []
	return {
		jumphost: {
			host: jumphost.host,
			port: typeof jumphost.port === 'number' ? jumphost.port : 22,
			username: jumphost.username,
			password: typeof jumphost.password === 'string' ? jumphost.password : '',
		},
		switch: {
			username: swCreds.username,
			password: typeof swCreds.password === 'string' ? swCreds.password : '',
			port: typeof swCreds.port === 'number' ? swCreds.port : 22,
		},
		switches: normSwitches,
		links: normLinks,
	}
}
