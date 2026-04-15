/**
 * Centralized API client for StageFlow BFF.
 * All fetch calls go through this class for consistent error handling,
 * auth headers, and base URL management.
 */

import type {
  AlignmentAnswersInput,
  ConfirmResearchInput,
  RegenerateZoneInput,
  SelectDirectionInput,
  SubmitProjectInput,
} from '@/lib/validations/project';
import type {
  ApiResponse,
  PaginatedResponse,
  Project,
  ProjectStatus,
  Proposal,
  Template,
  User,
} from '@/types';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        body?.error?.code ?? 'UNKNOWN_ERROR',
        body?.error?.message ?? `Request failed: ${res.status}`,
      );
    }

    let json: ApiResponse<T>;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(res.status, 'PARSE_ERROR', 'Response is not valid JSON');
    }

    if (!json.success) {
      throw new ApiError(400, json.error.code, json.error.message);
    }

    return json.data;
  }

  // === Projects ===

  async listProjects(page = 1, limit = 20): Promise<PaginatedResponse<Project>> {
    return this.request(`/projects?page=${page}&limit=${limit}`);
  }

  async getProject(id: string): Promise<Project> {
    return this.request(`/projects/${id}`);
  }

  // === Workflow ===

  async submitProject(data: SubmitProjectInput): Promise<{
    projectId: string;
    workflowRunId: string;
    status: string;
    sseChannel: string;
  }> {
    return this.request('/submit', { method: 'POST', body: JSON.stringify(data) });
  }

  async getResults(projectId: string): Promise<Record<string, unknown>> {
    // Returns aggregated project data; consumer casts to ProjectResults
    return this.request(`/results?projectId=${projectId}`);
  }

  async confirmResearch(
    projectId: string,
    data: ConfirmResearchInput,
  ): Promise<{ status: string; message: string }> {
    return this.request(`/projects/${projectId}/confirm-research`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async selectDirection(
    projectId: string,
    data: SelectDirectionInput,
  ): Promise<{ status: string; message: string }> {
    return this.request(`/projects/${projectId}/select-direction`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async submitAlignmentAnswers(
    projectId: string,
    data: AlignmentAnswersInput,
  ): Promise<{ status: string; message: string }> {
    return this.request(`/projects/${projectId}/alignment-answers`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getProposal(projectId: string): Promise<Proposal> {
    return this.request(`/proposal?projectId=${projectId}`);
  }

  async regenerateZone(
    projectId: string,
    data: RegenerateZoneInput,
  ): Promise<{ message: string; zoneType: string }> {
    return this.request(`/projects/${projectId}/regenerate-zone`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async regenerateProposal(projectId: string): Promise<{ message: string }> {
    return this.request(`/projects/${projectId}/regenerate-proposal`, { method: 'POST' });
  }

  async resetDirection(
    projectId: string,
  ): Promise<{ status: string; message: string; clearedSteps: string[] }> {
    return this.request(`/projects/${projectId}/reset-direction`, { method: 'POST' });
  }

  async resubmitAlignment(
    projectId: string,
    data: AlignmentAnswersInput,
  ): Promise<{ status: string; message: string }> {
    return this.request(`/projects/${projectId}/resubmit-alignment`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(projectId: string): Promise<{ message: string }> {
    return this.request(`/projects/${projectId}`, { method: 'DELETE' });
  }

  async uploadReferences(
    projectId: string,
    files: File[],
  ): Promise<{ imageIds: string[]; imageUrls: string[] }> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }
    // Don't set Content-Type — browser sets multipart boundary automatically
    const url = `${this.baseUrl}/projects/${projectId}/upload-references`;
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        body?.error?.code ?? 'UPLOAD_ERROR',
        body?.error?.message ?? 'Upload failed',
      );
    }
    const json: ApiResponse<{ imageIds: string[]; imageUrls: string[] }> = await res.json();
    if (!json.success) {
      throw new ApiError(400, json.error.code, json.error.message);
    }
    return json.data;
  }

  // === Templates ===

  async listTemplates(
    options: { page?: number; limit?: number; eventType?: string; scope?: string } = {},
  ): Promise<PaginatedResponse<Template>> {
    const { page = 1, limit = 20, eventType, scope } = options;
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (eventType) params.set('eventType', eventType);
    if (scope) params.set('scope', scope);
    return this.request(`/templates?${params.toString()}`);
  }

  async getTemplate(id: string): Promise<Template> {
    return this.request(`/templates/${id}`);
  }

  async createTemplate(data: Record<string, unknown>): Promise<{ templateId: string }> {
    return this.request('/templates', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateTemplate(id: string, data: Record<string, unknown>): Promise<{ message: string }> {
    return this.request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteTemplate(id: string): Promise<{ message: string }> {
    return this.request(`/templates/${id}`, { method: 'DELETE' });
  }

  // === Auth ===

  async login(email: string, password: string): Promise<{ userId: string; role: string }> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    role: string;
    organization: string;
  }): Promise<{ userId: string; role: string }> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<{ message: string }> {
    return this.request('/auth/logout', { method: 'POST' });
  }

  // === Users ===

  async getCurrentUser(): Promise<User> {
    return this.request('/auth/me');
  }

}

export const api = new ApiClient();
export { ApiError };
