import { useCallback, useEffect, useState } from 'react'
import './jenkins.css'

interface JenkinsJob{name:string;color:string;url?:string;lastBuild?:{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}|null;lastSuccessfulBuild?:{number:number;timestamp?:number}|null;healthReport?:Array<{score?:number;description?:string}>}
interface JenkinsBuild{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}

const api=async <T,>(url:string):Promise<T>=>{const response=await fetch(url,{headers:{accept:'application/json'}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??'请求失败');return value}
const durationText=(ms?:number):string=>ms===undefined||ms===0?'—':ms<60000?Math.round(ms/1000)+' 秒':ms<3600000?Math.round(ms/60000)+' 分':(ms/3600000).toFixed(1)+' 小时'
const timeText=(ms?:number):string=>ms===undefined||ms===0?'—':new Date(ms).toLocaleString()
const resultLabel=(build:JenkinsBuild):string=>build.building?'构建中':build.result==='SUCCESS'?'成功':build.result==='FAILURE'?'失败':build.result==='UNSTABLE'?'不稳定':build.result==='ABORTED'?'已中止':build.result??'—'
const resultClass=(build:JenkinsBuild):string=>build.building?'building':build.result==='SUCCESS'?'ok':build.result==='FAILURE'?'fail':build.result==='UNSTABLE'?'warn':build.result==='ABORTED'?'idle':'idle'

interface BuildRow extends JenkinsBuild{job:string}

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

export function JenkinsView({ visible }: { visible: boolean }): JSX.Element {
	const [server,setServer]=useState('')
	const [rows,setRows]=useState<BuildRow[]>([])
	const [error,setError]=useState('')
	const [selected,setSelected]=useState<{job:string;build:number}>()
	const [consoleText,setConsoleText]=useState('')
	const [consoleBusy,setConsoleBusy]=useState(false)

	const openConsole=useCallback(async(job:string,build:number):Promise<void>=>{
		setConsoleBusy(true);setSelected({job,build});setError('')
		try{const result=await api<{text:string;truncated?:boolean}>('/api/jenkins/jobs/'+encodeURIComponent(job)+'/builds/'+String(build)+'/console');setConsoleText(result.text)}
		catch(e){setConsoleText('');setError(String(e instanceof Error?e.message:e))}
		finally{setConsoleBusy(false)}
	},[])

	const load=useCallback(async():Promise<void>=>{
		try{
			const jobsResult=await api<{server:string;jobs:JenkinsJob[]}>('/api/jenkins/jobs')
			const histories=await Promise.all(jobsResult.jobs.map(async(job)=>{const result=await api<{builds:JenkinsBuild[]}>('/api/jenkins/jobs/'+encodeURIComponent(job.name)+'/builds?limit=50');return result.builds.map((build)=>({...build,job:job.name}))}))
			const next=histories.flat().sort((a,b)=>(b.timestamp??0)-(a.timestamp??0))
			setRows(next);setServer(jobsResult.server);setError('')
			if(selected===undefined&&next[0]!==undefined)void openConsole(next[0].job,next[0].number)
		}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[selected,openConsole])

	useEffect(()=>{
		if(!visible)return
		void load()
		const timer=setInterval(()=>void load(),15000)
		return()=>clearInterval(timer)
	},[visible,load])

	return <div className="jk-root">
		<header className="jk-toolbar">
			<div><small>CONTINUOUS INTEGRATION</small><strong>Jenkins 的构建历史</strong></div>
			<code>{server}</code><span className="jk-flex"/><span className="jk-refresh">{rows.length} 条构建 · 每 15 秒刷新</span>
		</header>
		{error.length>0&&<div className="jk-error" role="alert">{error}</div>}
		<div className="jk-history-layout">
			<section className="jk-history" aria-label="Jenkins 构建历史">
				<div className="jk-history-head"><span>状态</span><span>构建</span><span>时间</span><span>结果变化</span><span>日志</span></div>
				<div className="jk-history-body">
					{rows.length===0&&error.length===0?<div className="jk-empty"><b>暂无构建记录</b><p>正在读取 Jenkins 构建历史。</p></div>:rows.map((row)=>{
						const active=selected?.job===row.job&&selected.build===row.number
						const cls=resultClass(row)
						return <article key={row.job+':'+String(row.number)} className={'jk-history-row'+(active?' active':'')}>
							<span className={'jk-result-icon '+cls}>{row.building?'…':row.result==='SUCCESS'?'✓':row.result==='FAILURE'?'×':'•'}</span>
							<div className="jk-history-build"><b>{row.job}</b><code>#{String(row.number)}</code></div>
							<div className="jk-history-time"><time>{timeText(row.timestamp)}</time><small>{durationText(row.duration)}</small></div>
							<span className={'jk-history-trend '+cls}>{trendText(row,rows)}</span>
							<button className="jk-log-button" aria-label={'查看 '+row.job+' #'+String(row.number)+' 完整日志'} title="查看完整日志" onClick={()=>void openConsole(row.job,row.number)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></svg></button>
						</article>
					})}
				</div>
			</section>
			<section className="jk-full-console" aria-label="完整控制台日志">
				<header><strong>{selected===undefined?'选择右侧日志图标':selected.job+' #'+String(selected.build)}</strong><span>{consoleBusy?'正在读取完整日志…':consoleText.length>0?consoleText.length+' 字符':''}</span></header>
				<pre tabIndex={0}>{consoleText}</pre>
			</section>
		</div>
	</div>
}
