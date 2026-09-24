export const STAGES = ['month_6', 'month_18', 'final'] as const;
export type StageKey = (typeof STAGES)[number];
export type LegacyStageKey = 'year_1' | 'year_2';
export type AttemptStageKey = StageKey | LegacyStageKey;
export type ProviderMode = 'gemini' | 'openai' | 'test';
export const TIMELINE = STAGES;
export const STAGE_INFO: Record<StageKey, { label: string; filename: string; progress: string }> = {
  final: { label: 'Resultado final', filename: '03_final.png', progress: 'Alineación objetivo · sin brackets' },
  month_6: { label: '6 meses', filename: '01_month_6.png', progress: 'Cambios visuales muy discretos' },
  month_18: { label: '18 meses', filename: '02_month_18.png', progress: 'Mejora intermedia con brackets' },
};
export const ATTEMPT_LABELS: Record<AttemptStageKey, string> = {
  month_6: STAGE_INFO.month_6.label, month_18: STAGE_INFO.month_18.label, final: STAGE_INFO.final.label,
  year_1: '1 año · historial anterior', year_2: '2 años · historial anterior',
};
export const isStageKey = (key: AttemptStageKey): key is StageKey => STAGES.some((stage) => stage === key);
export interface PromptConfig { common: string; stages: Record<StageKey, string> }
export type StageStatus = 'pending' | 'queued' | 'generating' | 'needs_review' | 'accepted' | 'rejected' | 'failed' | 'interrupted';
export interface Bounds { left: number; top: number; width: number; height: number }
export interface VisualCheck {
  version: 1;
  passed: boolean;
  reason?: 'DENTAL_DRIFT' | 'CONTEXT_DRIFT';
  dentalChangedPercent: number;
  dentalMeanDelta: number;
  contextChangedPercent: number;
  contextMeanDelta: number;
}
export interface QualityReport {
  outsideChangedPixels: number;
  width: number;
  height: number;
  editedPixels: number;
  originalHashVerified: boolean;
  visualCheck?: VisualCheck;
}
export interface Stage {
  key: StageKey;
  version: number;
  status: StageStatus;
  attemptId?: string;
  outputAssetId?: string;
  cropAssetId?: string;
  error?: string;
  quality?: QualityReport;
}
export interface Asset {
  id: string;
  kind: 'original' | 'working' | 'mask' | 'crop' | 'candidate' | 'output';
  mime: 'image/png' | 'image/jpeg';
  stage?: AttemptStageKey;
  version?: number;
}
export interface Reference { role: string; assetId: string }
export interface Attempt {
  id: string;
  requestId: string;
  batchId?: string;
  stage: AttemptStageKey;
  version: number;
  maskVersion: number;
  model: string;
  provider?: ProviderMode;
  promptVersion: string;
  promptRevision?: number;
  promptText?: string;
  notes: string;
  status: Exclude<StageStatus, 'pending'>;
  createdAt: string;
  startedAt?: string;
  providerDurationMs?: number;
  completedAt?: string;
  references: Reference[];
  outputAssetId?: string;
  candidateAssetId?: string;
  quality?: QualityReport;
  visualCheck?: VisualCheck;
  usage?: Record<string, number>;
  errorCode?: string;
  error?: string;
}
export interface Simulation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  model: string;
  provider?: ProviderMode;
  originalHash: string;
  originalAssetId: string;
  workingAssetId: string;
  width: number;
  height: number;
  maskVersion: number;
  timelineVersion: number;
  migratedFromLegacyTimeline?: boolean;
  promptRevision: number;
  prompts: PromptConfig;
  maskAssetId?: string;
  cropAssetId?: string;
  bounds?: Bounds;
  stages: Record<StageKey, Stage>;
  assets: Asset[];
  attempts: Attempt[];
}
export interface SimulationSummary {
  id: string; name: string; createdAt: string; updatedAt: string;
  originalAssetId: string; accepted: number; busy: boolean; width: number; height: number;
}
export interface HistoryPage { items: SimulationSummary[]; nextOffset: number | null }
export interface Health { ready: boolean; model: string; mode: ProviderMode; promptVersion: string; warning?: string }
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const busySimulation = (sim: Simulation) => STAGES.some((key) => ['queued', 'generating'].includes(sim.stages[key].status));
export const firstIncomplete = (sim: Simulation): StageKey | undefined => STAGES.find((key) => sim.stages[key].status !== 'accepted');
export const assetUrl = (id: string, assetId: string) => '/api/simulations/' + id + '/assets/' + assetId;
export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: 'Pendiente', queued: 'En espera', generating: 'Generando', needs_review: 'Por revisar',
  accepted: 'Aceptado', rejected: 'Rechazado', failed: 'No se pudo generar', interrupted: 'Resultado desconocido',
};
