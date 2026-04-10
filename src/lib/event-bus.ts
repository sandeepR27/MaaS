export interface EventBusMessage<T = unknown> {
  type: string;
  interviewId: string;
  data: T;
  timestamp: number;
}

const interviewSubscribers = new Map<
  string,
  Set<(message: EventBusMessage) => void>
>();

export function subscribeToInterview(
  interviewId: string,
  listener: (message: EventBusMessage) => void
): void {
  let subscribers = interviewSubscribers.get(interviewId);
  if (!subscribers) {
    subscribers = new Set();
    interviewSubscribers.set(interviewId, subscribers);
  }
  subscribers.add(listener);
}

export function unsubscribeFromInterview(
  interviewId: string,
  listener: (message: EventBusMessage) => void
): void {
  const subscribers = interviewSubscribers.get(interviewId);
  if (!subscribers) return;
  subscribers.delete(listener);
  if (subscribers.size === 0) {
    interviewSubscribers.delete(interviewId);
  }
}

export function dispatchInterviewEvent(
  interviewId: string,
  type: string,
  data: unknown
): void {
  const subscribers = interviewSubscribers.get(interviewId);
  if (!subscribers || subscribers.size === 0) return;

  const message: EventBusMessage = {
    type,
    interviewId,
    data,
    timestamp: Date.now(),
  };

  for (const listener of subscribers) {
    try {
      listener(message);
    } catch (error) {
      // Ignore listener errors to keep the stream alive
      console.error("EventBus listener error:", error);
    }
  }
}
