import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { loadLabConfig } from './config.ts'
import { collect, collectLockLog, openInteractiveShell, setInterfaceDescription, verifyJumpHost } from './collector.ts'
import { buildTopology } from './topology.ts'
import { loadExperimentDefinition } from './experiment.ts'
import { parseSws } from './parser.ts'
import { addAttachment, addMessage, createJob, generateArtifacts, getProvider, listJobs, loadJob, readArtifact, setProvider } from './agent/service.ts'
import { cancelTransfer, createDownloadTask, createUploadTask, listRemote, listTransfers, makeRemoteDirectory, readDownloadedFile, receiveUpload } from './file-transfer/service.ts'

const HOST = process.env.LAB_WEB_HOST ?? '0.0.0.0'
const PORT = Number(process.env.LAB_WEB_PORT ?? 8889)
const ROOT = dirname(fileURLToPath(import.meta.url))
const ALLOWED_USERS = new Set(['wsy', 'lfx', 'fjj', 'yyh', 'zyh', 'szg', 'dj', 'fdk', 'ychan', 'dcc', 'sxx'])
const JUMP_HOST = '192.168.210.244'
interface WebSession { at: number; username: string; password: string }
const sessions = new Map<string, WebSession>()
const TTL = 8 * 60 * 60 * 1000
let collectionCache: { at: number; value: Awaited<ReturnType<typeof collect>> } | undefined
let collectionInflight: ReturnType<typeof collect> | undefined

const getCollection = async (lab: Awaited<ReturnType<typeof loadLabConfig>>, fresh = false): Promise<Awaited<ReturnType<typeof collect>>> => {
  if (!fresh && collectionCache !== undefined && Date.now() - collectionCache.at < 15000) return collectionCache.value
  collectionInflight ??= collect(lab, 15000).then((value) => { collectionCache = { at: Date.now(), value }; return value }).finally(() => { collectionInflight = undefined })
  return await collectionInflight
}

const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
}

const cookie = (req: IncomingMessage, name: string): string | undefined => {
  const raw = req.headers.cookie ?? ''
  const match = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))
  return match?.slice(name.length + 1)
}

const sessionOf = (req: IncomingMessage): WebSession | undefined => {
  const token = cookie(req, 'lab_session')
  if (token === undefined) return undefined
  const session = sessions.get(token)
  if (session === undefined) return undefined
  if (Date.now() - session.at > TTL) { sessions.delete(token); return undefined }
  session.at = Date.now()
  return session
}

const labForSession = async (session: WebSession): Promise<Awaited<ReturnType<typeof loadLabConfig>>> => {
  const lab = await loadLabConfig()
  return { ...lab, jumphost: { ...lab.jumphost, host: JUMP_HOST, username: session.username, password: session.password } }
}

const api = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
  if (path === '/api/lab/login' && req.method === 'POST') {
    const input = await body(req)
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!ALLOWED_USERS.has(username) || password.length === 0) { json(res, 401, { error: '账号或密码错误' }); return true }
    try { await verifyJumpHost(JUMP_HOST, 22, username, password) } catch { json(res, 401, { error: '跳板机认证失败，请检查账号密码' }); return true }
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { at: Date.now(), username, password })
    json(res, 200, { username, network: 'ZNSL', jumpHost: JUMP_HOST }, { 'set-cookie': 'lab_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800' })
    return true
  }
  if (path === '/api/lab/logout' && req.method === 'POST') {
    const token = cookie(req, 'lab_session'); if (token !== undefined) sessions.delete(token)
    json(res, 200, { ok: true }, { 'set-cookie': 'lab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return true
  }
  if (path === '/api/lab/session' && req.method === 'GET') { const session = sessionOf(req); json(res, session === undefined ? 401 : 200, session === undefined ? { error: '未登录' } : { username: session.username, network: 'ZNSL', jumpHost: JUMP_HOST }); return true }
  const session = sessionOf(req)
  if (session === undefined) { json(res, 401, { error: '未登录' }); return true }
  if (path === '/api/agent/me/provider' && req.method === 'GET') { json(res, 200, await getProvider(session.username)); return true }
  if (path === '/api/agent/me/provider' && req.method === 'PUT') { const input = await body(req); if ((input.provider !== 'mock' && input.provider !== 'deepseek' && input.provider !== 'openai-compatible') || typeof input.model !== 'string') { json(res, 400, { error: 'provider and model are required' }); return true } json(res, 200, await setProvider(session.username, { provider: input.provider, model: input.model, baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined, apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined })); return true }
  if (path === '/api/agent/me/jobs' && req.method === 'GET') { json(res, 200, { jobs: await listJobs(session.username) }); return true }
  if (path === '/api/agent/me/jobs' && req.method === 'POST') { const input = await body(req); json(res, 201, await createJob(session.username, typeof input.title === 'string' ? input.title : undefined)); return true }
  const agentJobMatch = path.match(/^\/api\/agent\/me\/jobs\/(job_[a-f0-9-]+)$/)
  if (agentJobMatch !== null && req.method === 'GET') { json(res, 200, await loadJob(session.username, agentJobMatch[1] ?? '')); return true }
  const attachmentMatch = path.match(/^\/api\/agent\/me\/jobs\/(job_[a-f0-9-]+)\/attachments$/)
  if (attachmentMatch !== null && req.method === 'POST') { const input = await body(req); if (typeof input.name !== 'string' || typeof input.mimeType !== 'string' || typeof input.data !== 'string') { json(res, 400, { error: 'name, mimeType and base64 data are required' }); return true } json(res, 200, await addAttachment(session.username, attachmentMatch[1] ?? '', { name: input.name, mimeType: input.mimeType, data: input.data })); return true }
  const messageMatch = path.match(/^\/api\/agent\/me\/jobs\/(job_[a-f0-9-]+)\/messages$/)
  if (messageMatch !== null && req.method === 'POST') { const input = await body(req); json(res, 200, await addMessage(session.username, messageMatch[1] ?? '', typeof input.content === 'string' ? input.content : '', Array.isArray(input.attachmentIds) ? input.attachmentIds.filter((id): id is string => typeof id === 'string') : [])); return true }
  const lab = await labForSession(session)
  if (path === '/api/files/me/switches' && req.method === 'GET') { json(res, 200, { switches: lab.switches.map((sw) => ({ id: sw.id, name: sw.name, ip: sw.ip })) }); return true }
  if (path === '/api/files/me/remote' && req.method === 'GET') { const url = new URL(req.url ?? '/', 'http://localhost'); const switchId = url.searchParams.get('switch') ?? ''; const remotePath = url.searchParams.get('path') ?? '/home/admin'; json(res, 200, await listRemote(lab, switchId, remotePath)); return true }
  if (path === '/api/files/me/remote/directories' && req.method === 'POST') { const input = await body(req); if (typeof input.switchId !== 'string' || typeof input.parent !== 'string' || typeof input.name !== 'string') { json(res, 400, { error: 'switchId, parent and name are required' }); return true } await makeRemoteDirectory(lab, input.switchId, input.parent, input.name); json(res, 200, { ok: true }); return true }
  if (path === '/api/files/me/transfers' && req.method === 'GET') { json(res, 200, { transfers: listTransfers(session.username) }); return true }
  if (path === '/api/files/me/transfers' && req.method === 'POST') { const input = await body(req); if (input.direction === 'upload' && typeof input.switchId === 'string' && typeof input.remoteDirectory === 'string' && typeof input.fileName === 'string' && typeof input.size === 'number') { json(res, 201, await createUploadTask(session.username, { switchId: input.switchId, remoteDirectory: input.remoteDirectory, fileName: input.fileName, size: input.size, overwrite: input.overwrite === true })); return true } if (input.direction === 'download' && typeof input.switchId === 'string' && typeof input.remotePath === 'string') { json(res, 201, await createDownloadTask(session.username, { switchId: input.switchId, remotePath: input.remotePath }, lab)); return true } json(res, 400, { error: 'invalid transfer request' }); return true }
  const transferContentMatch = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/content$/)
  if (transferContentMatch !== null && req.method === 'PUT') { json(res, 202, await receiveUpload(session.username, transferContentMatch[1] ?? '', req, lab)); return true }
  const transferDownloadMatch = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/download$/)
  if (transferDownloadMatch !== null && req.method === 'GET') { const result = await readDownloadedFile(session.username, transferDownloadMatch[1] ?? ''); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(result.task.fileName), 'content-length': String(result.data.length), 'cache-control': 'no-store' }); res.end(result.data); return true }
  const transferCancelMatch = path.match(/^\/api\/files\/me\/transfers\/(transfer_[a-f0-9-]+)\/cancel$/)
  if (transferCancelMatch !== null && req.method === 'POST') { json(res, 200, await cancelTransfer(session.username, transferCancelMatch[1] ?? '')); return true }
  const generateMatch = path.match(/^\/api\/agent\/me\/jobs\/(job_[a-f0-9-]+)\/generate$/)
  if (generateMatch !== null && req.method === 'POST') { const collected = await getCollection(lab, true); const topology = buildTopology(lab, collected); json(res, 200, await generateArtifacts(session.username, generateMatch[1] ?? '', { fetchedAt: Date.now(), durationMs: 0, cached: false, ...topology })); return true }
  const artifactMatch = path.match(/^\/api\/agent\/me\/jobs\/(job_[a-f0-9-]+)\/artifacts\/(art_[a-f0-9-]+)$/)
  if (artifactMatch !== null && req.method === 'GET') { const result = await readArtifact(session.username, artifactMatch[1] ?? '', artifactMatch[2] ?? ''); const type = result.artifact.name.endsWith('.yml') || result.artifact.name.endsWith('.yaml') ? 'application/yaml; charset=utf-8' : result.artifact.name.endsWith('.zip') ? 'application/zip' : 'text/plain; charset=utf-8'; res.writeHead(200, { 'content-type': type, 'content-disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(result.artifact.name), 'content-length': String(result.data.length), 'cache-control': 'no-store' }); res.end(result.data); return true }
  if (path === '/api/lab/experiment' && req.method === 'GET') { json(res, 200, await loadExperimentDefinition()); return true }
  if (path === '/api/lab/topology' && req.method === 'GET') {
    const started = Date.now()
    const collected = await getCollection(lab, new URL(req.url ?? '/', 'http://localhost').searchParams.get('fresh') === '1')
    const result = buildTopology(lab, collected)
    json(res, 200, { fetchedAt: Date.now(), durationMs: Date.now() - started, cached: false, ...result }); return true
  }
  if (path === '/api/lab/locks' && req.method === 'GET') {
    const collected = await getCollection(lab)
    json(res, 200, { fetchedAt: Date.now(), groups: parseSws(collected.locks.raw), raw: collected.locks.raw, error: collected.locks.error }); return true
  }
  if (path === '/api/lab/port-description' && req.method === 'POST') {
    const input = await body(req)
    if (typeof input.switchId !== 'string' || typeof input.interfaceName !== 'string' || typeof input.description !== 'string') { json(res, 400, { error: 'switchId, interfaceName and description are required' }); return true }
    const result = await setInterfaceDescription(lab, input.switchId, input.interfaceName, input.description, 15000)
    if (result.code !== 0) { json(res, 502, { error: result.err || result.out, code: result.code }); return true }
    collectionCache = undefined
    json(res, 200, { ok: true, output: result.out }); return true
  }
  if (path === '/api/lab/locklog' && req.method === 'GET') {
    const result = await collectLockLog(lab, 15000)
    json(res, 200, { fetchedAt: Date.now(), lines: result.text.split(/\r?\n/).filter((line) => line.trim()), error: result.error }); return true
  }
  json(res, 404, { error: 'not found' }); return true
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/api/')) { await api(req, res, url.pathname); return }
    const file = url.pathname === '/' ? join(ROOT, '..', 'web', 'index.html') : url.pathname === '/ssh.html' ? join(ROOT, '..', 'web', 'ssh.html') : url.pathname === '/web.js' ? join(ROOT, 'web.js') : url.pathname === '/web.css' ? join(ROOT, 'web.css') : url.pathname === '/ssh.js' ? join(ROOT, 'ssh.js') : url.pathname === '/ssh.css' ? join(ROOT, 'ssh.css') : ''
    if (file.length === 0) { res.writeHead(404); res.end('Not found'); return }
    const content = await readFile(file)
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(content)
  } catch (error) { json(res, 500, { error: String(error instanceof Error ? error.message : error) }) }
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const session = sessionOf(req)
  if (url.pathname !== '/api/lab/ssh' || session === undefined) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const switchId = url.searchParams.get('switch') ?? ''
    void labForSession(session).then((lab) => openInteractiveShell(lab, switchId, 120, 34, (data) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data })) }, (message) => { if (message !== undefined && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message })); ws.close() })).then((shell) => {
      ws.on('message', (raw) => { try { const message = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number }; if (message.type === 'input' && typeof message.data === 'string') shell.write(message.data); if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') shell.resize(message.cols, message.rows) } catch {} })
      ws.on('close', () => shell.close())
    }).catch((error) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: String(error instanceof Error ? error.message : error) })); ws.close() })
  })
})

server.listen(PORT, HOST, () => console.log('Lab Web listening on http://' + HOST + ':' + PORT))
