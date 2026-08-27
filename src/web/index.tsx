import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LabView } from '../client/LabView.tsx'
import { StyleInjector } from '../client/StyleInjector.tsx'
import { SshTerminal, type SshConnectionState } from '../ssh/SshTerminal.tsx'
import './web.css'

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
  return <main className="web-login"><StyleInjector /><div className="web-login-grid"><section className="web-login-visual"><div className="web-brand"><span className="web-brand-mark">L</span><div><strong>SONiC LAB</strong><small>NETWORK OPERATIONS</small></div></div><div className="web-visual-copy"><div className="web-kicker">PHYSICAL CONTROL SURFACE</div><h1>看见每一条链路，<br />掌握每一个端口。</h1><p>面向 Centec SONiC 实验室的交换机状态与链路控制台。</p></div><MiniRack /><div className="web-visual-foot"><span><i className="ok" />4 台设备</span><span><i className="ok" />128 个端口</span><span><i />局域网模式</span></div></section><section className="web-login-panel"><div className="web-login-card"><div className="web-kicker">AUTHORIZED ACCESS</div><h2>进入设备管理</h2><p>使用 ZNSL 跳板机账号登录控制台。</p><label><span>账号</span><input autoFocus list="lab-users" autoComplete="username" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /><datalist id="lab-users">{['wsy','lfx','fjj','yyh','zyh','szg','dj','fdk','ychan','dcc','sxx'].map((user) => <option key={user} value={user} />)}</datalist></label><label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login() }} /></label>{error.length > 0 && <div className="web-login-error">{error}</div>}<button className="web-login-submit" disabled={busy} onClick={() => { void login() }}><span>{busy ? '正在连接…' : '进入控制台'}</span><b>→</b></button><div className="web-login-note"><span>ZNSL · 192.168.210.244</span><code>初始密码 = 用户名</code></div></div></section></div></main>
}

function WebApp(): JSX.Element {
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [sshTabs, setSshTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState('topology')
  const [sshStatus, setSshStatus] = useState<Record<string, SshConnectionState>>({})
  const updateSshStatus = useCallback((switchId: string, state: SshConnectionState): void => { setSshStatus((current) => ({ ...current, [switchId]: state })) }, [])
  useEffect(() => { void fetch('/api/lab/session').then(async (response) => { if (response.ok) { const session = await response.json() as { username: string }; setUser(session.username) } }).finally(() => setChecking(false)) }, [])
  if (checking) return <div className="web-boot"><span className="web-brand-mark">L</span><p>正在连接设备管理服务…</p></div>
  if (user === null) return <Login onLogin={setUser} />
  const logout = async (): Promise<void> => { setSshTabs([]); setSshStatus({}); setActiveTab('topology'); await fetch('/api/lab/logout', { method: 'POST' }); setUser(null) }
  const openSsh = (switchId: string): void => { setSshTabs((tabs) => tabs.includes(switchId) ? tabs : [...tabs, switchId]); setActiveTab(switchId) }
  const closeSsh = (switchId: string): void => { setSshTabs((tabs) => tabs.filter((id) => id !== switchId)); setSshStatus((current) => { const next = { ...current }; delete next[switchId]; return next }); if (activeTab === switchId) setActiveTab('topology') }
  return <div className="web-shell"><StyleInjector /><header className="web-header"><div className="web-header-brand"><span className="web-brand-mark small">L</span><div><span className="web-kicker">SONiC LAB / DEVICE MANAGEMENT</span><h1>设备管理</h1></div></div><div className="web-user"><span className="web-live"><i />服务在线</span><code>{user}</code><button onClick={() => { void logout() }}>退出</button></div></header><nav className="web-tabs"><button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}><span className="web-tab-icon">⌘</span>物理拓扑</button>{sshTabs.map((switchId) => <button key={switchId} className={activeTab === switchId ? 'active terminal' : 'terminal'} onClick={() => setActiveTab(switchId)}><span className="web-tab-icon">›_</span>{switchId.toUpperCase()} SSH <span className={'web-tab-status ' + (sshStatus[switchId] ?? 'connecting')} title={sshStatus[switchId] === 'connected' ? '已连接' : sshStatus[switchId] === 'error' ? '连接错误' : sshStatus[switchId] === 'closed' ? '已断开' : '连接中'} /><i onClick={(event) => { event.stopPropagation(); closeSsh(switchId) }} title="关闭并断开 SSH">×</i></button>)}</nav><main className="web-workspace"><section className={activeTab === 'topology' ? 'web-panel active' : 'web-panel'}><LabView visible={activeTab === 'topology'} showExperiment={false} onOpenSsh={openSsh} /></section>{sshTabs.map((switchId) => <section key={switchId} className={activeTab === switchId ? 'web-panel active' : 'web-panel'}><SshTerminal switchId={switchId} onConnectionChange={(state) => updateSshStatus(switchId, state)} /></section>)}</main></div>
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<WebApp />)
