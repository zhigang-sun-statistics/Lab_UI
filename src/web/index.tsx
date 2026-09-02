import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LabView } from '../client/LabView.tsx'
import { StyleInjector } from '../client/StyleInjector.tsx'
import { SshTerminal, type SshConnectionState } from '../ssh/SshTerminal.tsx'
import { AgentView } from './agent/AgentView.tsx'
import { FileTransferView } from './file-transfer/FileTransferView.tsx'
import { TransferQueueBar } from './file-transfer/TransferQueueBar.tsx'
import './web.css'
import './pro-max.css'

const TabIcon = ({ kind }: { kind: 'topology' | 'agent' | 'files' | 'ssh' }): JSX.Element => {
  const paths = {
    topology: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3h6m6-3v3h-6v3"/></>,
    agent: <><path d="m12 3 2.1 4.9L19 10l-4.9 2.1L12 17l-2.1-4.9L5 10l4.9-2.1L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></>,
    files: <><path d="M7 7h11l3 3v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3"/><path d="M8 13h8m-2-2 2 2-2 2"/></>,
    ssh: <><path d="m5 7 4 4-4 4"/><path d="M12 17h7"/></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>
}

const MiniRack = (): JSX.Element => <div className="web-rack"><div className="web-rack-head"><i /> SW1 · 10.13.33.164 <span>ONLINE</span></div><div className="web-rack-face"><b>SYS</b><div className="web-rack-ports">{Array.from({ length: 32 }, (_, port) => <i key={port} className={port === 0 || port === 6 || port === 22 || port === 28 ? 'active' : ''}><em>{port}</em></i>)}</div></div><div className="web-rack-link"><span>Ethernet28</span><strong>LLDP</strong><span>SW3 · Ethernet6</span></div></div>

function Login({ onLogin }: { onLogin: (name: string) => void }): JSX.Element {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const login = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/lab/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password }) })
      if (!response.ok) { const result = await response.json().catch(() => ({ error: '账号或密码错误' })) as { error?: string }; setError(result.error ?? '账号或密码错误'); return }
      onLogin(name)
    } catch { setError('无法连接设备管理服务，请检查服务是否启动') } finally { setBusy(false) }
  }
  return <main className="web-login"><StyleInjector /><div className="web-login-grid"><section className="web-login-visual"><div className="web-brand"><span className="web-brand-mark">L</span><div><strong>SONiC LAB</strong><small>NETWORK OPERATIONS</small></div></div><div className="web-visual-copy"><div className="web-kicker">PHYSICAL CONTROL SURFACE</div><h1>看见每一条链路，<br />掌握每一个端口。</h1><p>面向 Centec SONiC 实验室的交换机状态与链路控制台。</p></div><MiniRack /><div className="web-visual-foot"><span><i className="ok" />4 台设备</span><span><i className="ok" />128 个端口</span><span><i />局域网模式</span></div></section><section className="web-login-panel"><div className="web-login-card"><div className="web-kicker">AUTHORIZED ACCESS</div><h2>进入设备管理</h2><p>使用 ZNSL 跳板机账号登录控制台。</p><label><span>账号</span><input autoFocus list="lab-users" autoComplete="username" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /><datalist id="lab-users">{['wsy','lfx','fjj','yyh','zyh','szg','dj','fdk','ychan','dcc','sxx'].map((user) => <option key={user} value={user} />)}</datalist></label><label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /></label>{error.length > 0 && <div className="web-login-error" role="alert">{error}</div>}<button className="web-login-submit" disabled={busy} onClick={() => { void login() }}><span>{busy ? '正在连接…' : '进入控制台'}</span><b>→</b></button><div className="web-login-note"><span>ZNSL · 192.168.210.244</span><code>初始密码 = 用户名</code></div></div></section></div></main>
}

interface SshTab { id: string; switchId: string; index: number }

function WebApp(): JSX.Element {
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [sshTabs, setSshTabs] = useState<SshTab[]>([])
  const [activeTab, setActiveTab] = useState('topology')
  const [sshStatus, setSshStatus] = useState<Record<string, SshConnectionState>>({})
  const updateSshStatus = useCallback((tabId: string, state: SshConnectionState): void => { setSshStatus((current) => ({ ...current, [tabId]: state })) }, [])
  const sshInstanceCounts = useMemo(() => sshTabs.reduce<Record<string, number>>((counts, tab) => ({ ...counts, [tab.switchId]: (counts[tab.switchId] ?? 0) + 1 }), {}), [sshTabs])
  useEffect(() => { void fetch('/api/lab/session').then(async (response) => { if (response.ok) { const session = await response.json() as { username: string }; setUser(session.username) } }).finally(() => setChecking(false)) }, [])
  if (checking) return <div className="web-boot"><span className="web-brand-mark">L</span><p>正在连接设备管理服务…</p></div>
  if (user === null) return <Login onLogin={setUser} />
  const logout = async (): Promise<void> => { setSshTabs([]); setSshStatus({}); setActiveTab('topology'); await fetch('/api/lab/logout', { method: 'POST' }); setUser(null) }
  const addSsh = (switchId: string): void => { const index = Math.max(0, ...sshTabs.filter((tab) => tab.switchId === switchId).map((tab) => tab.index)) + 1; const tab = { id: switchId + ':' + index, switchId, index }; setSshTabs((tabs) => [...tabs, tab]); setActiveTab(tab.id) }
  const openSsh = (switchId: string): void => { const existing = sshTabs.find((tab) => tab.switchId === switchId); if (existing !== undefined) { setActiveTab(existing.id); return } addSsh(switchId) }
  const closeSsh = (tabId: string): void => { const remaining = sshTabs.filter((tab) => tab.id !== tabId); setSshTabs(remaining); setSshStatus((current) => { const next = { ...current }; delete next[tabId]; return next }); if (activeTab === tabId) setActiveTab(remaining.at(-1)?.id ?? 'topology') }
  return <div className="web-shell"><StyleInjector /><a className="web-skip-link" href="#web-main">跳到主要内容</a><header className="web-header"><div className="web-header-brand"><span className="web-brand-mark small">L</span><div><span className="web-kicker">SONiC LAB / DEVICE MANAGEMENT</span><h1>设备管理</h1></div></div><div className="web-user"><span className="web-live"><i />服务在线</span><code>{user}</code><button onClick={() => { void logout() }}>退出</button></div></header><nav className="web-tabs" aria-label="工作区标签"><button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}><span className="web-tab-icon"><TabIcon kind="topology" /></span>物理拓扑</button><button className={activeTab === 'agent' ? 'active terminal' : 'terminal'} onClick={() => setActiveTab('agent')}><span className="web-tab-icon"><TabIcon kind="agent" /></span>Agent 工作台</button><button className={activeTab === 'files' ? 'active terminal' : 'terminal'} onClick={() => setActiveTab('files')}><span className="web-tab-icon"><TabIcon kind="files" /></span>文件传输</button>{sshTabs.map((tab) => <div key={tab.id} className={activeTab === tab.id ? 'web-tab-item active' : 'web-tab-item'}><button className="web-tab-main terminal" onClick={() => setActiveTab(tab.id)}><span className="web-tab-icon"><TabIcon kind="ssh" /></span>{tab.switchId.toUpperCase()} SSH {tab.index}<span className={'web-tab-status ' + (sshStatus[tab.id] ?? 'connecting')} title={sshStatus[tab.id] === 'connected' ? '已连接' : sshStatus[tab.id] === 'error' ? '连接错误' : sshStatus[tab.id] === 'closed' ? '已断开' : '连接中'} /></button><button className="web-tab-close" aria-label={'关闭并断开 '+tab.switchId.toUpperCase()+' SSH '+tab.index} onClick={() => closeSsh(tab.id)}>×</button></div>)}</nav><main id="web-main" className="web-workspace"><section className={activeTab === 'topology' ? 'web-panel active' : 'web-panel'}><LabView visible={activeTab === 'topology'} showExperiment={false} currentUsername={user} onOpenSsh={openSsh} onAddSsh={addSsh} sshInstanceCounts={sshInstanceCounts} /></section><section className={activeTab === 'agent' ? 'web-panel active' : 'web-panel'}><AgentView /></section><section className={activeTab === 'files' ? 'web-panel active web-panel-files' : 'web-panel web-panel-files'}><FileTransferView /><TransferQueueBar /></section>{sshTabs.map((tab) => <section key={tab.id} className={activeTab === tab.id ? 'web-panel active' : 'web-panel'}><SshTerminal switchId={tab.switchId} onConnectionChange={(state) => updateSshStatus(tab.id, state)} /></section>)}</main></div>
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<WebApp />)
