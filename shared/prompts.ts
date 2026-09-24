import type { PromptConfig, StageKey } from './domain.js';
import { STAGE_INFO } from './domain.js';

export const PROMPT_VERSION = 'dental-18-month-v4';
export const DEFAULT_PROMPTS: PromptConfig = {
  common: [
    'Edit the supplied dental work crop, using the ORIGINAL PATIENT PHOTO as the mandatory primary identity and tooth reference.',
    'Return exactly ONE square photograph of the edited WORK CROP. Full photo is a reference only; do not output the full portrait or a collage.',
    'Preserve the exact crop, mouth location, lip contours, opening, gums, lighting, shadows, texture and perspective.',
    'Only edit visible teeth and orthodontic hardware. Retain each original tooth: individual shape, width, length, proportions, natural enamel color and distinguishing features.',
    'Change alignment only as much as the requested stage requires. Do not replace the dentition, whiten it, create veneers, crowns, identical teeth, add, duplicate, fuse or remove teeth.',
    'Keep lips, gums and all non-dental content unchanged. Never enlarge the smile or invent hidden anatomy. This is an aesthetic illustration, not a diagnosis or clinical prediction.',
    'Time labels are illustrative. Do not infer a clinically predictable rate of movement from the dates. Early treatment may show very little visible change.',
    'No text, labels, dates, logos, arrows, tools, hands or people added. No beauty retouching.',
  ].join('\n'),
  stages: {
    month_6: 'FIRST STAGE, EARLY AND CONSERVATIVE. Teeth should look almost like the ORIGINAL: preserve the original crowding, rotations, gaps, irregular incisal edges and tooth positions. If any change is visible, make it very subtle and limited to one or two teeth. The new metallic brackets and fine arch wire should be the main visual difference. Do NOT make the dental arch look straight or evenly spaced. Use small conventional silver brackets centered on each visible tooth, attached to enamel, with a fine coherent wire following the original irregular arch; no hardware on lips or gums.',
    month_18: 'SECOND STAGE, EIGHTEEN-MONTH VISUAL. Continue from the SIX-MONTH STAGE, keeping the same original teeth, small silver brackets and fine wire. Show a visible but moderate alignment improvement while retaining natural tooth shapes and some irregularity. The wire follows the partly corrected arch. Do not make the smile final or remove the brackets.',
    final: 'THIRD AND FINAL STAGE. Continue from the EIGHTEEN-MONTH STAGE: remove every bracket, wire and orthodontic accessory, then make only the remaining alignment refinements needed for a natural result. Preserve the original tooth shapes, subtle individuality and natural shade. No perfect celebrity smile, veneers or artificial whitening.',
  },
};

export function buildPrompt(stage: StageKey, notes: string, config: PromptConfig): string {
  return config.common.trim() + '\nSTAGE: ' + STAGE_INFO[stage].label + '\n' + config.stages[stage].trim() +
    '\nThe dates describe an illustrative sequence only, never a clinical measurement or promise.' +
    (notes ? '\nOperator observations for this revision (apply only within the constraints above):\n' + notes : '');
}
