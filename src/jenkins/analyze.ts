import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consoleTail } from './service.ts'
import { callProviderChat } from '../agent/service.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(process.env.LAB_CI_DATA_DIR ?? join(MODULE_DIR, '..', 'data', 'ci-reports'))

export interface CiReportMeta { job: string; build: number; generatedAt: number; provider: string; model: string; logChars: number; inputChars: number; durationMs: number }
export interface CiReport { meta: CiReportMeta; markdown: string }

// Long build logs dwarf any model context window. Keep the informative
// parts: the head (build setup), windows around every error-looking line,
// and the tail (where the fatal failure usually is).
const ERROR_LINE = /(\berror\b|\bfatal\b|fail(ed|ure)?|traceback|exception|undefined reference|no such file|cannot find|not found|cmake error|recipe for target|killed|out of memory|segmentation fault|exit code|returned [1-9]|✗|error:)/i
const HEAD_LINES = 40
const TAIL_LINES = 500
const WINDOW_LINES = 14
const MAX_WINDOWS = 40
const MAX_INPUT_CHARS = 150_000

const selectForModel = (text: string): string => {
	const lines = text.split('\n')
	const hits: number[] = []
	lines.forEach((line, index) => { if (ERROR_LINE.test(line)) hits.push(index) })
	const windows: Array<[number, number]> = []
	for (const hit of hits.slice(0, 400)) {
		const start = Math.max(0, hit - WINDOW_LINES)
		const end = Math.min(lines.length - 1, hit + WINDOW_LINES)
		const last = windows.at(-1)
		if (last !== undefined && start <= last[1] + 2) last[1] = end
		else if (windows.length < MAX_WINDOWS) windows.push([start, end])
	}
	const sections: string[] = []
	sections.push('【日志头部(构建环境与步骤)】\n' + lines.slice(0, HEAD_LINES).join('\n'))
	if (windows.length > 0) {
		sections.push('【错误上下文片段】\n' + windows.map(([start, end]) => {
			const prefix = start > 0 ? '...(前文省略 ' + String(start) + ' 行)...\n' : ''
			return prefix + lines.slice(start, end + 1).join('\n')
		}).join('\n\n---\n\n'))
	}
	sections.push('【日志尾部(最终失败位置)】\n' + lines.slice(-TAIL_LINES).join('\n'))
	return sections.join('\n\n').slice(0, MAX_INPUT_CHARS)
}

const SYSTEM_PROMPT = [
	'你是资深 SONiC / OpenNetworking 构建工程师,负责分析 CI 构建失败日志。',
	'只依据日志中的证据做判断,不得臆造日志中不存在的内容。',
	'输出为 Markdown 格式的专业中文报告,章节固定、结论明确、建议可执行。',
].join('\n')

const reportPrompt = (job: string, build: number, log: string): string => [
	'分析以下 Jenkins 构建失败日志并生成报告。',
	'任务: ' + job + '   构建 #' + String(build),
	'',
	'报告必须包含以下章节(使用 Markdown 标题):',
	'## 1. 结论速览 — 表格:任务/构建号/失败阶段/根因一句话/置信度(高中低)',
	'## 2. 失败定位 — 首个致命错误出现的阶段、命令、关键日志行(引用原文)',
	'## 3. 根因分析 — 主因与次因分开,每条附日志证据',
	'## 4. 错误分类 — 编译/链接/依赖/环境/网络/资源/测试/其他,标注命中项',
	'## 5. 修复建议 — 按优先级排列的可执行步骤,涉及命令时给出具体命令',
	'## 6. 验证与回归 — 修复后如何确认',
	'## 7. 预防建议 — CI 或工程层面的改进',
	'## 8. 附录:关键日志片段 — 不超过 30 行',
	'',
	'===== 构建日志(已截取关键部分) =====',
	log,
	'===== 日志结束 =====',
].join('\n')

const safeJob = (job: string): string => job.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
const metaPath = (job: string, build: number): string => join(DATA_ROOT, safeJob(job) + '-build-' + String(build) + '.meta.json')
const reportPath = (job: string, build: number): string => join(DATA_ROOT, safeJob(job) + '-build-' + String(build) + '.md')

export async function readReport(job: string, build: number): Promise<CiReport | undefined> {
	if (!Number.isSafeInteger(build) || build < 1) return undefined
	const [meta, markdown] = await Promise.all([
		readFile(metaPath(job, build), 'utf8').then((text) => JSON.parse(text) as CiReportMeta).catch(() => undefined),
		readFile(reportPath(job, build), 'utf8').catch(() => undefined),
	])
	if (meta === undefined || markdown === undefined) return undefined
	return { meta, markdown }
}

export async function analyzeBuild(username: string, job: string, build: number): Promise<CiReport> {
	const started = Date.now()
	const log = await consoleTail(job, build)
	const input = selectForModel(log.text)
	const chat = await callProviderChat(username, SYSTEM_PROMPT, reportPrompt(job, build, input), { maxTokens: 8192 })
	const meta: CiReportMeta = { job, build, generatedAt: Date.now(), provider: chat.provider, model: chat.model, logChars: log.text.length, inputChars: input.length, durationMs: Date.now() - started }
	const header = [
		'# 构建失败分析报告 — ' + job + ' #' + String(build),
		'',
		'- 生成时间: ' + new Date(meta.generatedAt).toLocaleString('zh-CN'),
		'- 分析模型: ' + chat.model + ' (' + chat.provider + ')',
		'- 原始日志: ' + String(Math.round(meta.logChars / 1024)) + ' KB,送入模型: ' + String(Math.round(meta.inputChars / 1024)) + ' KB' + (log.truncated ? '(原日志超限已截尾)' : ''),
		'- 分析耗时: ' + String(Math.round(meta.durationMs / 1000)) + ' 秒',
		'',
		'---',
		'',
	].join('\n')
	const markdown = header + chat.content + '\n'
	await mkdir(DATA_ROOT, { recursive: true })
	await Promise.all([
		writeFile(metaPath(job, build), JSON.stringify(meta, null, 2), 'utf8'),
		writeFile(reportPath(job, build), markdown, 'utf8'),
	])
	return { meta, markdown }
}
