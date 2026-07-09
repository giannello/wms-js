export class TypedEventEmitter<EventMap> {
  private listeners = new Map<keyof EventMap, Set<(event: unknown) => void>>()

  on<K extends keyof EventMap>(type: K, fn: (event: EventMap[K]) => void): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn as (event: unknown) => void)
    return () => {
      set!.delete(fn as (event: unknown) => void)
    }
  }

  emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    this.listeners.get(type)?.forEach((fn) => {
      ;(fn as (event: EventMap[K]) => void)(event)
    })
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
