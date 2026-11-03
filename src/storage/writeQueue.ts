/**
 * Serialize writes for one logical key. Distinct keys remain independent.
 * A rejected write is reported to its caller but must not poison the queue.
 */
export function createKeyedWriteQueue() {
  const queues = new Map<string, Promise<void>>();
  return async (key: string, operation: () => Promise<void>): Promise<void> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    queues.set(key, current);
    try { await current; }
    finally {
      if (queues.get(key) === current) queues.delete(key);
    }
  };
}
