import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consoleTail, listBuilds } from './service.ts'
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
	'纪律:',
	'- 只依据日志中的证据判断,禁止臆造;证据不足时必须明确说明“日志中无法定位”,并列出需要补充的日志范围。',
	'- 优先找“第一个改变构建走向的错误”,而不是最后一条错误(失败常由级联引起)。',
	'- 输出为 Markdown 专业中文报告:章节固定、语言精炼、结论先行、建议可直接执行。',
	'- 禁止复述与失败无关的日志内容,禁止输出空洞的套话。',
].join('\n')

const reportPrompt = (job: string, build: number, trend: string, log: string): string => [
	'分析以下 Jenkins 构建失败日志,生成可供工程师直接执行的排查修复报告。',
	'任务: ' + job + '   构建 #' + String(build) + '   ' + trend,
	'',
	'输出要求(使用 Markdown,章节编号固定):',
	'## 1. 结论速览 — 表格:任务 / 构建号 / 失败阶段 / 根因一句话 / 置信度(高·中·低)',
	'## 2. 失败定位 — 第一个致命错误:所在阶段、执行的命令、引用关键日志原文(不超过 5 行)',
	'## 3. 根因分析 — 主因在前、次因在后;每条结论必须紧跟日志证据(引用原文片段)',
	'## 4. 错误分类 — 从 编译 / 链接 / 依赖 / 环境 / 网络 / 资源 / 测试 / 其他 中标注命中项',
	'## 5. 修复建议 — 按优先级列出可执行步骤;涉及命令时写出完整命令',
	'## 6. 验证与回归 — 修复后如何确认问题消除',
	'## 7. 预防建议 — CI 流程或工程层面的改进措施',
	'## 8. 附录:关键日志片段 — 不超过 30 行',
	'注意:日志经过截取(头部/错误上下文/尾部),中间可能省略;引用日志时保持原文,不要改写。',
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

const trendOf = async (job: string, build: number): Promise<string> => {
	try {
		const { builds } = await listBuilds(job, 50)
		const index = builds.findIndex((item) => item.number === build)
		if (index < 0) return '构建趋势未知'
		const failedRuns = builds.slice(index).filter((item) => item.result === 'FAILURE' || item.result === 'UNSTABLE').length
		const prev = builds[index + 1]
		if (failedRuns > 1) return '该任务已连续失败 ' + String(failedRuns) + ' 次(本次为其中之一)'
		if (prev !== undefined && (prev.result === 'SUCCESS' || prev.result === null)) return '本次为新一轮失败(上一次构建成功)'
		return '本次构建失败'
	} catch {
		return '构建趋势未知'
	}
}

export async function analyzeBuild(username: string, job: string, build: number): Promise<CiReport> {
	const started = Date.now()
	const [log, trend] = await Promise.all([consoleTail(job, build), trendOf(job, build)])
	const input = selectForModel(log.text)
	const chat = await callProviderChat(username, SYSTEM_PROMPT, reportPrompt(job, build, trend, input), { maxTokens: 8192 })
	const meta: CiReportMeta = { job, build, generatedAt: Date.now(), provider: chat.provider, model: chat.model, logChars: log.text.length, inputChars: input.length, durationMs: Date.now() - started }
	const header = [
		'# 构建失败分析报告 — ' + job + ' #' + String(build),
		'',
		'- 生成时间: ' + new Date(meta.generatedAt).toLocaleString('zh-CN'),
		'- 分析模型: ' + chat.model + ' (' + chat.provider + ')',
		'- 原始日志: ' + String(Math.round(meta.logChars / 1024)) + ' KB,送入模型: ' + String(Math.round(meta.inputChars / 1024)) + ' KB' + (log.truncated ? '(原日志超限已截尾)' : ''),
		'- 构建趋势: ' + trend,
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
