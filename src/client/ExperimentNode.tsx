import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ExperimentNodeDefinition } from '../types.ts'

export interface ExperimentPortBadge {
	id: string
	label: string
	side: 'top' | 'bottom'
	oper?: string
	mismatch?: boolean
	annotation?: {
		bundle?: string
		address?: string
		dx: number
		dy: number
		align: 'left' | 'center' | 'right'
	}
}

export interface ExperimentNodeData extends Record<string, unknown> {
	definition: ExperimentNodeDefinition
	reachable?: boolean
	collecting: boolean
	ports: ExperimentPortBadge[]
}

function PortBadge({ port }: { port: ExperimentPortBadge }): JSX.Element {
	const position = port.side === 'top' ? Position.Top : Position.Bottom
	const note = port.annotation
	return (
		<div className={'exp-port-badge ' + port.side + (port.oper === 'up' ? ' up' : '') + (port.mismatch === true ? ' mismatch' : '')} title={port.id}>
			<span>{port.label}</span>
			<Handle type="source" position={position} id={port.id + ':source'} className={'exp-port-handle ' + port.side} isConnectable={false} />
			<Handle type="target" position={position} id={port.id + ':target'} className={'exp-port-handle ' + port.side} isConnectable={false} />
			{note !== undefined ? (
				<div className={'exp-port-note align-' + note.align} style={{ left: '50%', top: '50%', transform: 'translate(' + String(note.dx) + 'px,' + String(note.dy) + 'px)' }}>
					{note.bundle !== undefined ? <strong>{note.bundle}</strong> : null}
					{note.address !== undefined ? <span>{note.address}</span> : null}
				</div>
			) : null}
		</div>
	)
}

/** Reference-diagram switch: plain box, centered label, protruding ports. */
export function ExperimentNode({ data }: NodeProps): JSX.Element {
	const node = data as ExperimentNodeData
	const def = node.definition
	const top = node.ports.filter((port) => port.side === 'top')
	const bottom = node.ports.filter((port) => port.side === 'bottom')
	return (
		<div className={'exp-node exp-node-' + def.type + (node.collecting ? ' collecting' : '') + (node.reachable === false ? ' unreachable' : '')}>
			<div className="exp-node-body"><strong>{def.label}</strong></div>
			<div className="exp-port-row top">{top.map((port) => <PortBadge key={port.id} port={port} />)}</div>
			<div className="exp-port-row bottom">{bottom.map((port) => <PortBadge key={port.id} port={port} />)}</div>
		</div>
	)
}
