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

export function buildTopology(lab: LabConfig, collected: CollectOutput): { switches: SwitchState[]; links: LinkState[] } {
	const byNameOrId = new Map<string, string>()
	for (const sw of lab.switches) {
		byNameOrId.set(sw.name, sw.id)
		byNameOrId.set(sw.id, sw.id)
	}
	const switches: SwitchState[] = []
	const lldpLinks = new Map<string, LinkState>()
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
			for (const row of lldp) peers.set(row.localPort, { device: row.peer, port: row.peerPort })
			state.ports = ports.map((port) => ({ ...port, description: descriptions.get(port.name) ?? port.description, counters: counters.get(port.name), ipAddresses: ipAddresses.get(port.name), lldpPeer: peers.get(port.name) }))
			for (const [localPort, peer] of peers) {
				const peerSwId = byNameOrId.get(peer.device)
				if (peerSwId === undefined || peerSwId === sw.id) continue
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
		}
		switches.push(state)
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
