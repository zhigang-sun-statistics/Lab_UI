import { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

export interface CableEdgeData extends Record<string, unknown> {
	sourceUp: boolean
	targetUp: boolean
	alwaysLabel?: boolean
}

/**
 * Cable rendered above chassis nodes. The path is painted first and the two
 * endpoint plugs afterwards, so each circular plug remains crisp where the
 * Bezier cable enters the physical port centre.
 */
export function CableEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	style,
	label,
	data,
}: EdgeProps): JSX.Element {
	const [hovered, setHovered] = useState(false)
	const cable = (data ?? {}) as CableEdgeData
	const showLabel = hovered || cable.alwaysLabel === true
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
		curvature: 0.32,
	})
	return (
		<>
			<BaseEdge id={id} path={path} style={style} className={'lab-cable-edge' + (hovered ? ' hovered' : '')} interactionWidth={0} />
			<path
				d={path}
				className="lab-cable-hit"
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
			/>
			<circle cx={sourceX} cy={sourceY} r={5} className={'lab-cable-plug' + (cable.sourceUp ? ' up' : '') + (hovered ? ' hovered' : '')} />
			<circle cx={targetX} cy={targetY} r={5} className={'lab-cable-plug' + (cable.targetUp ? ' up' : '') + (hovered ? ' hovered' : '')} />
			{label !== undefined && label !== null && (
				<EdgeLabelRenderer>
					<div className="lab-cable-label-anchor nodrag nopan" style={{ transform: 'translate(-50%, -50%) translate(' + String(labelX) + 'px,' + String(labelY) + 'px)' }}>
						<div className={'lab-cable-label' + (showLabel ? ' visible' : '')}>{String(label)}</div>
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	)
}
