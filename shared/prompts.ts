import type { PromptConfig, StageKey } from './domain.js';
import { STAGE_INFO } from './domain.js';

export const PROMPT_VERSION = 'dental-multimodal-v1';
export const DEFAULT_PROMPTS: PromptConfig = {
  common: [
    'Edit the supplied dental work crop, using the ORIGINAL PATIENT PHOTO as the mandatory primary identity and tooth reference.',
    'Return exactly ONE square photograph of the edited WORK CROP. Full photo is a reference only; do not output the full portrait or a collage.',
    'Preserve the exact crop, mouth location, lip contours, opening, gums, lighting, shadows, texture and perspective.',
    'Retain each original tooth identity, width, length, natural proportions and distinguishing features.',
    'Keep lips, gums, facial skin and all non-dental content completely unchanged. Never enlarge the smile or invent hidden anatomy. This is an aesthetic illustration, not a clinical prediction.',
    'No text, labels, dates, logos, arrows, tools, hands or people added.',
  ].join('\n'),
  stages: {
    // 1. Ortodoncia & Brackets
    month_6: 'FIRST STAGE, EARLY AND CONSERVATIVE. Teeth should look almost like the ORIGINAL: preserve the original crowding, rotations, gaps, irregular incisal edges and tooth positions. If any change is visible, make it very subtle and limited to one or two teeth. The new metallic brackets and fine arch wire should be the main visual difference. Do NOT make the dental arch look straight or evenly spaced. Use small conventional silver brackets centered on each visible tooth, attached to enamel, with a fine coherent wire following the original irregular arch; no hardware on lips or gums.',
    month_18: 'SECOND STAGE, EIGHTEEN-MONTH VISUAL. Continue from the SIX-MONTH STAGE, keeping the same original teeth, small silver brackets and fine wire. Show a visible but moderate alignment improvement while retaining natural tooth shapes and some irregularity. The wire follows the partly corrected arch. Do not make the smile final or remove the brackets.',
    final: 'THIRD AND FINAL STAGE. Continue from the EIGHTEEN-MONTH STAGE: remove every bracket, wire and orthodontic accessory, then make only the remaining alignment refinements needed for a natural result. Preserve the original tooth shapes, subtle individuality and natural shade. No perfect celebrity smile, veneers or artificial whitening.',

    // 2. Carillas Dentales de Porcelana (Veneers)
    veneer_natural: 'PORCELAIN VENEERS — NATURAL SHADE (VITA A2/A3). Reshape the visible anterior teeth into harmonious, realistic aesthetic porcelain veneers. Refine incisal edges, close minor gaps/diastemas, and create symmetrical contours while maintaining a natural, lifelike biological tooth shade (warm ivory A2/A3 with subtle enamel translucency and depth). The veneers must appear biologically integrated and not artificial. No metal, no brackets.',
    veneer_white: 'PORCELAIN VENEERS — BRIGHT AESTHETIC WHITE (VITA A1/B1). Reshape the visible anterior teeth with symmetrical, balanced porcelain veneers. Harmonize tooth lengths, smooth incisal line, and close visible gaps. Shade is a bright, clean, premium aesthetic white (A1/B1) with crisp natural reflections, high-end glaze, and delicate interdental separations. No metal, no brackets.',
    veneer_bleach: 'PORCELAIN VENEERS — EXTRA WHITE BLEACH (HOLLYWOOD BL1/OM1). Sculpt visible anterior teeth into a brilliant, radiant Hollywood celebrity aesthetic smile. Flawless high-value bleach white porcelain veneers (BL1). Symmetrical dental arch, refined embrasures, perfectly leveled incisal edges. Radiant, stark bright white while keeping realistic individual tooth separation and healthy gingival margins. No metal, no brackets.',

    // 3. Blanqueamiento Dental (Whitening)
    whitening_mild: 'TEETH WHITENING — MILD SHADE LIFT (+2 VITA SHADES). STRICT RULE: DO NOT reshape, move, straighten, enlarge or replace any tooth. Preserve all original crowding, rotations, tooth outlines, incisal edges and dental anatomy EXACTLY as in the original photo. Only lift the natural enamel brightness by approximately 2 shades: gently reduce surface yellowing and staining for a clean, refreshed appearance with authentic enamel translucency. No brackets, no veneers.',
    whitening_medium: 'TEETH WHITENING — MEDIUM SHADE LIFT (+4 VITA SHADES). STRICT RULE: DO NOT alter tooth shape, position, edges, spacing or anatomy in any way. Keep the exact original dental geometry intact. Uniformly lighten visible enamel by 4 shades on the dental shade guide: visibly cleaner, luminous and desaturated of yellow/brown chroma, with natural specular highlights. No brackets, no veneers.',
    whitening_intense: 'TEETH WHITENING — INTENSIVE CLINICAL LIFT (+6 VITA SHADES / IN-OFFICE LASER). STRICT RULE: DO NOT alter the shape, position, edges, spacing or morphology of any tooth. Maximize enamel value and brightness as achieved by high-potency in-office professional laser whitening: noticeably whiter, vibrant, clean enamel deeply desaturated of all stains, reflecting light brightly while retaining individual tooth separation and intact gum line. No brackets, no veneers.',
  },
};

export function buildPrompt(stage: StageKey, notes: string, config: PromptConfig): string {
  const stageInstruction = config.stages[stage] ?? DEFAULT_PROMPTS.stages[stage] ?? '';
  return config.common.trim() + '\nSTAGE: ' + STAGE_INFO[stage].label + '\n' + stageInstruction.trim() +
    '\nThe dates or labels describe an illustrative aesthetic sequence only, never a clinical measurement or promise.' +
    (notes ? '\nOperator observations for this revision (apply only within the constraints above):\n' + notes : '');
}
