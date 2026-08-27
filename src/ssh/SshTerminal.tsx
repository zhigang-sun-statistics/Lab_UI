import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './ssh.css'

export function SshTerminal({ switchId }: { switchId: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState('正在建立 SSH 连接…')
  useEffect(() => {
    if (host.current === null || !/^sw\d+$/.test(switchId)) { setState('无效的交换机'); return }
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 14, lineHeight: 1.2, theme: { background: '#090e13', foreground: '#dce7ee', cursor: '#62e0ae', selectionBackground: '#315b4d', black: '#111820', brightBlack: '#647582', green: '#5bd7a5', brightGreen: '#84edc1', cyan: '#5ebbd0', brightCyan: '#8ad9e9', red: '#dc717b', brightRed: '#f18d96', yellow: '#d0a85f', brightYellow: '#e4c27e', blue: '#699ddb', brightBlue: '#88b7ec', magenta: '#aa8bd1', brightMagenta: '#c4a7e5', white: '#c5d0d8', brightWhite: '#f3f7fa' } })
    terminal.open(host.current)
    terminal.writeln('\x1b[38;2;98;224;174mSONiC LAB SSH\x1b[0m  connecting to ' + switchId.toUpperCase() + '…')
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(protocol + '//' + location.host + '/api/lab/ssh?switch=' + encodeURIComponent(switchId))
    socket.onopen = () => { setState('已连接'); socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })) }
    socket.onmessage = (event) => { const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string }; if (message.type === 'data') terminal.write(message.data ?? ''); if (message.type === 'error') terminal.writeln('\r\n\x1b[31m' + (message.message ?? 'SSH error') + '\x1b[0m') }
    socket.onclose = () => { setState('连接已关闭'); terminal.writeln('\r\n\x1b[33m[SSH connection closed]\x1b[0m') }
    terminal.onData((data) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })) })
    const resize = (): void => { const cols = Math.max(40, Math.floor((host.current?.clientWidth ?? 800) / 8.4)); const rows = Math.max(12, Math.floor((host.current?.clientHeight ?? 500) / 17)); terminal.resize(cols, rows); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows })) }
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize()
    return () => { observer.disconnect(); socket.close(); terminal.dispose() }
  }, [switchId])
  return <div className="ssh-page"><header><div><span className="ssh-mark">›_</span><div><strong>{switchId.toUpperCase()} SSH</strong><small>Browser terminal · jump host protected</small></div></div><span className={'ssh-state ' + (state === '已连接' ? 'online' : '')}><i />{state}</span></header><main ref={host} /></div>
}
