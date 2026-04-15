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
    };

    es.addEventListener('message', (e) => {
      try {
        const data: SSEEvent = JSON.parse(e.data);
        handleEvent(data);
      } catch {
        // Ignore parse errors
      }
    });

    es.onerror = () => {
      setSSEConnected(false);
      // EventSource auto-reconnects; on reconnect, refresh full state as fallback
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
      es.close();
      eventSourceRef.current = null;
      setSSEConnected(false);
    };
  }, [projectId, enabled, queryClient, setSSEConnected]);
}
