import { type EdgeProps } from '@xyflow/react'
import { useState } from 'react'
import type { ExperimentLinkStatus } from '../types.ts'

export interface EngineeringEdgeData extends Record<string, unknown> {
	status: ExperimentLinkStatus
}

const triangle = (tipX: number, tipY: number, baseX: number, baseY: number, px: number, py: number): string =>
	[tipX + ',' + tipY, (baseX + px) + ',' + (baseY + py), (baseX - px) + ',' + (baseY - py)].join(' ')

/** Straight engineering link; arrow tips stop exactly at port borders. */
export function EngineeringEdge({ sourceX, sourceY, targetX, targetY, style }: EdgeProps): JSX.Element {
	const [hovered, setHovered] = useState(false)
	const dx = targetX - sourceX
	const dy = targetY - sourceY
	const length = Math.max(1, Math.hypot(dx, dy))
	const ux = dx / length
	const uy = dy / length
	const px = -uy * 5
	const py = ux * 5
	const sourceBaseX = sourceX + ux * 13
	const sourceBaseY = sourceY + uy * 13
	const targetBaseX = targetX - ux * 13
	const targetBaseY = targetY - uy * 13
	const stroke = typeof style?.stroke === 'string' ? style.stroke : '#171717'
	return (
		<>
			<path d={'M ' + sourceX + ' ' + sourceY + ' L ' + targetX + ' ' + targetY} className={'exp-engineering-line' + (hovered ? ' hovered' : '')} style={style} />
			<path d={'M ' + sourceX + ' ' + sourceY + ' L ' + targetX + ' ' + targetY} className="exp-engineering-hit" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} />
			<polygon points={triangle(sourceX, sourceY, sourceBaseX, sourceBaseY, px, py)} fill={stroke} className="exp-engineering-arrow" />
			<polygon points={triangle(targetX, targetY, targetBaseX, targetBaseY, px, py)} fill={stroke} className="exp-engineering-arrow" />
		</>
	)
}
