/**
 * ssh2-based two-hop collector: one connection to the jumphost, then one
 * direct-tcpip channel per switch (the same shape as the reference paramiko
 * flow in the lab skill docs). Every command this module can ever issue is
 * a fixed string defined here - there is no code path that executes a
 * caller-supplied command. Read-only by construction:
 *   switch probes : show interfaces status / show lldp table / show version
 *   jumphost      : sws / "swl | tail -N"
 */
import { Client, type ConnectConfig } from 'ssh2'
import type { LabConfig } from './config.ts'

export interface ExecResult {
	out: string
	err: string
	code: number | null
}

const execOnClient = (client: Client, command: string, timeoutMs: number): Promise<ExecResult> =>
	new Promise((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error('command timed out after ' + timeoutMs + 'ms: ' + command.slice(0, 60)))
		}, timeoutMs)
		client.exec(command, (execError, stream) => {
			if (execError !== undefined && execError !== null) {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(execError)
				return
			}
			if (stream === undefined) {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(new Error('ssh exec returned no stream'))
				return
			}
			let out = ''
			let err = ''
			stream.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
			stream.on('stderr', (chunk: Buffer) => { err += chunk.toString('utf8') })
			stream.on('close', (code: number | null) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve({ out, err, code })
			})
			stream.on('error', (streamError: Error) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(streamError)
			})
		})
	})

const connectClient = (options: ConnectConfig): Promise<Client> =>
	new Promise((resolve, reject) => {
		const client = new Client()
		const fail = (error: Error): void => {
			client.end()
			reject(error)
		}
		client.on('ready', () => { resolve(client) })
		client.on('error', fail)
		client.connect(options)
	})

/** The only jumphost commands this plugin may run (read-only lock state). */
export const JUMP_CMD = {
	sws: 'sws',
	locklog: 'swl | tail -30',
} as const

/** The only switch commands this plugin may run (read-only show). */
export const SWITCH_CMD = {
	interfaces: 'show interfaces status',
	lldp: 'show lldp table',
	version: 'show version',
	ipInterfaces: 'show ip interfaces',
} as const

export interface SwitchProbe {
	interfaces: ExecResult
	lldp: ExecResult
	version: ExecResult
	ipInterfaces: ExecResult
}

export interface CollectOutput {
	locks: { raw: string; error?: string }
	switches: Map<string, { probe?: SwitchProbe; error?: string }>
}

/**
 * One collection round: connect to the jumphost once, read the lock state,
 * then probe every configured switch in parallel over its own
 * direct-tcpip channel. Per-switch failures are captured, never thrown -
 * the topology shows the switch as unreachable with its error.
 */
export async function collect(lab: LabConfig, timeoutMs: number): Promise<CollectOutput> {
	const jump = await connectClient({
		host: lab.jumphost.host,
		port: lab.jumphost.port ?? 22,
		username: lab.jumphost.username,
		password: lab.jumphost.password,
		readyTimeout: Math.min(timeoutMs, 12000),
	})
	try {
		const locks = await execOnClient(jump, JUMP_CMD.sws, timeoutMs)
			.then((result) => ({ raw: result.out + (result.err.length > 0 ? '\n' + result.err : '') }))
			.catch((error: unknown) => ({ raw: '', error: String(error instanceof Error ? error.message : error) }))
		const switches = new Map<string, { probe?: SwitchProbe; error?: string }>()
		await Promise.allSettled(lab.switches.map(async (sw) => {
			const channel = await new Promise<Client>((resolve, reject) => {
				jump.forwardOut('127.0.0.1', 0, sw.ip, lab.switch.port ?? 22, (error, stream) => {
					if (error !== undefined && error !== null) {
						reject(error)
						return
					}
					if (stream === undefined) {
						reject(new Error('forwardOut returned no stream'))
						return
					}
					const target = new Client()
					target.on('ready', () => { resolve(target) })
					target.on('error', (targetError: Error) => { reject(targetError) })
					target.connect({
						sock: stream,
						username: lab.switch.username,
						password: lab.switch.password,
						readyTimeout: Math.min(timeoutMs, 12000),
					})
				})
			})
			try {
				const [interfaces, lldp, version, ipInterfaces] = await Promise.all([
					execOnClient(channel, SWITCH_CMD.interfaces, timeoutMs),
					execOnClient(channel, SWITCH_CMD.lldp, timeoutMs),
					execOnClient(channel, SWITCH_CMD.version, timeoutMs),
					execOnClient(channel, SWITCH_CMD.ipInterfaces, timeoutMs),
				])
				switches.set(sw.id, { probe: { interfaces, lldp, version, ipInterfaces } })
			} finally {
				channel.end()
			}
		}))
		for (const sw of lab.switches) {
			if (!switches.has(sw.id)) {
				switches.set(sw.id, { error: 'probe failed (ssh channel or exec error)' })
			}
		}
		return { locks, switches }
	} finally {
		jump.end()
	}
}

/** Update only an interface description; callers cannot submit arbitrary commands. */
export async function setInterfaceDescription(lab: LabConfig, switchId: string, interfaceName: string, description: string, timeoutMs: number): Promise<ExecResult> {
	if (!/^Ethernet\d+$/.test(interfaceName)) throw new Error('only Ethernet interfaces can be modified')
	if (description.length > 128 || /[\r\n]/.test(description)) throw new Error('description must be one line and at most 128 characters')
	const sw = lab.switches.find((item) => item.id === switchId)
	if (sw === undefined) throw new Error('unknown switch')
	const jump = await connectClient({ host: lab.jumphost.host, port: lab.jumphost.port ?? 22, username: lab.jumphost.username, password: lab.jumphost.password, readyTimeout: Math.min(timeoutMs, 12000) })
	try {
		const channel = await new Promise<Client>((resolve, reject) => {
			jump.forwardOut('127.0.0.1', 0, sw.ip, lab.switch.port ?? 22, (error, stream) => {
				if (error !== undefined && error !== null) { reject(error); return }
				if (stream === undefined) { reject(new Error('forwardOut returned no stream')); return }
				const target = new Client()
				target.on('ready', () => resolve(target))
				target.on('error', reject)
				target.connect({ sock: stream, username: lab.switch.username, password: lab.switch.password, readyTimeout: Math.min(timeoutMs, 12000) })
			})
		})
		try {
			const quoted = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
			return await execOnClient(channel, 'sudo config interface description ' + interfaceName + ' "' + quoted + '"', timeoutMs)
		} finally { channel.end() }
	} finally { jump.end() }
}

/** Read the lock log (swl | tail -30) over a fresh short-lived connection. */
export async function collectLockLog(lab: LabConfig, timeoutMs: number): Promise<{ text: string; error?: string }> {
	const jump = await connectClient({
		host: lab.jumphost.host,
		port: lab.jumphost.port ?? 22,
		username: lab.jumphost.username,
		password: lab.jumphost.password,
		readyTimeout: Math.min(timeoutMs, 12000),
	})
	try {
		const result = await execOnClient(jump, JUMP_CMD.locklog, timeoutMs)
		return { text: result.out + (result.err.length > 0 ? '\n' + result.err : '') }
	} catch (error) {
		return { text: '', error: String(error instanceof Error ? error.message : error) }
	} finally {
		jump.end()
	}
}
