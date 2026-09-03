import { useCallback, useEffect, useRef, useState } from 'react'
import './jenkins.css'

interface JenkinsJob{name:string;color:string;url?:string;lastBuild?:{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}|null;lastSuccessfulBuild?:{number:number;timestamp?:number}|null;healthReport?:Array<{score?:number;description?:string}>}
interface JenkinsBuild{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}

const api=async <T,>(url:string,init?:RequestInit):Promise<T>=>{const response=await fetch(url,{...init,headers:{accept:'application/json',...(init?.headers??{})}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??('HTTP '+String(response.status)));return value}
const durationText=(ms?:number):string=>ms===undefined||ms===0?'—':ms<60000?Math.round(ms/1000)+' 秒':ms<3600000?Math.round(ms/60000)+' 分':(ms/3600000).toFixed(1)+' 小时'
const timeText=(ms?:number):string=>ms===undefined||ms===0?'—':new Date(ms).toLocaleString()
const resultClass=(build:JenkinsBuild):string=>build.building?'building':build.result==='SUCCESS'?'ok':build.result==='FAILURE'?'fail':build.result==='UNSTABLE'?'warn':build.result==='ABORTED'?'idle':'idle'

interface BuildRow extends JenkinsBuild{job:string}
type GenState='queued'|'running'|'ready'|'failed'
interface CiReportMeta{job:string;build:number;generatedAt:number;provider:string;model:string;logChars:number;inputChars:number;durationMs:number}
interface CiReport{meta:CiReportMeta;markdown:string}

const reportUrl=(job:string,build:number):string=>'/api/jenkins/jobs/'+encodeURIComponent(job)+'/builds/'+String(build)+'/report'
const analyzeUrl=(job:string,build:number):string=>'/api/jenkins/jobs/'+encodeURIComponent(job)+'/builds/'+String(build)+'/analyze'
const keyOf=(job:string,build:number):string=>job+':'+String(build)

const trendText=(row:BuildRow,rows:BuildRow[]):string=>{
	if(row.building)return '正在构建'
	const same=rows.filter((item)=>item.job===row.job)
	const index=same.findIndex((item)=>item.number===row.number)
	const older=same[index+1]
	if(row.result==='FAILURE'&&older?.result==='SUCCESS')return '从本次构建开始失败'
	if(row.result==='FAILURE'&&older?.result==='FAILURE')return '持续失败'
	return '—'
}

export function JenkinsView({ visible }: { visible: boolean }): JSX.Element {
	const [server,setServer]=useState('')
	const [rows,setRows]=useState<BuildRow[]>([])
	const [error,setError]=useState('')
	const [genStatus,setGenStatus]=useState<Record<string,GenState>>({})
	const [genError,setGenError]=useState<Record<string,string>>({})
	const attemptedRef=useRef<Set<string>>(new Set())
	const queueRef=useRef<Array<{job:string;build:number}>>([])
	const runningRef=useRef(false)

	const processQueue=useCallback(async():Promise<void>=>{
		if(runningRef.current)return
		runningRef.current=true
		while(queueRef.current.length>0){
			const item=queueRef.current.shift()
			if(item===undefined)break
			const k=keyOf(item.job,item.build)
			setGenStatus((old)=>({...old,[k]:'running'}))
			try{
				await api<CiReport>(analyzeUrl(item.job,item.build),{method:'POST'})
				setGenStatus((old)=>({...old,[k]:'ready'}))
			}catch(e){
				setGenStatus((old)=>({...old,[k]:'failed'}))
				setGenError((old)=>({...old,[k]:String(e instanceof Error?e.message:e)}))
			}
		}
		runningRef.current=false
	},[])

	const enqueue=useCallback((job:string,build:number):void=>{
		const k=keyOf(job,build)
		if(attemptedRef.current.has(k))return
		attemptedRef.current.add(k)
		setGenStatus((old)=>({...old,[k]:'queued'}))
		queueRef.current.push({job,build})
		void processQueue()
	},[processQueue])

	const checkExisting=useCallback(async(job:string,build:number):Promise<void>=>{
		const k=keyOf(job,build)
		if(attemptedRef.current.has(k))return
		attemptedRef.current.add(k)
		try{await api<CiReport>(reportUrl(job,build));setGenStatus((old)=>({...old,[k]:'ready'}))}
		catch{enqueue(job,build)}
	},[enqueue])

	const load=useCallback(async():Promise<void>=>{
		try{
			const jobsResult=await api<{server:string;jobs:JenkinsJob[]}>('/api/jenkins/jobs')
			const histories=await Promise.all(jobsResult.jobs.map(async(job)=>{const result=await api<{builds:JenkinsBuild[]}>('/api/jenkins/jobs/'+encodeURIComponent(job.name)+'/builds?limit=50');return result.builds.map((build)=>({...build,job:job.name}))}))
			const next=histories.flat().sort((a,b)=>(b.timestamp??0)-(a.timestamp??0))
			setRows(next);setServer(jobsResult.server);setError('')
			for(const row of next){
				if(row.building)continue
				if(row.result!=='FAILURE'&&row.result!=='UNSTABLE')continue
				void checkExisting(row.job,row.number)
			}
		}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[checkExisting])

	useEffect(()=>{
		if(!visible)return
		void load()
		const timer=setInterval(()=>void load(),15000)
		return()=>clearInterval(timer)
	},[visible,load])

	return <div className="jk-root">
		<header className="jk-toolbar">
			<div><small>CONTINUOUS INTEGRATION</small><strong>Jenkins 构建失败自动分析</strong></div>
			<code>{server}</code><span className="jk-flex"/><span className="jk-refresh">{rows.length} 条构建 · 失败构建自动生成分析报告</span>
		</header>
		{error.length>0&&<div className="jk-error" role="alert">{error}</div>}
		<section className="jk-history" aria-label="Jenkins 构建历史">
			<div className="jk-history-head"><span>状态</span><span>构建</span><span>时间</span><span>结果变化</span><span>分析报告</span></div>
			<div className="jk-history-body">
				{rows.length===0&&error.length===0?<div className="jk-empty"><b>暂无构建记录</b><p>正在读取 Jenkins 构建历史。</p></div>:rows.map((row)=>{
					const cls=resultClass(row)
					const k=keyOf(row.job,row.number)
					const st=genStatus[k]
					const failed=!row.building&&(row.result==='FAILURE'||row.result==='UNSTABLE')
					return <article key={k} className="jk-history-row">
						<span className={'jk-result-icon '+cls}>{row.building?'…':row.result==='SUCCESS'?'✓':row.result==='FAILURE'?'×':'•'}</span>
						<div className="jk-history-build"><b>{row.job}</b><code>#{String(row.number)}</code></div>
						<div className="jk-history-time"><time>{timeText(row.timestamp)}</time><small>{durationText(row.duration)}</small></div>
						<span className={'jk-history-trend '+cls}>{failed?trendText(row,rows):'—'}</span>
						<span className="jk-analysis-cell">
							{st==='ready'
								?<a className="jk-report-link" href={reportUrl(row.job,row.number)} download title="下载分析报告 (.md)">下载报告</a>
								:st==='running'
									?<span className="jk-analysis-status running"><i/>分析中…</span>
									:st==='queued'
										?<span className="jk-analysis-status">排队中</span>
										:st==='failed'
											?<button className="jk-analysis-retry" title={genError[k]??'分析失败'} onClick={()=>{attemptedRef.current.delete(k);enqueue(row.job,row.number)}}>重试</button>
											:failed
												?<span className="jk-analysis-status">待分析</span>
												:<span className="jk-analysis-none">—</span>}
						</span>
					</article>
				})}
			</div>
		</section>
	</div>
}
