/**
 * Same-origin fetch helpers for /api/lab/*. The host routes carry the
 * browser trust fence; the client just never issues anything but GETs.
 */
import type { ExperimentResponse, LockLogResponse, LocksResponse, TopologyResponse } from '../types.ts'

async function getJson<T>(path: string): Promise<T> {
	const response = await fetch(path, { headers: { accept: 'application/json' } })
	if (!response.ok) {
		const detail = await response.text().catch(() => '')
		throw new Error(path + ' -> HTTP ' + String(response.status) + (detail.length > 0 ? ': ' + detail.slice(0, 200) : ''))
	}
	return await response.json() as Promise<T>
}

export const fetchExperiment = (): Promise<ExperimentResponse> => getJson<ExperimentResponse>('/api/lab/experiment')

export const fetchTopology = (fresh = false): Promise<TopologyResponse> =>
	getJson<TopologyResponse>('/api/lab/topology' + (fresh ? '?fresh=1' : ''))

export const fetchLocks = (): Promise<LocksResponse> => getJson<LocksResponse>('/api/lab/locks')

export const fetchLockLog = (): Promise<LockLogResponse> => getJson<LockLogResponse>('/api/lab/locklog')