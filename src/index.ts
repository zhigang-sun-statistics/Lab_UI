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
import { loadLabConfig, type LabConfig, type LabPluginConfig } from './config.ts'
import { collect, collectLockLog } from './collector.ts'
import { loadExperimentDefinition } from './experiment.ts'
import { buildTopology } from './topology.ts'
import { parseSws } from './parser.ts'
import type { Context, LabHttpRequest, LabHttpResponse } from './context-types.ts'
import type { LockLogResponse, LocksResponse, TopologyResponse } from './types.ts'

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

const writeJson = (res: LabHttpResponse, status: number, body: unknown): void => {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'referrer-policy': 'no-referrer',
	})
	res.end(JSON.stringify(body))
}

export function apply(ctx: Context, config?: LabPluginConfig): void {
	const ttlMs = config?.cacheTtlMs ?? DEFAULT_TTL_MS
	const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
	let inflightLocks: Promise<LocksResponse> | undefined

	const fetchTopology = async (): Promise<TopologyResponse> => {
		const cfg = await lab()
		const started = Date.now()
		const collected = await collect(cfg, timeoutMs)
		const { switches, links } = buildTopology(cfg, collected)
		return { fetchedAt: Date.now(), durationMs: Date.now() - started, cached: false, switches, links }
	}

	const fetchLocks = async (): Promise<LocksResponse> => {
		const cfg = await lab()
		const result = await (async () => {
			try {
				const collected = await collect(cfg, timeoutMs)
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

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/experiment',
		handler: guarded(async (_req, res) => { writeJson(res, 200, await experiment()) }),
	}))

	ctx.effect(() => ctx.webServer?.register({
		kind: 'exact',
		path: '/api/lab/topology',
		handler: guarded(async (req, res) => {
			const url = new URL(req.url ?? '/', 'http://localhost')
			const fresh = url.searchParams.get('fresh') === '1'
			const now = Date.now()
			if (!fresh && topologyCache !== undefined && now - topologyCache.at < ttlMs) {
				writeJson(res, 200, { ...topologyCache.value, cached: true })
				return
			}
			inflightTopology ??= fetchTopology()
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
		handler: guarded(async (_req, res) => {
			const now = Date.now()
			if (locksCache !== undefined && now - locksCache.at < LOCKS_TTL_MS) {
				writeJson(res, 200, locksCache.value)
				return
			}
			inflightLocks ??= fetchLocks()
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
		path: '/api/lab/locklog',
		handler: guarded(async (_req, res) => {
			const cfg = await lab()
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
