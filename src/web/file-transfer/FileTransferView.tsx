import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './file-transfer.css'
import { bytes, refreshQueue, setUploadProgress, type TransferTask } from './queue-store.ts'

interface SwitchItem{id:string;name:string;ip:string}
interface RemoteEntry{name:string;path:string;type:'file'|'directory'|'link'|'other';size:number;modifiedAt:number;permissions:number}
interface RemoteListing{path:string;parent:string;entries:RemoteEntry[]}
type Pane='local'|'remote'

const MAX_TOTAL_BYTES=2*1024*1024*1024
const api=async <T,>(url:string,init?:RequestInit):Promise<T>=>{const response=await fetch(url,{...init,headers:{'content-type':'application/json',...(init?.headers??{})}});const value=await response.json().catch(()=>({error:'请求失败'})) as T&{error?:string};if(!response.ok)throw new Error(value.error??'请求失败');return value}

const Icon=({kind}:{kind:'file'|'folder'|'up'|'refresh'|'newFolder'|'upload'|'download'|'close'}):JSX.Element=>{
  const paths:Record<string,JSX.Element>={file:<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></>,folder:<><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/></>,up:<><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></>,refresh:<><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></>,newFolder:<><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/><path d="M12 14h4m-2-2v4"/></>,upload:<><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></>,download:<><path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/></>,close:<><path d="M18 6 6 18M6 6l12 12"/></>}
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>
}

interface LocalItem{name:string;path:string;type:'file'|'directory';file?:File;size:number;modifiedAt:number}
const buildLocalTree=(files:File[],current:string):LocalItem[]=>{
  const prefix=current===''?'':current+'/'
  const dirs=new Map<string,LocalItem>()
  const output:LocalItem[]=[]
  for(const file of files){
    const full=(file.webkitRelativePath||file.name).replace(/\\/g,'/')
    if(!full.startsWith(prefix))continue
    const rest=full.slice(prefix.length)
    const slash=rest.indexOf('/')
    if(slash>=0){const name=rest.slice(0,slash);if(!dirs.has(name))dirs.set(name,{name,path:prefix+name,type:'directory',size:0,modifiedAt:0});continue}
    output.push({name:rest,path:full,type:'file',file,size:file.size,modifiedAt:file.lastModified})
  }
  return[...dirs.values(),...output.sort((a,b)=>a.name.localeCompare(b.name))]
}

const PATH_STORE='ft:remotePaths'
const readPaths=():Record<string,string>=>{try{return JSON.parse(localStorage.getItem(PATH_STORE)??'{}') as Record<string,string>}catch{return{}}}

export function FileTransferView():JSX.Element{
  const [switches,setSwitches]=useState<SwitchItem[]>([])
  const [switchId,setSwitchId]=useState('sw1')
  const [pane,setPane]=useState<Pane>('remote')
  const [remote,setRemote]=useState<RemoteListing>({path:'/home/admin',parent:'/home/admin',entries:[]})
  const [remoteBusy,setRemoteBusy]=useState(false)
  const [remoteSelected,setRemoteSelected]=useState<Set<string>>(new Set())
  const [localFiles,setLocalFiles]=useState<File[]>([])
  const [localPath,setLocalPath]=useState('')
  const [localSelected,setLocalSelected]=useState<Set<string>>(new Set())
  const [error,setError]=useState('')
  const filesRef=useRef<HTMLInputElement>(null)
  const folderRef=useRef<HTMLInputElement>(null)

  const localEntries=useMemo(()=>buildLocalTree(localFiles,localPath),[localFiles,localPath])
  const uploadTarget=useMemo(()=>readPaths()[switchId]??'/home/admin',[switchId])
  const selectedUploads=useMemo(()=>localEntries.filter((item)=>item.type==='file'&&(localSelected.size===0||localSelected.has(item.path))),[localEntries,localSelected])
  const selectedDownloads=useMemo(()=>remote.entries.filter((entry)=>entry.type==='file'&&remoteSelected.has(entry.path)),[remote,remoteSelected])
  const selectedUploadBytes=selectedUploads.reduce((sum,item)=>sum+(item.file?.size??0),0)

  const loadRemote=useCallback(async(path:string,nextSwitch:string):Promise<void>=>{
    setRemoteBusy(true);setError('')
    try{
      setRemote(await api<RemoteListing>('/api/files/me/remote?switch='+encodeURIComponent(nextSwitch)+'&path='+encodeURIComponent(path)))
      setRemoteSelected(new Set())
      const store=readPaths();store[nextSwitch]=path;localStorage.setItem(PATH_STORE,JSON.stringify(store))
    }catch(e){setError(String(e instanceof Error?e.message:e))}finally{setRemoteBusy(false)}
  },[])

  useEffect(()=>{
    void api<{switches:SwitchItem[]}>('/api/files/me/switches').then((result)=>{
      setSwitches(result.switches)
      const first=result.switches[0]?.id??'sw1'
      setSwitchId(first)
      void loadRemote(readPaths()[first]??'/home/admin',first)
    }).catch((e)=>setError(String(e)))
    void refreshQueue()
  },[loadRemote])

  const addFiles=(list:File[]):void=>{
    setLocalFiles((old)=>{const map=new Map(old.map((f)=>[(f.webkitRelativePath||f.name)+'|'+f.size,f]));for(const file of list)map.set((file.webkitRelativePath||file.name)+'|'+file.size,file);return Array.from(map.values())})
    setLocalPath('');setLocalSelected(new Set())
  }

  const uploadOne=async(file:File,relativeName?:string):Promise<void>=>{
    const fileName=(relativeName??file.name).split('/').at(-1)??file.name
    const task=await api<TransferTask>('/api/files/me/transfers',{method:'POST',body:JSON.stringify({direction:'upload',switchId,remoteDirectory:uploadTarget,fileName,size:file.size,overwrite:false})})
    await new Promise<void>((resolveUpload,reject)=>{
      const xhr=new XMLHttpRequest()
      xhr.open('PUT','/api/files/me/transfers/'+task.id+'/content')
      xhr.upload.onprogress=(event)=>{if(event.lengthComputable)setUploadProgress(task.id,event.loaded/event.total*100)}
      xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolveUpload():reject(new Error('上传到跳板机失败'))
      xhr.onerror=()=>reject(new Error('上传连接失败'))
      xhr.send(file)
    })
    void refreshQueue()
  }

  const uploadSelected=async():Promise<void>=>{
    setError('')
    if(selectedUploads.length===0){setError('请先在本地栏选择要上传的文件');return}
    if(selectedUploadBytes>MAX_TOTAL_BYTES){setError('单次传输总量不能超过 2 GB(当前 '+bytes(selectedUploadBytes)+'),请分批上传');return}
    try{for(const item of selectedUploads)if(item.file)await uploadOne(item.file,item.path)}
    catch(e){setError(String(e instanceof Error?e.message:e))}
  }

  const downloadSelected=async():Promise<void>=>{
    setError('')
    if(selectedDownloads.length===0){setError('请先勾选要下载的远程文件');return}
    try{for(const entry of selectedDownloads)await api('/api/files/me/transfers',{method:'POST',body:JSON.stringify({direction:'download',switchId,remotePath:entry.path})});setRemoteSelected(new Set());void refreshQueue()}
    catch(e){setError(String(e instanceof Error?e.message:e))}
  }

  const mkdirRemote=async():Promise<void>=>{
    const name=window.prompt('在 '+remote.path+' 下新建文件夹：')
    if(!name)return
    try{await api('/api/files/me/remote/directories',{method:'POST',body:JSON.stringify({switchId,parent:remote.path,name})});await loadRemote(remote.path,switchId)}
    catch(e){setError(String(e instanceof Error?e.message:e))}
  }

  const crumbs=remote.path==='/'?['/']:['/',...remote.path.split('/').filter(Boolean)]
  const selectedSwitch=switches.find((item)=>item.id===switchId)

  return <div className="ft-root">
    <header className="ft-toolbar">
      <div className="ft-seg" role="tablist" aria-label="文件浏览位置">
        <button role="tab" aria-selected={pane==='local'} className={pane==='local'?'active':''} onClick={()=>setPane('local')}>本地文件</button>
        <button role="tab" aria-selected={pane==='remote'} className={pane==='remote'?'active':''} onClick={()=>setPane('remote')}>{switchId.toUpperCase()} 文件系统</button>
      </div>
      <label className="ft-switch"><span>设备</span>
        <select value={switchId} onChange={(event)=>{const next=event.target.value;setSwitchId(next);void loadRemote(readPaths()[next]??'/home/admin',next)}} aria-label="目标交换机">
          {switches.map((item)=><option key={item.id} value={item.id}>{item.id.toUpperCase()} · {item.ip}</option>)}
        </select>
      </label>
      <span className="ft-live"><i/>{selectedSwitch?selectedSwitch.ip:'连接中'}</span>
    </header>

    <section className="ft-browser" aria-label={pane==='local'?'本地授权文件':'交换机文件系统'}>
      {pane==='local'?(
        <>
          <div className="ft-crumbs">
            <button className="ft-ghost" disabled={localPath===''} aria-label="返回本地上一级" onClick={()=>setLocalPath(localPath.split('/').slice(0,-1).join('/'))}><Icon kind="up"/></button>
            <code>{localPath||'已选择的本地文件'}</code>
            <span className="ft-flex"/>
            <button className="ft-ghost" onClick={()=>filesRef.current?.click()}><Icon kind="file"/>选择文件</button>
            <button className="ft-ghost" onClick={()=>folderRef.current?.click()}><Icon kind="folder"/>选择文件夹</button>
            {localFiles.length>0&&<button className="ft-ghost" onClick={()=>{setLocalFiles([]);setLocalPath('');setLocalSelected(new Set())}}><Icon kind="close"/>清空</button>}
          </div>
          <input ref={filesRef} hidden multiple type="file" onChange={(event)=>{addFiles(Array.from(event.target.files??[]));event.target.value=''}}/>
          <input ref={folderRef} hidden multiple type="file" {...({webkitdirectory:'',directory:''} as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event)=>{addFiles(Array.from(event.target.files??[]));event.target.value=''}}/>
          <div className="ft-list" onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();addFiles(Array.from(event.dataTransfer.files))}}>
            {localEntries.length===0
              ?<div className="ft-empty"><b>选择或拖入本地文件</b><p>支持文件与整个文件夹;WSL 路径可通过 Windows 选择器的 \\\\wsl.localhost 访问。</p></div>
              :localEntries.map((item)=>(
                <button key={item.path} className={localSelected.has(item.path)?'selected':''} onClick={()=>item.type==='file'&&setLocalSelected((old)=>{const next=new Set(old);next.has(item.path)?next.delete(item.path):next.add(item.path);return next})} onDoubleClick={()=>item.type==='directory'&&setLocalPath(item.path)}>
                  <span className="ft-name"><i className={item.type}/>{item.name}</span>
                  <code>{item.type==='file'?bytes(item.size):'—'}</code>
                  <time>{item.modifiedAt?new Date(item.modifiedAt).toLocaleString():'—'}</time>
                </button>
              ))}
          </div>
          <footer className="ft-actionbar">
            <span>{localFiles.length} 个文件 · 已选 {selectedUploads.length} 个{selectedUploads.length>0?' · '+bytes(selectedUploadBytes):''}</span>
            <button className="ft-primary" disabled={selectedUploads.length===0} onClick={()=>void uploadSelected()}><Icon kind="upload"/>上传到 {switchId.toUpperCase()}:{uploadTarget}</button>
          </footer>
        </>
      ):(
        <>
          <div className="ft-crumbs">
            <button className="ft-ghost" disabled={remote.parent===remote.path||remoteBusy} aria-label="返回远程上一级" onClick={()=>void loadRemote(remote.parent,switchId)}><Icon kind="up"/></button>
            <code className="ft-path" aria-label="远程路径">{crumbs.map((part,index)=><span key={String(index)}>{index===0&&crumbs.length>1?'/ ':part}{index<crumbs.length-1?'/':''}</span>)}</code>
            <span className="ft-flex"/>
            <button className="ft-ghost" disabled={remoteBusy} onClick={()=>void loadRemote(remote.path,switchId)} aria-label="刷新远程列表"><Icon kind="refresh"/></button>
            <button className="ft-ghost" onClick={()=>void mkdirRemote()}><Icon kind="newFolder"/>新建目录</button>
          </div>
          <div className={'ft-list'+(remoteBusy?' loading':'')}>
            {remote.entries.length===0
              ?<div className="ft-empty"><b>{remoteBusy?'正在读取目录…':'目录为空'}</b><p>双击文件夹进入;勾选文件后从底部下载,完成即自动保存。</p></div>
              :remote.entries.map((entry)=>(
                <button key={entry.path} className={remoteSelected.has(entry.path)?'selected':''} onClick={()=>entry.type==='file'&&setRemoteSelected((old)=>{const next=new Set(old);next.has(entry.path)?next.delete(entry.path):next.add(entry.path);return next})} onDoubleClick={()=>entry.type==='directory'?void loadRemote(entry.path,switchId):void downloadSelected()}>
                  <span className="ft-name"><i className={entry.type==='directory'?'directory':'file'}/>{entry.name}</span>
                  <code>{entry.type==='file'?bytes(entry.size):'—'}</code>
                  <time>{entry.modifiedAt?new Date(entry.modifiedAt).toLocaleString():'—'}</time>
                </button>
              ))}
          </div>
          <footer className="ft-actionbar">
            <span>{remote.entries.length} 项 · 已选 {selectedDownloads.length} 个</span>
            <button className="ft-primary" disabled={selectedDownloads.length===0} onClick={()=>void downloadSelected()}><Icon kind="download"/>下载选中(自动保存)</button>
          </footer>
        </>
      )}
    </section>

    {error.length>0&&<button className="ft-error" role="alert" aria-label="关闭错误提示" onClick={()=>setError('')}>{error} ×</button>}
  </div>
}
