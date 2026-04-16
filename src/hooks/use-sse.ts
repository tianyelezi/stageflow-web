'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { projectKeys } from '@/lib/query-keys';
import { useWorkflowUIStore } from '@/stores/workflow-ui';

interface SSEEvent {
  event: 'progress' | 'checkpoint' | 'complete' | 'error' | 'warning';
  currentStep?: string;
  progress?: number;
  message?: string;
  checkpointType?: string;
  type?: string;
}

interface UseSSEOptions {
  projectId: string;
  enabled?: boolean;
}

export function useSSE({ projectId, enabled = true }: UseSSEOptions) {
  const queryClient = useQueryClient();
  const setSSEConnected = useWorkflowUIStore((s) => s.setSSEConnected);
  const setProgressMessage = useWorkflowUIStore((s) => s.setProgressMessage);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) return;

    const url = `/api/projects/${projectId}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSSEConnected(true);
      // Full-state fallback on every connect (initial + reconnect): refetch
      // the detail query so any missed events can't leave the UI stale.
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    };

    // Server emits typed `event:` lines (progress / checkpoint / complete /
    // error / warning). Attach a listener per type; each forwards into the
    // same dispatch below.
    const typedEvents: SSEEvent['event'][] = [
      'progress',
      'checkpoint',
      'complete',
      'error',
      'warning',
    ];
    const onTyped = (evType: SSEEvent['event']) => (e: MessageEvent) => {
      try {
        const body = JSON.parse(e.data) as Omit<SSEEvent, 'event'>;
        handleEvent({ ...body, event: evType });
      } catch {
        /* ignore parse errors */
      }
    };
    const typedHandlers: Array<[string, EventListener]> = [];
    for (const evType of typedEvents) {
      const handler = onTyped(evType) as EventListener;
      typedHandlers.push([evType, handler]);
      es.addEventListener(evType, handler);
    }

    // Back-compat: bare `message` events still parse the `event` field out
    // of the JSON body (in case the server falls back to the pre-typed path).
    const messageHandler = (e: MessageEvent) => {
      try {
        handleEvent(JSON.parse(e.data) as SSEEvent);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener('message', messageHandler);

    es.onerror = () => {
      setSSEConnected(false);
      // EventSource auto-reconnects with Last-Event-ID; onopen above
      // re-runs the detail invalidate as a belt-and-braces fallback.
    };

    function handleEvent(data: SSEEvent) {
      // Every event refreshes the project detail (includes status + progress)
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });

      // Update progress message for UI display
      if (data.message) {
        setProgressMessage(data.message);
      }

      switch (data.event) {
        case 'progress':
          break;

        case 'checkpoint':
          if (data.checkpointType === 'direction_selection') {
            queryClient.invalidateQueries({
              queryKey: projectKeys.creativeDirections(projectId),
            });
          }
          if (data.checkpointType === 'alignment_answers') {
            queryClient.invalidateQueries({
              queryKey: projectKeys.designerAlignment(projectId),
            });
          }
          break;

        case 'warning':
          // Warning — no special handling, detail invalidation above is sufficient
          break;

        case 'complete':
          // P0-7: notification is now sent from the Python workflow via
          // /api/internal/notify (HMAC-signed). We no longer depend on
          // someone keeping this page open.
          es.close();
          setSSEConnected(false);
          break;

        case 'error':
          es.close();
          setSSEConnected(false);
          break;
      }
    }

    return () => {
      for (const [evType, handler] of typedHandlers) {
        es.removeEventListener(evType, handler);
      }
      es.removeEventListener('message', messageHandler);
      es.close();
      eventSourceRef.current = null;
      setSSEConnected(false);
    };
  }, [projectId, enabled, queryClient, setSSEConnected]);
}
