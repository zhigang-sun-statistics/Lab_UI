import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { loadLabConfig } from './config.ts'
import { collect, collectLockLog, setInterfaceDescription } from './collector.ts'
import { buildTopology } from './topology.ts'
import { loadExperimentDefinition } from './experiment.ts'
import { parseSws } from './parser.ts'

const HOST = process.env.LAB_WEB_HOST ?? '0.0.0.0'
const PORT = Number(process.env.LAB_WEB_PORT ?? 8889)
const USERNAME = process.env.LAB_WEB_USERNAME ?? 'szg'
const PASSWORD = process.env.LAB_WEB_PASSWORD ?? 'szg'
const ROOT = dirname(fileURLToPath(import.meta.url))
const sessions = new Map<string, number>()
const TTL = 8 * 60 * 60 * 1000

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

const authenticated = (req: IncomingMessage): boolean => {
  const token = cookie(req, 'lab_session')
  if (token === undefined) return false
  const at = sessions.get(token)
  if (at === undefined) return false
  if (Date.now() - at > TTL) { sessions.delete(token); return false }
  sessions.set(token, Date.now())
  return true
}

const api = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
  if (path === '/api/lab/login' && req.method === 'POST') {
    const input = await body(req)
    if (input.username !== USERNAME || input.password !== PASSWORD) { json(res, 401, { error: '账号或密码错误' }); return true }
    const token = randomBytes(32).toString('hex')
    sessions.set(token, Date.now())
    json(res, 200, { username: USERNAME }, { 'set-cookie': 'lab_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800' })
    return true
  }
  if (path === '/api/lab/logout' && req.method === 'POST') {
    const token = cookie(req, 'lab_session'); if (token !== undefined) sessions.delete(token)
    json(res, 200, { ok: true }, { 'set-cookie': 'lab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return true
  }
  if (path === '/api/lab/session' && req.method === 'GET') { json(res, authenticated(req) ? 200 : 401, authenticated(req) ? { username: USERNAME } : { error: '未登录' }); return true }
  if (!authenticated(req)) { json(res, 401, { error: '未登录' }); return true }
  const lab = await loadLabConfig()
  if (path === '/api/lab/experiment' && req.method === 'GET') { json(res, 200, await loadExperimentDefinition()); return true }
  if (path === '/api/lab/topology' && req.method === 'GET') {
    const collected = await collect(lab, 15000)
    const result = buildTopology(lab, collected)
    json(res, 200, { fetchedAt: Date.now(), durationMs: 0, cached: false, ...result }); return true
  }
  if (path === '/api/lab/locks' && req.method === 'GET') {
    const collected = await collect(lab, 15000)
    json(res, 200, { fetchedAt: Date.now(), groups: parseSws(collected.locks.raw), raw: collected.locks.raw, error: collected.locks.error }); return true
  }
  if (path === '/api/lab/port-description' && req.method === 'POST') {
    const input = await body(req)
    if (typeof input.switchId !== 'string' || typeof input.interfaceName !== 'string' || typeof input.description !== 'string') { json(res, 400, { error: 'switchId, interfaceName and description are required' }); return true }
    const result = await setInterfaceDescription(lab, input.switchId, input.interfaceName, input.description, 15000)
    if (result.code !== 0) { json(res, 502, { error: result.err || result.out, code: result.code }); return true }
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
    const file = url.pathname === '/' ? join(ROOT, '..', 'web', 'index.html') : url.pathname === '/web.js' ? join(ROOT, 'web.js') : url.pathname === '/web.css' ? join(ROOT, 'web.css') : ''
    if (file.length === 0) { res.writeHead(404); res.end('Not found'); return }
    const content = await readFile(file)
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(content)
  } catch (error) { json(res, 500, { error: String(error instanceof Error ? error.message : error) }) }
})

server.listen(PORT, HOST, () => console.log('Lab Web listening on http://' + HOST + ':' + PORT))
