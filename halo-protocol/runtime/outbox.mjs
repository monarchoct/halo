/** Handlers must support idempotent delivery or reconcile an uncertain result.
 * Content-addressed receipt publication is idempotent. A generic social POST is not. */
export function createOutboxDispatcher({ store, workerId, handlers, leaseSeconds = 120, signal }) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600) throw new Error('Invalid publication lease');
  return {
    async deliverOnce(topic) {
      const handler = Object.hasOwn(handlers, topic) ? handlers[topic] : undefined;
      if (typeof handler !== 'function') throw new Error('This operator has no configured handler for that publication topic');
      signal?.throwIfAborted();
      const delivery = await store.claimDelivery(topic, workerId, leaseSeconds);
      if (!delivery) return { status: 'idle' };
      let lost = false, renewal = Promise.resolve();
      const leaseAbort = new AbortController();
      const executionSignal = signal ? AbortSignal.any([signal, leaseAbort.signal]) : leaseAbort.signal;
      const interval = setInterval(() => {
        renewal = renewal.then(() => store.renewDelivery(delivery, leaseSeconds)).catch(() => { lost = true; leaseAbort.abort(); });
      }, Math.floor(leaseSeconds * 1000 / 3));
      try {
        const result = await handler(delivery.payload, delivery, { signal: executionSignal });
        if (lost) return { status: 'lease-lost', id: delivery.id };
        if (result?.deliveryStatus === 'deferred') {
          await store.retryDelivery(delivery, { delaySeconds: result.retrySeconds, reason: result.result.status, result: result.result });
          return { status: 'deferred', id: delivery.id, result: result.result };
        }
        const outcome = result?.deliveryStatus === 'posted' ? result.result
          : result && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
        await store.acknowledge(delivery, outcome);
        return { status: 'delivered', id: delivery.id, result };
      } catch {
        try { await store.retryDelivery(delivery, { reason: 'publication-unavailable', delaySeconds: 10 }); }
        catch { return { status: 'lease-lost', id: delivery.id }; }
        return { status: 'retryable-error', id: delivery.id };
      } finally { clearInterval(interval); await renewal; }
    },
  };
}
