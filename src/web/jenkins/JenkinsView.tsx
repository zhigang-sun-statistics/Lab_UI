import { useCallback, useEffect, useState } from 'react'
import './jenkins.css'

interface JenkinsJob{name:string;color:string;url?:string;lastBuild?:{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}|null;lastSuccessfulBuild?:{number:number;timestamp?:number}|null;healthReport?:Array<{score?:number;description?:string}>}
interface JenkinsBuild{number:number;timestamp?:number;result?:string|null;duration?:number;building?:boolean}

const api=async <T,>(url:string):Promise<T>=>{const response=await fetch(url,{headers:{accept:'application/json'}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??'请求失败');return value}
const durationText=(ms?:number):string=>ms===undefined||ms===0?'—':ms<60000?Math.round(ms/1000)+' 秒':ms<3600000?Math.round(ms/60000)+' 分':(ms/3600000).toFixed(1)+' 小时'
const timeText=(ms?:number):string=>ms===undefined||ms===0?'—':new Date(ms).toLocaleString()
const resultLabel=(build:JenkinsBuild):string=>build.building?'构建中':build.result==='SUCCESS'?'成功':build.result==='FAILURE'?'失败':build.result==='UNSTABLE'?'不稳定':build.result==='ABORTED'?'已中止':build.result??'—'
const resultClass=(build:JenkinsBuild):string=>build.building?'building':build.result==='SUCCESS'?'ok':build.result==='FAILURE'?'fail':build.result==='UNSTABLE'?'warn':build.result==='ABORTED'?'idle':'idle'
const jobState=(job:JenkinsJob):{cls:string;label:string}=>{const color=job.color??'';if(color.endsWith('_anime'))return{cls:'building',label:'构建中'};if(job.lastBuild?.building)return{cls:'building',label:'构建中'};if(color.startsWith('blue'))return{cls:'ok',label:'成功'};if(color.startsWith('red'))return{cls:'fail',label:'失败'};if(color.startsWith('yellow'))return{cls:'warn',label:'不稳定'};if(color.startsWith('aborted'))return{cls:'aborted',label:'已中止'};if(color.startsWith('disabled'))return{cls:'idle',label:'已禁用'};return{cls:'idle',label:'未构建'}}

export function JenkinsView({ visible }: { visible: boolean }): JSX.Element {
	const [server,setServer]=useState('')
	const [jobs,setJobs]=useState<JenkinsJob[]>([])
	const [error,setError]=useState('')
	const [selectedJob,setSelectedJob]=useState<string>()
	const [builds,setBuilds]=useState<JenkinsBuild[]>([])
	const [selectedBuild,setSelectedBuild]=useState<number>()
	const [consoleText,setConsoleText]=useState('')
	const [consoleBusy,setConsoleBusy]=useState(false)

	const load=useCallback(async():Promise<void>=>{
		try{const result=await api<{server:string;jobs:JenkinsJob[]}>('/api/jenkins/jobs');setJobs(result.jobs);setServer(result.server);setError('')}
		catch(e){setError(String(e instanceof Error?e.message:e))}
	},[])

	useEffect(()=>{
		if(!visible)return
		void load()
		const timer=setInterval(()=>void load(),15000)
		return()=>clearInterval(timer)
	},[visible,load])

	const openConsole=useCallback(async(name:string,build:number):Promise<void>=>{
		setConsoleBusy(true);setSelectedBuild(build)
		try{const result=await api<{text:string}>('/api/jenkins/jobs/'+encodeURIComponent(name)+'/builds/'+String(build)+'/console');setConsoleText(result.text)}
		catch(e){setConsoleText('');setError(String(e instanceof Error?e.message:e))}
		finally{setConsoleBusy(false)}
	},[])

	// 选中任务即加载历史,并自动展开最新一次构建(构建中可看实时日志)。
	const openJob=useCallback(async(name:string):Promise<void>=>{
		setSelectedJob(name);setConsoleText('')
		try{
			const result=await api<{builds:JenkinsBuild[]}>('/api/jenkins/jobs/'+encodeURIComponent(name)+'/builds?limit=15')
			setBuilds(result.builds)
			const latest=result.builds[0]
			if(latest!==undefined)await openConsole(name,latest.number)
		}
		catch(e){setError(String(e instanceof Error?e.message:e))}
	},[openConsole])

	return <div className="jk-root">
		<header className="jk-toolbar">
			<div><small>CONTINUOUS INTEGRATION</small><strong>Jenkins 构建</strong></div>
			<code>{server}</code>
			<span className="jk-flex"/>
			<span className="jk-refresh">{jobs.length} 个任务 · 每 15 秒刷新</span>
		</header>
		{error.length>0&&<div className="jk-error" role="alert">{error}{error.includes('未配置')&&<p>在服务端设置 LAB_JENKINS_USER / LAB_JENKINS_TOKEN,或创建 jenkins.local.json(不进 Git)。</p>}</div>}
		<div className="jk-main">
			<section className="jk-jobs" aria-label="Jenkins 任务列表">
				<div className="jk-col-head"><strong>任务</strong><small>点击加载构建历史</small></div>
				{jobs.length===0&&error.length===0&&<div className="jk-empty"><b>暂无任务</b><p>该账号在此 Jenkins 上没有可见任务。</p></div>}
				{jobs.map((job)=>{const state=jobState(job);const active=selectedJob===job.name;return(
					<button key={job.name} className={'jk-job'+(active?' active':'')} onClick={()=>void openJob(job.name)}>
						<span className={'jk-dot '+state.cls}/>
						<span className="jk-job-name">{job.name}</span>
						<span className="jk-job-build">#{String(job.lastBuild?.number??'—')}</span>
						<span className={'jk-job-state '+state.cls}>{state.label}</span>
					</button>
				)})}
			</section>
			<section className="jk-builds-col" aria-label="构建历史">
				<div className="jk-col-head"><strong>{selectedJob===undefined?'构建历史':selectedJob}</strong><small>最近 {builds.length} 次</small></div>
				<div className="jk-builds">
					{selectedJob===undefined||builds.length===0
						?<div className="jk-empty"><b>{selectedJob===undefined?'未选择任务':'暂无构建记录'}</b><p>在左侧选择任务后,这里按时间倒序列出最近构建。</p></div>
						:builds.map((build)=>(
							<button key={build.number} className={'jk-build'+(selectedBuild===build.number?' active':'')} onClick={()=>void openConsole(selectedJob,build.number)}>
								<span className="jk-build-top"><b>#{String(build.number)}</b><span className={'jk-dot '+resultClass(build)}/><code>{resultLabel(build)}</code></span>
								<span className="jk-build-sub"><time>{timeText(build.timestamp)}</time><small>{durationText(build.duration)}</small></span>
							</button>
						))}
				</div>
			</section>
			<section className="jk-console-wrap" aria-label="控制台日志">
				<div className="jk-console-head">
					<strong>{selectedJob===undefined||selectedBuild===undefined?'控制台':selectedJob+' #'+String(selectedBuild)}</strong>
					<span>{consoleBusy?'读取中…':consoleText.length>0?consoleText.length+' 字符(尾部)':''}</span>
				</div>
				<pre className="jk-console">{consoleText}</pre>
			</section>
		</div>
	</div>
}
