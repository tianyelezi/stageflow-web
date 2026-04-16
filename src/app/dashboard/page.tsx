'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/use-auth';
import { projectListOptions, useDeleteProjectMutation } from '@/hooks/use-project';
import { cn } from '@/lib/utils';
import type { EventType, Project, ProjectStatus } from '@/types';

// === Constants ===

type StatusFilter = 'all' | 'in_progress' | 'completed';

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
];

const COMPLETED_STATUSES: ReadonlySet<ProjectStatus> = new Set(['proposal_ready', 'completed']);

const STATUS_BADGE_CONFIG: Record<ProjectStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-700' },
  researching: { label: '研究中', className: 'bg-blue-100 text-blue-700' },
  research_review: { label: '研究审核', className: 'bg-blue-100 text-blue-700' },
  visual_suggestions: { label: '视觉建议', className: 'bg-blue-100 text-blue-700' },
  direction_selection: { label: '方向选择', className: 'bg-yellow-100 text-yellow-700' },
  alignment: { label: '设计对齐', className: 'bg-yellow-100 text-yellow-700' },
  generating_layouts: { label: '生成布局', className: 'bg-purple-100 text-purple-700' },
  proposal_ready: { label: '提案就绪', className: 'bg-green-100 text-green-700' },
  completed: { label: '已完成', className: 'bg-green-100 text-green-700' },
  failed: { label: '失败', className: 'bg-red-100 text-red-700' },
};

const UNKNOWN_STATUS_BADGE = { label: '未知', className: 'bg-gray-100 text-gray-500' };

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  annual_meeting: '年会',
  product_launch: '发布会',
  award_ceremony: '颁奖典礼',
  gala: '晚会',
  custom: '自定义',
};

// === Page Component ===

export default function DashboardPage() {
  const { data: currentUser } = useCurrentUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');

  const { data, isLoading, isError } = useQuery(projectListOptions());

  const filteredProjects = useMemo(() => {
    const items = data?.items ?? [];
    const query = searchQuery.toLowerCase().trim();

    return items.filter((project) => {
      if (activeFilter === 'in_progress' && COMPLETED_STATUSES.has(project.status)) {
        return false;
      }
      if (activeFilter === 'completed' && !COMPLETED_STATUSES.has(project.status)) {
        return false;
      }

      if (query.length > 0) {
        const matchesCompany = project.companyName.toLowerCase().includes(query);
        const matchesEvent = project.eventName.toLowerCase().includes(query);
        if (!matchesCompany && !matchesEvent) {
          return false;
        }
      }

      return true;
    });
  }, [data, searchQuery, activeFilter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的项目</h1>
        <Link href="/project/new">
          <Button>新建项目</Button>
        </Link>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="搜索公司名称或活动名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border bg-muted p-1">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              activeFilter === filter.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && <ProjectGridSkeleton />}

      {isError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">加载项目列表失败，请稍后重试。</p>
        </div>
      )}

      {!isLoading && !isError && filteredProjects.length === 0 && (
        <EmptyState hasProjects={(data?.items ?? []).length > 0} />
      )}

      {!isLoading && !isError && filteredProjects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} currentUserId={currentUser?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// === Sub-components ===

interface ProjectCardProps {
  project: Project & { userId?: string | null };
  currentUserId?: string;
}

function ProjectCard({ project, currentUserId }: ProjectCardProps) {
  const isOwner = currentUserId === project.userId;
  const router = useRouter();
  const deleteMutation = useDeleteProjectMutation();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // Defensive fallback: if a new status slips in from the backend that the
  // UI doesn't know yet, render a neutral "unknown" badge instead of
  // crashing the card. Prevents "Cannot read 'className' of undefined".
  const badgeConfig = STATUS_BADGE_CONFIG[project.status] ?? UNKNOWN_STATUS_BADGE;
  const eventTypeLabel = EVENT_TYPE_LABELS[project.eventType] ?? project.eventType;
  const formattedDate = new Date(project.createdAt).toLocaleDateString('zh-CN');

  function handleCardClick() {
    router.push(`/project/${project.id}`);
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setIsConfirmingDelete(true);
  }

  function handleConfirmDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteMutation.mutate(project.id, {
      onSuccess: () => setIsConfirmingDelete(false),
      onError: () => {
        setIsConfirmingDelete(false);
        alert('无法删除此项目（只有项目创建者可以删除）');
      },
    });
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setIsConfirmingDelete(false);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className="group relative cursor-pointer rounded-lg border bg-card p-5 transition-all hover:shadow-md"
    >
      {/* Delete button — only for project owner */}
      {isOwner && (
        <div className="absolute right-3 top-3">
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                {deleteMutation.isPending ? '删除中...' : '确认'}
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              aria-label="删除项目"
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
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Company & event name */}
      <h3 className="mb-1 pr-8 text-sm font-semibold">{project.companyName}</h3>
      <p className="mb-3 text-sm text-muted-foreground">{project.eventName}</p>

      {/* Badges row */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
          {eventTypeLabel}
        </span>
        <span
          className={cn(
            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
            badgeConfig.className,
          )}
        >
          {badgeConfig.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">进度</span>
          <span className="text-xs font-medium">{project.progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }}
          />
        </div>
      </div>

      {/* Date */}
      <p className="text-xs text-muted-foreground">{formattedDate}</p>
    </div>
  );
}

interface EmptyStateProps {
  hasProjects: boolean;
}

function EmptyState({ hasProjects }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground"
        >
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        </svg>
      </div>
      <h3 className="mb-1 text-sm font-semibold">{hasProjects ? '没有匹配的项目' : '暂无项目'}</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        {hasProjects
          ? '尝试调整搜索条件或筛选条件'
          : '点击"新建项目"开始创建您的第一个舞台设计方案'}
      </p>
      {!hasProjects && (
        <Link href="/project/new">
          <Button>新建项目</Button>
        </Link>
      )}
    </div>
  );
}

function ProjectGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="animate-pulse rounded-lg border bg-card p-5">
          <div className="mb-2 h-4 w-3/4 rounded bg-muted" />
          <div className="mb-3 h-3.5 w-1/2 rounded bg-muted" />
          <div className="mb-3 flex gap-2">
            <div className="h-5 w-14 rounded-full bg-muted" />
            <div className="h-5 w-14 rounded-full bg-muted" />
          </div>
          <div className="mb-3 h-1.5 w-full rounded-full bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
