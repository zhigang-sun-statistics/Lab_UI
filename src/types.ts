/**
 * Wire types shared by the host API routes and the client tab. Everything
 * crossing /api/lab/* is one of these shapes; keep them JSON-safe.
 */

/** One port of one switch, merged from `show interfaces status` + LLDP. */
export interface PortState {
	/** SONiC interface name, e.g. "Ethernet48". */
	name: string
	/** Vendor alias, e.g. "etp49" (absent when parsing failed). */
	alias?: string
	/** Configured speed, e.g. "10G" / "100G". */
	speed?: string
	/** Oper status: "up" | "down" (absent when unknown). */
	oper?: string
	/** Admin status: "up" | "down". */
	admin?: string
	/** VLAN / routed marker from the status table. */
	vlan?: string
	/** LLDP peer discovered on this port (device id + port id). */
	lldpPeer?: { device: string; port: string }
}

/** One switch's live snapshot. */
export interface SwitchState {
	id: string
	name: string
	ip: string
	group: string
	model?: string
	reachable: boolean
	error?: string
	/** First line of `show version` (build string). */
	version?: string
	ports: PortState[]
}

/** How a link became known. */
export type LinkSource = 'lldp' | 'static' | 'both'

/** One cable between two switch ports. */
export interface LinkState {
	id: string
	a: { sw: string; port: string }
	b: { sw: string; port: string }
	source: LinkSource
	note?: string
}

/** GET /api/lab/topology response. */
export interface TopologyResponse {
	fetchedAt: number
	/** ms the collector took (0 when cache-served without refresh). */
	durationMs: number
	cached: boolean
	switches: SwitchState[]
	links: LinkState[]
}

/** One lock group (A/B) parsed from the jumphost `sws` output. */
export interface LockGroup {
	group: string
	state: 'free' | 'busy' | 'unknown'
	/** Raw line from sws for display when parsing is uncertain. */
	raw?: string
}

/** GET /api/lab/locks response. */
export interface LocksResponse {
	fetchedAt: number
	groups: LockGroup[]
	raw: string
	error?: string
}

/** GET /api/lab/locklog response. */
export interface LockLogResponse {
	fetchedAt: number
	lines: string[]
	error?: string
}

/** YAML-driven experiment topology intent. Live snapshots validate this model. */
export type ExperimentNodeType = 'switch' | 'server' | 'management'
export type ExperimentLinkStatus = 'collecting' | 'matched-up' | 'matched-down' | 'mismatch' | 'unknown'

export interface ExperimentNodeDefinition {
	id: string
	type: ExperimentNodeType
	label: string
	device?: string
	role?: string
	caption?: string
	ports?: number
	position: { x: number; y: number }
}

export interface ExperimentEndpointDefinition {
	node: string
	interface?: string
	label?: string
	address?: string
	annotation?: { dx: number; dy: number; align?: 'left' | 'center' | 'right' }
}

export interface ExperimentLinkDefinition {
	id: string
	from: ExperimentEndpointDefinition
	to: ExperimentEndpointDefinition
	label?: string
	bundle?: string
	speed?: string
	color?: string
	count?: number
}

export interface ExperimentDefinition {
	apiVersion: 'soniclab/v1'
	kind: 'Experiment'
	metadata: { name: string; title: string; description?: string }
	render: { defaultView: 'ppt' | 'logical'; width?: number; height?: number }
	nodes: ExperimentNodeDefinition[]
	links: ExperimentLinkDefinition[]
}

export interface ExperimentResponse {
	loadedAt: number
	source: string
	definition: ExperimentDefinition
}
