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
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, scrollback: 5000, fontFamily: 'MobaFont, Cascadia Mono, JetBrains Mono, Consolas, monospace', fontSize: 14, lineHeight: 1.2, theme: { background: '#1e1e1e', foreground: '#ececec', cursor: '#b4b4c0', cursorAccent: '#1e1e1e', selectionBackground: '#4a5260', black: '#000000', brightBlack: '#808080', red: '#bb0000', brightRed: '#ff5555', green: '#00bb00', brightGreen: '#55ff55', yellow: '#bbbb00', brightYellow: '#ffff55', blue: '#0000bb', brightBlue: '#5555ff', magenta: '#bb00bb', brightMagenta: '#ff55ff', cyan: '#00bbbb', brightCyan: '#55ffff', white: '#bbbbbb', brightWhite: '#ffffff' } })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)
    fitAddon.fit()
    terminal.writeln('\x1b[38;2;98;224;174mSONiC LAB SSH\x1b[0m  connecting to ' + switchId.toUpperCase() + '…')
    terminal.writeln('\x1b[2m复制: 选中即复制 / Ctrl+C / Ctrl+Ins · 粘贴: 右键 / Ctrl+V\x1b[0m')

    // ---- MobaXterm-style clipboard: copy-on-select, right-click paste, smart Ctrl+C ----
    const hostEl = host.current
    let toastTimer = 0
    const toast = (message: string): void => {
      hostEl.querySelector('.ssh-toast')?.remove()
      window.clearTimeout(toastTimer)
      const el = document.createElement('div')
      el.className = 'ssh-toast'
      el.textContent = message
      hostEl.appendChild(el)
      toastTimer = window.setTimeout(() => el.remove(), 1500)
    }
    // Legacy path for insecure origins (LAN console on http) where navigator.clipboard is absent.
    const legacyCopy = (text: string): boolean => {
      const area = document.createElement('textarea')
      area.value = text
      area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
      document.body.appendChild(area)
      area.select()
      let copied = false
      try { copied = document.execCommand('copy') } catch { copied = false }
      area.remove()
      return copied
    }
    const copyText = (text: string): void => {
      if (text.length === 0) return
      const done = (ok: boolean): void => { toast(ok ? '已复制 ' + String(text.length) + ' 字符' : '复制失败') }
      if (navigator.clipboard !== undefined) { navigator.clipboard.writeText(text).then(() => done(true), () => done(legacyCopy(text))); return }
      done(legacyCopy(text))
    }
    // Copy whatever the terminal selection holds once a drag finishes.
    const onMouseUp = (): void => { window.setTimeout(() => { const selection = terminal.getSelection(); if (selection.length > 0) copyText(selection) }, 0) }
    hostEl.addEventListener('mouseup', onMouseUp)

    // Fallback paste box for when clipboard READ is unavailable or denied:
    // the user pastes into a plain textarea (works on http) and we forward it.
    let pasteBox: HTMLDivElement | null = null
    const closePasteBox = (): void => { pasteBox?.remove(); pasteBox = null; terminal.focus() }
    const openPasteBox = (): void => {
      if (pasteBox !== null) { (pasteBox.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(); return }
      const box = document.createElement('div')
      box.className = 'ssh-paste-box'
      const card = document.createElement('div')
      const title = document.createElement('p')
      title.textContent = '无法直接读取剪贴板 — 按 Ctrl+V 粘贴到下方,Enter 发送,Esc 取消'
      const area = document.createElement('textarea')
      area.placeholder = '待粘贴内容…'
      const actions = document.createElement('div')
      actions.className = 'ssh-paste-actions'
      const cancel = document.createElement('button')
      cancel.className = 'ssh-cancel'
      cancel.textContent = '取消'
      const send = document.createElement('button')
      send.className = 'ssh-send'
      send.textContent = '发送到终端'
      const submit = (): void => { const text = area.value; closePasteBox(); if (text.length > 0) terminal.paste(text) }
      send.addEventListener('click', submit)
      cancel.addEventListener('click', closePasteBox)
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); closePasteBox() }
      })
      actions.append(cancel, send)
      card.append(title, area, actions)
      box.append(card)
      box.addEventListener('mousedown', (event) => { if (event.target === box) closePasteBox() })
      pasteBox = box
      hostEl.appendChild(box)
      area.focus()
    }
    const pasteFromClipboard = async (): Promise<void> => {
      try {
        if (navigator.clipboard === undefined) throw new Error('insecure context')
        const text = await navigator.clipboard.readText()
        if (text.length === 0) { toast('剪贴板为空'); return }
        terminal.paste(text)
      } catch { openPasteBox() }
    }
    // Right-click always pastes (PuTTY/MobaXterm muscle memory); Ctrl+V keeps
    // working through xterm's native paste event.
    const onContextMenu = (event: MouseEvent): void => { event.preventDefault(); void pasteFromClipboard() }
    hostEl.addEventListener('contextmenu', onContextMenu)

    terminal.attachCustomKeyEventHandler((event): boolean => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey && key === 'c') { copyText(terminal.getSelection()); return false }
      if (event.ctrlKey && !event.shiftKey && key === 'c' && terminal.hasSelection()) { copyText(terminal.getSelection()); return false }
      if (event.ctrlKey && key === 'insert' && terminal.hasSelection()) { copyText(terminal.getSelection()); return false }
      return true
    })

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(protocol + '//' + location.host + '/api/lab/ssh?switch=' + encodeURIComponent(switchId))
    socket.onopen = () => { onConnectionChange?.('connected'); socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })) }
    socket.onmessage = (event) => { const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string }; if (message.type === 'data') terminal.write(colorizeOutput(message.data ?? ''), () => terminal.scrollToBottom()); if (message.type === 'error') { onConnectionChange?.('error'); terminal.writeln('\r\n\x1b[31m' + (message.message ?? 'SSH error') + '\x1b[0m') } }
    socket.onclose = () => { onConnectionChange?.('closed'); terminal.writeln('\r\n\x1b[33m[SSH connection closed]\x1b[0m') }
    terminal.onData((data) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })) })
    const resize = (): void => { requestAnimationFrame(() => { try { fitAddon.fit(); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })) } catch {} }) }
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize()
    return () => {
      observer.disconnect()
      hostEl.removeEventListener('mouseup', onMouseUp)
      hostEl.removeEventListener('contextmenu', onContextMenu)
      window.clearTimeout(toastTimer)
      closePasteBox()
      socket.close()
      terminal.dispose()
    }
  }, [switchId])
  return <div className="ssh-page"><main ref={host} /></div>
}
