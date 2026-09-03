import { useCallback, useEffect, useState } from 'react'
import './jenkins.css'

interface JenkinsJob{name:string;color:string;url?:string;lastBuild?:{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}|null;lastSuccessfulBuild?:{number:number;timestamp?:number}|null;healthReport?:Array<{score?:number;description?:string}>}
interface JenkinsBuild{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}

const api=async <T,>(url:string,init?:RequestInit):Promise<T>=>{const response=await fetch(url,{...init,headers:{accept:'application/json',...(init?.headers??{})}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??('HTTP '+String(response.status)));return value}
const durationText=(ms?:number):string=>ms===undefined||ms===0?'—':ms<60000?Math.round(ms/1000)+' 秒':ms<3600000?Math.round(ms/60000)+' 分':(ms/3600000).toFixed(1)+' 小时'
const timeText=(ms?:number):string=>ms===undefined||ms===0?'—':new Date(ms).toLocaleString()
const resultLabel=(build:JenkinsBuild):string=>build.building?'构建中':build.result==='SUCCESS'?'成功':build.result==='FAILURE'?'失败':build.result==='UNSTABLE'?'不稳定':build.result==='ABORTED'?'已中止':build.result??'—'
const resultClass=(build:JenkinsBuild):string=>build.building?'building':build.result==='SUCCESS'?'ok':build.result==='FAILURE'?'fail':build.result==='UNSTABLE'?'warn':build.result==='ABORTED'?'idle':'idle'

interface BuildRow extends JenkinsBuild{job:string}
interface CiReportMeta{job:string;build:number;generatedAt:number;provider:string;model:string;logChars:number;inputChars:number;durationMs:number}
interface CiReport{meta:CiReportMeta;markdown:string}

const reportUrl=(job:string,build:number):string=>'/api/jenkins/jobs/'+encodeURIComponent(job)+'/builds/'+String(build)+'/report'
const analyzeUrl=(job:string,build:number):string=>'/api/jenkins/jobs/'+encodeURIComponent(job)+'/builds/'+String(build)+'/analyze'

const trendText=(row:BuildRow,rows:BuildRow[]):string=>{
	if(row.building)return '正在构建'
	const same=rows.filter((item)=>item.job===row.job)
	const index=same.findIndex((item)=>item.number===row.number)
	const older=same[index+1]
	if(row.result==='SUCCESS'&&older?.result==='FAILURE')return '恢复正常'
	if(row.result==='FAILURE'&&older?.result==='SUCCESS')return '从本次构建开始失败'
	if(row.result==='FAILURE'&&older?.result==='FAILURE')return '持续失败'
	return resultLabel(row)
}

const kb=(chars:number):string=>chars<1024?String(chars)+' B':String(Math.round(chars/1024))+' KB'

export function JenkinsView({ visible }: { visible: boolean }): JSX.Element {
	const [server,setServer]=useState('')
	const [rows,setRows]=useState<BuildRow[]>([])
	const [error,setError]=useState('')
	const [selected,setSelected]=useState<{job:string;build:number}>()
	const [report,setReport]=useState<CiReport>()
	const [analyzeBusy,setAnalyzeBusy]=useState(false)
	const [analyzeError,setAnalyzeError]=useState('')

	const selectRow=useCallback(async(job:string,build:number):Promise<void>=>{
		setSelected({job,build});setAnalyzeError('');setReport(undefined)
		try{const existing=await api<CiReport>(reportUrl(job,build));setReport(existing)}catch{setReport(undefined)}
	},[])

	const runAnalysis=useCallback(async(job:string,build:number):Promise<void>=>{
		setAnalyzeBusy(true);setAnalyzeError('');setSelected({job,build});setReport(undefined)
		try{const result=await api<CiReport>(analyzeUrl(job,build),{method:'POST'});setReport(result)}
		catch(e){setAnalyzeError(String(e instanceof Error?e.message:e))}
		finally{setAnalyzeBusy(false)}
	},[])

	const load=useCallback(async():Promise<void>=>{
		try{
			const jobsResult=await api<{server:string;jobs:JenkinsJob[]}>('/api/jenkins/jobs')
			const histories=await Promise.all(jobsResult.jobs.map(async(job)=>{const result=await api<{builds:JenkinsBuild[]}>('/api/jenkins/jobs/'+encodeURIComponent(job.name)+'/builds?limit=50');return result.builds.map((build)=>({...build,job:job.name}))}))
			const next=histories.flat().sort((a,b)=>(b.timestamp??0)-(a.timestamp??0))
			setRows(next);setServer(jobsResult.server);setError('')
			if(selected===undefined){const failed=next.find((row)=>row.result==='FAILURE'||row.result==='UNSTABLE');if(failed!==undefined)void selectRow(failed.job,failed.number)}
		}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[selected,selectRow])

	useEffect(()=>{
		if(!visible)return
		void load()
		const timer=setInterval(()=>void load(),15000)
		return()=>clearInterval(timer)
	},[visible,load])

	return <div className="jk-root">
		<header className="jk-toolbar">
			<div><small>CONTINUOUS INTEGRATION</small><strong>Jenkins 构建失败分析</strong></div>
			<code>{server}</code><span className="jk-flex"/><span className="jk-refresh">{rows.length} 条构建 · 每 15 秒刷新</span>
		</header>
		{error.length>0&&<div className="jk-error" role="alert">{error}</div>}
		<div className="jk-history-layout">
			<section className="jk-history" aria-label="Jenkins 构建历史">
				<div className="jk-history-head"><span>状态</span><span>构建</span><span>时间</span><span>结果变化</span><span>分析</span></div>
				<div className="jk-history-body">
					{rows.length===0&&error.length===0?<div className="jk-empty"><b>暂无构建记录</b><p>正在读取 Jenkins 构建历史。</p></div>:rows.map((row)=>{
						const active=selected?.job===row.job&&selected.build===row.number
						const cls=resultClass(row)
						const failed=row.result==='FAILURE'||row.result==='UNSTABLE'
						return <article key={row.job+':'+String(row.number)} className={'jk-history-row'+(active?' active':'')} onClick={()=>void selectRow(row.job,row.number)}>
							<span className={'jk-result-icon '+cls}>{row.building?'…':row.result==='SUCCESS'?'✓':row.result==='FAILURE'?'×':'•'}</span>
							<div className="jk-history-build"><b>{row.job}</b><code>#{String(row.number)}</code></div>
							<div className="jk-history-time"><time>{timeText(row.timestamp)}</time><small>{durationText(row.duration)}</small></div>
							<span className={'jk-history-trend '+cls}>{trendText(row,rows)}</span>
							{failed
								?<button className="jk-analyze-button" disabled={analyzeBusy} aria-label={'AI 分析 '+row.job+' #'+String(row.number)+' 失败日志'} title={report?.meta.job===row.job&&report.meta.build===row.number?'重新生成分析报告':'调用模型分析失败日志并生成报告'} onClick={(event)=>{event.stopPropagation();void runAnalysis(row.job,row.number)}}>
									<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>
								</button>
								:<span className="jk-analyze-none" title="仅失败/不稳定构建支持 AI 分析">—</span>}
						</article>
					})}
				</div>
			</section>
			<section className="jk-report-pane" aria-label="构建失败分析报告">
				<header>
					<div><small>FAILURE ANALYSIS REPORT</small><strong>{selected===undefined?'未选择构建':selected.job+' #'+String(selected.build)}</strong></div>
					{report!==undefined&&<>
						<span className="jk-report-meta" title={'原始日志 '+kb(report.meta.logChars)+' · 送入模型 '+kb(report.meta.inputChars)}>{report.meta.model} · {new Date(report.meta.generatedAt).toLocaleString()} · {kb(report.meta.inputChars)}/{kb(report.meta.logChars)}</span>
						<a className="jk-report-download" href={reportUrl(report.meta.job,report.meta.build)} download>下载 .md</a>
					</>}
				</header>
				{analyzeError.length>0&&<div className="jk-error" role="alert">{analyzeError}</div>}
				{analyzeBusy
					?<div className="jk-report-busy"><span className="jk-spinner"/><b>正在调用模型分析长日志</b><p>拉取构建日志 → 截取错误上下文 → 模型深度分析 → 生成报告,通常需要 1-3 分钟。</p></div>
					:report!==undefined
						?<pre className="jk-report-body" tabIndex={0}>{report.markdown}</pre>
						:<div className="jk-empty"><b>{selected===undefined?'在左侧选择失败构建':'该构建尚未生成报告'}</b><p>点击失败构建行的 ★ 按钮调用模型生成专业分析报告;已生成的报告可直接查看与下载。</p></div>}
			</section>
		</div>
	</div>
}
