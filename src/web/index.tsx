import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LabView } from '../client/LabView.tsx'
import { StyleInjector } from '../client/StyleInjector.tsx'

function WebApp(): JSX.Element {
  const [user, setUser] = useState<string | null>(null)
  const [name, setName] = useState('szg')
  const [password, setPassword] = useState('szg')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const login = async (): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch('/api/lab/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password }) })
      if (!response.ok) { setError('账号或密码错误'); return }
      setUser(name); setError('')
    } catch { setError('无法连接 Web 服务') } finally { setBusy(false) }
  }
  if (user === null) return (
    <main className="web-login">
      <StyleInjector />
      <section className="web-login-card">
        <div className="web-eyebrow">SONiC LAB / LOCAL NETWORK</div>
        <h1>设备管理</h1>
        <p>登录后查看交换机端口、链路和实验状态。</p>
        <label>账号<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error.length > 0 && <div className="web-login-error">{error}</div>}
        <button disabled={busy} onClick={() => { void login() }}>{busy ? '登录中…' : '进入控制台'}</button>
        <small>局域网测试版 · 默认账号 szg / szg</small>
      </section>
    </main>
  )
  return <div className="web-shell"><StyleInjector /><header className="web-header"><div><span className="web-eyebrow">SONiC LAB / DEVICE MANAGEMENT</span><h1>设备管理</h1></div><div className="web-user">{user}<button onClick={() => setUser(null)}>退出</button></div></header><LabView visible /></div>
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<WebApp />)
