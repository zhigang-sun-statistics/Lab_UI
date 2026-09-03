import WebSocket from 'ws'
const commands = process.argv.slice(2)
if (commands.length === 0) { console.error('usage: node ws-run.mjs "cmd1" "cmd2"'); process.exit(1) }
const ws = new WebSocket('ws://127.0.0.1:43120/api/lab/ssh?switch=sw1')
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const strip = (s) => s.split(ESC + '[').map(part => part.replace(/^[0-9;?]*[a-zA-Z]/, '')).join('').split(ESC + ']').map(part => part.slice(part.includes(BEL) ? part.indexOf(BEL) + 1 : 0)).join('').replaceAll(ESC, '').replaceAll(String.fromCharCode(13), '')
let buf = ''
const t0 = Date.now()
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
ws.on('open', () => { console.log('[' + el() + '] WS OPEN -> sw1'); ws.send(JSON.stringify({ type: 'resize', cols: 110, rows: 30 })) })
ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'data') buf += m.data; if (m.type === 'error') console.log('[' + el() + '] ERROR:', m.message) })
ws.on('close', () => { process.exit(0) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = (cmd) => { console.log(''); console.log('[' + el() + '] >>> ' + cmd); buf = ''; ws.send(JSON.stringify({ type: 'input', data: cmd + String.fromCharCode(10) })) }
const report = (cmd) => {
  const lines = strip(buf).split(String.fromCharCode(10)).map((l) => l.replace(/^.*\$ /, '').trim()).filter((l) => l.length > 0 && l !== cmd && !l.endsWith(cmd) && !/^Last login/.test(l) && !/^admin@/.test(l))
  console.log(lines.join(String.fromCharCode(10)))
}
await wait(3000)
for (const cmd of commands) {
  send(cmd)
  await wait(cmd.includes('counters') ? 4500 : 2500)
  report(cmd)
}
console.log('')
console.log('[' + el() + '] done')
ws.close()
setTimeout(() => process.exit(0), 500)
