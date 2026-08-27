import { createRoot } from 'react-dom/client'
import { SshTerminal } from './SshTerminal.tsx'

const switchId = new URLSearchParams(location.search).get('switch') ?? ''
const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<SshTerminal switchId={switchId} />)
