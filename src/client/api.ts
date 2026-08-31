/**
 * Same-origin fetch helpers for /api/lab/*. The host routes carry the
 * browser trust fence; resource usage mutations are scoped to the current Session.
 */
import type { ExperimentResponse, LockLogResponse, LocksResponse, ResourceUsageResponse, TopologyResponse } from '../types.ts'

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

const mutateUsage = async (path: string, init: RequestInit): Promise<ResourceUsageResponse> => {
	const response = await fetch(path, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers } })
	if (!response.ok) throw new Error((await response.json().catch(() => ({ error: '资源使用操作失败' })) as { error?: string }).error ?? '资源使用操作失败')
	return await response.json() as ResourceUsageResponse
}

export const fetchResourceUsage = (): Promise<ResourceUsageResponse> => getJson<ResourceUsageResponse>('/api/lab/resource-usage')
export const startResourceUsage = (input: { switchId: string; portName?: string; purpose?: string }): Promise<ResourceUsageResponse> => mutateUsage('/api/lab/resource-usage', { method: 'POST', body: JSON.stringify(input) })
export const stopResourceUsage = (id: string): Promise<ResourceUsageResponse> => mutateUsage('/api/lab/resource-usage/' + encodeURIComponent(id), { method: 'DELETE', body: '{}' })