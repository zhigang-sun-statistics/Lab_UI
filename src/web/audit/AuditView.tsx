import { useCallback, useEffect, useState } from 'react'
import './audit.css'

interface AuditSessionMeta{id:string;username:string;switchId:string;startedAt:number;endedAt?:number;bytesIn:number;bytesOut:number;outputCapped:boolean;closed:boolean}
interface AuditEvent{at:number;k:'open'|'in'|'out'|'cap'|'close';d?:string}

const api=async <T,>(url:string):Promise<T>=>{const response=await fetch(url,{headers:{accept:'application/json'}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??('HTTP '+String(response.status)));return value}
const timeText=(ms:number):string=>new Date(ms).toLocaleString()
const bytesText=(n:number):string=>n<1024?String(n)+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'
const durText=(from:number,to?:number):string=>to===undefined?'进行中':((to-from)/1000<60?Math.round((to-from)/1000)+' 秒':Math.round((to-from)/60000)+' 分钟')

export function AuditView({ visible }: { visible: boolean }): JSX.Element {
	const [sessions,setSessions]=useState<AuditSessionMeta[]>([])
	const [error,setError]=useState('')
	const [selectedId,setSelectedId]=useState<string>()
	const [detail,setDetail]=useState<{meta:AuditSessionMeta;events:AuditEvent[]}>()
	const [showOutput,setShowOutput]=useState(false)

	const load=useCallback(async():Promise<void>=>{
		try{const result=await api<{sessions:AuditSessionMeta[]}>('/api/audit/sessions?limit=100');setSessions(result.sessions);setError('')}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[])

	const open=useCallback(async(id:string):Promise<void>=>{
		setSelectedId(id);setShowOutput(false)
		try{const kinds=showOutput?undefined:'open,in,close,cap'
			setDetail(await api<{meta:AuditSessionMeta;events:AuditEvent[]}>('/api/audit/sessions/'+id+(kinds===undefined?'':'?kinds='+encodeURIComponent(kinds))))}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[showOutput])

	useEffect(()=>{if(!visible)return;void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer)},[visible,load])

	const reopen=useCallback(async():Promise<void>=>{if(selectedId===undefined)return
		const kinds=showOutput?undefined:'open,in,close,cap'
		try{setDetail(await api<{meta:AuditSessionMeta;events:AuditEvent[]}>('/api/audit/sessions/'+selectedId+(kinds===undefined?'':'?kinds='+encodeURIComponent(kinds))))}catch(e){setError(String(e instanceof Error?e.message:e))}
	},[selectedId,showOutput])

	return <div className="au-root">
		<header className="au-toolbar">
			<div><small>SSH SESSION AUDIT</small><strong>会话审计</strong></div>
			<span className="au-flex"/>
			<span className="au-note">{sessions.length} 个会话 · 记录保留 30 天 · 每 30 秒刷新</span>
		</header>
		{error.length>0&&<div className="au-error" role="alert">{error}</div>}
		<div className="au-list" role="table" aria-label="SSH 会话列表">
			<div className="au-row au-head" role="row"><span>时间</span><span>用户</span><span>交换机</span><span>时长</span><span>输入</span><span>输出</span><span>状态</span><span></span></div>
			{sessions.length===0&&error.length===0?<div className="au-empty">暂无会话记录。打开任意 SSH 终端后会自动记录。</div>
			:sessions.map((session)=>(
				<div key={session.id} role="row" className={'au-row'+(selectedId===session.id?' active':'')}>
					<span>{timeText(session.startedAt)}</span>
					<span><b>{session.username}</b></span>
					<span><code>{session.switchId.toUpperCase()}</code></span>
					<span>{durText(session.startedAt,session.endedAt)}</span>
					<span>{bytesText(session.bytesIn)}</span>
					<span>{bytesText(session.bytesOut)}{session.outputCapped?' ·截断':''}</span>
					<span>{session.closed?'已结束':'进行中'}</span>
					<span><button className="au-view" onClick={()=>{void open(session.id)}}>查看</button></span>
				</div>
			))}
		</div>
		{detail!==undefined&&(
			<section className="au-detail" aria-label="会话详情">
				<header>
					<div><small>SESSION TIMELINE</small><strong>{detail.meta.username} @ {detail.meta.switchId.toUpperCase()} · {timeText(detail.meta.startedAt)}</strong></div>
					<label className="au-toggle"><input type="checkbox" checked={showOutput} onChange={()=>{setShowOutput(!showOutput);void reopen()}}/>包含终端输出</label>
				</header>
				<div className="au-events">
					{detail.events.map((event,index)=>(
						<div key={String(index)} className={'au-event au-'+event.k}>
							<time>{new Date(event.at).toLocaleTimeString()}</time>
							<span className="au-kind">{event.k==='in'?'输入':event.k==='out'?'输出':event.k==='open'?'打开':event.k==='cap'?'截断':'关闭'}</span>
							<pre>{event.d ?? ''}</pre>
						</div>
					))}
					{detail.events.length===0&&<div className="au-empty">该会话暂无{showOutput?'事件':'输入'}记录。</div>}
				</div>
			</section>
		)}
	</div>
}
