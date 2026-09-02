import { useEffect, useState } from 'react'

export type Phase='queued'|'local-to-jump'|'jump-to-switch'|'switch-to-jump'|'ready-to-download'|'complete'|'failed'|'cancelled'
export interface TransferTask{id:string;direction:'upload'|'download';switchId:string;sourcePath:string;destinationPath:string;fileName:string;totalBytes:number;transferredBytes:number;speedBytesPerSecond:number;phase:Phase;createdAt:number;error?:string;downloadReady?:boolean}

export const PHASE_TEXT:Record<Phase,string>={queued:'等待中','local-to-jump':'本地 → 跳板机','jump-to-switch':'跳板机 → 交换机','switch-to-jump':'交换机 → 跳板机','ready-to-download':'正在保存到本地',complete:'已完成',failed:'失败',cancelled:'已取消'}
export const bytes=(value:number):string=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':value<1073741824?(value/1048576).toFixed(1)+' MB':(value/1073741824).toFixed(2)+' GB'

let tasks:TransferTask[]=[]
let uploadPercent:Record<string,number>={}
const listeners=new Set<()=>void>()
const savedIds=new Set<string>()
let timer:ReturnType<typeof setInterval>|undefined
let inflight=false

const emit=():void=>{for(const fn of listeners)fn()}

const saveNow=(task:TransferTask):void=>{
  if(savedIds.has(task.id))return
  savedIds.add(task.id)
  location.href='/api/files/me/transfers/'+task.id+'/download'
}

export const refreshQueue=async():Promise<void>=>{
  if(inflight)return
  inflight=true
  try{
    const response=await fetch('/api/files/me/transfers',{headers:{accept:'application/json'}})
    if(!response.ok)return
    const value=await response.json() as {transfers?:TransferTask[]}
    const next=value.transfers??[]
    let changed=JSON.stringify(next)!==JSON.stringify(tasks)
    for(const task of next){
      if(task.phase==='ready-to-download'&&!savedIds.has(task.id)){saveNow(task);changed=true}
    }
    tasks=next
    if(changed)emit()
  }catch{}finally{inflight=false}
}

export function subscribeQueue(fn:()=>void):()=>void{
  listeners.add(fn)
  if(timer===undefined){void refreshQueue();timer=setInterval(()=>{void refreshQueue()},900)}
  return()=>{
    listeners.delete(fn)
    if(listeners.size===0&&timer!==undefined){clearInterval(timer);timer=undefined}
  }
}

export const setUploadProgress=(id:string,percent:number):void=>{uploadPercent={...uploadPercent,[id]:percent};emit()}
export const getTasks=():TransferTask[]=>tasks
export const percentOf=(id:string):number=>uploadPercent[id]??0
export const saveTask=saveNow

export async function cancelTask(id:string):Promise<void>{
  await fetch('/api/files/me/transfers/'+id+'/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
  void refreshQueue()
}

export async function retryDownloadTask(task:TransferTask):Promise<void>{
  await fetch('/api/files/me/transfers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({direction:'download',switchId:task.switchId,remotePath:task.sourcePath})})
  void refreshQueue()
}

/** Shared queue state for every view that shows transfers (browser + bottom dock). */
export function useTransferQueue():{tasks:TransferTask[];percentOf:(id:string)=>number}{
  const [,bump]=useState(0)
  useEffect(()=>subscribeQueue(()=>bump((n)=>n+1)),[])
  return{tasks:getTasks(),percentOf}
}
