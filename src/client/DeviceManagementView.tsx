import { useCallback, useEffect, useMemo, useState } from 'react'
import { LabView } from './LabView.tsx'
import { StyleInjector } from './StyleInjector.tsx'
import { FileTransferView } from '../web/file-transfer/FileTransferView.tsx'
import { JenkinsView } from '../web/jenkins/JenkinsView.tsx'
import { TransferQueueBar } from '../web/file-transfer/TransferQueueBar.tsx'
import { SshTerminal, type SshConnectionState } from '../ssh/SshTerminal.tsx'
import './device-management.css'

interface SshTab { id: string; switchId: string; index: number }
type ActiveTab = 'topology' | 'ssh' | 'files' | 'ci' | string

interface ActualUser { username: string; switchId: string; source: 'lab-ssh' | 'swkit-lock'; sessionCount: number; startedAt?: number; clientIp?: string }

/** Switch SSH launcher cards: one per lab switch, with live actual users. */
function SshGrid({ visible, onOpen }: { visible: boolean; onOpen: (switchId: string) => void }): JSX.Element {
	const [switches, setSwitches] = useState<Array<{ id: string; name: string; ip: string }>>([])
	const [users, setUsers] = useState<Record<string, ActualUser[]>>({})
	useEffect(() => {
		if (!visible) return
		let alive = true
		const load = async (): Promise<void> => {
			try {
				const switchList = await fetch('/api/files/me/switches').then((r) => r.json()) as { switches?: Array<{ id: string; name: string; ip: string }> }
				const usage = await fetch('/api/lab/actual-usage').then((r) => r.json()) as { switches?: Record<string, ActualUser[]> }
				if (!alive) return
				setSwitches(switchList.switches ?? [])
				setUsers(usage.switches ?? {})
			} catch { /* keep last snapshot */ }
		}
		void load()
		const timer = setInterval(() => { void load() }, 10_000)
		return () => { alive = false; clearInterval(timer) }
	}, [visible])
	return <div className="dm-ssh-grid" aria-label="交换机 SSH 入口">
		{switches.map((sw) => {
			const list = users[sw.id] ?? []
			return <button key={sw.id} className="dm-ssh-card" onClick={() => onOpen(sw.id)}>
				<header><span className="dm-ssh-badge">SSH</span><strong>{sw.id.toUpperCase()}</strong><code>{sw.ip}</code></header>
				<div className="dm-ssh-users">
					{list.length === 0 ? <small>当前无使用者</small> : list.map((item) => <span key={item.source + ':' + item.username} className="dm-ssh-user" title={item.source === 'lab-ssh' ? 'Lab_UI SSH 会话' : 'centec-swkit 锁'}><i />{item.username}{item.sessionCount > 1 ? ' ×' + String(item.sessionCount) : ''}</span>)}
				</div>
				<footer><span>打开终端</span>→</footer>
			</button>
		})}
	</div>
}

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
			onLogin(name.trim().toLowerCase())
		} catch { setError('无法连接设备管理服务') } finally { setBusy(false) }
	}
	return <div className="dm-login"><StyleInjector />
		<form className="dm-login-card" onSubmit={(event) => { event.preventDefault(); void login() }}>
			<small>AUTHORIZED ACCESS · ZNSL</small>
			<h2>进入设备管理</h2>
			<p>使用跳板机账号登录，采集与 SSH 将以该账号连接实验室。</p>
			<label><span>账号</span><input autoFocus list="dm-users" autoComplete="username" value={name} onChange={(event) => setName(event.target.value)} /><datalist id="dm-users">{['wsy','lfx','fjj','yyh','zyh','szg','dj','fdk','ychan','dcc','sxx'].map((user) => <option key={user} value={user} />)}</datalist></label>
			<label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
			{error.length > 0 && <div className="dm-login-error" role="alert">{error}</div>}
			<button type="submit" disabled={busy}>{busy ? '正在连接…' : '进入控制台'}</button>
			<div className="dm-login-note"><span>ZNSL · 192.168.210.244</span><code>初始密码 = 用户名</code></div>
		</form>
	</div>
}

const Icon = ({ kind }: { kind: 'topology' | 'files' | 'ssh' | 'ci' }): JSX.Element => kind === 'topology' ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="6" rx="1.5"/><path d="M7 8h.01M11 8h6M6 15h12M9 12v3m6-3v3"/></svg> : kind === 'files' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/></svg> : kind === 'ci' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/><path d="M12 8v4l3 2"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></svg>

export function DeviceManagementView({ visible = true, showCi = true, onLogout }: { visible?: boolean; showCi?: boolean; onLogout?: () => void }): JSX.Element {
	const [user, setUser] = useState<string | null>(null)
	const [checking, setChecking] = useState(true)
	const [activeTab, setActiveTab] = useState<ActiveTab>('topology')
	const [sshTabs, setSshTabs] = useState<SshTab[]>([])
	const [sshStatus, setSshStatus] = useState<Record<string, SshConnectionState>>({})
	const counts = useMemo(() => Object.fromEntries(['sw1','sw2','sw3','sw4'].map((switchId) => [switchId, sshTabs.filter((tab) => tab.switchId === switchId).length])), [sshTabs])
	// Tab lifecycle: all state updates are computed OUTSIDE setState updaters.
	// Scheduling setActiveTab from inside another updater is a side effect
	// React 18 may drop, which strands activeTab on a removed tab id.
	const addSsh = useCallback((switchId: string): void => {
		const index = Math.max(0, ...sshTabs.filter((tab) => tab.switchId === switchId).map((tab) => tab.index)) + 1
		const tab: SshTab = { id: 'ssh:' + switchId + ':' + String(Date.now()) + ':' + String(index), switchId, index }
		setSshTabs((tabs) => [...tabs, tab])
		setActiveTab(tab.id)
	}, [sshTabs])
	const openSsh = useCallback((switchId: string): void => { const existing = sshTabs.find((tab) => tab.switchId === switchId); if (existing !== undefined) setActiveTab(existing.id); else addSsh(switchId) }, [sshTabs, addSsh])
	const closeSsh = useCallback((id: string): void => {
		const index = sshTabs.findIndex((tab) => tab.id === id)
		const next = sshTabs.filter((tab) => tab.id !== id)
		setSshTabs(next)
		setSshStatus((old) => { const updated = { ...old }; delete updated[id]; return updated })
		if (activeTab === id) setActiveTab(next[Math.max(0, index - 1)]?.id ?? 'topology')
	}, [sshTabs, activeTab])
	const logout = useCallback(async (): Promise<void> => { setSshTabs([]); setSshStatus({}); setActiveTab('topology'); await fetch('/api/lab/logout', { method: 'POST' }); setUser(null); onLogout?.() }, [onLogout])
	useEffect(() => { void fetch('/api/lab/session').then(async (response) => { if (response.ok) { const session = await response.json() as { username?: string }; if (session.username !== undefined) setUser(session.username) } }).finally(() => setChecking(false)) }, [])
	if (checking) return <div className="dm-boot"><StyleInjector /><span className="dm-brand-mark">L</span><p>正在连接设备管理服务…</p></div>
	if (user === null) return <Login onLogin={setUser}/>
	return <div className="dm-root">
		<StyleInjector />
		<nav className="dm-tabs" aria-label="设备管理工作区">
			<button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}><Icon kind="topology"/>物理拓扑</button>
			<button className={activeTab === 'ssh' ? 'active' : ''} onClick={() => setActiveTab('ssh')}><Icon kind="ssh"/>SSH 连接</button>
			<button className={activeTab === 'files' ? 'active' : ''} onClick={() => setActiveTab('files')}><Icon kind="files"/>文件传输</button>
			{showCi && <button className={activeTab === 'ci' ? 'active' : ''} onClick={() => setActiveTab('ci')}><Icon kind="ci"/>CI 构建</button>}
			{sshTabs.map((tab) => <div key={tab.id} className={'dm-ssh-tab' + (activeTab === tab.id ? ' active' : '')}><button className="dm-ssh-main" onClick={() => setActiveTab(tab.id)}><Icon kind="ssh"/>{tab.switchId}_{tab.index}<i className={sshStatus[tab.id] ?? 'connecting'}/></button><button className="dm-ssh-close" aria-label={'关闭 ' + tab.switchId.toUpperCase() + ' SSH ' + tab.index} onClick={() => closeSsh(tab.id)}>×</button></div>)}
			<span className="dm-user"><code>{user}</code><button onClick={() => { void logout() }}>退出</button></span>
		</nav>
		<main className="dm-workspace">
			<section className={activeTab === 'topology' ? 'active' : ''}><LabView visible={visible && activeTab === 'topology'} showExperiment={false} currentUsername={user} onOpenSsh={openSsh} onAddSsh={addSsh} sshInstanceCounts={counts}/></section>
			<section className={activeTab === 'ssh' ? 'active' : ''}><SshGrid visible={visible && activeTab === 'ssh'} onOpen={addSsh}/></section>
			<section className={activeTab === 'files' ? 'active' : ''}><FileTransferView/></section>
			{showCi && <section className={activeTab === 'ci' ? 'active' : ''}><JenkinsView visible={visible && activeTab === 'ci'}/></section>}
			{sshTabs.map((tab) => <section key={tab.id} className={activeTab === tab.id ? 'active' : ''}><SshTerminal switchId={tab.switchId} onConnectionChange={(state) => setSshStatus((old) => ({ ...old, [tab.id]: state }))}/></section>)}
		</main>
		<TransferQueueBar/>
	</div>
}
