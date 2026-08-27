/**
 * Minimal structural mirror of dsh-better-sidebar's client service types -
 * just enough for this plugin's `registerTab` call. The real declarations
 * live in the dsh-better-sidebar package (npm, peer devDependency); this
 * local mirror keeps our build hermetic when that package is absent from
 * node_modules (the profile provides the service at runtime).
 */
import type { ReactNode } from 'react'
import type { Context } from '../context-types.ts'

/** Props every tab component receives (subset this plugin reads). */
export interface TabComponentProps {
	ctx: Context
	visible: boolean
}

/** Describes one kind of sidebar tab (subset). */
export interface TabDescriptor {
	id: string
	title: string | (() => string)
	icon?: ReactNode | ((size: number) => ReactNode)
	order?: number
	hidden?: boolean
	single?: boolean
	component: (props: TabComponentProps) => ReactNode
}

/** The registry service published as ctx.betterSidebar. */
export interface BetterSidebarService {
	registerTab(descriptor: TabDescriptor): () => void
	registerFileViewer(descriptor: unknown): () => void
}
