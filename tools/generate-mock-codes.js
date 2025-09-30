/**
 * Generate rich mock 5-digit codes with broad coverage:
 * Imaging (CT/MRI/X-ray/US/Nuclear/PET), Procedures, E/M visits, Therapy,
 * Lab/Path, Anesthesia, Cardiology diagnostics, OB/GYN, Pediatrics/Vaccines,
 * Vision/Ophthalmology, and DME-like services.
 *
 * Usage:
 *   node tools/generate-mock-codes.js src/cpt-codes.json 6000
 */
const fs = require('fs');

const OUT = process.argv[2] || 'src/cpt-codes.json';
const COUNT = parseInt(process.argv[3] || '6000', 10);

// helpers
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const yesNo = () => (Math.random() < 0.5 ? 'yes' : 'no');
const laterality = () => pick(['left','right','bilateral','n/a']);
const setting = () => pick(['office','outpatient','inpatient','ASC','telehealth','ED']);
const contrastPhrase = () => pick(['without contrast','with contrast','with and without contrast','n/a']);
const viewsPhrase = () => pick(['single view','2 views','3+ views','n/a']);

const CAT = [
  // Imaging
  { name:'Imaging – CT', weight:0.12, build(){
      const body = pick(['head','chest','abdomen','pelvis','abdomen/pelvis','spine','knee','shoulder']);
      const c = contrastPhrase();
      return {
        description:`CT scan, ${body}, ${c}`,
        tags:['imaging','ct',body,c],
        attributes:{ modality:'CT', bodyPart:body, contrast:c, laterality:laterality(), views:'n/a', setting:setting() }
      };
  }},
  { name:'Imaging – MRI', weight:0.12, build(){
      const body = pick(['brain','cervical spine','thoracic spine','lumbar spine','shoulder','knee','hip','abdomen','pelvis']);
      const c = contrastPhrase();
      return {
        description:`MRI, ${body}, ${c}`,
        tags:['imaging','mri',body,c],
        attributes:{ modality:'MRI', bodyPart:body, contrast:c, laterality:laterality(), views:'n/a', setting:setting() }
      };
  }},
  { name:'Imaging – X-ray', weight:0.08, build(){
      const body = pick(['chest','hand','foot','knee','shoulder','spine']);
      const v = viewsPhrase();
      return {
        description:`X-ray, ${body}, ${v}`,
        tags:['imaging','xray',body,v],
        attributes:{ modality:'X-ray', bodyPart:body, contrast:'n/a', laterality:laterality(), views:v, setting:setting() }
      };
  }},
  { name:'Imaging – Ultrasound', weight:0.08, build(){
      const body = pick(['abdomen','pelvis','OB','vascular','thyroid','breast']);
      const extra = pick(['limited','complete','Doppler','guided']);
      return {
        description:`Ultrasound, ${body}, ${extra}`,
        tags:['imaging','ultrasound',body,extra.toLowerCase()],
        attributes:{ modality:'Ultrasound', bodyPart:body, contrast:'n/a', laterality:laterality(), views:'n/a', setting:setting() }
      };
  }},
  { name:'Imaging – Nuclear/PET', weight:0.03, build(){
      const body = pick(['whole body','cardiac','bone','renal']);
      const modality = pick(['nuclear medicine','PET']);
      return {
        description:`${modality}, ${body}`,
        tags:['imaging',modality.replace(' ','').toLowerCase(),body],
        attributes:{ modality, bodyPart:body, contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},

  // Procedures
  { name:'Procedure – General Surgery', weight:0.07, build(){
      const proc = pick(['laparoscopic cholecystectomy','hernia repair','appendectomy','hemorrhoidectomy']);
      return {
        description:`Procedure, ${proc}`,
        tags:['procedure','general-surgery'],
        attributes:{ modality:'n/a', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},
  { name:'Procedure – Orthopedics', weight:0.05, build(){
      const proc = pick(['knee arthroscopy','shoulder arthroscopy','ACL reconstruction','carpal tunnel release']);
      return {
        description:`Procedure, orthopedics: ${proc}`,
        tags:['procedure','orthopedics'],
        attributes:{ modality:'n/a', bodyPart:'musculoskeletal', contrast:'n/a', laterality:laterality(), views:'n/a', setting:setting() }
      };
  }},
  { name:'Procedure – Cardiology', weight:0.03, build(){
      const proc = pick(['cardiac cath diagnostic','stent placement','TTE echocardiography','TEE']);
      return {
        description:`Procedure, cardiology: ${proc}`,
        tags:['procedure','cardiology'],
        attributes:{ modality:'n/a', bodyPart:'cardiac', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},
  { name:'Procedure – GI/Endoscopy', weight:0.03, build(){
      const proc = pick(['colonoscopy screening','colonoscopy diagnostic','EGD with biopsy','ERCP']);
      return {
        description:`Procedure, GI: ${proc}`,
        tags:['procedure','gi','endoscopy'],
        attributes:{ modality:'endoscopy', bodyPart:'GI', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},
  { name:'Procedure – OB/GYN', weight:0.03, build(){
      const proc = pick(['C-section','D&C','hysteroscopy','IUD insertion']);
      return {
        description:`Procedure, OB/GYN: ${proc}`,
        tags:['procedure','obgyn'],
        attributes:{ modality:'n/a', bodyPart:'OB/GYN', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},

  // E/M & visits
  { name:'E/M – Office/Outpatient', weight:0.10, build(){
      const type = pick(['new patient','established patient','preventive']);
      const complexity = pick(['low','moderate','high']);
      const tele = yesNo();
      return {
        description:`Evaluation & Management, office/outpatient, ${type}, ${complexity} complexity${tele==='yes'?', telehealth':''}`,
        tags:['em','visit','office', type.replace(' ','-'), complexity, tele==='yes'?'telehealth':'in-person'],
        attributes:{ visitType:type, setting:tele==='yes'?'telehealth':'office', modality:'n/a', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a' }
      };
  }},
  { name:'E/M – ED/Hospital', weight:0.04, build(){
      const type = pick(['ED visit','inpatient hospital','observation']);
      const complexity = pick(['low','moderate','high']);
      return {
        description:`Evaluation & Management, ${type}, ${complexity} complexity`,
        tags:['em','visit', type.includes('ED')?'ed':'hospital', complexity],
        attributes:{ visitType:type, setting:type.includes('ED')?'ED':'inpatient', modality:'n/a', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a' }
      };
  }},

  // Therapy
  { name:'Therapy – PT/OT/SLP', weight:0.06, build(){
      const kind = pick(['PT','OT','SLP']);
      const type = pick(['evaluation','re-evaluation','treatment 15 min','group therapy','home exercise training']);
      return {
        description:`Therapy, ${kind}, ${type}`,
        tags:['therapy', kind.toLowerCase(), type.replace(/\s+/g,'-')],
        attributes:{ modality:'n/a', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},

  // Lab & Path
  { name:'Laboratory', weight:0.06, build(){
      const test = pick(['CBC','CMP','lipid panel','A1c','TSH','COVID PCR','HIV antigen/antibody']);
      return {
        description:`Laboratory test, ${test}`,
        tags:['lab','laboratory', test.toLowerCase().replace(/\s+/g,'-')],
        attributes:{ modality:'lab', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a', setting:'office' }
      };
  }},
  { name:'Pathology', weight:0.04, build(){
      const t = pick(['biopsy exam','cytology','frozen section','IHC stain','molecular panel']);
      return {
        description:`Pathology, ${t}`,
        tags:['pathology', t.toLowerCase().replace(/\s+/g,'-')],
        attributes:{ modality:'pathology', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a', setting:'lab' }
      };
  }},

  // Anesthesia
  { name:'Anesthesia', weight:0.05, build(){
      const area = pick(['upper limb','lower limb','abdomen','thorax','spine','head/neck']);
      const type = pick(['general','regional','MAC']);
      return {
        description:`Anesthesia, ${type}, ${area}`,
        tags:['anesthesia', type.toLowerCase(), area.replace('/','-')],
        attributes:{ modality:'anesthesia', bodyPart:area, contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},

  // Cardiology diagnostics
  { name:'Cardiology – Diagnostics', weight:0.03, build(){
      const t = pick(['ECG 12-lead','Holter monitor','stress test treadmill','stress echo']);
      return {
        description:`Cardiology diagnostic, ${t}`,
        tags:['cardiology','diagnostic', t.toLowerCase().replace(/\s+/g,'-')],
        attributes:{ modality:'cardiology', bodyPart:'cardiac', contrast:'n/a', laterality:'n/a', views:'n/a', setting:setting() }
      };
  }},

  // Pediatrics / Vaccines
  { name:'Pediatrics – Vaccines', weight:0.03, build(){
      const v = pick(['DTaP','MMR','Varicella','Influenza','HPV','Hep B','Pneumococcal']);
      return {
        description:`Immunization, ${v}`,
        tags:['pediatrics','vaccine', v.toLowerCase()],
        attributes:{ modality:'vaccine', bodyPart:'n/a', contrast:'n/a', laterality:'n/a', views:'n/a', setting:'office' }
      };
  }},

  // Vision / Ophthalmology
  { name:'Vision – Exams & Tests', weight:0.04, build(){
      const t = pick(['comprehensive eye exam','intermediate eye exam','refraction','OCT retina','visual field']);
      return {
        description:`Ophthalmology, ${t}`,
        tags:['vision','ophthalmology', t.toLowerCase().replace(/\s+/g,'-')],
        attributes:{ modality:'vision', bodyPart:'eye', contrast:'n/a', laterality:laterality(), views:'n/a', setting:setting() }
      };
  }},

  // DME-like
  { name:'DME – Equipment/Supplies', weight:0.10, build(){
      const item = pick(['wheelchair','walker','cane','crutches','CPAP device','oxygen concentrator','nebulizer','knee brace','wrist splint','prosthetic limb','orthotic foot insert']);
      const mod = pick(['RR (rental)','NU (new)','UE (used)','KX (doc on file)','GA (ABN on file)','LT (left)','RT (right)']);
      return {
        description:`DME item, ${item}, modifier ${mod}`,
        tags:['dme', item.replace(/\s+/g,'-'), mod.split(' ')[0].toLowerCase()],
        attributes:{ modality:'dme', bodyPart:'n/a', contrast:'n/a', laterality: mod.includes('LT')?'left':(mod.includes('RT')?'right':'n/a'), views:'n/a', setting:'office' }
      };
  }},
];

// build weighted table
const weighted = CAT.flatMap(c => Array(Math.max(1, Math.round(c.weight * 100))).fill(c));

function genRow() {
  const code = String(10000 + rnd(90000)); // 10000–99999
  const bucket = weighted[rnd(weighted.length)];
  const b = bucket.build();
  return { code, description:b.description, category:bucket.name, tags:b.tags, attributes:b.attributes };
}

(function main(){
  const used = new Set();
  const rows = [];
  while (rows.length < COUNT) {
    const r = genRow();
    if (used.has(r.code)) continue;
    used.add(r.code);
    rows.push(r);
  }
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} mock codes to ${OUT}`);
})();
