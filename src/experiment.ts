import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { LabInvariantError } from './invariant.ts'
import type {
	ExperimentDefinition,
	ExperimentEndpointDefinition,
	ExperimentLinkDefinition,
	ExperimentNodeDefinition,
	ExperimentResponse,
} from './types.ts'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown, field: string): string => {
	if (typeof value !== 'string' || value.trim().length === 0) throw new LabInvariantError('experiment.yml: ' + field + ' must be a non-empty string')
	return value
}
const position = (value: unknown, field: string): { x: number; y: number } => {
	if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') throw new LabInvariantError('experiment.yml: ' + field + ' needs {x,y}')
	return { x: value.x, y: value.y }
}
const endpoint = (value: unknown, field: string): ExperimentEndpointDefinition => {
	if (!isRecord(value)) throw new LabInvariantError('experiment.yml: ' + field + ' must be an object')
	const rawAnnotation = value.annotation
	const annotationAlign: 'left' | 'center' | 'right' | undefined = isRecord(rawAnnotation) && (rawAnnotation.align === 'left' || rawAnnotation.align === 'center' || rawAnnotation.align === 'right')
		? rawAnnotation.align
		: undefined
	const annotation = isRecord(rawAnnotation) && typeof rawAnnotation.dx === 'number' && typeof rawAnnotation.dy === 'number'
		? { dx: rawAnnotation.dx, dy: rawAnnotation.dy, align: annotationAlign }
		: undefined
	return {
		node: text(value.node, field + '.node'),
		interface: typeof value.interface === 'string' ? value.interface : undefined,
		label: typeof value.label === 'string' ? value.label : undefined,
		address: typeof value.address === 'string' ? value.address : undefined,
		annotation,
	}
}

export async function loadExperimentDefinition(overridePath?: string): Promise<ExperimentResponse> {
	const path = overridePath !== undefined && overridePath.length > 0 && isAbsolute(overridePath)
		? overridePath
		: join(LIB_DIR, '..', 'experiment.yml')
	const parsed: unknown = parse(await readFile(path, 'utf8'))
	if (!isRecord(parsed)) throw new LabInvariantError('experiment.yml: root must be an object')
	if (parsed.apiVersion !== 'soniclab/v1' || parsed.kind !== 'Experiment') throw new LabInvariantError('experiment.yml: apiVersion soniclab/v1 and kind Experiment required')
	if (!isRecord(parsed.metadata)) throw new LabInvariantError('experiment.yml: metadata required')
	const render = isRecord(parsed.render) ? parsed.render : {}
	if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) throw new LabInvariantError('experiment.yml: nodes[] required')
	const known = new Set<string>()
	const nodes: ExperimentNodeDefinition[] = parsed.nodes.map((raw, index) => {
		if (!isRecord(raw)) throw new LabInvariantError('experiment.yml: nodes[' + String(index) + '] must be an object')
		const id = text(raw.id, 'nodes[' + String(index) + '].id')
		if (known.has(id)) throw new LabInvariantError('experiment.yml: duplicate node ' + id)
		known.add(id)
		const type = raw.type
		if (type !== 'switch' && type !== 'server' && type !== 'management') throw new LabInvariantError('experiment.yml: node ' + id + ' has invalid type')
		return {
			id,
			type,
			label: text(raw.label, 'node ' + id + '.label'),
			device: typeof raw.device === 'string' ? raw.device : undefined,
			role: typeof raw.role === 'string' ? raw.role : undefined,
			caption: typeof raw.caption === 'string' ? raw.caption : undefined,
			ports: typeof raw.ports === 'number' ? raw.ports : undefined,
			position: position(raw.position, 'node ' + id + '.position'),
		}
	})
	const links: ExperimentLinkDefinition[] = Array.isArray(parsed.links) ? parsed.links.map((raw, index) => {
		if (!isRecord(raw)) throw new LabInvariantError('experiment.yml: links[' + String(index) + '] must be an object')
		const from = endpoint(raw.from, 'links[' + String(index) + '].from')
		const to = endpoint(raw.to, 'links[' + String(index) + '].to')
		if (!known.has(from.node) || !known.has(to.node)) throw new LabInvariantError('experiment.yml: link references an unknown node')
		return {
			id: text(raw.id, 'links[' + String(index) + '].id'),
			from,
			to,
			label: typeof raw.label === 'string' ? raw.label : undefined,
			bundle: typeof raw.bundle === 'string' ? raw.bundle : undefined,
			speed: typeof raw.speed === 'string' ? raw.speed : undefined,
			color: typeof raw.color === 'string' ? raw.color : undefined,
			count: typeof raw.count === 'number' ? raw.count : undefined,
		}
	}) : []
	const definition: ExperimentDefinition = {
		apiVersion: 'soniclab/v1',
		kind: 'Experiment',
		metadata: {
			name: text(parsed.metadata.name, 'metadata.name'),
			title: text(parsed.metadata.title, 'metadata.title'),
			description: typeof parsed.metadata.description === 'string' ? parsed.metadata.description : undefined,
		},
		render: {
			defaultView: render.defaultView === 'logical' ? 'logical' : 'ppt',
			width: typeof render.width === 'number' ? render.width : undefined,
			height: typeof render.height === 'number' ? render.height : undefined,
		},
		nodes,
		links,
	}
	return { loadedAt: Date.now(), source: path, definition }
}
