import WebSocket from 'ws'
const ws = new WebSocket('ws://127.0.0.1:43120/api/lab/ssh?switch=sw1')
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const strip = (s) => s.split(ESC + '[').map(part => part.replace(/^[0-9;?]*[a-zA-Z]/, '')).join('').split(ESC + ']').map(part => part.slice(part.includes(BEL) ? part.indexOf(BEL) + 1 : 0)).join('').replaceAll(ESC, '').replaceAll(String.fromCharCode(13), '')
let buf = ''
const t0 = Date.now()
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
ws.on('open', () => { console.log('[' + el() + '] WS OPEN -> /api/lab/ssh?switch=sw1'); ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 })) })
ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'data') buf += m.data; if (m.type === 'error') console.log('[' + el() + '] ERROR:', m.message) })
ws.on('close', () => { console.log('[' + el() + '] WS CLOSED'); process.exit(0) })
const send = (cmd) => { console.log(''); console.log('[' + el() + '] >>> ' + cmd); buf = ''; ws.send(JSON.stringify({ type: 'input', data: cmd + String.fromCharCode(10) })) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const report = () => { const lines = strip(buf).split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.length > 0 && !l.includes('>>>') && !/^(admin@|\$ |show |Last login)/.test(l)); console.log(lines.join(String.fromCharCode(10))) }
await wait(3500)
send('show clock'); await wait(1500); report()
send('show version | head -6'); await wait(2000); report()
send('show interfaces status | grep -c up'); await wait(2000); report()
console.log('')
console.log('[' + el() + '] closing session')
ws.close()
setTimeout(() => process.exit(0), 800)
