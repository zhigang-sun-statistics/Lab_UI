/**
 * dsh-lab-controller client half: registers the lab tab on the
 * betterSidebar service. No UI of its own outside the tab.
 */
import type { Context } from '../context-types.ts'
import { DeviceManagementView } from './DeviceManagementView.tsx'

export const inject = ['betterSidebar']

const SwitchIcon = (size: number): JSX.Element => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
		<rect x="3" y="6" width="18" height="5" rx="1.2" />
		<rect x="3" y="13" width="18" height="5" rx="1.2" />
		<circle cx="7" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
		<circle cx="7" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
		<line x1="12" y1="8.5" x2="17" y2="8.5" />
		<line x1="12" y1="15.5" x2="17" y2="15.5" />
	</svg>
)

export function apply(ctx: Context): void {
	ctx.effect(() => ctx.betterSidebar?.registerTab({
		id: 'lab-controller:main',
		title: '设备管理',
		icon: SwitchIcon,
		order: 80,
		single: true,
		component: ({ visible }) => <DeviceManagementView visible={visible === true} />,
	}))
}