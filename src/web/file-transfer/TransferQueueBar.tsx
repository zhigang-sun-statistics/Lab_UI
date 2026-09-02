import { useState } from 'react'
import { PHASE_TEXT, bytes, cancelTask, percentOf, retryDownloadTask, saveTask, useTransferQueue } from './queue-store.ts'

const ACTIVE:PhaseLike[]=['queued','local-to-jump','jump-to-switch','switch-to-jump','ready-to-download']
type PhaseLike='queued'|'local-to-jump'|'jump-to-switch'|'switch-to-jump'|'ready-to-download'|'complete'|'failed'|'cancelled'

/** Bottom-docked transfer queue, rendered under the whole device workspace. */
export function TransferQueueBar():JSX.Element|null{
  const {tasks}=useTransferQueue()
  const [open,setOpen]=useState(false)
  if(tasks.length===0)return null
  const active=tasks.filter((task)=>!['complete','failed','cancelled'].includes(task.phase))
  const overall=active.length>0?Math.round(active.reduce((sum,task)=>sum+Math.min(100,task.totalBytes?task.transferredBytes/task.totalBytes*100:percentOf(task.id)),0)/active.length):null
  const latest=active[0]??tasks[0]
  const status=active.length>0
    ?String(active.length)+' 个进行中'+(latest!==undefined?' · '+latest.fileName:'')+(overall!==null?' · '+String(overall)+'%':'')
    :'空闲 · 最近 '+(latest!==undefined?latest.fileName:'')
  return <section className={'ft-dock'+(open?' open':'')} aria-label="传输队列">
    <header>
      <button className="ft-dock-toggle" aria-expanded={open} aria-label={open?'收起传输队列':'展开传输队列'} onClick={()=>setOpen(!open)}><i/>{open?'▾':'▴'}</button>
      <strong>传输队列</strong>
      <span className="ft-dock-status">{status}</span>
      <span className="ft-flex"/>
      {overall!==null&&<code className="ft-dock-percent">{String(overall)}%</code>}
    </header>
    {open&&<div className="ft-dock-list">
      {tasks.slice(0,30).map((task)=>{
        const percent=task.totalBytes?Math.min(100,task.transferredBytes/task.totalBytes*100):percentOf(task.id)
        return <article key={task.id} className={task.phase}>
          <span className="ft-dir">{task.direction==='upload'?'↑':'↓'}</span>
          <b>{task.fileName}</b>
          <small>{task.switchId.toUpperCase()} · {PHASE_TEXT[task.phase]}{task.error?' · '+task.error:''}{task.speedBytesPerSecond>0?' · '+bytes(task.speedBytesPerSecond)+'/s':''}</small>
          <div className="ft-bar"><i style={{width:percent+'%'}}/></div>
          <code>{percent.toFixed(0)}%</code>
          {task.phase==='ready-to-download'?<button className="ft-dock-btn" aria-label={'立即保存 '+task.fileName} onClick={()=>saveTask(task)}>保存</button>
            :task.phase==='failed'&&task.direction==='download'?<button className="ft-dock-btn" aria-label={'重试 '+task.fileName} onClick={()=>{void retryDownloadTask(task)}}>↻</button>
            :ACTIVE.includes(task.phase)?<button className="ft-dock-btn" aria-label={'取消传输 '+task.fileName} onClick={()=>{void cancelTask(task.id)}}>×</button>
            :<em className="ft-done">✓</em>}
        </article>
      })}
    </div>}
  </section>
}
