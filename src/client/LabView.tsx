/**
 * LabView: the lab controller tab body. Three bands - lock toolbar,
 * topology canvas + switch detail panel, status footer. Polls topology
 * and lock state while visible; every fetch is a read-only GET.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type NodeMouseHandler } from '@xyflow/react'
import { fetchActualUsage, fetchExperiment, fetchLockLog, fetchLocks, fetchTopology } from './api.ts'
import { CableEdge } from './CableEdge.tsx'
import { ExperimentView } from './ExperimentView.tsx'
import { StyleInjector } from './StyleInjector.tsx'
import { SwitchNode, type FrontPort, type SwitchNodeData } from './SwitchNode.tsx'
import type { ActualUsageResponse, ExperimentResponse, LinkState, LockLogResponse, LocksResponse, SwitchState, TopologyResponse } from '../types.ts'

const REFRESH_MS = 45_000
const EDGE_TYPES = { cable: CableEdge }

const mockPorts = () => Array.from({ length: 32 }, (_, index) => ({
	name: 'Ethernet' + String(index),
	alias: 'eth-0-' + String(index + 1),
	admin: 'up',
	oper: 'down',
	speed: '—',
}))

const MOCK_TOPOLOGY: TopologyResponse = {
	fetchedAt: 0,
	durationMs: 0,
	cached: false,
	switches: [
		{ id: 'sw1', name: 'sw1', ip: '10.13.33.164', group: 'A', reachable: true, ports: mockPorts() },
		{ id: 'sw2', name: 'sw2', ip: '10.13.33.165', group: 'A', reachable: true, ports: mockPorts() },
		{ id: 'sw3', name: 'sw3', ip: '10.13.33.166', group: 'B', reachable: true, ports: mockPorts() },
		{ id: 'sw4', name: 'sw4', ip: '10.13.33.167', group: 'B', reachable: true, ports: mockPorts() },
	],
	links: [],
}

const timeLabel = (epoch: number): string => new Date(epoch).toLocaleTimeString()

const edgeStyle = (source: LinkState['source']): { stroke: string; strokeDasharray?: string; strokeWidth: number } => {
	if (source === 'static') return { stroke: '#788294', strokeDasharray: '7 5', strokeWidth: 1.5 }
	if (source === 'both') return { stroke: '#32c878', strokeWidth: 2.2 }
	return { stroke: '#4d96ff', strokeWidth: 2 }
}

const endpointLabel = (swId: string, port: string): string => {
	const swNo = swId.match(/(\d+)/)?.[1] ?? swId.toUpperCase()
	const ethNo = port.match(/^Ethernet(.+)$/i)?.[1] ?? port.replace(/^eth/i, '')
	return 'SW' + swNo + 'Eth' + ethNo
}

const physicalSlotOf = (alias: string | undefined, name: string, fallbackIndex: number): number | undefined => {
	const aliasMatch = alias?.match(/eth-\d+-(\d+)/i)
	if (aliasMatch?.[1] !== undefined) return Number(aliasMatch[1]) - 1
	const nameMatch = name.match(/^Ethernet(\d+)/i)
	if (nameMatch?.[1] !== undefined) return Number(nameMatch[1])
	const fallback = fallbackIndex
	return fallback >= 0 && fallback <= 31 ? fallback : undefined
}

const frontPortsOf = (
	sw: SwitchState,
	linked: Map<string, { peerLabel?: string }> | undefined,
): FrontPort[] => {
	const cages = new Map<number, typeof sw.ports>()
	sw.ports.forEach((port, index) => {
		const slot = physicalSlotOf(port.alias, port.name, index)
		if (slot === undefined || slot < 0 || slot > 31) return
		const entries = cages.get(slot) ?? []
		entries.push(port)
		cages.set(slot, entries)
	})
	return Array.from({ length: 32 }, (_, index): FrontPort => {
		const slot = index
		const entries = cages.get(slot) ?? []
		const linkedPort = entries.find((port) => linked?.has(port.name) === true)
		const active = linkedPort ?? entries.find((port) => port.oper === 'up') ?? entries[0]
		const peer = active !== undefined ? linked?.get(active.name)?.peerLabel : undefined
		const portName = active?.name ?? 'Ethernet' + String(slot)
		return {
			slot,
			port: portName,
			displayName: endpointLabel(sw.id, portName),
			oper: active?.oper,
			admin: active?.admin,
			peerLabel: peer,
			subports: entries.map((port) => port.name),
		}
	})
}

export function LabView({ visible, showExperiment = true, onOpenSsh, onAddSsh, sshInstanceCounts = {}, currentUsername }: { visible: boolean; showExperiment?: boolean; onOpenSsh?: (switchId: string) => void; onAddSsh?: (switchId: string) => void; sshInstanceCounts?: Record<string, number>; currentUsername?: string }): JSX.Element {
	const [view, setView] = useState<'physical' | 'experiment'>('physical')
	const [experiment, setExperiment] = useState<ExperimentResponse>()
	const [topology, setTopology] = useState<TopologyResponse>(MOCK_TOPOLOGY)
	const [hydrated, setHydrated] = useState(false)
	const [locks, setLocks] = useState<LocksResponse | undefined>()
	const [actualUsage, setActualUsage] = useState<ActualUsageResponse>({ fetchedAt: 0, switches: {} })
	const [lockLog, setLockLog] = useState<LockLogResponse | undefined>()
	const [showLog, setShowLog] = useState(false)
	const [error, setError] = useState<string>()
	const [selected, setSelected] = useState<string>()
	const [selectedPort, setSelectedPort] = useState<string>()
	const [busy, setBusy] = useState(false)
	const alive = useRef(true)

	useEffect(() => {
		alive.current = true
		return () => { alive.current = false }
	}, [])

	const load = useCallback(async (fresh: boolean): Promise<void> => {
		setBusy(true)
		try {
			// Actual usage is an optional enhancement: never let its failure
			// (e.g. a backend without the route) abort the topology snapshot.
			const actualUsageTask = currentUsername === undefined ? Promise.resolve(undefined) : fetchActualUsage().catch(() => undefined)
			const [nextTopology, nextLocks, nextExperiment, nextActualUsage] = await Promise.all([fetchTopology(fresh), fetchLocks(), showExperiment ? fetchExperiment() : Promise.resolve(undefined), actualUsageTask])
			if (!alive.current) return
			// Commit one complete snapshot: panels stay on mock data until port
			// state, LLDP links and locks have all finished collecting.
			setTopology(nextTopology)
			setLocks(nextLocks)
			if (nextActualUsage !== undefined) setActualUsage(nextActualUsage)
			if (nextExperiment !== undefined) setExperiment(nextExperiment)
			setHydrated(true)
			setError(undefined)
		} catch (loadError) {
			if (!alive.current) return
			setError(String(loadError instanceof Error ? loadError.message : loadError))
		} finally {
			if (alive.current) setBusy(false)
		}
	}, [showExperiment, currentUsername])

	useEffect(() => {
		if (!visible) return
		void load(false)
		const timer = setInterval(() => { void load(false) }, REFRESH_MS)
		return () => { clearInterval(timer) }
	}, [visible, load])

	useEffect(() => {
		if (!visible || currentUsername === undefined) return
		const timer = setInterval(() => { void fetchActualUsage().then(setActualUsage).catch(() => undefined) }, 10_000)
		return () => { clearInterval(timer) }
	}, [visible, currentUsername])

	const loadLog = useCallback(async (): Promise<void> => {
		setShowLog(true)
		setLockLog(await fetchLockLog())
	}, [])

	const { nodes, edges } = useMemo(() => {
		const orderOf = new Map(topology.switches.map((sw, index) => [sw.id, index]))
		const portOper = new Map(topology.switches.flatMap((sw) => sw.ports.map((port) => [sw.id + ':' + port.name, port.oper] as const)))
		const linkedBySw = new Map<string, Map<string, { peerLabel?: string }>>()
		const register = (swId: string, port: string, peerLabel: string): void => {
			const map = linkedBySw.get(swId) ?? new Map()
			map.set(port, { peerLabel })
			linkedBySw.set(swId, map)
		}
		for (const link of topology.links) {
			register(link.a.sw, link.a.port, endpointLabel(link.b.sw, link.b.port))
			register(link.b.sw, link.b.port, endpointLabel(link.a.sw, link.a.port))
		}
		const nodes: Node[] = topology.switches.map((sw: SwitchState, index: number) => {
			const data: SwitchNodeData = {
				id: sw.id,
				name: sw.name,
				ip: sw.ip,
				group: sw.group,
				reachable: sw.reachable,
				version: sw.version,
				selected: selected === sw.id,
				loading: !hydrated,
				ports: frontPortsOf(sw, linkedBySw.get(sw.id)),
				actualUsers: actualUsage.switches[sw.id] ?? [],
				onPortClick: (port) => { setSelected(sw.id); setSelectedPort(port.port) },
				onSsh: onOpenSsh === undefined ? undefined : () => onOpenSsh(sw.id),
				onSshAdd: onAddSsh !== undefined && (sshInstanceCounts[sw.id] ?? 0) > 0 ? () => onAddSsh(sw.id) : undefined,
			}
			return {
				id: sw.id,
				type: 'switch',
				position: { x: 60, y: index * 235 + 30 },
				data,
				draggable: false,
			}
		})
		const edges: Edge[] = topology.links.map((link) => {
			const aFirst = (orderOf.get(link.a.sw) ?? 0) <= (orderOf.get(link.b.sw) ?? 0)
			const source = aFirst ? link.a : link.b
			const target = aFirst ? link.b : link.a
			return {
				id: link.id,
				source: source.sw,
				sourceHandle: source.port + ':source',
				target: target.sw,
				targetHandle: target.port + ':target',
				label: endpointLabel(source.sw, source.port) + ' ↔ ' + endpointLabel(target.sw, target.port),
				style: edgeStyle(link.source),
				labelShowBg: true,
				labelBgStyle: { fill: '#11151b', fillOpacity: 0.88 },
				labelBgPadding: [5, 3],
				labelBgBorderRadius: 4,
				type: 'cable',
				className: 'lab-cable-edge',
				zIndex: 20,
				data: {
					sourceUp: portOper.get(source.sw + ':' + source.port) === 'up',
					targetUp: portOper.get(target.sw + ':' + target.port) === 'up',
				},
				interactionWidth: 0,
			}
		})
		return { nodes, edges }
	}, [topology, actualUsage, selected, hydrated, onOpenSsh, onAddSsh, sshInstanceCounts])

	const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => { setSelected(node.id) }, [])
	const closeDetail = useCallback(() => { setSelected(undefined); setSelectedPort(undefined) }, [])

	const selectedSw = topology?.switches.find((sw) => sw.id === selected)
	const selectedLinks = topology?.links.filter((l) => l.a.sw === selected || l.b.sw === selected) ?? []
	const selectedPortState = selectedSw?.ports.find((port) => port.name === selectedPort)
	const selectedActualUsers = selectedSw === undefined ? [] : actualUsage.switches[selectedSw.id] ?? []
	const editDescription = useCallback(async (): Promise<void> => {
		if (selectedSw === undefined || selectedPortState === undefined) return
		const next = window.prompt('修改端口描述', selectedPortState.description ?? '')
		if (next === null) return
		const response = await fetch('/api/lab/port-description', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ switchId: selectedSw.id, interfaceName: selectedPortState.name, description: next }) })
		if (!response.ok) { setError('端口描述修改失败: ' + await response.text()); return }
		await load(true)
	}, [selectedSw, selectedPortState, load])
	const unreachable = topology?.switches.filter((sw) => !sw.reachable) ?? []

	return (
		<div className="lab-root">
			<StyleInjector />
			<div className="lab-toolbar">
				<span className="lab-title">Lab 控制台</span>
				{showExperiment && <div className="lab-view-switch">
					<button className={view === 'physical' ? 'active' : ''} onClick={() => setView('physical')}>物理拓扑</button>
					<button className={view === 'experiment' ? 'active' : ''} onClick={() => { setView('experiment'); closeDetail() }}>实验拓扑</button>
				</div>}
				{(locks?.groups ?? []).map((group) => (
					<span key={group.group} className={'lab-lockchip ' + group.state} title={group.raw}>
						{'组 ' + group.group + ': ' + (group.state === 'free' ? '空闲' : group.state === 'busy' ? '占用' : '未知')}
					</span>
			))}
			<span style={{ flex: 1 }} />
			<button className="lab-btn" onClick={() => void loadLog()} disabled={showLog}>锁日志</button>
			<button className="lab-btn" onClick={() => void load(true)} disabled={busy}>{busy ? '采集中…' : '刷新'}</button>
			</div>
			{error !== undefined && (
				<div className="lab-toolbar"><span className="lab-error">{error}</span></div>
			)}
			<div className="lab-main">
				{view === 'experiment' ? (
					experiment !== undefined
						? <ExperimentView definition={experiment.definition} topology={topology} hydrated={hydrated} />
						: <div className="exp-loading">正在读取 experiment.yml…</div>
				) : (<>
				<div className={'lab-canvas' + (hydrated ? ' hydrated' : ' loading')}>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						nodeTypes={{ switch: SwitchNode }}
						edgeTypes={EDGE_TYPES}
						onNodeClick={onNodeClick}
						onPaneClick={closeDetail}
						fitView
						proOptions={{ hideAttribution: true }}
						nodesConnectable={false}
						elementsSelectable
					>
					<Background gap={18} size={1} />
					<MiniMap pannable zoomable style={{ width: 120, height: 80 }} />
					<Controls showInteractive={false} />
				</ReactFlow>
				</div>
				{selectedSw !== undefined && (
					<div className="lab-side lab-detail-float">
						<button className="lab-detail-close" onClick={closeDetail} aria-label="关闭端口详情">×</button>
						<h4 className="lab-mono">{selectedSw.name.toUpperCase()} <span className="lab-sw-group">{'G-' + selectedSw.group}</span></h4>
						<p><span className="kv">IP</span><span className="lab-mono">{selectedSw.ip}</span></p>
						<p><span className="kv">状态</span>{hydrated ? (selectedSw.reachable ? '可达' : <span className="lab-error">不可达: {selectedSw.error}</span>) : '正在采集…'}</p>
						{selectedSw.version !== undefined && <p className="lab-mono" style={{ fontSize: 11 }}>{selectedSw.version}</p>}
						<section className="lab-actual-usage" aria-label="交换机当前实际使用者"><header><div><small>LIVE USAGE</small><strong>当前实际使用者</strong></div><span>{selectedActualUsers.reduce((sum, item) => sum + item.sessionCount, 0)} 个会话</span></header>{selectedActualUsers.length === 0 ? <p className="lab-actual-empty">当前未采集到活动会话</p> : <div className="lab-actual-list">{selectedActualUsers.map((item) => <article key={item.source + ':' + item.username + ':' + (item.clientIp ?? '')}><span className="lab-actual-avatar">{item.username.slice(0, 2).toUpperCase()}</span><div><b>{item.username}</b><small>{item.source === 'lab-ssh' ? 'Lab_UI SSH' : 'centec-swkit'} · {item.sessionCount} 个会话{item.clientIp !== undefined ? ' · ' + item.clientIp : ''}</small></div><span className="lab-actual-live"><i />在线</span></article>)}</div>}<footer>数据来自活动 SSH 会话和跳板机 swkit 锁文件，不是人工预约。</footer></section>
						{selectedPortState !== undefined && <div className="lab-port-focus"><div className="lab-port-focus-head"><div><span className={'lab-port-state ' + (selectedPortState.oper === 'up' ? 'up' : 'down')} /> <strong>{selectedPortState.name}</strong><small>{selectedPortState.alias ?? ''}</small></div><button className="lab-btn" onClick={() => void editDescription()}>修改描述</button></div><div className="lab-port-detail-grid"><p><span className="kv">状态</span><b>{selectedPortState.admin ?? '—'} / {selectedPortState.oper ?? '—'}</b></p><p><span className="kv">速率</span><b>{selectedPortState.speed ?? '—'}</b></p><p><span className="kv">MTU</span><b>{selectedPortState.mtu ?? '—'}</b></p><p><span className="kv">FEC</span><b>{selectedPortState.fec ?? '—'}</b></p><p><span className="kv">模式</span><b>{selectedPortState.vlan ?? '—'}</b></p><p><span className="kv">光模块</span><b>{selectedPortState.type ?? 'N/A'}</b></p></div><p><span className="kv">描述</span>{selectedPortState.description ?? '—'}</p><p><span className="kv">IP 地址</span>{selectedPortState.ipAddresses?.join(', ') ?? '—'}</p><p><span className="kv">LLDP 邻居</span>{selectedPortState.lldpPeer !== undefined ? endpointLabel(selectedPortState.lldpPeer.device, selectedPortState.lldpPeer.port) : selectedPortState.oper === 'up' ? <span title="端口已连通，但对端设备不运行或不回应 LLDP（服务器 / 测试仪常见）">已连线 · 对端未上报 LLDP</span> : '—'}</p><div className="lab-port-traffic"><div><span>RX</span><strong>{selectedPortState.counters?.rxBps ?? '0.00 B/s'}</strong><small>{selectedPortState.counters?.rxPps ?? '0.00/s'} · ERR {selectedPortState.counters?.rxErr ?? '0'} · DROP {selectedPortState.counters?.rxDrop ?? '0'}</small></div><div><span>TX</span><strong>{selectedPortState.counters?.txBps ?? '0.00 B/s'}</strong><small>{selectedPortState.counters?.txPps ?? '0.00/s'} · ERR {selectedPortState.counters?.txErr ?? '0'} · DROP {selectedPortState.counters?.txDrop ?? '0'}</small></div></div></div>}
						<div className="lab-swdetail-links">
							{selectedLinks.map((link) => (
								<div key={link.id} className="lab-linkrow">
									<span className="lab-mono">{endpointLabel(link.a.sw, link.a.port)} ↔ {endpointLabel(link.b.sw, link.b.port)}</span>
									<span className={'lab-tag ' + link.source}>{link.source}</span>
								</div>
							))}
						</div>
						<table className="lab-table">
							<thead><tr><th>端口</th><th>别名</th><th>速率</th><th>Oper</th><th>LLDP 邻居</th></tr></thead>
							<tbody>
								{selectedSw.ports.map((port) => (
									<tr key={port.name}>
										<td className="lab-mono">{endpointLabel(selectedSw.id, port.name)}</td>
										<td>{port.alias ?? '-'}</td>
										<td>{port.speed ?? '-'}</td>
										<td className={port.oper === 'up' ? 'lab-up' : 'lab-down'}>{port.oper ?? '-'}</td>
										<td>{port.lldpPeer !== undefined ? endpointLabel(port.lldpPeer.device, port.lldpPeer.port) : '-'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				</>)}
			</div>
			{showLog && lockLog !== undefined && (
				<div className="lab-toolbar">
					<div className="lab-pre" style={{ flex: 1 }}>{lockLog.lines.join('\n')}</div>
					<button className="lab-btn" onClick={() => setShowLog(false)}>收起</button>
				</div>
			)}
			<div className="lab-footer">
				<span>{hydrated ? '采集于 ' + timeLabel(topology.fetchedAt) + ' (' + String(topology.durationMs) + 'ms' + (topology.cached ? ', 缓存' : '') + ')' : '已加载 mock 面板，正在完整采集端口和 LLDP…'}</span>
				{hydrated && unreachable.length > 0 && <span className="lab-error">{'不可达: ' + unreachable.map((sw) => sw.name).join(', ')}</span>}
				{locks?.error !== undefined && locks.error.length > 0 && <span className="lab-error">{'锁状态: ' + locks.error}</span>}
			</div>
		</div>
	)
}