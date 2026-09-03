#!/usr/bin/env node
/**
 * lab-ssh.mjs — FAST agent entry for ZNSL lab switches. Zero-decision usage:
 *
 *   node lab-ssh.mjs                            -> list switches
 *   node lab-ssh.mjs sw1                        -> connectivity check
 *   node lab-ssh.mjs sw1 "show version"         -> one command
 *   node lab-ssh.mjs sw1 "cmd1" "cmd2"          -> several commands, ONE ssh chain
 *   node lab-ssh.mjs all "show lldp table"      -> all switches IN PARALLEL
 *
 * Output sections are delimited by "##### <sw> | <cmd> #####".
 * Built-in timeouts: 30s per command, 90s global (exit 124). Never hangs.
 *
 * Credentials: env LAB_JUMP_USER/LAB_JUMP_PASS > lab.local.json > lab.json.
 * Never hardcode credentials here; never commit lab.local.json.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Client } from 'ssh2'

const CMD_TIMEOUT = 30_000
const GLOBAL_TIMEOUT = 90_000

setTimeout(() => {
  console.error('[GLOBAL-TIMEOUT] aborted after ' + GLOBAL_TIMEOUT / 1000 + 's')
  process.exit(124)
}, GLOBAL_TIMEOUT).unref()

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lab = JSON.parse(readFileSync(join(root, 'lab.json'), 'utf8'))
const loadLocal = (name) => { try { return JSON.parse(readFileSync(join(root, name), 'utf8')) } catch { return {} } }
const local = loadLocal('lab.local.json')

const jump = { ...(lab.jumphost ?? {}), ...(local.jumphost ?? {}) }
if (process.env.LAB_JUMP_USER !== undefined) jump.username = process.env.LAB_JUMP_USER
if (process.env.LAB_JUMP_PASS !== undefined) jump.password = process.env.LAB_JUMP_PASS
const swAccount = { ...(lab.switch ?? {}), ...(local.switch ?? {}) }

const TARGET = process.argv[2] ?? ''
const COMMANDS = process.argv.slice(3).filter((a) => a.trim().length > 0)

const listInventory = () => {
  console.log('ZNSL lab switches:')
  for (const item of lab.switches) console.log('  ' + item.id.padEnd(4) + item.ip + '  group ' + item.group + '  ' + (item.model ?? ''))
  console.log('usage: node lab-ssh.mjs <sw1|sw2|sw3|sw4|all> ["cmd1" "cmd2" ...]')
}

const connect = (opts) => new Promise((resolve, reject) => { const c = new Client(); c.on('ready', () => resolve(c)); c.on('error', reject); c.connect({ ...opts, readyTimeout: 12000 }) })

const run = (client, cmd) => new Promise((resolve, reject) => {
  let done = false
  const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('CMD-TIMEOUT ' + CMD_TIMEOUT / 1000 + 's')) } }, CMD_TIMEOUT)
  client.exec(cmd, (error, stream) => {
    if (error !== undefined && error !== null) { clearTimeout(timer); if (!done) { done = true; reject(error) } return }
    let out = ''
    stream.on('data', (chunk) => { out += String(chunk) })
    stream.stderr.on('data', (chunk) => { out += String(chunk) })
    stream.on('close', () => { clearTimeout(timer); if (!done) { done = true; resolve(out) } })
  })
})

const runOnSwitch = async (sw, cmds) => {
  const jumpClient = await connect({ host: jump.host, port: jump.port ?? 22, username: jump.username, password: jump.password })
  try {
    const targetClient = await new Promise((resolve, reject) => {
      jumpClient.forwardOut('127.0.0.1', 0, sw.ip, swAccount.port ?? 22, (error, stream) => {
        if (error !== undefined && error !== null) { reject(error); return }
        const inner = new Client()
        inner.on('ready', () => resolve(inner))
        inner.on('error', reject)
        inner.connect({ sock: stream, username: swAccount.username, password: swAccount.password, readyTimeout: 12000 })
      })
    })
    try {
      if (cmds.length === 0) return sw.id + ' ' + sw.ip + ' reachable as ' + swAccount.username
      const parts = []
      for (const cmd of cmds) {
        try { parts.push('##### ' + sw.id + ' | ' + cmd + ' #####\n' + await run(targetClient, cmd)) }
        catch (e) { parts.push('##### ' + sw.id + ' | ' + cmd + ' #####\n[ERROR] ' + e.message) }
      }
      return parts.join('\n')
    } finally { targetClient.end() }
  } finally { jumpClient.end() }
}

if (TARGET.length === 0) { listInventory(); process.exit(0) }

if (TARGET === 'all') {
  const cmds = COMMANDS
  const results = await Promise.all(lab.switches.map((sw) => runOnSwitch(sw, cmds).catch((e) => '##### ' + sw.id + ' | ERROR #####\n' + e.message)))
  console.log(results.join('\n\n'))
  process.exit(0)
}

const sw = lab.switches.find((item) => item.id === TARGET || item.ip === TARGET)
if (sw === undefined) { console.error('unknown switch: ' + TARGET); listInventory(); process.exit(2) }
try {
  console.log(await runOnSwitch(sw, COMMANDS))
  process.exit(0)
} catch (error) {
  console.error('[ERROR] ' + sw.id + ': ' + (error instanceof Error ? error.message : String(error)))
  process.exit(3)
}
