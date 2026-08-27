import { ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useMemo } from 'react'
import type { ExperimentDefinition, ExperimentLinkDefinition, ExperimentLinkStatus, TopologyResponse } from '../types.ts'
import { EngineeringEdge } from './EngineeringEdge.tsx'
import { ExperimentNode, type ExperimentNodeData, type ExperimentPortBadge } from './ExperimentNode.tsx'

const NODE_TYPES = { experiment: ExperimentNode }
const EDGE_TYPES = { engineering: EngineeringEdge }
const portNumber = (value: string | undefined): string => value?.replace(/^Ethernet/i, '') ?? '?'
const pairKey = (aSw: string, aPort: string, bSw: string, bPort: string): string => [aSw + ':' + aPort, bSw + ':' + bPort].sort().join('|')

const statusStyle = (status: ExperimentLinkStatus): { stroke: string; strokeWidth: number; strokeDasharray?: string } => {
	if (status === 'matched-up') return { stroke: '#171717', strokeWidth: 2.4 }
	if (status === 'matched-down') return { stroke: '#a66f00', strokeWidth: 2.4, strokeDasharray: '8 5' }
	if (status === 'mismatch') return { stroke: '#c93632', strokeWidth: 2.4, strokeDasharray: '5 5' }
	if (status === 'collecting') return { stroke: '#8b8b8b', strokeWidth: 2, strokeDasharray: '6 5' }
	return { stroke: '#171717', strokeWidth: 2.2 }
}

function linkStatus(link: ExperimentLinkDefinition, definition: ExperimentDefinition, topology: TopologyResponse, hydrated: boolean): ExperimentLinkStatus {
	if (!hydrated) return 'collecting'
	const nodeById = new Map(definition.nodes.map((node) => [node.id, node] as const))
	const fromDevice = nodeById.get(link.from.node)?.device
	const toDevice = nodeById.get(link.to.node)?.device
	if (fromDevice === undefined || toDevice === undefined || link.from.interface === undefined || link.to.interface === undefined) return 'unknown'
	const fromPort = topology.switches.find((sw) => sw.id === fromDevice)?.ports.find((port) => port.name === link.from.interface)
	const toPort = topology.switches.find((sw) => sw.id === toDevice)?.ports.find((port) => port.name === link.to.interface)
	if (fromPort === undefined || toPort === undefined) return 'mismatch'
	const actual = new Set(topology.links.map((item) => pairKey(item.a.sw, item.a.port, item.b.sw, item.b.port)))
	if (!actual.has(pairKey(fromDevice, link.from.interface, toDevice, link.to.interface))) return 'mismatch'
	return fromPort.oper === 'up' && toPort.oper === 'up' ? 'matched-up' : 'matched-down'
}

export function ExperimentView({ definition, topology, hydrated }: { definition: ExperimentDefinition; topology: TopologyResponse; hydrated: boolean }): JSX.Element {
	const graph = useMemo(() => {
		const byId = new Map(definition.nodes.map((node) => [node.id, node] as const))
		const statuses = new Map(definition.links.map((link) => [link.id, linkStatus(link, definition, topology, hydrated)] as const))
		const portsByNode = new Map<string, Map<string, ExperimentPortBadge>>()
		const addPort = (endpoint: ExperimentLinkDefinition['from'], otherId: string, status: ExperimentLinkStatus, bundle?: string): void => {
			const nodeId = endpoint.node
			const interfaceName = endpoint.interface
			if (interfaceName === undefined) return
			const current = portsByNode.get(nodeId) ?? new Map<string, ExperimentPortBadge>()
			const here = byId.get(nodeId)
			const other = byId.get(otherId)
			const side = (other?.position.y ?? 0) < (here?.position.y ?? 0) ? 'top' : 'bottom'
			const device = here?.device
			const oper = device !== undefined ? topology.switches.find((sw) => sw.id === device)?.ports.find((port) => port.name === interfaceName)?.oper : undefined
			const fallbackDy = side === 'top' ? -88 : 52
			current.set(interfaceName, {
				id: interfaceName,
				label: portNumber(interfaceName),
				side,
				oper,
				mismatch: status === 'mismatch',
				annotation: {
					bundle,
					address: endpoint.address,
					dx: endpoint.annotation?.dx ?? 18,
					dy: endpoint.annotation?.dy ?? fallbackDy,
					align: endpoint.annotation?.align ?? 'left',
				},
			})
			portsByNode.set(nodeId, current)
		}
		for (const link of definition.links) {
			const status = statuses.get(link.id) ?? 'unknown'
			addPort(link.from, link.to.node, status, link.bundle)
			addPort(link.to, link.from.node, status, link.bundle)
		}
		const nodes: Node[] = definition.nodes.map((def) => {
			const live = def.device !== undefined ? topology.switches.find((sw) => sw.id === def.device) : undefined
			const data: ExperimentNodeData = { definition: def, reachable: live?.reachable, collecting: !hydrated, ports: [...(portsByNode.get(def.id)?.values() ?? [])] }
			return { id: def.id, type: 'experiment', position: def.position, data, draggable: false, zIndex: 10 }
		})
		const edges: Edge[] = definition.links.map((link) => {
			const status = statuses.get(link.id) ?? 'unknown'
			return {
				id: link.id,
				source: link.from.node,
				sourceHandle: (link.from.interface ?? 'link') + ':source',
				target: link.to.node,
				targetHandle: (link.to.interface ?? 'link') + ':target',
				type: 'engineering',
				zIndex: 0,
				style: statusStyle(status),
				data: {
					status,
				},
			}
		})
		return { nodes, edges }
	}, [definition, topology, hydrated])
	return (
		<div className="exp-root">
			<div className="exp-canvas">
				<ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} fitView fitViewOptions={{ padding: 0.06 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} />
			</div>
		</div>
	)
}
