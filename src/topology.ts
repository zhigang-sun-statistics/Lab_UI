/**
 * Merge the collector output (interfaces status + LLDP + version per
 * switch) with the static lab.json cabling into the wire topology. LLDP
 * links seen from both ends collapse into one cable; static links not
 * confirmed by LLDP survive as dashed 'static' edges.
 */
import type { CollectOutput } from './collector.ts'
import { parseInterfaceCounters, parseInterfaceDescriptions, parseInterfaceStatus, parseIpInterfaces, parseLldpTable } from './parser.ts'
import type { LabConfig } from './config.ts'
import type { LinkState, SwitchState } from './types.ts'

const linkKey = (a: { sw: string; port: string }, b: { sw: string; port: string }): string => {
	const first = a.sw < b.sw ? a : b
	const second = a.sw < b.sw ? b : a
	return first.sw + ':' + first.port + '--' + second.sw + ':' + second.port
}

/** Alias form (eth-0-29) or canonical form (Ethernet28) -> physical slot. */
const portSlotOf = (port: string): number | undefined => {
	const alias = port.match(/^eth-\d+-(\d+)$/i)
	if (alias?.[1] !== undefined) return Number(alias[1]) - 1
	const eth = port.match(/^Ethernet(\d+)$/i)
	if (eth?.[1] !== undefined) return Number(eth[1])
	return undefined
}

/** Canonicalize an alias peer port (eth-0-29 -> Ethernet28) for display. */
const canonicalPort = (port: string): string => {
	const slot = portSlotOf(port)
	return slot === undefined ? port : 'Ethernet' + String(slot)
}

export function buildTopology(lab: LabConfig, collected: CollectOutput): { switches: SwitchState[]; links: LinkState[] } {
	const byNameOrId = new Map<string, string>()
	for (const sw of lab.switches) {
		byNameOrId.set(sw.name, sw.id)
		byNameOrId.set(sw.id, sw.id)
	}
	const switches: SwitchState[] = []
	const lldpLinks = new Map<string, LinkState>()
	const unresolvedBySwitch: Array<{ switchId: string; unresolved: Array<{ localPort: string; peerPort: string }> }> = []
	for (const sw of lab.switches) {
		const entry = collected.switches.get(sw.id)
		const probe = entry?.probe
		const state: SwitchState = {
			id: sw.id,
			name: sw.name,
			ip: sw.ip,
			group: sw.group,
			model: sw.model,
			reachable: probe !== undefined,
			error: entry?.error,
			ports: [],
		}
		if (probe !== undefined) {
			state.version = (probe.version.out.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '').trim()
			const ports = parseInterfaceStatus(probe.interfaces.out + '\n' + probe.interfaces.err)
			const lldp = parseLldpTable(probe.lldp.out + '\n' + probe.lldp.err)
			const ipAddresses = parseIpInterfaces(probe.ipInterfaces.out + '\n' + probe.ipInterfaces.err)
			const counters = parseInterfaceCounters(probe.counters.out + '\n' + probe.counters.err)
			const descriptions = parseInterfaceDescriptions(probe.descriptions.out + '\n' + probe.descriptions.err)
			const peers = new Map<string, { device: string; port: string }>()
			for (const row of lldp) peers.set(row.localPort, { device: row.peer, port: canonicalPort(row.peerPort) })
			state.ports = ports.map((port) => ({ ...port, description: descriptions.get(port.name) ?? port.description, counters: counters.get(port.name), ipAddresses: ipAddresses.get(port.name), lldpPeer: peers.get(port.name) }))
			const unresolved: Array<{ localPort: string; peerPort: string }> = []
			for (const [localPort, peer] of peers) {
				const peerSwId = byNameOrId.get(peer.device)
				if (peerSwId === undefined) {
					// Neighbor hostname is not a lab switch (e.g. the Centec
					// default "localhost"). Remember it for reciprocal pairing.
					unresolved.push({ localPort, peerPort: peer.port })
					continue
				}
				if (peerSwId === sw.id) continue
				const key = linkKey({ sw: sw.id, port: localPort }, { sw: peerSwId, port: peer.port })
				if (!lldpLinks.has(key)) {
					lldpLinks.set(key, {
						id: key,
						a: { sw: sw.id, port: localPort },
						b: { sw: peerSwId, port: peer.port },
						source: 'lldp',
					})
				}
			}
			unresolvedBySwitch.push({ switchId: sw.id, unresolved })
		}
		switches.push(state)
	}
	// Reciprocal pairing for neighbors whose hostname names no lab switch
	// (the Centec default "localhost"). The lab cables same-numbered ports
	// (the resolved sw3-sw4 link is Ethernet14<->Ethernet14), so when exactly
	// two switches each hold ONE unresolved neighbor on the same physical
	// slot, both ends refer to the same cable. Anything ambiguous (>2
	// switches, duplicate ports on one switch, unknown slot) stays unlinked.
	const bySlot = new Map<number, Map<string, { switchId: string; localPort: string }>>()
	for (const { switchId, unresolved } of unresolvedBySwitch) {
		for (const entry of unresolved) {
			const slot = portSlotOf(entry.peerPort)
			if (slot === undefined) continue
			const perSwitch = bySlot.get(slot) ?? new Map<string, { switchId: string; localPort: string }>()
			if (!perSwitch.has(switchId)) perSwitch.set(switchId, { switchId, localPort: entry.localPort })
			bySlot.set(slot, perSwitch)
		}
	}
	for (const perSwitch of bySlot.values()) {
		if (perSwitch.size !== 2) continue
		const [first, second] = [...perSwitch.values()]
		if (first === undefined || second === undefined) continue
		const key = linkKey({ sw: first.switchId, port: first.localPort }, { sw: second.switchId, port: second.localPort })
		if (!lldpLinks.has(key)) {
			lldpLinks.set(key, {
				id: key,
				a: { sw: first.switchId, port: first.localPort },
				b: { sw: second.switchId, port: second.localPort },
				source: 'lldp',
				note: '对端主机名未命名，LLDP 按同号端口配对',
			})
		}
	}
	const links = new Map<string, LinkState>(lldpLinks)
	for (const link of lab.links) {
		const key = linkKey(link.a, link.b)
		const existing = links.get(key)
		if (existing !== undefined) {
			existing.source = 'both'
			existing.note = link.note
		} else {
			links.set(key, { id: key, a: link.a, b: link.b, source: 'static', note: link.note })
		}
	}
	return { switches, links: [...links.values()] }
}
