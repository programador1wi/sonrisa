export type StudioSection = 'brackets' | 'carillas' | 'blanqueamiento';

export const BRACKETS_STAGES = ['month_6', 'month_18', 'final'] as const;
export const VENEER_STAGES = ['veneer_natural', 'veneer_white', 'veneer_bleach'] as const;
export const WHITENING_STAGES = ['whitening_mild', 'whitening_medium', 'whitening_intense'] as const;

export const ALL_STAGE_KEYS = [
  ...BRACKETS_STAGES,
  ...VENEER_STAGES,
  ...WHITENING_STAGES,
] as const;

export type BracketsStageKey = (typeof BRACKETS_STAGES)[number];
export type VeneerStageKey = (typeof VENEER_STAGES)[number];
export type WhiteningStageKey = (typeof WHITENING_STAGES)[number];
export type StageKey = (typeof ALL_STAGE_KEYS)[number];

export const SECTION_STAGES: Record<StudioSection, readonly StageKey[]> = {
  brackets: BRACKETS_STAGES,
  carillas: VENEER_STAGES,
  blanqueamiento: WHITENING_STAGES,
};

export const SECTION_LABELS: Record<StudioSection, { title: string; subtitle: string; icon: string; batchLabel: string }> = {
  brackets: {
    title: 'Ortodoncia & Brackets',
    subtitle: 'Evolución temporal con aparatología metálica',
    icon: '🦷',
    batchLabel: 'Generar las 3 imágenes',
  },
  carillas: {
    title: 'Carillas Dentales de Porcelana',
    subtitle: 'Diseño de sonrisa en 3 tonos: Natural, Blanco y Muy Blanco',
    icon: '✨',
    batchLabel: 'Generar las 3 carillas',
  },
  blanqueamiento: {
    title: 'Blanqueamiento Dental',
    subtitle: 'Aclarado progresivo en 3 niveles sin alterar anatomía',
    icon: '⚡',
    batchLabel: 'Generar los 3 blanqueamientos',
  },
};

export const STAGES = BRACKETS_STAGES;
export type LegacyStageKey = 'year_1' | 'year_2';
export type AttemptStageKey = StageKey | LegacyStageKey;
export type ProviderMode = 'gemini' | 'openai' | 'test';
export const TIMELINE = STAGES;

export interface StageInfo {
  label: string;
  filename: string;
  progress: string;
  section: StudioSection;
  chipLabel?: string;
}

export const STAGE_INFO: Record<StageKey, StageInfo> = {
  // Brackets
  final: { label: 'Resultado final', filename: '03_final.png', progress: 'Alineación objetivo · sin brackets', section: 'brackets', chipLabel: 'Final' },
  month_6: { label: '6 meses', filename: '01_month_6.png', progress: 'Cambios visuales muy discretos', section: 'brackets', chipLabel: '6 meses' },
  month_18: { label: '18 meses', filename: '02_month_18.png', progress: 'Mejora intermedia con brackets', section: 'brackets', chipLabel: '18 meses' },

  // Carillas
  veneer_natural: { label: 'Tono Natural (A2/A3)', filename: 'carilla_natural.png', progress: 'Porcelana estética armónica con color biológico', section: 'carillas', chipLabel: 'Natural A2' },
  veneer_white: { label: 'Tono Blanco (A1/B1)', filename: 'carilla_blanco.png', progress: 'Luminosidad estética de alta gama', section: 'carillas', chipLabel: 'Blanco A1' },
  veneer_bleach: { label: 'Tono Muy Blanco (BL1)', filename: 'carilla_muy_blanco.png', progress: 'Sonrisa Hollywood Bleach de máxima luminosidad', section: 'carillas', chipLabel: 'Hollywood BL1' },

  // Blanqueamiento
  whitening_mild: { label: 'Aclarado Suave (+2 tonos)', filename: 'blanqueamiento_suave.png', progress: 'Aclaramiento sutil y progresivo en esmalte', section: 'blanqueamiento', chipLabel: '+2 tonos' },
  whitening_medium: { label: 'Aclarado Medio (+4 tonos)', filename: 'blanqueamiento_medio.png', progress: 'Luminosidad balanceada visible y limpia', section: 'blanqueamiento', chipLabel: '+4 tonos' },
  whitening_intense: { label: 'Aclarado Intenso (+6 tonos)', filename: 'blanqueamiento_intenso.png', progress: 'Tratamiento clínico intensivo de máxima potencia', section: 'blanqueamiento', chipLabel: '+6 tonos' },
};

export const ATTEMPT_LABELS: Record<AttemptStageKey, string> = {
  month_6: STAGE_INFO.month_6.label,
  month_18: STAGE_INFO.month_18.label,
  final: STAGE_INFO.final.label,
  veneer_natural: STAGE_INFO.veneer_natural.label,
  veneer_white: STAGE_INFO.veneer_white.label,
  veneer_bleach: STAGE_INFO.veneer_bleach.label,
  whitening_mild: STAGE_INFO.whitening_mild.label,
  whitening_medium: STAGE_INFO.whitening_medium.label,
  whitening_intense: STAGE_INFO.whitening_intense.label,
  year_1: '1 año · historial anterior',
  year_2: '2 años · historial anterior',
};

export const isStageKey = (key: AttemptStageKey): key is StageKey => ALL_STAGE_KEYS.some((stage) => stage === key);
export interface PromptConfig { common: string; stages: Partial<Record<StageKey, string>> }
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

export const sectionStages = (section: StudioSection): readonly StageKey[] => SECTION_STAGES[section];

export const busySimulation = (sim: Simulation, section?: StudioSection) => {
  const keys = section ? SECTION_STAGES[section] : ALL_STAGE_KEYS;
  return keys.some((key) => ['queued', 'generating'].includes(sim.stages[key]?.status));
};

export const firstIncomplete = (sim: Simulation, section: StudioSection = 'brackets'): StageKey | undefined =>
  SECTION_STAGES[section].find((key) => sim.stages[key]?.status !== 'accepted');

export const assetUrl = (id: string, assetId: string) => '/api/simulations/' + id + '/assets/' + assetId;
export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: 'Pendiente', queued: 'En espera', generating: 'Generando', needs_review: 'Por revisar',
  accepted: 'Aceptado', rejected: 'Rechazado', failed: 'No se pudo generar', interrupted: 'Resultado desconocido',
};
