/**
 * Server-side client for the Python workflow service.
 * Used by BFF Route Handlers only — never imported on the client.
 */

import { env } from '@/lib/env';

class WorkflowServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowServiceError';
  }
}

async function workflowRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${env.WORKFLOW_SERVICE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new WorkflowServiceError(res.status, text);
  }

  return res.json() as Promise<T>;
}

export const workflowClient = {
  startWorkflow(projectId: string, inputData: Record<string, unknown>, researchProvider: string) {
    return workflowRequest<{ run_id: string; status: string }>('/workflow/start', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        input_data: inputData,
        research_provider: researchProvider,
      }),
    });
  },

  resumeWorkflow(runId: string, checkpointType: string, checkpointData: Record<string, unknown>) {
    return workflowRequest<{ status: string; current_node: string }>(`/workflow/${runId}/resume`, {
      method: 'POST',
      body: JSON.stringify({
        checkpoint_type: checkpointType,
        checkpoint_data: checkpointData,
      }),
    });
  },

  getStatus(runId: string) {
    return workflowRequest<{
      run_id: string;
      project_id: string;
      status: string;
      current_node: string;
      progress: number;
      error: string | null;
      checkpoint_type: string | null;
      updated_at: string | null;
    }>(`/workflow/${runId}/status`);
  },

  supersedeRun(runId: string) {
    return workflowRequest<{
      run_id: string;
      project_id: string | null;
      status: string;
      thread_cleared: boolean;
    }>(`/workflow/runs/${runId}/supersede`, { method: 'POST' });
  },

  regenerateProposal(projectId: string) {
    return workflowRequest<{ status: string; project_id: string }>(
      '/workflow/regenerate-proposal',
      {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      },
    );
  },

  regenerateZone(projectId: string, zoneType: string, additionalNotes?: string) {
    return workflowRequest<{ status: string; zone_type: string }>('/workflow/regenerate-zone', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        zone_type: zoneType,
        additional_notes: additionalNotes ?? null,
      }),
    });
  },

  health() {
    return workflowRequest<{ status: string; mongodb: string; redis: string }>('/workflow/health');
  },

  getProposalDownloadUrl(projectId: string, kind: 'pdf' | 'pptx') {
    return workflowRequest<{ url: string; expiresIn: number }>(
      `/workflow/proposals/${projectId}/download-url?kind=${kind}`,
    );
  },
};

export { WorkflowServiceError };
