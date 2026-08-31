/**
 * Rack-style 32-port switch front panel. The physical face mirrors the lab
 * hardware: MGMT over ETH on the left, then two rows of sixteen cages on the
 * right (even ports 0..30 above, odd ports 1..31 below). Every cage owns a
 * top target handle and bottom source handle so vertically stacked devices
 * can draw cables from the exact physical port.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface FrontPort {
	slot: number
	port: string
	displayName: string
	oper?: string
	admin?: string
	peerLabel?: string
	subports: string[]
	users: string[]
}

export interface SwitchNodeData extends Record<string, unknown> {
	id: string
	name: string
	ip: string
	group: string
	reachable: boolean
	version?: string
	selected: boolean
	loading: boolean
	ports: FrontPort[]
	users: string[]
	onPortClick?: (port: FrontPort) => void
	onSsh?: () => void
	onSshAdd?: () => void
}

const operClass = (port: FrontPort): string => {
	if (port.admin === 'down') return 'admin-down'
	if (port.oper === 'up') return 'up'
	return 'down'
}

function FacePort({ port, row, onClick }: { port: FrontPort; row: 'top' | 'bottom'; onClick?: (port: FrontPort) => void }): JSX.Element {
	const linked = port.peerLabel !== undefined && port.peerLabel.length > 0
	const title = [
		port.displayName,
		'物理端口 ' + String(port.slot),
		port.subports.length > 0 ? port.subports.join(', ') : '等待采集',
		port.peerLabel !== undefined ? '邻居 ' + port.peerLabel : undefined,
		port.users.length > 0 ? '使用者 ' + port.users.join(', ') : '无人登记使用',
	].filter(Boolean).join(' · ')
	return (
		<div className={'lab-face-port ' + row + ' ' + operClass(port) + (linked ? ' linked' : '')} title={title} onClick={() => onClick?.(port)} onContextMenu={(event) => { event.preventDefault(); onClick?.(port) }} role={onClick === undefined ? undefined : 'button'} tabIndex={onClick === undefined ? undefined : 0}>
			{row === 'top' ? <span className="lab-face-port-no">{port.slot}</span> : null}
			<div className="lab-face-cage">
				<span className="lab-face-cage-core" />
				<span className="lab-face-led" />
				{port.users.length > 0 && <span className="lab-face-users" title={'当前使用者: ' + port.users.join(', ')}>{port.users.length}</span>}
				<Handle type="target" position={Position.Top} id={port.port + ':target'} className="lab-face-rf-handle center" isConnectable={false} />
				<Handle type="source" position={Position.Bottom} id={port.port + ':source'} className="lab-face-rf-handle center" isConnectable={false} />
			</div>
			{row === 'bottom' ? <span className="lab-face-port-no">{port.slot}</span> : null}
		</div>
	)
}

export function SwitchNode({ data }: NodeProps): JSX.Element {
	const sw = data as SwitchNodeData
	const evenPorts = sw.ports.filter((port) => port.slot % 2 === 0)
	const oddPorts = sw.ports.filter((port) => port.slot % 2 === 1)
	return (
		<div className={'lab-device-node' + (sw.selected ? ' selected' : '') + (sw.reachable ? '' : ' unreachable') + (sw.loading ? ' loading' : '')}>
			<div className="lab-device-caption">
				<span className={'lab-sw-dot' + (sw.reachable ? '' : ' down')} />
				<strong>{sw.name}</strong>
				{sw.onSsh !== undefined && <button className="lab-ssh-button" title={'打开 ' + sw.name + ' SSH 终端'} onClick={(event) => { event.stopPropagation(); sw.onSsh?.() }} aria-label={'打开 ' + sw.name + ' SSH 终端'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></svg></button>}
				{sw.onSshAdd !== undefined && <button className="lab-ssh-add" title={'再打开一个 ' + sw.name + ' SSH 终端'} onClick={(event) => { event.stopPropagation(); sw.onSshAdd?.() }} aria-label={'新增 ' + sw.name + ' SSH 终端'}>+</button>}
				<span className="lab-sw-group">{'G-' + sw.group}</span>
				<span className="lab-device-ip">{sw.ip}</span>
				{sw.users.length > 0 && <span className="lab-device-users" title={'当前使用者: ' + sw.users.join(', ')}>使用: {sw.users.join(', ')}</span>}
				<span className="lab-device-port-summary">{sw.loading ? 'SYNCING…' : sw.ports.filter((p) => p.oper === 'up').length + '/32 UP'}</span>
			</div>
			<div className="lab-chassis">
				<div className="lab-chassis-left">
					<div className="lab-led-strip"><span className="lab-status-led on" /><span>SYS</span><span className="lab-status-led on" /><span>PWR</span></div>
					<div className="lab-service-port"><span>MGMT</span><i /></div>
					<div className="lab-service-port"><span>ETH</span><i /></div>
				</div>
				<div className="lab-chassis-vent top" />
				<div className="lab-port-bank">
					<div className="lab-port-row top">{evenPorts.map((port) => <FacePort key={port.slot} port={port} row="top" onClick={sw.onPortClick} />)}</div>
					<div className="lab-port-row bottom">{oddPorts.map((port) => <FacePort key={port.slot} port={port} row="bottom" onClick={sw.onPortClick} />)}</div>
				</div>
				<div className="lab-chassis-vent bottom" />
			</div>
		</div>
	)
}
