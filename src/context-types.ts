/**
 * Structural types for the cordis services this plugin consumes. A
 * third-party plugin resolves outside the DSH monorepo's single cordis
 * instance, so upstream `declare module 'cordis'` augmentations do not
 * reach this Context. The members below mirror the runtime shapes this
 * plugin touches (pattern borrowed from dsh-better-sidebar's
 * context-types.ts; drift from upstream is contained to this file).
 *
 * This file must stay FREE of Node.js types: it is part of the
 * client-reachable declaration graph, so a Node import here would leak into
 * browser-only consumer builds. Host-side code casts to real Node types at
 * its own boundaries.
 */
import type { Context as CordisContext } from 'cordis'
import type { BetterSidebarService } from './client/service.ts'

/** The request face route handlers see (structural subset of node's IncomingMessage). */
export interface LabHttpRequest {
	url?: string
	method?: string
	headers: Record<string, string | string[] | undefined>
}

/** The response face route handlers write to. */
export interface LabHttpResponse {
	statusCode: number
	writeHead(status: number, headers?: Record<string, string>): void
	end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface LabWebRoute {
	kind: 'exact' | 'prefix'
	path: string
	handler: (req: LabHttpRequest, res: LabHttpResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses (host side only). */
export interface LabUpgradeRoute {
	path: string
	handler: (req: LabHttpRequest, socket: unknown, head: Uint8Array) => void | Promise<void>
}

export interface LabWebServer {
	register(route: LabWebRoute): () => void
	registerUpgrade(route: LabUpgradeRoute): () => void
}

/**
 * The plugin Context: cordis' base plus the vendored `ctx.effect` helper
 * and, on the client half, the betterSidebar service. Both halves import
 * this same file; the host never touches `betterSidebar` and the client
 * never touches `webServer` at runtime.
 */
declare module 'cordis' {
	interface Context {
		effect(onCleanup: () => void): void
		webServer?: LabWebServer
		betterSidebar?: BetterSidebarService
	}
}

export type Context = CordisContext
