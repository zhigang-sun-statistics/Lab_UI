/**
 * Parsers for the SONiC CLI tables this plugin reads. All inputs come from
 * fixed probes the collector itself issues (never from client strings), so
 * the parsers may be strict about shape and simply yield empty results on
 * unexpected output - a parse gap degrades one panel, never the API.
 *
 * Column strategy: SONiC builds pad the header row and the data rows with
 * DIFFERENT widths (the header is centered per column), so header-offset
 * slicing misreads values. The dash separator row, however, marks the exact
 * data spans - so columns come from the separator runs and names map onto
 * them by order.
 */

export interface TableRow {
	[name: string]: string
}

/** Strip ANSI SGR/ESC sequences (the sws banner is colorful). */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

interface ColumnSpan {
	name: string
	start: number
	end: number
}

const isSeparatorLine = (line: string): boolean =>
	line.trim().length > 0 && /^[-\s]+$/.test(line) && line.includes('--')

/**
 * Parse a fixed-width CLI table: column spans from the dash separator row,
 * names mapped by order from the header word groups. Rows are sliced at the
 * spans. A trailing "N entries" line is dropped. When no separator row (or a
 * count mismatch between header groups and spans) exists, falls back to a
 * two-plus-space split per row with the header's names.
 */
export function parseFixedWidthTable(text: string): TableRow[] {
	const clean = stripAnsi(text)
	const lines = clean.split(/\r?\n/).filter((line) => line.trim().length > 0)
	if (lines.length === 0) return []
	const separatorIndex = lines.findIndex((line, index) => index > 0 && isSeparatorLine(line))
	// The header is the line directly above the separator; lldp output opens
	// with a "Capability codes: ..." preamble that must not become column names.
	const headerIndex = separatorIndex > 0 ? separatorIndex - 1 : 0
	const headerLine = lines[headerIndex] ?? ''
	const headerGroups = headerLine.trim().split(/\s{2,}/).filter((g) => g.trim().length > 0)
	let columns: ColumnSpan[] = []
	if (separatorIndex > 0) {
		const separator = lines[separatorIndex] ?? ''
		const runs: Array<{ start: number; end: number }> = []
		for (const match of separator.matchAll(/-+/g)) {
			const start = match.index ?? 0
			runs.push({ start, end: start + match[0].length })
		}
		// Widen each span by one char on both sides: values may touch the
		// dash boundary without a space (e.g. "Ethernet0_1").
		for (const run of runs) run.start = Math.max(0, run.start - 1)
		if (runs.length === headerGroups.length) {
			columns = runs.map((run, index) => ({ name: (headerGroups[index] ?? '').trim(), start: run.start, end: run.end + 1 }))
		}
	}
	const dataLines = lines.slice((separatorIndex > 0 ? separatorIndex : 0) + 1)
	const rows: TableRow[] = []
	for (const line of dataLines) {
		if (isSeparatorLine(line)) continue
		const trimmed = line.trim()
		if (/^\d+\s+entr/i.test(trimmed)) continue
		const row: TableRow = {}
		if (columns.length > 0) {
			let any = false
			for (const col of columns) {
				const value = line.slice(col.start, col.end).trim()
				row[col.name] = value
				if (value.length > 0) any = true
			}
			if (any) rows.push(row)
		} else {
			const cells = trimmed.split(/\s{2,}/)
			if (cells.length < 2) continue
			let any = false
			headerGroups.forEach((name, index) => {
				const value = cells[index] ?? ''
				row[name] = value
				if (value.length > 0) any = true
			})
			if (any) rows.push(row)
		}
	}
	return rows
}

export interface InterfaceStatusRow {
	name: string
	alias?: string
	speed?: string
	oper?: string
	admin?: string
	vlan?: string
	description?: string
}

const INTERFACE_KEY_RE = /^(?:Ethernet[\d_]+|Eth\d+|Management\d+|Vlan\d+|PortChannel\d+|Loopback\d+)/i

/**
 * `show interfaces status` -> interface rows.
 */
export function parseInterfaceStatus(text: string): InterfaceStatusRow[] {
	const rows: InterfaceStatusRow[] = []
	const find = (row: TableRow, ...names: string[]): string | undefined => {
		for (const name of names) {
			const value = row[name]
			if (value !== undefined && value.length > 0) return value
		}
		return undefined
	}
	for (const row of parseFixedWidthTable(text)) {
		const name = find(row, 'Interface', 'Iface', 'iface') ?? ''
		if (!INTERFACE_KEY_RE.test(name)) continue
		rows.push({
			name,
			alias: find(row, 'Alias', 'alias'),
			speed: find(row, 'Speed', 'speed'),
			oper: find(row, 'Oper', 'oper'),
			admin: find(row, 'Admin', 'admin'),
			vlan: find(row, 'Vlan', 'VLAN', 'Mode', 'mode'),
			description: find(row, 'Description', 'description', 'Desc'),
		})
	}
	return rows
}

/** Parse `show ip interfaces`; tolerant of vendor table variants. */
export function parseIpInterfaces(text: string): Map<string, string[]> {
	const result = new Map<string, string[]>()
	for (const line of stripAnsi(text).split(/\r?\n/)) {
		const match = line.match(/\b(Ethernet\d+)\b.*?\b((?:\d{1,3}\.){3}\d{1,3}\/\d{1,3}|[0-9a-f:]+\/\d{1,3})\b/iu)
		if (match === null) continue
		const name = match[1] ?? ''
		const address = match[2] ?? ''
		if (name.length > 0 && address.length > 0) result.set(name, [...(result.get(name) ?? []), address])
	}
	return result
}

export interface LldpRow {
	peer: string
	localPort: string
	peerPort: string
}

/**
 * `show lldp table` -> neighbor rows. Two column layouts exist:
 *
 *   older : Device ID | Local Intf | Hold-time | Capability | Port ID
 *   ctc   : LocalPort | RemoteDevice | RemotePortID | Capability | RemotePortDescr
 *
 * On the ctc layout RemoteDevice is a useless chassis id ("localhost") but
 * RemotePortDescr encodes "<peer>_<port>" (e.g. "sw4_Ethernet26"), which
 * carries both the peer device and its canonical port name - so that field
 * wins when present.
 */
export function parseLldpTable(text: string): LldpRow[] {
	const rows: LldpRow[] = []
	for (const row of parseFixedWidthTable(stripAnsi(text))) {
		const localPort = row['LocalPort'] ?? row['Local Intf'] ?? row['LocalIntf'] ?? row['Local'] ?? ''
		if (localPort.length === 0) continue
		const descr = row['RemotePortDescr'] ?? row['Remote Port Descr'] ?? ''
		const descrMatch = descr.match(/^([A-Za-z][\w-]*)_(.+)$/)
		if (descrMatch !== null) {
			rows.push({ peer: descrMatch[1] ?? '', localPort, peerPort: descrMatch[2] ?? '' })
			continue
		}
		const peer = row['Device ID'] ?? row['DeviceID'] ?? row['Device'] ?? row['RemoteDevice'] ?? ''
		const peerPort = row['Port ID'] ?? row['PortID'] ?? row['Port'] ?? row['RemotePortID'] ?? ''
		if (peer.length === 0 || peerPort.length === 0) continue
		rows.push({ peer, localPort, peerPort })
	}
	return rows
}

export interface LockGroupRaw {
	group: string
	state: 'free' | 'busy' | 'unknown'
	raw: string
}

/**
 * `sws` (jumphost lock status) -> per-group states. The banner carries
 * ANSI colors and a shared-mode notice; anything unparsable maps to
 * 'unknown' with the raw line preserved. When the banner announces shared
 * mode (no locking), an empty result is expected.
 */
export function parseSws(text: string): LockGroupRaw[] {
	const groups: LockGroupRaw[] = []
	for (const line of stripAnsi(text).split(/\r?\n/)) {
		const groupMatch = line.match(/\b([AB])\b/)
		if (groupMatch === null) continue
		const group = groupMatch[1] ?? ''
		const busy = /busy|占用/i.test(line)
		const free = /free|空闲/i.test(line)
		if (!busy && !free) continue
		groups.push({ group, state: busy ? 'busy' : 'free', raw: line.trim() })
	}
	return groups
}
