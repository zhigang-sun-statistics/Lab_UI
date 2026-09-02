/**
 * dsh-lab-controller host half: three read-only JSON routes under
 * /api/lab/* served through the webServer plugin.
 *
 *   GET /api/lab/topology[?fresh=1] - merged static+LLDP topology (cached)
 *   GET /api/lab/locks              - jumphost sws lock state (cached 15s)
 *   GET /api/lab/locklog            - jumphost swl | tail -30 (uncached)
 *
 * Safety model (v1 is read-only BY CONSTRUCTION):
 * - No route accepts a command string; the collector only issues the fixed
 *   probes defined in collector.ts (show ... / sws / swl).
 * - There is no config-write, swr, reboot, or exec channel at all.
 * - Browser trust fence mirrors dsh-better-sidebar's: Host-header loopback
 *   or a Sec-Fetch-Site same-origin/none marker; cross-site refuses.
 */
import { randomBytes } from 'node:crypto'
import { loadLabConfig, type LabConfig, type LabPluginConfig } from './config.ts'
import { collect, collectLockLog, setInterfaceDescription, verifyJumpHost } from './collector.ts'
import { loadExperimentDefinition } from './experiment.ts'
import { buildTopology, type DeclaredLink } from './topology.ts'
import { parseSws } from './parser.ts'
import type { Context, LabHttpRequest, LabHttpResponse } from './context-types.ts'
import type { LockLogResponse, LocksResponse, TopologyResponse } from './types.ts'
import { createDesktopFeatures } from './desktop-host.ts'

export const inject = ['webServer']

const DEFAULT_TTL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 15_000
const LOCKS_TTL_MS = 15_000

const header = (req: LabHttpRequest, name: string): string | undefined => {
	const value = req.headers[name]
	return typeof value === 'string' ? value : undefined
}

const isLoopbackHostname = (hostname: string): boolean => {
	if (hostname === 'localhost' || hostname === '[::1]') return true
	const parts = hostname.split('.')
	return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** DNS-rebinding / cross-site defense (behaviorally mirrors the sidebar fence). */
const isTrusted = (req: LabHttpRequest): boolean => {
	const secFetchSite = header(req, 'sec-fetch-site')
	if (secFetchSite !== undefined && secFetchSite !== 'same-origin' && secFetchSite !== 'none') return false
	const authority = header(req, 'host') ?? ''
	let hostname = authority
	if (authority.includes(']')) hostname = authority.slice(0, authority.indexOf(']') + 1)
	else if (authority.includes(':')) hostname = authority.slice(0, authority.indexOf(':'))
	return isLoopbackHostname(hostname)
}

interface CachedEntry<T> {
	value: T
	at: number
}

const writeJson = (res: LabHttpResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'referrer-policy': 'no-referrer',
		...extra,
	})
	res.end(JSON.stringify(body))
}

const readJsonBody = async (req: LabHttpRequest): Promise<Record<string, unknown>> => {
	const chunks: Uint8Array[] = []
	for await (const chunk of req as LabHttpRequest & AsyncIterable<Uint8Array>) chunks.push(chunk)
	const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
	const merged = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
	const parsed: unknown = JSON.parse(new TextDecoder().decode(merged) || '{}')
	return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
}

export function apply(ctx: Context, config?: LabPluginConfig): void {
	const ttlMs = config?.cacheTtlMs ?? DEFAULT_TTL_MS
	const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS
	// Same authentication model as the standalone LAN web console: ZNSL
	// accounts verified against the jump host, in-memory cookie session,
	// and every lab connection built from the logged-in user's credentials.
	const ALLOWED_USERS = new Set(['wsy', 'lfx', 'fjj', 'yyh', 'zyh', 'szg', 'dj', 'fdk', 'ychan', 'dcc', 'sxx'])
	const JUMP_HOST = '192.168.210.244'
	const SESSION_TTL = 8 * 60 * 60 * 1000
	interface LabSession { at: number; username: string; password: string }
	const sessions = new Map<string, LabSession>()
	const cookieOf = (req: LabHttpRequest, name: string): string | undefined => {
		const raw = header(req, 'cookie') ?? ''
		const match = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))
		return match?.slice(name.length + 1)
	}
	const sessionOf = (req: LabHttpRequest): LabSession | undefined => {
		const token = cookieOf(req, 'lab_session')
		if (token === undefined) return undefined
		const session = sessions.get(token)
		if (session === undefined) return undefined
		if (Date.now() - session.at > SESSION_TTL) { sessions.delete(token); return undefined }
		session.at = Date.now()
		return session
	}
	const labForSession = async (session: LabSession): Promise<LabConfig> => {
		const base = await loadLabConfig(config?.labFile)
		return { ...base, jumphost: { ...base.jumphost, host: JUMP_HOST, username: session.username, password: session.password } }
	}
	ctx.effect(() => () => { sessions.clear() })
	let labPromise: Promise<LabConfig> | undefined
	const lab = (): Promise<LabConfig> => {
		labPromise ??= loadLabConfig(config?.labFile)
		return labPromise
	}
	let experimentPromise: ReturnType<typeof loadExperimentDefinition> | undefined
	const experiment = () => {
		experimentPromise ??= loadExperimentDefinition(config?.experimentFile)
		return experimentPromise
	}
	let topologyCache: CachedEntry<TopologyResponse> | undefined
	let locksCache: CachedEntry<LocksResponse> | undefined
	let inflightTopology: Promise<TopologyResponse> | undefined
	let latestCollection: { at: number; value: Awaited<ReturnType<typeof collect>> } | undefined
	let inflightLocks: Promise<LocksResponse> | undefined

	const declaredFromExperiment = async (): Promise<DeclaredLink[]> => {
		const cfg = await lab()
		const definition = (await experiment()).definition
		return definition.links
			.filter((link) => link.from.interface !== undefined && link.to.interface !== undefined)
			.filter((link) => cfg.switches.some((sw) => sw.id === link.from.node || sw.name === link.from.node) && cfg.switches.some((sw) => sw.id === link.to.node || sw.name === link.to.node))
			.map((link) => ({ a: { sw: link.from.node, port: link.from.interface ?? '' }, b: { sw: link.to.node, port: link.to.interface ?? '' }, note: [link.bundle, link.speed].filter((part) => part !== undefined).join(' ') }))
	}

	const fetchTopology = async (cfg: LabConfig): Promise<TopologyResponse> => {
		const started = Date.now()
		const [collected, declared] = await Promise.all([collect(cfg, timeoutMs), declaredFromExperiment().catch(() => [])])
		latestCollection = { at: Date.now(), value: collected }
		const { switches, links } = buildTopology(cfg, collected, declared)
		return { fetchedAt: Date.now(), durationMs: Date.now() - started, cached: false, switches, links }
	}

	const fetchLocks = async (cfg: LabConfig): Promise<LocksResponse> => {
		const result = await (async () => {
			try {
				const collected = await collect(cfg, timeoutMs)
				latestCollection = { at: Date.now(), value: collected }
				return { raw: collected.locks.raw, error: collected.locks.error }
			} catch (error) {
				return { raw: '', error: String(error instanceof Error ? error.message : error) }
			}
		})()
		return { fetchedAt: Date.now(), groups: parseSws(result.raw), raw: result.raw, error: result.error }
	}

	const guarded = (handler: (req: LabHttpRequest, res: LabHttpResponse) => Promise<void>) =>
		async (req: LabHttpRequest, res: LabHttpResponse): Promise<void> => {
			if (!isTrusted(req)) {
				writeJson(res, 403, { error: 'untrusted request origin' })
				return
			}
			try {
				await handler(req, res)
			} catch (error) {
				writeJson(res, 500, { error: String(error instanceof Error ? error.message : error) })
			}
		}

	const withSession = (handler: (req: LabHttpRequest, res: LabHttpResponse, session: LabSession) => Promise<void>) =>
		guarded(async (req, res) => {
			const session = sessionOf(req)
			if (session === undefined) { writeJson(res, 401, { error: '未登录' }); return }
			await handler(req, res, session)
		})

	// Auth routes: same contract as the LAN web console.
	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact', path: '/api/lab/login',
		handler: guarded(async (req, res) => {
			if (req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed' }); return }
			const input = await readJsonBody(req)
			const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
			const password = typeof input.password === 'string' ? input.password : ''
			if (!ALLOWED_USERS.has(username) || password.length === 0) { writeJson(res, 401, { error: '账号或密码错误' }); return }
			try { await verifyJumpHost(JUMP_HOST, 22, username, password) } catch { writeJson(res, 401, { error: '跳板机认证失败，请检查账号密码' }); return }
			const token = randomBytes(32).toString('hex')
			sessions.set(token, { at: Date.now(), username, password })
			writeJson(res, 200, { username, network: 'ZNSL', jumpHost: JUMP_HOST }, { 'set-cookie': 'lab_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800' })
		}),
	}))
	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact', path: '/api/lab/logout',
		handler: guarded(async (req, res) => {
			const token = cookieOf(req, 'lab_session')
			if (token !== undefined) sessions.delete(token)
			writeJson(res, 200, { ok: true }, { 'set-cookie': 'lab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
		}),
	}))
	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact', path: '/api/lab/session',
		handler: guarded(async (req, res) => {
			const session = sessionOf(req)
			writeJson(res, session === undefined ? 401 : 200, session === undefined ? { error: '未登录' } : { username: session.username, network: 'ZNSL', jumpHost: JUMP_HOST })
		}),
	}))

	const desktopFeatures = createDesktopFeatures({
		getCollected: async (labForCollect) => {
			if (latestCollection !== undefined && Date.now() - latestCollection.at < LOCKS_TTL_MS) return latestCollection.value
			const value = await collect(labForCollect, timeoutMs)
			latestCollection = { at: Date.now(), value }
			return value
		},
	})

	ctx.effect(() => ctx.webServer?.register({ kind: 'exact', path: '/api/lab/actual-usage', handler: withSession(async (req, res, session) => { await desktopFeatures.actualUsage(req, res, await labForSession(session)) }) }))
	ctx.effect(() => ctx.webServer?.register({ kind: 'prefix', path: '/api/files/me', handler: withSession(async (req, res, session) => { await desktopFeatures.files(req, res, await labForSession(session), session.username) }) }))
	ctx.effect(() => ctx.webServer?.registerUpgrade({ path: '/api/lab/ssh', handler: async (req, socket, head) => {
		if (!isTrusted(req)) { (socket as { destroy(): void }).destroy(); return }
		const session = sessionOf(req)
		if (session === undefined) { (socket as { destroy(): void }).destroy(); return }
		await desktopFeatures.upgradeSsh(req, socket, head, await labForSession(session))
	} }))
	ctx.effect(() => desktopFeatures.dispose)

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/experiment',
		handler: guarded(async (_req, res) => { writeJson(res, 200, await experiment()) }),
	}))

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/topology',
		handler: withSession(async (req, res, session) => {
			const url = new URL(req.url ?? '/', 'http://localhost')
			const fresh = url.searchParams.get('fresh') === '1'
			const now = Date.now()
			if (!fresh && topologyCache !== undefined && now - topologyCache.at < ttlMs) {
				writeJson(res, 200, { ...topologyCache.value, cached: true })
				return
			}
			inflightTopology ??= fetchTopology(await labForSession(session))
				.then((value) => {
					topologyCache = { value, at: Date.now() }
					return value
				})
				.finally(() => { inflightTopology = undefined })
			writeJson(res, 200, await inflightTopology)
		}),
	}))

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/locks',
		handler: withSession(async (_req, res, session) => {
			const now = Date.now()
			if (locksCache !== undefined && now - locksCache.at < LOCKS_TTL_MS) {
				writeJson(res, 200, locksCache.value)
				return
			}
			inflightLocks ??= fetchLocks(await labForSession(session))
				.then((value) => {
					locksCache = { value, at: Date.now() }
					return value
				})
				.finally(() => { inflightLocks = undefined })
			writeJson(res, 200, await inflightLocks)
		}),
	}))

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/port-description',
		handler: withSession(async (req, res, session) => {
			if (req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed' }); return }
			const input = await readJsonBody(req)
			if (typeof input.switchId !== 'string' || typeof input.interfaceName !== 'string' || typeof input.description !== 'string') { writeJson(res, 400, { error: 'switchId, interfaceName and description are required' }); return }
			const cfg = await labForSession(session)
			const result = await setInterfaceDescription(cfg, input.switchId, input.interfaceName, input.description, timeoutMs)
			if (result.code !== 0) { writeJson(res, 502, { error: result.err || result.out, code: result.code }); return }
			topologyCache = undefined
			writeJson(res, 200, { ok: true, output: result.out })
		}),
	}))

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/locklog',
		handler: withSession(async (_req, res, session) => {
			const cfg = await labForSession(session)
			const result = await collectLockLog(cfg, timeoutMs)
			const body: LockLogResponse = {
				fetchedAt: Date.now(),
				lines: result.text.split(/\r?\n/).filter((line) => line.trim().length > 0),
				error: result.error,
			}
			writeJson(res, 200, body)
		}),
	}))
}
