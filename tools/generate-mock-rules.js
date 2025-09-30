#!/usr/bin/env node
/**
 * Generate payer rules that vary by category and attributes.
 * Compatible with your existing rules.json shape:
 *   {
 *     "12345": { "Medicare": "text", "BlueCross": "text", ... },
 *     "67890": { ... }
 *   }
 *
 * Usage:
 *   node tools/generate-mock-rules.js src/cpt-codes.json src/rules.json 4242
 */

const fs = require('fs');

const CODES = process.argv[2] || 'src/cpt-codes.json';
const OUT   = process.argv[3] || 'src/rules.json';
let seed = parseInt(process.argv[4] || '4242', 10);

const payers = ['Medicare','BlueCross','UnitedHealth','Cigna','Aetna','Humana'];

function sRand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function pick(arr) { return arr[Math.floor(sRand() * arr.length)]; }
function coin() { return sRand() < 0.5; }
function includesAny(text, list) { return list.some(w => text.includes(w)); }
function uniqSentences(txt) {
  const s = (txt || '').replace(/\s+/g,' ').trim();
  const parts = s.split(/(?<=[.!?])\s+/);
  const out = [];
  for (const p of parts) {
    if (!out.length || out[out.length-1].toLowerCase() !== p.toLowerCase()) out.push(p);
  }
  return out.join(' ');
}

// Rule templates
const BASE_DOC = [
  'Maintain documentation of medical necessity.',
  'Include referring provider and clinical indication.',
  'Chart note must support diagnosis and rationale.',
  'Attach relevant imaging/lab results if applicable.'
];

const IMG_PA = [
  'Prior authorization required for advanced imaging.',
  'Precertification required; submit clinical criteria.',
  'Authorization needed for outpatient setting; inpatient exempt.'
];
const IMG_MOD = [
  'Use modifiers -26 (professional) and TC (technical) as appropriate.',
  'Split billing allowed with -26/-TC based on component.'
];
const IMG_CONTRAST = [
  'Include contrast details (with/without/with and without) in request.',
  'Contrast usage must be specified; check renal function when applicable.'
];

const XRAY_RULES = [
  'No PA for routine X-ray; frequency limits may apply.',
  'Coverage limited by medical necessity; document views performed.'
];

const US_RULES = [
  'PA not typically required; Doppler/OB may require additional criteria.',
  'Guided procedures should document target and intent.'
];

const E_M_RULES = [
  'No prior authorization for E/M; telehealth allowed when payer criteria are met.',
  'Level selection based on time or MDM; follow payer telehealth list and modifiers.'
];

const PROC_RULES = [
  'Prior authorization may be required; submit operative plan and diagnosis.',
  'Site of service may affect coverage; ASC vs. hospital outpatient rules apply.',
  'Assistant surgeon modifiers (80/81/82) per payer policy.'
];

const LAB_RULES = [
  'No PA; CLIA-compliant lab required.',
  'Reflex testing must meet criteria; document indication.'
];

const PATH_RULES = [
  'No PA; pathology report must include specimen source and findings.',
  'IHC/molecular add-ons may require documentation.'
];

const ANES_RULES = [
  'No PA for anesthesia; coverage tied to related procedure.',
  'Document start/stop times; ASA modifiers where applicable.'
];

const CARD_RULES = [
  'PA may be required for stress testing and certain diagnostics.',
  'Device/monitoring duration must be documented (e.g., Holter hours).'
];

const PEDS_VAX = [
  'No PA; coverage per immunization schedule; vaccine admin codes required.',
  'VFC or program documentation as applicable.'
];

const VISION_RULES = [
  'Refraction not covered by Medicare; may be non-covered for many plans.',
  'Frequency limits apply to routine vision services and hardware.'
];

const DME_RULES = [
  'Prior authorization may be required; include physician order and face-to-face note.',
  'Use DME modifiers: RR (rental), NU (new), UE (used), KX (documentation on file), GA (ABN on file), LT/RT.',
  'Coverage may require trial/failed conservative therapy; frequency and replacement limits apply.'
];

function buildRuleFor(codeRow, payer) {
  const d = (codeRow.description || '').toLowerCase();
  const cat = (codeRow.category || '').toLowerCase();
  let parts = [];

  // Imaging
  if (includesAny(cat, ['imaging']) || includesAny(d, ['ct','mri','x-ray','radiograph','ultrasound','sonogram','nuclear','pet'])) {
    if (includesAny(d, ['ct','mri','nuclear','pet'])) parts.push(pick(IMG_PA));
    if (includesAny(d, ['ct','mri'])) parts.push(pick(IMG_CONTRAST));
    if (includesAny(d, ['ct','mri','x-ray','ultrasound','sonogram'])) parts.push(pick(IMG_MOD));
    if (includesAny(d, ['x-ray','radiograph'])) parts.push(pick(XRAY_RULES));
    if (includesAny(d, ['ultrasound','sonogram'])) parts.push(pick(US_RULES));
    parts.push(pick(BASE_DOC));
  }
  // E/M
  else if (includesAny(cat, ['e/m','em']) || includesAny(d, ['evaluation & management','e/m','visit','telehealth'])) {
    parts.push(pick(E_M_RULES));
    if (includesAny(d, ['telehealth'])) parts.push('Use payer-specific telehealth place-of-service and modifiers when required.');
    parts.push(pick(BASE_DOC));
  }
  // Procedures (surgery subspecialties)
  else if (includesAny(cat, ['procedure'])) {
    parts.push(pick(PROC_RULES));
    parts.push(pick(BASE_DOC));
  }
  // Lab
  else if (includesAny(cat, ['laboratory']) || includesAny(d, ['lab','laboratory','panel','assay','pcr'])) {
    parts.push(pick(LAB_RULES));
    parts.push(pick(BASE_DOC));
  }
  // Pathology
  else if (includesAny(cat, ['pathology'])) {
    parts.push(pick(PATH_RULES));
    parts.push(pick(BASE_DOC));
  }
  // Anesthesia
  else if (includesAny(cat, ['anesthesia'])) {
    parts.push(pick(ANES_RULES));
    parts.push(pick(BASE_DOC));
  }
  // Cardiology diagnostics
  else if (includesAny(cat, ['cardiology'])) {
    parts.push(pick(CARD_RULES));
    parts.push(pick(BASE_DOC));
  }
  // Pediatrics/Vaccines
  else if (includesAny(cat, ['pediatrics','vaccine'])) {
    parts.push(pick(PEDS_VAX));
    parts.push(pick(BASE_DOC));
  }
  // Vision/Ophthalmology
  else if (includesAny(cat, ['vision','ophthalmology'])) {
    parts.push(pick(VISION_RULES));
    parts.push(pick(BASE_DOC));
  }
  // DME-like
  else if (includesAny(cat, ['dme'])) {
    parts.push(pick(DME_RULES));
    parts.push(pick(BASE_DOC));
  }
  else {
    // Generic fallback
    parts.push('Coverage based on medical necessity; prior authorization may apply for select services.');
    parts.push(pick(BASE_DOC));
  }

  // Light payer variation
  if (payer === 'Medicare' && includesAny(cat, ['vision']) && includesAny(d, ['refraction']))
    parts.push('Refraction not covered by Medicare (non-covered service).');

  if (payer === 'Humana' && includesAny(cat, ['imaging']))
    parts.push('Use contracted imaging centers when available.');

  if (payer === 'BlueCross' && includesAny(cat, ['dme']))
    parts.push('Rental vs. purchase subject to plan terms; verify benefits.');

  // Normalize & return
  return uniqSentences(parts.join(' '));
}

(function main() {
  const data = JSON.parse(fs.readFileSync(CODES,'utf8'));
  const rulesOut = {};
  for (const row of data) {
    const perPayer = {};
    for (const p of payers) {
      perPayer[p] = buildRuleFor(row, p);
    }
    rulesOut[row.code] = perPayer;
  }
  fs.writeFileSync(OUT, JSON.stringify(rulesOut, null, 2));
  console.log(`Wrote synthetic rules for ${data.length} codes to ${OUT}`);
})();
