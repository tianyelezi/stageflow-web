'use client';

import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useRegenerateZoneMutation } from '@/hooks/use-project';
import type { CostEstimate, MaterialItem, SpatialZone, ZoneType } from '@/types';

interface SpatialGalleryProps {
  projectId: string;
  zones: SpatialZone[];
}

const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  main_stage: '主舞台',
  photo_wall: '照片墙',
  entrance: '入口',
  check_in_desk: '签到台',
  history_wall: '历史墙',
  honor_wall: '荣誉墙',
  interactive_zone: '互动区',
};

const MAX_DESCRIPTION_LINES = 2;

function formatCurrency(amount: number | undefined | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '¥-';
  return `¥${amount.toLocaleString('zh-CN')}`;
}

function MaterialTable({ items }: { items: MaterialItem[] }) {
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="bg-muted">
          <th className="px-2 py-1 text-left font-medium">材料名称</th>
          <th className="px-2 py-1 text-left font-medium">规格</th>
          <th className="px-2 py-1 text-left font-medium">数量</th>
          <th className="px-2 py-1 text-left font-medium">参考单价</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.name}-${item.spec}`} className="border-b">
            <td className="px-2 py-1">{item.name}</td>
            <td className="px-2 py-1">{item.spec}</td>
            <td className="px-2 py-1">{item.quantity}</td>
            <td className="px-2 py-1">{item.unitPriceRange}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZoneCostSection({
  costEstimate,
  constructionDays,
  materialList,
}: {
  costEstimate?: CostEstimate;
  constructionDays?: number;
  materialList?: MaterialItem[];
}) {
  const [isMaterialOpen, setIsMaterialOpen] = useState(false);

  const handleToggleMaterial = useCallback(() => {
    setIsMaterialOpen((prev) => !prev);
  }, []);

  if (costEstimate === undefined && constructionDays === undefined) {
    return null;
  }

  return (
    <div className="mt-3 rounded border bg-muted/30 p-3">
      <h5 className="text-xs font-medium text-muted-foreground">成本与材料</h5>
      {costEstimate !== undefined && (
        <>
          <p className="mt-1 text-sm font-semibold text-primary">
            预算：{formatCurrency(costEstimate.totalMin)} - {formatCurrency(costEstimate.totalMax)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            ⚠️ AI 基于标准行情估算，误差 ±30%，实际以供应商现场报价为准
          </p>
        </>
      )}
      {constructionDays !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">搭建周期：{constructionDays} 天</p>
      )}
      {materialList !== undefined && materialList.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-primary underline-offset-2 hover:underline"
            onClick={handleToggleMaterial}
          >
            {isMaterialOpen ? '收起材料清单' : '查看材料清单'}
          </button>
          {isMaterialOpen && <MaterialTable items={materialList} />}
        </div>
      )}
    </div>
  );
}

function ZoneImage({
  imageUrl,
  name,
  onClickPreview,
}: {
  imageUrl: string | null;
  name: string;
  onClickPreview: () => void;
}) {
  if (imageUrl === null) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-t-lg bg-muted">
        <span className="text-sm text-muted-foreground">生成失败</span>
      </div>
    );
  }

  return (
    <button type="button" className="block w-full cursor-pointer" onClick={onClickPreview}>
      <img src={imageUrl} alt={name} className="aspect-video w-full rounded-t-lg object-cover" />
    </button>
  );
}

function ImagePreviewModal({
  imageUrl,
  alt,
  onClose,
}: {
  imageUrl: string;
  alt: string;
  onClose: () => void;
}) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="relative max-h-[90vh] max-w-[90vw]">
        <button
          type="button"
          className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg"
          onClick={onClose}
          aria-label="关闭预览"
        >
          ✕
        </button>
        <img
          src={imageUrl}
          alt={alt}
          className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
        />
      </div>
    </div>
  );
}

function ZoneCard({
  zone,
  projectId,
  allZones,
  onPreview,
}: {
  zone: SpatialZone;
  projectId: string;
  allZones: SpatialZone[];
  onPreview: (imageUrl: string, name: string) => void;
}) {
  const regenerateMutation = useRegenerateZoneMutation(projectId);

  const handleRegenerate = useCallback(() => {
    // Include other zones' design context for style consistency
    const otherZones = allZones
      .filter((z) => z.type !== zone.type)
      .map((z) => `${z.name}: ${z.description?.slice(0, 50) ?? ''}`)
      .join('；');
    const additionalNotes = `请保持与以下区域一致的设计语言和风格：${otherZones}`;
    regenerateMutation.mutate({ zoneType: zone.type, additionalNotes });
  }, [regenerateMutation, zone.type, allZones]);

  const handleClickPreview = useCallback(() => {
    if (zone.imageUrl !== null) {
      onPreview(zone.imageUrl, zone.name);
    }
  }, [zone.imageUrl, zone.name, onPreview]);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <ZoneImage imageUrl={zone.imageUrl} name={zone.name} onClickPreview={handleClickPreview} />
      <div className="p-6">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{zone.name}</h4>
          <span className="rounded bg-muted px-2 py-0.5 text-xs">
            {ZONE_TYPE_LABELS[zone.type] ?? zone.type}
          </span>
        </div>
        <p
          className="mt-2 text-sm text-muted-foreground"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: MAX_DESCRIPTION_LINES,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {zone.description}
        </p>
        <ZoneCostSection
          costEstimate={zone.costEstimate}
          constructionDays={zone.constructionDays}
          materialList={zone.materialList}
        />
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={handleRegenerate}
          disabled={regenerateMutation.isPending}
        >
          {regenerateMutation.isPending ? '生成中...' : '重新生成'}
        </Button>
      </div>
    </div>
  );
}

function ProjectCostSummary({ zones }: { zones: SpatialZone[] }) {
  const summary = useMemo(() => {
    let totalMin = 0;
    let totalMax = 0;
    let maxDays = 0;

    for (const zone of zones) {
      if (zone.costEstimate !== undefined) {
        totalMin += zone.costEstimate.totalMin;
        totalMax += zone.costEstimate.totalMax;
      }
      if (zone.constructionDays !== undefined && zone.constructionDays > maxDays) {
        maxDays = zone.constructionDays;
      }
    }

    return { totalMin, totalMax, maxDays };
  }, [zones]);

  if (summary.totalMin === 0 && summary.totalMax === 0 && summary.maxDays === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      {(summary.totalMin > 0 || summary.totalMax > 0) && (
        <>
          <p className="text-sm font-semibold text-primary">
            项目总预算估算：{formatCurrency(summary.totalMin)} - {formatCurrency(summary.totalMax)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            ⚠️ 该估算由 AI 基于一线城市活动搭建行情生成，误差 ±30%，实际以供应商现场核价为准
          </p>
        </>
      )}
      {summary.maxDays > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          总搭建周期：约 {summary.maxDays} 天（含并行施工）
        </p>
      )}
    </div>
  );
}

export function SpatialGallery({ projectId, zones }: SpatialGalleryProps) {
  const [preview, setPreview] = useState<{ imageUrl: string; name: string } | null>(null);

  const handleOpenPreview = useCallback((imageUrl: string, name: string) => {
    setPreview({ imageUrl, name });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreview(null);
  }, []);

  return (
    <>
      <ProjectCostSummary zones={zones} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {zones.map((zone) => (
          <ZoneCard
            key={zone.type}
            zone={zone}
            projectId={projectId}
            allZones={zones}
            onPreview={handleOpenPreview}
          />
        ))}
      </div>

      {preview !== null && (
        <ImagePreviewModal
          imageUrl={preview.imageUrl}
          alt={preview.name}
          onClose={handleClosePreview}
        />
      )}
    </>
  );
}
