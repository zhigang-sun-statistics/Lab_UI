import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './ssh.css'

const semanticToken = /Ethernet\d+|PortChannel\d+|Vlan\d+|\b(?:up|connected|success|ready)\b|\b(?:down|disconnected|failed|failure|error|fault|denied)\b|\bnot present\b|\b(?:warning|warn|never)\b|\b(?:routed|trunk)\b|\b(?:rs|fc|N\/A)\b|\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?\b|\b\d+(?:\.\d+)?(?:G|M|K|B\/s|b\/s|\/s|pps|PPS|%)\b/gi

const semanticColor = (token: string): string => {
  if (/^(?:Ethernet|PortChannel|Vlan)/i.test(token)) return '\x1b[38;2;79;201;222m' + token + '\x1b[39m'
  if (/^(?:up|connected|success|ready)$/i.test(token)) return '\x1b[1;38;2;83;220;164m' + token + '\x1b[22;39m'
  if (/^(?:down|disconnected|failed|failure|error|fault|denied|not present)$/i.test(token)) return '\x1b[1;38;2;241;112;124m' + token + '\x1b[22;39m'
  if (/^(?:warning|warn|never)$/i.test(token)) return '\x1b[38;2;231;181;92m' + token + '\x1b[39m'
  if (/^(?:routed|trunk)$/i.test(token)) return '\x1b[38;2;149;133;238m' + token + '\x1b[39m'
  if (/^(?:rs|fc|N\/A)$/i.test(token)) return '\x1b[38;2;198;144;229m' + token + '\x1b[39m'
  if (/^\d{1,3}(?:\.\d{1,3}){3}/.test(token)) return '\x1b[38;2;102;176;255m' + token + '\x1b[39m'
  return '\x1b[38;2;238;196;103m' + token + '\x1b[39m'
}

const ansiSequence = /(\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)))/g

/** MobaXterm-like highlighting while preserving device-provided ANSI sequences. */
const colorizeOutput = (data: string): string => data.split(ansiSequence).map((part) => part.startsWith('\x1b') ? part : part.replace(semanticToken, semanticColor)).join('')

export type SshConnectionState = 'connecting' | 'connected' | 'closed' | 'error'

export function SshTerminal({ switchId, onConnectionChange }: { switchId: string; onConnectionChange?: (state: SshConnectionState) => void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (host.current === null || !/^sw\d+$/.test(switchId)) { onConnectionChange?.('error'); return }
    onConnectionChange?.('connecting')
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: 'MobaFont, Cascadia Mono, JetBrains Mono, Consolas, monospace', fontSize: 14, lineHeight: 1.2, theme: { background: '#1e1e1e', foreground: '#ececec', cursor: '#b4b4c0', cursorAccent: '#1e1e1e', selectionBackground: '#4a5260', black: '#000000', brightBlack: '#808080', red: '#bb0000', brightRed: '#ff5555', green: '#00bb00', brightGreen: '#55ff55', yellow: '#bbbb00', brightYellow: '#ffff55', blue: '#0000bb', brightBlue: '#5555ff', magenta: '#bb00bb', brightMagenta: '#ff55ff', cyan: '#00bbbb', brightCyan: '#55ffff', white: '#bbbbbb', brightWhite: '#ffffff' } })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)
    fitAddon.fit()
    terminal.writeln('\x1b[38;2;98;224;174mSONiC LAB SSH\x1b[0m  connecting to ' + switchId.toUpperCase() + '…')
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(protocol + '//' + location.host + '/api/lab/ssh?switch=' + encodeURIComponent(switchId))
    socket.onopen = () => { onConnectionChange?.('connected'); socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })) }
    socket.onmessage = (event) => { const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string }; if (message.type === 'data') terminal.write(colorizeOutput(message.data ?? ''), () => terminal.scrollToBottom()); if (message.type === 'error') { onConnectionChange?.('error'); terminal.writeln('\r\n\x1b[31m' + (message.message ?? 'SSH error') + '\x1b[0m') } }
    socket.onclose = () => { onConnectionChange?.('closed'); terminal.writeln('\r\n\x1b[33m[SSH connection closed]\x1b[0m') }
    terminal.onData((data) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })) })
    const resize = (): void => { requestAnimationFrame(() => { try { fitAddon.fit(); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })) } catch {} }) }
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize()
    return () => { observer.disconnect(); socket.close(); terminal.dispose() }
  }, [switchId])
  return <div className="ssh-page"><main ref={host} /></div>
}
