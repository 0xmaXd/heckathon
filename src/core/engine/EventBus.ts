export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus<TEvents extends Record<string, unknown>> {
	private listeners = new Map<keyof TEvents, Set<EventHandler<unknown>>>();

	on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
		let bucket = this.listeners.get(event);
		if (!bucket) {
			bucket = new Set();
			this.listeners.set(event, bucket);
		}
		bucket.add(handler as EventHandler<unknown>);
		return () => this.off(event, handler);
	}

	off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
		this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
	}

	emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
		const bucket = this.listeners.get(event);
		if (!bucket) return;
		for (const handler of bucket) {
			handler(payload);
		}
	}

	clear(): void {
		this.listeners.clear();
	}
}
