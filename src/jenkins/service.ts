import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
// The file lives at the package root. From src/jenkins that is ../.., from the
// bundled lib/ it is simply .. — check both so dev and built layouts both work.
const CREDENTIAL_CANDIDATES = [join(MODULE_DIR, '..', 'jenkins.local.json'), join(MODULE_DIR, '..', '..', 'jenkins.local.json')]

interface JenkinsCredentials { user: string; token: string }
let cachedCredentials: JenkinsCredentials | undefined

/** Credentials come from env vars or the gitignored jenkins.local.json; never from the browser. */
const credentials = async (): Promise<JenkinsCredentials | undefined> => {
  const user = process.env.LAB_JENKINS_USER
  const token = process.env.LAB_JENKINS_TOKEN
  if (user !== undefined && token !== undefined && user.length > 0 && token.length > 0) return { user, token }
  if (cachedCredentials !== undefined) return cachedCredentials
  for (const candidate of CREDENTIAL_CANDIDATES) {
    const loaded = await readFile(candidate, 'utf8').then((text) => {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const record = parsed as Record<string, unknown>
      return typeof record.user === 'string' && typeof record.token === 'string' && record.user.length > 0 && record.token.length > 0
        ? { user: record.user, token: record.token }
        : undefined
    }).catch(() => undefined)
    if (loaded !== undefined) { cachedCredentials = loaded; return loaded }
  }
  return undefined
}

const baseUrl = (): string => (process.env.LAB_JENKINS_URL ?? 'http://192.168.210.244:18080').replace(/\/+$/, '')

export const jenkinsConfigured = async (): Promise<boolean> => (await credentials()) !== undefined

const authHeader = async (): Promise<string> => {
  const creds = await credentials()
  if (creds === undefined) throw new Error('Jenkins 未配置凭据:请设置 LAB_JENKINS_USER / LAB_JENKINS_TOKEN,或在服务端创建 jenkins.local.json')
  return 'Basic ' + Buffer.from(creds.user + ':' + creds.token).toString('base64')
}

const safeJobName = (value: string): string => {
  if (value.length === 0 || value.length > 120 || /[\\/]|\.\.|[\r\n%]/.test(value)) throw new Error('invalid job name')
  return value
}

const getJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(baseUrl() + path, { headers: { authorization: await authHeader(), accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Jenkins HTTP ' + String(response.status))
  return await response.json() as T
}

export interface JenkinsJob { name: string; color: string; url?: string; lastBuild?: { number: number; timestamp?: number; result?: string | null; duration?: number; building?: boolean } | null; lastSuccessfulBuild?: { number: number; timestamp?: number } | null; healthReport?: Array<{ score?: number; description?: string }> }

export async function listJobs(): Promise<{ server: string; jobs: JenkinsJob[] }> {
  const data = await getJson<{ jobs?: JenkinsJob[] }>('/api/json?tree=jobs[name,color,url,lastBuild[number,timestamp,result,duration,building],lastSuccessfulBuild[number,timestamp],healthReport[score,description]]')
  return { server: baseUrl(), jobs: data.jobs ?? [] }
}

export interface JenkinsBuild { number: number; timestamp?: number; result?: string | null; duration?: number; building?: boolean; url?: string }

export async function listBuilds(jobName: string, limit = 15): Promise<{ job: string; builds: JenkinsBuild[] }> {
  const name = safeJobName(jobName)
  const bounded = Math.min(Math.max(1, limit), 50)
  const data = await getJson<{ builds?: JenkinsBuild[] }>('/job/' + encodeURIComponent(name) + '/api/json?tree=builds[number,timestamp,result,duration,building]{0,' + String(bounded) + '}')
  return { job: name, builds: data.builds ?? [] }
}

export async function consoleTail(jobName: string, build: number, maxChars = 20_000_000): Promise<{ job: string; build: number; text: string; truncated: boolean }> {
  const name = safeJobName(jobName)
  if (!Number.isSafeInteger(build) || build < 1) throw new Error('invalid build number')
  const response = await fetch(baseUrl() + '/job/' + encodeURIComponent(name) + '/' + String(build) + '/consoleText', { headers: { authorization: await authHeader() }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error('Jenkins HTTP ' + String(response.status))
  const text = await response.text()
  const truncated = text.length > maxChars
  return { job: name, build, text: truncated ? '…(日志超过 20 MB,前部已省略)…\n' + text.slice(-maxChars) : text, truncated }
}
