import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import { openInteractiveShell, type CollectOutput } from './collector.ts'
import { startSession } from './audit/service.ts'
import { parseSwkitLockUsers } from './parser.ts'
import { cancelTransfer, createDownloadTask, createUploadTask, listRemote, listTransfers, makeRemoteDirectory, readDownloadedFile, readRemoteText, receiveUpload, writeRemoteText } from './file-transfer/service.ts'
import type { LabConfig } from './config.ts'
import type { ActualSwitchUser, ActualUsageResponse } from './types.ts'
import type { LabHttpRequest, LabHttpResponse } from './context-types.ts'

interface ActiveSshSession { id: string; username: string; switchId: string; startedAt: number }
interface DesktopFeaturesOptions { getCollected: (lab: LabConfig) => Promise<CollectOutput> }

interface DesktopFeatures {
	actualUsage: (req: LabHttpRequest, res: LabHttpResponse, lab: LabConfig) => Promise<void>
	files: (req: LabHttpRequest, res: LabHttpResponse, lab: LabConfig, owner: string) => Promise<void>
	upgradeSsh: (req: LabHttpRequest, socket: unknown, head: Uint8Array, lab: LabConfig) => Promise<void>
	dispose: () => void
}

const writeJson = (res: LabHttpResponse, status: number, value: unknown): void => {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
	res.end(JSON.stringify(value))
}

const readBody = async (request: LabHttpRequest): Promise<Record<string, unknown>> => {
	const chunks: Buffer[] = []
	for await (const chunk of request as IncomingMessage) chunks.push(Buffer.from(chunk))
	const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
	return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
}

export function createDesktopFeatures(options: DesktopFeaturesOptions): DesktopFeatures {
	const activeSshSessions = new Map<string, ActiveSshSession>()
	const wss = new WebSocketServer({ noServer: true })

	const actualUsage = async (_req: LabHttpRequest, res: LabHttpResponse, lab: LabConfig): Promise<void> => {
		const bySwitch: Record<string, ActualSwitchUser[]> = Object.fromEntries(lab.switches.map((sw) => [sw.id, []]))
		const merge = (item: ActualSwitchUser): void => {
			const list = bySwitch[item.switchId]
			if (list === undefined) return
			const existing = list.find((entry) => entry.username === item.username && entry.source === item.source && entry.clientIp === item.clientIp)
			if (existing !== undefined) { existing.sessionCount += item.sessionCount; if (item.startedAt !== undefined && (existing.startedAt === undefined || item.startedAt < existing.startedAt)) existing.startedAt = item.startedAt; return }
			list.push(item)
		}
		for (const session of activeSshSessions.values()) merge({ username: session.username, switchId: session.switchId, source: 'lab-ssh', sessionCount: 1, startedAt: session.startedAt })
		const collected = await options.getCollected(lab)
		for (const lock of parseSwkitLockUsers(collected.lockUsers.raw)) {
			const name = lock.switchName?.trim() ?? ''
			const number = name.match(/(?:switch\s*-?|sw\s*)(\d+)/i)?.[1]
			const switchIds = number !== undefined ? ['sw' + number] : /^[ab]$/i.test(name) ? lab.switches.filter((sw) => sw.group.toUpperCase() === name.toUpperCase()).map((sw) => sw.id) : lab.switches.map((sw) => sw.id)
			for (const switchId of switchIds) merge({ username: lock.username, switchId, source: 'swkit-lock', sessionCount: 1, startedAt: lock.startedAt, clientIp: lock.clientIp })
		}
		for (const list of Object.values(bySwitch)) list.sort((a, b) => a.username.localeCompare(b.username) || a.source.localeCompare(b.source))
		const response: ActualUsageResponse = { fetchedAt: Date.now(), switches: bySwitch }
		writeJson(res, 200, response)
	}

	const files = async (req: LabHttpRequest, res: LabHttpResponse, lab: LabConfig, owner: string): Promise<void> => {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const path = url.pathname
		if (path === '/api/files/me/switches' && req.method === 'GET') { writeJson(res, 200, { switches: lab.switches.map((sw) => ({ id: sw.id, name: sw.name, ip: sw.ip })) }); return }
		if (path === '/api/files/me/remote' && req.method === 'GET') { writeJson(res, 200, await listRemote(lab, url.searchParams.get('switch') ?? '', url.searchParams.get('path') ?? '/home/admin')); return }
		if (path === '/api/files/me/file' && req.method === 'GET') { writeJson(res, 200, await readRemoteText(lab, url.searchParams.get('switch') ?? '', url.searchParams.get('path') ?? '')); return }
		if (path === '/api/files/me/file' && req.method === 'PUT') { const input = await readBody(req); if (typeof input.switchId !== 'string' || typeof input.path !== 'string' || typeof input.content !== 'string') { writeJson(res, 400, { error: 'switchId, path and content are required' }); return } writeJson(res, 200, await writeRemoteText(lab, input.switchId, input.path, input.content)); return }
		if (path === '/api/files/me/remote/directories' && req.method === 'POST') { const input = await readBody(req); if (typeof input.switchId !== 'string' || typeof input.parent !== 'string' || typeof input.name !== 'string') { writeJson(res, 400, { error: 'switchId, parent and name are required' }); return } await makeRemoteDirectory(lab, input.switchId, input.parent, input.name); writeJson(res, 200, { ok: true }); return }
		if (path === '/api/files/me/transfers' && req.method === 'GET') { writeJson(res, 200, { transfers: listTransfers(owner) }); return }
		if (path === '/api/files/me/transfers' && req.method === 'POST') { const input = await readBody(req); if (input.direction === 'upload' && typeof input.switchId === 'string' && typeof input.remoteDirectory === 'string' && typeof input.fileName === 'string' && typeof input.size === 'number') { writeJson(res, 201, await createUploadTask(owner, { switchId: input.switchId, remoteDirectory: input.remoteDirectory, fileName: input.fileName, size: input.size, overwrite: input.overwrite === true })); return } if (input.direction === 'download' && typeof input.switchId === 'string' && typeof input.remotePath === 'string') { writeJson(res, 201, await createDownloadTask(owner, { switchId: input.switchId, remotePath: input.remotePath }, lab)); return } writeJson(res, 400, { error: 'invalid transfer request' }); return }
		const content = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/content$/)
		if (content !== null && req.method === 'PUT') { writeJson(res, 202, await receiveUpload(owner, content[1] ?? '', req as IncomingMessage, lab)); return }
		const download = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/download$/)
		if (download !== null && req.method === 'GET') { const result = await readDownloadedFile(owner, download[1] ?? ''); const response = res as ServerResponse; response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(result.task.fileName), 'content-length': String(result.data.length), 'cache-control': 'no-store' }); response.end(result.data); return }
		const cancel = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/cancel$/)
		if (cancel !== null && req.method === 'POST') { writeJson(res, 200, await cancelTransfer(owner, cancel[1] ?? '')); return }
		writeJson(res, 404, { error: 'not found' })
	}

	const upgradeSsh = async (req: LabHttpRequest, socket: unknown, head: Uint8Array, lab: LabConfig): Promise<void> => {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const switchId = url.searchParams.get('switch') ?? ''
		if (!lab.switches.some((sw) => sw.id === switchId)) { (socket as Duplex).destroy(); return }
		wss.handleUpgrade(req as IncomingMessage, socket as Duplex, Buffer.from(head), (ws) => {
		const audit = startSession(lab.jumphost.username, switchId)
			void openInteractiveShell(lab, switchId, 120, 34, (data) => { audit.output(data); if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data })) }, (message) => { if (message !== undefined && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message })); ws.close() }).then((shell) => {
				const id = randomBytes(16).toString('hex')
				activeSshSessions.set(id, { id, username: lab.jumphost.username, switchId, startedAt: Date.now() })
				if (ws.readyState !== ws.OPEN) { activeSshSessions.delete(id); shell.close() }
				const wsPing = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping() }, 30_000)
				ws.on('message', (raw) => { try { const message = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number }; if (message.type === 'input' && typeof message.data === 'string') { audit.input(message.data); shell.write(message.data) }; if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') shell.resize(message.cols, message.rows) } catch {} })
				ws.on('close', () => { clearInterval(wsPing); activeSshSessions.delete(id); audit.end(); shell.close() })
			}).catch((error) => { audit.end(); if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: String(error instanceof Error ? error.message : error) })); ws.close() })
		})
	}

	return { actualUsage, files, upgradeSsh, dispose: () => { for (const client of wss.clients) client.close(); wss.close(); activeSshSessions.clear() } }
}
