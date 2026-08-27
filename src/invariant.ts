/** Thrown when an internal assumption is violated (never for user input). */
export class LabInvariantError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'LabInvariantError'
	}
}
