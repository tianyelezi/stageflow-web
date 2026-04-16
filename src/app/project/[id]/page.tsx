'use client';

import { use, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { AlignmentQuestionnaire } from '@/components/workflow/alignment-questionnaire';
import { ClientRequirements } from '@/components/workflow/client-requirements';
import { BrandResearchResultCard } from '@/components/workflow/brand-research-result';
import { DirectionSelector } from '@/components/workflow/direction-selector';
import { WorkflowProgress } from '@/components/workflow/workflow-progress';
import { useCurrentUser } from '@/hooks/use-auth';
import { useWorkflowUIStore } from '@/stores/workflow-ui';
import { projectResultsOptions, useResetDirectionMutation } from '@/hooks/use-project';
import { useSSE } from '@/hooks/use-sse';
import { projectKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import type {
  AlignmentQuestion,
  BrandResearchResult,
  CreativeDirection,
  ProjectStatus,
  Proposal,
  SpatialZone,
  VisualElements,
} from '@/types';

// Lazy-import components that may not exist yet — these are listed as already existing
import { ProposalViewer } from '@/components/workflow/proposal-viewer';
import { SpatialGallery } from '@/components/workflow/spatial-gallery';
import { VisualElementsDisplay } from '@/components/workflow/visual-elements-display';

// === Constants ===

const ACTIVE_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  'researching',
  'research_review',
  'visual_suggestions',
  'direction_selection',
  'alignment',
  'generating_layouts',
]);

const STATUS_ORDER: readonly ProjectStatus[] = [
  'draft',
  'researching',
  'research_review',
  'visual_suggestions',
  'direction_selection',
  'alignment',
  'generating_layouts',
  'proposal_ready',
  'completed',
];

/** Map ProjectStatus to the workflow step key used by WorkflowProgress */
const STATUS_TO_STEP: Record<ProjectStatus, string> = {
  draft: 'brand_research',
  researching: 'brand_research',
  research_review: 'research_confirmation',
  visual_suggestions: 'visual_refinement',
  direction_selection: 'direction_selection',
  alignment: 'designer_alignment',
  generating_layouts: 'spatial_design',
  proposal_ready: 'proposal_generation',
  completed: 'proposal_generation',
  failed: 'brand_research', // progress bar just shows at the failure point
};

// === Types for results payload ===

interface ProjectResults {
  project: {
    id: string;
    status: ProjectStatus;
    progress: number;
    companyName: string;
    eventName: string;
    designerId?: string | null;
    error?: { message: string; node: string; at: string } | null;
  };
  brandResearch?: BrandResearchResult;
  visualElements?: VisualElements;
  creativeDirections?: {
    directions: CreativeDirection[];
    selectedDirectionId: string | null;
  };
  designerAlignment?: {
    questions: AlignmentQuestion[];
    alignmentStatus: string;
  };
  spatialLayouts?: {
    zones: SpatialZone[];
  };
  proposal?: Proposal;
}

// === Helper ===

function isAtOrPast(current: ProjectStatus, target: ProjectStatus): boolean {
  return STATUS_ORDER.indexOf(current) >= STATUS_ORDER.indexOf(target);
}

function isAfterAlignment(status: ProjectStatus): boolean {
  return STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf('alignment');
}

// === Page Component ===

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = use(params);

  const { data: currentUser } = useCurrentUser();

  const { data, isLoading, isError } = useQuery(projectResultsOptions(id));
  const results = data as ProjectResults | undefined;

  const status = results?.project?.status ?? 'draft';
  const progress = results?.project?.progress ?? 0;
  const isSSEEnabled = ACTIVE_STATUSES.has(status);

  useSSE({ projectId: id, enabled: isSSEEnabled });

  const queryClient = useQueryClient();
  const resetDirectionMutation = useResetDirectionMutation(id);

  const handleInvalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
  }, [queryClient, id]);

  const handleResetDirection = useCallback(() => {
    resetDirectionMutation.mutate();
  }, [resetDirectionMutation]);

  // Loading state
  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <DetailSkeleton />
      </div>
    );
  }

  // Error state
  if (isError || !results?.project) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-12 text-center">
          <h2 className="mb-2 text-lg font-semibold text-destructive">项目未找到</h2>
          <p className="mb-4 text-sm text-muted-foreground">该项目不存在或加载时出错。</p>
          <Link href="/dashboard">
            <Button variant="outline">返回项目列表</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回项目列表
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{results.project.companyName}</h1>
        <p className="mt-1 text-muted-foreground">{results.project.eventName}</p>
      </div>

      {/* Failure banner — surfaces workflow_failed to the user so they know
          what went wrong and that retrying (e.g. new project) is the move. */}
      {status === 'failed' && results.project.error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm">
          <div className="font-medium text-red-800">
            工作流在 &ldquo;{results.project.error.node || '未知节点'}&rdquo; 处失败
          </div>
          <div className="mt-2 whitespace-pre-wrap break-words text-red-700">
            {results.project.error.message}
          </div>
          <div className="mt-2 text-xs text-red-600">
            时间：{new Date(results.project.error.at).toLocaleString('zh-CN')}
          </div>
          <p className="mt-3 text-xs text-red-700">
            建议：检查 AI provider 的 API key 是否配置正确，或稍后新建项目重试。
          </p>
        </div>
      )}

      {/* Workflow progress */}
      <WorkflowProgress currentStep={STATUS_TO_STEP[status]} progress={progress} />

      {/* Reset direction button */}
      {isAfterAlignment(status) && (
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={handleResetDirection}
            disabled={resetDirectionMutation.isPending}
          >
            {resetDirectionMutation.isPending ? '重置中...' : '返回方向选择'}
          </Button>
        </div>
      )}

      {/* === Completed sections shown above current step === */}

      {/* Brand research results — show when at or past research_review */}
      {isAtOrPast(status, 'research_review') && results.brandResearch && (
        <section className="my-8 border-t pt-8">
          <BrandResearchResultCard
            projectId={id}
            data={results.brandResearch}
            onConfirmed={handleInvalidate}
            canConfirm={status === 'research_review'}
          />
        </section>
      )}

      {/* Visual elements — show when at or past visual_suggestions */}
      {isAtOrPast(status, 'visual_suggestions') && results.visualElements && (
        <section className="my-8 border-t pt-8">
          <VisualElementsDisplay data={results.visualElements} />
        </section>
      )}

      {/* Direction selector — show completed selection or active selector */}
      {isAtOrPast(status, 'direction_selection') && results.creativeDirections?.directions && (
        <section className="my-8 border-t pt-8">
          {status === 'direction_selection' ? (
            <DirectionSelector
              projectId={id}
              directions={results.creativeDirections.directions}
              onSelected={handleInvalidate}
            />
          ) : (
            <CompletedDirectionSummary
              directions={results.creativeDirections.directions}
              selectedId={results.creativeDirections.selectedDirectionId}
            />
          )}
        </section>
      )}

      {/* Client requirements — show after research confirmed, before completion */}
      {isAtOrPast(status, 'visual_suggestions') && status !== 'completed' && (
        <section className="my-8 border-t pt-8">
          <ClientRequirements projectId={id} />
        </section>
      )}

      {/* Alignment questionnaire */}
      {isAtOrPast(status, 'alignment') && results.designerAlignment?.questions && (
        <section className="my-8 border-t pt-8">
          {status === 'alignment' ? (
            <AlignmentQuestionnaire
              projectId={id}
              questions={results.designerAlignment.questions}
              onSubmitted={handleInvalidate}
            />
          ) : (
            <CompletedAlignmentSummary questions={results.designerAlignment.questions} />
          )}
        </section>
      )}

      {/* === Current step active states === */}

      {/* Researching loading */}
      {status === 'researching' && (
        <section className="my-8 border-t pt-8">
          <LoadingSection message="品牌研究进行中..." />
        </section>
      )}

      {/* Generating layouts loading — with real-time progress from SSE */}
      {status === 'generating_layouts' && <GeneratingLayoutsProgress />}

      {/* Spatial gallery + Proposal — show when proposal ready or completed */}
      {(status === 'proposal_ready' || status === 'completed') && (
        <>
          {results.spatialLayouts?.zones && (
            <section className="my-8 border-t pt-8">
              <SpatialGallery projectId={id} zones={results.spatialLayouts.zones} />
            </section>
          )}

          {results.proposal && (
            <section className="my-8 border-t pt-8">
              <ProposalViewer projectId={id} proposal={results.proposal} />
            </section>
          )}

          {/* Re-select direction */}
          <section className="my-8 border-t pt-8">
            <div className="rounded-lg border border-dashed bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                对当前方案不满意？可以重新选择创意方向，生成全新的设计方案
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('确定要重新选择方案吗？当前的空间设计和提案将被清除。')) {
                    resetDirectionMutation.mutate(undefined, {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
                      },
                    });
                  }
                }}
                disabled={resetDirectionMutation.isPending}
              >
                {resetDirectionMutation.isPending ? '重置中...' : '重新选择方案'}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// === Sub-components ===

interface LoadingSectionProps {
  message: string;
}

function LoadingSection({ message }: LoadingSectionProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-8">
      <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

function GeneratingLayoutsProgress() {
  const progressMessage = useWorkflowUIStore((s) => s.progressMessage);
  const displayMessage = progressMessage ?? '空间设计生成中...';

  return (
    <section className="my-8 border-t pt-8">
      <div className="rounded-lg border bg-card p-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium">{displayMessage}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          正在为 7 个区域生成设计方案和效果图，预计需要 3-5 分钟
        </p>
      </div>
    </section>
  );
}

interface CompletedDirectionSummaryProps {
  directions: CreativeDirection[];
  selectedId: string | null;
}

function CompletedDirectionSummary({ directions, selectedId }: CompletedDirectionSummaryProps) {
  const selected = directions.find((d) => d.id === selectedId);

  if (!selected) return null;

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-lg font-semibold">已选择方向</h3>
        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          已确认
        </span>
      </div>
      <h4 className="mb-1 font-medium">{selected.name}</h4>
      <p className="text-sm text-muted-foreground">{selected.styleDescription}</p>
      {(selected.moodBoardKeywords ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(selected.moodBoardKeywords ?? []).map((keyword) => (
            <span
              key={keyword}
              className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface CompletedAlignmentSummaryProps {
  questions: AlignmentQuestion[];
}

function CompletedAlignmentSummary({ questions }: CompletedAlignmentSummaryProps) {
  const answeredCount = questions.filter((q) => q.answer !== null).length;

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-lg font-semibold">设计师对齐问卷</h3>
        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          已完成
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        已回答 {answeredCount} / {questions.length} 个问题
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Back link skeleton */}
      <div className="h-4 w-24 rounded bg-muted" />

      {/* Header skeleton */}
      <div>
        <div className="mb-2 h-7 w-48 rounded bg-muted" />
        <div className="h-5 w-32 rounded bg-muted" />
      </div>

      {/* Progress skeleton */}
      <div className="space-y-3">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="flex gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="size-7 rounded-full bg-muted" />
              <div className="h-3 w-12 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>

      {/* Content skeleton */}
      <div className="border-t pt-8">
        <div className="h-48 rounded-lg bg-muted" />
      </div>
    </div>
  );
}
