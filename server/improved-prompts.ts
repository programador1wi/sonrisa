// Frozen v5 defaults, retained only to reverse the automatic v4-to-v5 migration.
import type { PromptConfig } from '../shared/domain.js';

export const IMPROVED_DEFAULT_PROMPTS: PromptConfig = {
  common: [
    'TASK: Make a restrained, photorealistic dental edit of the supplied WORK CROP. The ORIGINAL PATIENT PHOTO is the mandatory authority for identity and the original teeth. Return ONE square edited work crop, with exactly the same framing and mouth coordinates. The full portrait is reference only.',
    'LOCKED CONTENT: Preserve lip contours, mouth opening, gum margins, smile expression, skin, perspective, exposure, white balance and existing shadows. Change only visible teeth and requested orthodontic hardware inside the editable region. Never widen the smile, reveal more teeth or reconstruct hidden anatomy.',
    'TOOTH IDENTITY: Before editing, match the visible teeth to the original from left to right. Keep their apparent count and each tooth\'s own crown outline, width-to-height ratio, incisal edge, canine tip, small asymmetries and natural shade. Move or slightly rotate those same teeth only as needed for this stage. Do not substitute a generic dental arch, enlarge crowns, fill the mouth with a uniform white strip, duplicate, fuse, add or remove teeth.',
    'PHOTOGRAPHIC MATCH: Retain the original enamel translucency, tonal variation, contact shadows and separation between adjacent teeth. Match the source sharpness, grain and depth of field; avoid a sharper or brighter pasted-in patch, artificial shine, porcelain texture, whitening, veneers or beauty retouching. If a detail is unclear in the source, preserve its ambiguity instead of inventing anatomy.',
    'BRACKETS WHEN REQUESTED: Small conventional stainless-steel brackets, one per sufficiently exposed tooth surface, following each tooth\'s perspective and natural irregular position. A thin silver archwire passes through the bracket slots along the arch. Keep hardware realistically attached with restrained reflections and tiny contact shadows. Lips and neighbouring teeth occlude hardware naturally. Do not draw brackets on gums, lips or barely visible slivers of teeth; no large chrome blocks, floating pieces, duplicate wires or black outlines. Use this same hardware design in both treatment stages.',
    'SHARED VISUAL PLAN: All stages derive independently from the same original. At 6 months, keep almost all original irregularity; brackets are the main change. At 18 months, reduce some of that same irregularity, with brackets and some unfinished alignment. At final, align those same teeth naturally without hardware, retaining individual shapes and subtle asymmetry. Never straighten teeth more than necessary or force a perfect symmetric smile. If the original is already fairly aligned, differences should remain small.',
    'Output only the requested stage. No text, dates, labels, arrows, collage, instruments, hands or additional people.',
  ].join('\n\n'),
  stages: {
    month_6: [
      '6-MONTH VISUAL — EARLY, MINIMAL CHANGE.',
      'Use the ORIGINAL tooth positions as the starting and near-final geometry for this image. Preserve visible crowding, overlaps, rotations, gaps and uneven edges. Add the small silver brackets and fine wire described above. Alignment changes, if any, must be barely perceptible; do not close major gaps or make the arch straight. Preserve irregular bracket heights caused by the original tooth positions. The clear visible difference should be the appliance, not a transformed smile.',
    ].join('\n'),
    month_18: [
      '18-MONTH VISUAL — MODERATE, INCOMPLETE ALIGNMENT.',
      'Edit directly from the ORIGINAL teeth. Show a restrained improvement in the visible crowding or rotations that actually exist in this patient, while retaining some irregularity. Keep the same crown outlines and natural shade, with the small silver brackets and fine wire specified in the common plan. Do not invent defects to correct, create a perfectly even row, or expose hidden tooth surfaces. This stage should look more ordered than the conservative 6-month description and less finished than the final description; no previous generated image is required.',
    ].join('\n'),
    final: [
      'FINAL VISUAL — NATURAL ALIGNMENT, NO APPLIANCE.',
      'Edit directly from the ORIGINAL teeth to depict a modest, harmonious alignment of those same visible teeth. Preserve characteristic crown shapes, individual sizes, incisal edges, natural color and small asymmetries. Improve positions only; do not redesign the smile, change the bite, enlarge the visible dental area or turn the teeth into veneers. No brackets, wire, adhesive residue or orthodontic accessories. The result must remain recognizable as this patient\'s original dentition, with natural separation and shadows between teeth.',
    ].join('\n'),
  },
};
