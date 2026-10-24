import { zip } from './export.js';
import { toPdf } from '../cad/pdf.js';
import type { Entity, Pt } from '../cad/entities.js';
import type { Role } from './intake.js';

// Sample inputs for trying New Project: two floor layout PDFs, a master
// schedule (CSV) and a hardware schedule (Word). Fictional data with two
// deliberate discrepancies so the cross-check has something to find.

const enc = new TextEncoder();

function layoutPdf(level: string, rooms: { name: string; x: number; y: number; w: number; h: number; door: string }[], legend: string[]): Uint8Array {
  const es: Entity[] = [];
  const rect = (x: number, y: number, w: number, h: number, layer: Entity['layer'] = 'A-WALL'): Entity => ({ t: 'poly', layer, closed: true, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Pt[] });
  es.push(rect(10, 10, 400, 277, 'A-SHEET'));
  es.push(rect(30, 40, 300, 220));
  for (const r of rooms) {
    es.push(rect(r.x, r.y, r.w, r.h));
    es.push({ t: 'text', layer: 'A-TEXT', p: [r.x + r.w / 2, r.y + r.h / 2 + 4], h: 3, s: r.name.toUpperCase(), align: 'center' });
    es.push({ t: 'circle', layer: 'A-DOOR', c: [r.x + r.w / 2, r.y + 8], r: 6 });
    es.push({ t: 'text', layer: 'A-DOOR', p: [r.x + r.w / 2, r.y + 8], h: 2.4, s: r.door, align: 'center', valign: 'middle' });
  }
  es.push({ t: 'text', layer: 'A-TITLE', p: [345, 250], h: 4, s: `${level.toUpperCase()} - DOOR LAYOUT` });
  legend.forEach((l, i) => es.push({ t: 'text', layer: 'A-TEXT', p: [345, 238 - i * 6], h: 2.6, s: l }));
  es.push({ t: 'text', layer: 'A-TITLE', p: [345, 30], h: 3, s: 'HARBOUR VIEW HOTEL' });
  return toPdf([{ entities: es, paper: [420, 297], S: 1 }], { title: `${level} door layout` });
}

const SCHEDULE = [
  'Project Name,Harbour View Hotel',
  'Project No,HVH-2026',
  'Client,Harbour Holdings LLC',
  'Architect,Studio North Architects',
  'Location,Dubai Marina',
  '',
  'Door No,Level,Room,Width,Height,Thickness,Fire rating,Acoustic,Leaves,Door material,Frame,Finish,Hardware set,Handing',
  'D-101,Level 01,Lobby,1800,2400,54,,,2,Glass,Aluminium,Clear glass,HW-01,LH',
  'D-102,Level 01,Office 1,900,2100,44,,35 dB,1,Timber,Timber,Oak veneer,HW-02,RH',
  'D-103,Level 01,Office 2,900,2100,44,,35 dB,1,Timber,Timber,Oak veneer,HW-02,LH',
  'D-104,Level 01,Stair 1,1000,2100,54,60 min,,1,Steel,Steel,Paint RAL 9010,HW-03,RH',
  'D-105,Level 01,Plant room,1500,2100,54,60 min,,2,Steel,Steel,Paint RAL 7016,HW-04,LH',
  'D-201,Level 02,Guest room 201,900,2100,54,30 min,40 dB,1,Timber,Timber,Walnut veneer,HW-05,RH',
  'D-202,Level 02,Guest room 202,900,2100,54,30 min,40 dB,1,Timber,Timber,Walnut veneer,HW-05,LH',
  'D-203,Level 02,Bathroom 201,800,2100,44,,,1,Timber,Timber,White laminate,HW-06,LH',
  'D-204,Level 02,Bathroom 202,800,2100,44,,,1,Timber,Timber,White laminate,HW-06,RH',
  'D-205,Level 02,Stair 1,1000,2100,54,60 min,,1,Steel,Steel,Paint RAL 9010,HW-03,LH',
  'D-206,Level 02,Linen store,800,2100,44,,,1,Timber,Timber,Paint,HW-07,RH',
].join('\n');

function hardwareDocx(): Uint8Array {
  const rows: string[][] = [
    ['Set', 'Qty', 'Item', 'Manufacturer', 'Model', 'Finish'],
    ['HW-01', '2', 'Pull handle 600 mm (back to back)', 'Generic', 'PH-600', 'SSS'],
    ['', '2', 'Floor spring', 'Generic', 'FS-3', 'SSS'],
    ['', '1', 'Euro double cylinder', 'Generic', 'EC-70', 'SCP'],
    ['HW-02', '3', 'Butt hinge 100 mm ball bearing', 'Generic', 'BH-100', 'SSS'],
    ['', '1', 'Mortice sashlock', 'Generic', 'SL-60', 'SSS'],
    ['', '1', 'Lever handle on round rose', 'Generic', 'LV-19', 'SSS'],
    ['', '1', 'Euro cylinder and thumbturn', 'Generic', 'CT-70', 'SCP'],
    ['', '1', 'Drop seal', 'Generic', 'DS-1', 'Aluminium'],
    ['', '1', 'Door stop wall mounted', 'Generic', 'WS-1', 'SSS'],
    ['HW-03', '3', 'Butt hinge 100 mm ball bearing', 'Generic', 'BH-100', 'SSS'],
    ['', '1', 'Panic bar single door', 'Generic', 'PB-1', 'Silver'],
    ['', '1', 'Overhead closer', 'Generic', 'OC-4', 'Silver'],
    ['', '1', 'Kick plate 900 x 200', 'Generic', 'KP-900', 'SSS'],
    ['', '1', 'Intumescent smoke seal', 'Generic', 'IS-15', 'Black'],
    ['HW-04', '6', 'Butt hinge 100 mm ball bearing', 'Generic', 'BH-100', 'SSS'],
    ['', '1', 'Panic bar vertical rod', 'Generic', 'PR-2', 'Silver'],
    ['', '2', 'Overhead closer', 'Generic', 'OC-4', 'Silver'],
    ['', '1', 'Door selector / coordinator', 'Generic', 'CO-1', 'Silver'],
    ['HW-05', '4', 'Butt hinge 100 mm ball bearing', 'Generic', 'BH-100', 'Matt black'],
    ['', '1', 'Electronic hotel lock with card reader', 'Generic', 'HL-9', 'Matt black'],
    ['', '1', 'Overhead closer', 'Generic', 'OC-3', 'Matt black'],
    ['', '1', 'Door viewer', 'Generic', 'DV-1', 'Matt black'],
    ['', '1', 'Automatic drop seal', 'Generic', 'DS-2', 'Aluminium'],
    ['HW-06', '3', 'Butt hinge 100 mm', 'Generic', 'BH-100', 'SSS'],
    ['', '1', 'Bathroom lock with indicator', 'Generic', 'BL-1', 'SSS'],
    ['', '1', 'Lever handle on round rose', 'Generic', 'LV-19', 'SSS'],
    ['HW-08', '1', 'Sliding door track', 'Generic', 'ST-1', 'Aluminium'],
  ];
  const cell = (s: string) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p></w:tc>`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>HARBOUR VIEW HOTEL - IRONMONGERY SCHEDULE</w:t></w:r></w:p>' +
    '<w:tbl>' + rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('') + '</w:tbl></w:body></w:document>';
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: xml },
  ]);
}

export function sampleIntakeFiles(): { name: string; role: Role; bytes: Uint8Array }[] {
  const l1 = layoutPdf('Level 01', [
    { name: 'Lobby', x: 40, y: 50, w: 120, h: 90, door: 'D-101' }, { name: 'Office 1', x: 170, y: 50, w: 70, h: 90, door: 'D-102' },
    { name: 'Office 2', x: 250, y: 50, w: 70, h: 90, door: 'D-103' }, { name: 'Stair 1', x: 40, y: 160, w: 80, h: 90, door: 'D-104' },
    { name: 'Plant room', x: 130, y: 160, w: 110, h: 90, door: 'D-105' },
  ], ['LEGEND - 5 DOORS', 'NORMAL - 3 Drs', '60 MIN FIRE RATED - 2 Drs']);
  const l2 = layoutPdf('Level 02', [
    { name: 'Guest room 201', x: 40, y: 50, w: 90, h: 90, door: 'D-201' }, { name: 'Guest room 202', x: 140, y: 50, w: 90, h: 90, door: 'D-202' },
    { name: 'Bath 201', x: 40, y: 160, w: 60, h: 60, door: 'D-203' }, { name: 'Bath 202', x: 110, y: 160, w: 60, h: 60, door: 'D-204' },
    { name: 'Stair 1', x: 180, y: 160, w: 70, h: 90, door: 'D-205' }, { name: 'Cleaner', x: 260, y: 160, w: 60, h: 60, door: 'D-207' },
  ], ['LEGEND - 6 DOORS']);
  return [
    { name: 'Level 01 - door layout.pdf', role: 'layout', bytes: l1 },
    { name: 'Level 02 - door layout.pdf', role: 'layout', bytes: l2 },
    { name: 'Master door schedule.csv', role: 'schedule', bytes: enc.encode(SCHEDULE) },
    { name: 'Ironmongery schedule.docx', role: 'hardware', bytes: hardwareDocx() },
  ];
}
