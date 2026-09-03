import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { stringify } from 'yaml'
import type { TopologyResponse } from '../types.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(process.env.LAB_AGENT_DATA_DIR ?? join(MODULE_DIR, '..', 'data', 'agent'))
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const ALLOWED_MIME = new Set(['text/plain','text/markdown','application/json','application/yaml','text/yaml','image/png','image/jpeg','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])

export type AgentJobStatus = 'created' | 'ready' | 'generating' | 'complete' | 'failed'
export interface AgentMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: number; attachmentIds: string[] }
export interface AgentAttachment { id: string; name: string; mimeType: string; size: number; status: 'ready'; createdAt: number }
export interface AgentArtifact { id: string; name: string; kind: 'experiment-yaml' | 'switch-config' | 'topology-diff' | 'package'; size: number; device?: string; createdAt: number }
export interface AgentJob { id: string; owner: string; title: string; status: AgentJobStatus; createdAt: number; updatedAt: number; messages: AgentMessage[]; attachments: AgentAttachment[]; artifacts: AgentArtifact[]; summary?: string; error?: string }
export interface AgentProviderProfile { provider: 'mock' | 'deepseek' | 'openai-compatible'; baseUrl?: string; model: string; configured: boolean; apiKeyHint?: string }
interface StoredProvider extends AgentProviderProfile { encryptedApiKey?: string }

const userRoot = (username: string): string => { const root = resolve(DATA_ROOT, 'users', username); if (!root.startsWith(resolve(DATA_ROOT, 'users') + sep)) throw new Error('invalid user workspace'); return root }
const jobRoot = (username: string, jobId: string): string => { if (!/^job_[a-f0-9-]+$/.test(jobId)) throw new Error('invalid job id'); return join(userRoot(username), 'jobs', jobId) }
const ensureUser = async (username: string): Promise<void> => { await Promise.all(['jobs','uploads','artifacts','conversations'].map(async (name) => mkdir(join(userRoot(username), name), { recursive: true }))) }
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
const saveJob = async (job: AgentJob): Promise<void> => { job.updatedAt = Date.now(); await mkdir(jobRoot(job.owner, job.id), { recursive: true }); await writeFile(join(jobRoot(job.owner, job.id), 'job.json'), JSON.stringify(job, null, 2), 'utf8') }
const loadJob = async (username: string, jobId: string): Promise<AgentJob> => { const job = await readJson<AgentJob>(join(jobRoot(username, jobId), 'job.json')); if (job.owner !== username) throw new Error('job not found'); return job }

const secretKey = (): Buffer => createHash('sha256').update(process.env.LAB_AGENT_MASTER_KEY ?? 'sonic-lab-local-agent-key-change-me').digest()
const encrypt = (plain: string): string => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secretKey(), iv); const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]); return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.') }
export const decryptProviderKey = (stored: StoredProvider): string | undefined => { if (stored.encryptedApiKey === undefined) return undefined; const [iv, tag, data] = stored.encryptedApiKey.split('.'); if (iv === undefined || tag === undefined || data === undefined) return undefined; const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64')); decipher.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8') }

export async function getProvider(username: string): Promise<AgentProviderProfile> { await ensureUser(username); try { const stored = await readJson<StoredProvider>(join(userRoot(username), 'provider.json')); const { encryptedApiKey: _, ...profile } = stored; return profile } catch { return { provider: 'mock', model: 'sonic-mock-planner', configured: true } } }
export async function setProvider(username: string, input: { provider: AgentProviderProfile['provider']; baseUrl?: string; model: string; apiKey?: string }): Promise<AgentProviderProfile> { await ensureUser(username); const previous = await readJson<StoredProvider>(join(userRoot(username), 'provider.json')).catch(() => undefined); const encryptedApiKey = input.apiKey?.trim() ? encrypt(input.apiKey.trim()) : previous?.encryptedApiKey; const profile: StoredProvider = { provider: input.provider, baseUrl: input.baseUrl?.trim() || undefined, model: input.model.trim() || 'sonic-mock-planner', configured: input.provider === 'mock' || encryptedApiKey !== undefined, apiKeyHint: input.apiKey?.trim() ? '****' + input.apiKey.trim().slice(-4) : previous?.apiKeyHint, encryptedApiKey }; await writeFile(join(userRoot(username), 'provider.json'), JSON.stringify(profile, null, 2), 'utf8'); const { encryptedApiKey: _, ...safe } = profile; return safe }

export async function listJobs(username: string): Promise<AgentJob[]> { await ensureUser(username); const dir = join(userRoot(username), 'jobs'); const names = await readdir(dir).catch(() => []); const jobs = await Promise.all(names.filter((name) => name.startsWith('job_')).map(async (name) => loadJob(username, name).catch(() => undefined))); return jobs.filter((job): job is AgentJob => job !== undefined).sort((a,b) => b.updatedAt - a.updatedAt) }
export async function createJob(username: string, title?: string): Promise<AgentJob> { await ensureUser(username); const now = Date.now(); const job: AgentJob = { id: 'job_' + randomUUID(), owner: username, title: title?.trim() || '新建拓扑任务', status: 'created', createdAt: now, updatedAt: now, messages: [{ id: randomUUID(), role: 'assistant', content: '请上传实验文档、拓扑截图或直接描述需求。文件准备好后，我会结合当前实机拓扑生成 experiment.yml 和每台交换机的手工配置文件。', createdAt: now, attachmentIds: [] }], attachments: [], artifacts: [] }; await saveJob(job); return job }
export { loadJob }

export interface ProviderChatResult { provider: string; model: string; content: string }

/** One-shot chat completion through the user's stored provider (DeepSeek or OpenAI-compatible). */
export async function callProviderChat(username: string, system: string, prompt: string, options?: { maxTokens?: number; timeoutMs?: number }): Promise<ProviderChatResult> {
	await ensureUser(username)
	const stored = await readJson<StoredProvider>(join(userRoot(username), 'provider.json')).catch(() => undefined)
	if (stored === undefined || stored.provider === 'mock') throw new Error('当前模型为 Mock,无法进行长日志分析。请在 Lab_UI Web 的 Agent 工作台配置 DeepSeek 或 OpenAI 兼容模型。')
	const apiKey = decryptProviderKey(stored)
	if (apiKey === undefined) throw new Error('模型 API Key 未配置,无法进行分析。请在 Agent 工作台填写并保存。')
	const base = (stored.baseUrl?.trim() || (stored.provider === 'deepseek' ? 'https://api.deepseek.com' : '')).replace(/\/+$/, '')
	if (base.length === 0) throw new Error('模型 baseUrl 未配置。')
	const response = await fetch(base + '/chat/completions', {
		method: 'POST',
		headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
		body: JSON.stringify({ model: stored.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: false, temperature: 0.2, max_tokens: options?.maxTokens ?? 8192 }),
		signal: AbortSignal.timeout(options?.timeoutMs ?? 300_000),
	})
	if (!response.ok) throw new Error('模型 HTTP ' + String(response.status) + ': ' + (await response.text().catch(() => '')).slice(0, 300))
	const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
	const content = data.choices?.[0]?.message?.content
	if (typeof content !== 'string' || content.trim().length === 0) throw new Error('模型返回内容为空')
	return { provider: stored.provider, model: stored.model, content }
}

const safeName = (name: string): string => name.replace(/[\/:*?"<>|\r\n]/g, '_').slice(0, 120) || 'attachment.bin'
export async function addAttachment(username: string, jobId: string, input: { name: string; mimeType: string; data: string }): Promise<AgentJob> { const job = await loadJob(username, jobId); if (!ALLOWED_MIME.has(input.mimeType)) throw new Error('unsupported attachment type'); const bytes = Buffer.from(input.data, 'base64'); if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment must be between 1 byte and 12 MB'); const attachment: AgentAttachment = { id: 'att_' + randomUUID(), name: safeName(input.name), mimeType: input.mimeType, size: bytes.length, status: 'ready', createdAt: Date.now() }; const dir = join(jobRoot(username, jobId), 'attachments'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, attachment.id + '-' + attachment.name), bytes); job.attachments.push(attachment); if (job.title === '新建拓扑任务') job.title = attachment.name.replace(/\.[^.]+$/, ''); await saveJob(job); return job }

const attachmentText = async (username: string, job: AgentJob): Promise<string> => { const dir = join(jobRoot(username, job.id), 'attachments'); const chunks: string[] = []; for (const att of job.attachments) { if (!att.mimeType.startsWith('text/') && !['application/json','application/yaml'].includes(att.mimeType)) continue; const file = join(dir, att.id + '-' + att.name); chunks.push(await readFile(file, 'utf8').catch(() => '')) } return chunks.join('\n\n').slice(0, 80000) }
export async function addMessage(username: string, jobId: string, content: string, attachmentIds: string[]): Promise<AgentJob> { const job = await loadJob(username, jobId); const text = content.trim(); if (!text && attachmentIds.length === 0) throw new Error('message is empty'); job.messages.push({ id: randomUUID(), role: 'user', content: text, createdAt: Date.now(), attachmentIds: attachmentIds.filter((id) => job.attachments.some((item) => item.id === id)) }); const docText = await attachmentText(username, job); const response = docText ? '已收到文档并建立任务上下文。当前 MVP 会从实机 LLDP 生成参考拓扑，并为各交换机生成只包含端口描述的安全手工配置。点击“生成方案”继续。' : '已记录需求。请继续补充设备、端口、IP、速率或上传文档；准备完成后点击“生成方案”。'; job.messages.push({ id: randomUUID(), role: 'assistant', content: response, createdAt: Date.now(), attachmentIds: [] }); job.status = 'ready'; await saveJob(job); return job }

const positions = [{x:170,y:70},{x:930,y:70},{x:170,y:540},{x:930,y:540}]
const yamlFor = (job: AgentJob, topology: TopologyResponse): string => stringify({ apiVersion:'soniclab/v1', kind:'Experiment', metadata:{ name:job.id.replace('job_','agent-').slice(0,48), title:job.title, description:'由 SONiC Lab Agent 工作台生成；配置尚未自动执行。' }, render:{ defaultView:'logical', width:1500, height:840 }, nodes:topology.switches.map((sw,index)=>({ id:sw.id, type:'switch', device:sw.id, label:sw.name.toUpperCase()+' '+sw.ip.split('.').at(-1), position:positions[index] ?? {x:170+(index%3)*450,y:70+Math.floor(index/3)*360} })), links:topology.links.map((link,index)=>({ id:'agent-link-'+String(index+1), from:{node:link.a.sw,interface:link.a.port}, to:{node:link.b.sw,interface:link.b.port}, label:link.source.toUpperCase() })) })
const configFor = (device: string, topology: TopologyResponse): string => { const links = topology.links.filter((link) => link.a.sw === device || link.b.sw === device); const lines = ['# SONiC Lab Agent generated manual configuration','# Device: '+device,'# WARNING: Review every command before execution. Nothing has been executed automatically.','','# PRE-CHECK','show interfaces status','show lldp table','','# CONFIGURATION']; for (const link of links) { const local = link.a.sw === device ? link.a : link.b; const peer = link.a.sw === device ? link.b : link.a; lines.push('sudo config interface description '+local.port+' '+JSON.stringify(device+'_to_'+peer.sw+'_'+peer.port)) } lines.push('','# POST-CHECK','show interfaces status','show lldp table','','# ROLLBACK','# Restore descriptions manually from the pre-check snapshot.'); return lines.join('\n')+'\n' }
const writeArtifact = async (job: AgentJob, name: string, kind: AgentArtifact['kind'], data: Uint8Array, device?: string): Promise<AgentArtifact> => { const id = 'art_' + randomUUID(); const dir = join(jobRoot(job.owner, job.id), 'artifacts'); await mkdir(dir, { recursive:true }); await writeFile(join(dir, id+'-'+safeName(name)), data); return { id, name, kind, size:data.byteLength, device, createdAt:Date.now() } }
export async function generateArtifacts(username: string, jobId: string, topology: TopologyResponse): Promise<AgentJob> { const job = await loadJob(username, jobId); job.status='generating'; job.error=undefined; await saveJob(job); try { job.artifacts=[]; const experiment=yamlFor(job,topology); const artifacts: AgentArtifact[]=[]; artifacts.push(await writeArtifact(job,'experiment.yml','experiment-yaml',strToU8(experiment))); const diff=['# 拓扑比对摘要','','- 实机交换机：'+topology.switches.length,'- 实机链路：'+topology.links.length,'- 当前 Mock Planner 使用实机 LLDP 作为参考拓扑。','- 文档语义解析和 Pi Provider 将在下一阶段替换 Mock Planner。'].join('\n')+'\n'; artifacts.push(await writeArtifact(job,'topology-diff.md','topology-diff',strToU8(diff))); const zipFiles: Record<string,Uint8Array>={ 'experiment.yml':strToU8(experiment), 'topology-diff.md':strToU8(diff) }; for(const sw of topology.switches){ const config=configFor(sw.id,topology); artifacts.push(await writeArtifact(job,sw.id+'-config.txt','switch-config',strToU8(config),sw.id)); zipFiles['config/'+sw.id+'-config.txt']=strToU8(config) } const zip=zipSync(zipFiles,{level:6}); artifacts.push(await writeArtifact(job,job.title.replace(/\s+/g,'-')+'-artifacts.zip','package',zip)); job.artifacts=artifacts; job.summary='已根据当前实机拓扑生成 '+topology.links.length+' 条链路、experiment.yml 和 '+topology.switches.length+' 份交换机手工配置。'; job.messages.push({id:randomUUID(),role:'assistant',content:job.summary+' 所有配置均未自动执行，请在右侧产物面板中预览和下载。',createdAt:Date.now(),attachmentIds:[]}); job.status='complete'; await saveJob(job); return job } catch(error){ job.status='failed'; job.error=String(error instanceof Error?error.message:error); await saveJob(job); return job } }

export async function readArtifact(username:string,jobId:string,artifactId:string):Promise<{artifact:AgentArtifact;data:Buffer}>{ const job=await loadJob(username,jobId); const artifact=job.artifacts.find((item)=>item.id===artifactId); if(artifact===undefined)throw new Error('artifact not found'); const dir=join(jobRoot(username,jobId),'artifacts'); const names=await readdir(dir); const name=names.find((item)=>item.startsWith(artifact.id+'-')); if(name===undefined)throw new Error('artifact file missing'); return {artifact,data:await readFile(join(dir,name))} }
