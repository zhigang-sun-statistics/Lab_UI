import { useCallback, useMemo, useState } from 'react'
import { LabView } from './LabView.tsx'
import { StyleInjector } from './StyleInjector.tsx'
import { FileTransferView } from '../web/file-transfer/FileTransferView.tsx'
import { SshTerminal, type SshConnectionState } from '../ssh/SshTerminal.tsx'
import './device-management.css'

interface SshTab { id: string; switchId: string; index: number }
type ActiveTab = 'topology' | 'files' | string

const Icon = ({ kind }: { kind: 'topology' | 'files' | 'ssh' }): JSX.Element => kind === 'topology' ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="6" rx="1.5"/><path d="M7 8h.01M11 8h6M6 15h12M9 12v3m6-3v3"/></svg> : kind === 'files' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></svg>

export function DeviceManagementView({ visible }: { visible: boolean }): JSX.Element {
	const [activeTab, setActiveTab] = useState<ActiveTab>('topology')
	const [sshTabs, setSshTabs] = useState<SshTab[]>([])
	const [sshStatus, setSshStatus] = useState<Record<string, SshConnectionState>>({})
	const counts = useMemo(() => Object.fromEntries(['sw1','sw2','sw3','sw4'].map((switchId) => [switchId, sshTabs.filter((tab) => tab.switchId === switchId).length])), [sshTabs])
	const addSsh = useCallback((switchId: string): void => {
		setSshTabs((tabs) => { const index = Math.max(0, ...tabs.filter((tab) => tab.switchId === switchId).map((tab) => tab.index)) + 1; const tab = { id: 'ssh:' + switchId + ':' + String(Date.now()) + ':' + String(index), switchId, index }; setActiveTab(tab.id); return [...tabs, tab] })
	}, [])
	const openSsh = useCallback((switchId: string): void => { const existing = sshTabs.find((tab) => tab.switchId === switchId); if (existing !== undefined) setActiveTab(existing.id); else addSsh(switchId) }, [sshTabs, addSsh])
	const closeSsh = useCallback((id: string): void => { setSshTabs((tabs) => { const index = tabs.findIndex((tab) => tab.id === id); const next = tabs.filter((tab) => tab.id !== id); if (activeTab === id) setActiveTab(next[Math.max(0, index - 1)]?.id ?? 'topology'); return next }); setSshStatus((old) => { const next = { ...old }; delete next[id]; return next }) }, [activeTab])
	return <div className="dm-root">
		<StyleInjector />
		<nav className="dm-tabs" aria-label="设备管理工作区">
			<button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}><Icon kind="topology"/>物理拓扑</button>
			<button className={activeTab === 'files' ? 'active' : ''} onClick={() => setActiveTab('files')}><Icon kind="files"/>文件传输</button>
			{sshTabs.map((tab) => <div key={tab.id} className={'dm-ssh-tab' + (activeTab === tab.id ? ' active' : '')}><button className="dm-ssh-main" onClick={() => setActiveTab(tab.id)}><Icon kind="ssh"/>{tab.switchId.toUpperCase()} SSH {tab.index}<i className={sshStatus[tab.id] ?? 'connecting'}/></button><button className="dm-ssh-close" aria-label={'关闭 '+tab.switchId.toUpperCase()+' SSH '+tab.index} onClick={() => closeSsh(tab.id)}>×</button></div>)}
		</nav>
		<main className="dm-workspace">
			<section className={activeTab === 'topology' ? 'active' : ''}><LabView visible={visible && activeTab === 'topology'} showExperiment={false} currentUsername="desktop" onOpenSsh={openSsh} onAddSsh={addSsh} sshInstanceCounts={counts}/></section>
			<section className={activeTab === 'files' ? 'active' : ''}><FileTransferView/></section>
			{sshTabs.map((tab) => <section key={tab.id} className={activeTab === tab.id ? 'active' : ''}><SshTerminal switchId={tab.switchId} onConnectionChange={(state) => setSshStatus((old) => ({ ...old, [tab.id]: state }))}/></section>)}
		</main>
	</div>
}
