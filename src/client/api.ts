/**
 * Same-origin fetch helpers for /api/lab/*. The host routes carry the
 * browser trust fence; the client just never issues anything but GETs.
 */
import type { ActualUsageResponse, ExperimentResponse, LinkState, LockLogResponse, LocksResponse, TopologyResponse } from '../types.ts'

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

export const fetchActualUsage = (): Promise<ActualUsageResponse> => getJson<ActualUsageResponse>('/api/lab/actual-usage')

const mutateJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
	const response = await fetch(url, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) } })
	if (!response.ok) throw new Error((await response.json().catch(() => ({ error: '操作失败' })) as { error?: string }).error ?? '操作失败')
	return await response.json() as T
}

export const registerManualLink = (input: { aSw: string; aPort: string; bSw: string; bPort: string; note?: string }): Promise<{ links: LinkState[] }> =>
	mutateJson('/api/lab/links', { method: 'POST', body: JSON.stringify(input) })

export const removeManualLink = (id: string): Promise<{ links: LinkState[] }> =>
	mutateJson('/api/lab/links/' + encodeURIComponent(id), { method: 'DELETE' })