# DORSCH - Door Schedule Solutions: release notes

Designed by i3 Design. (Formerly DOCHS - DoorChisolution.)

## 2.0.0-beta - start a project from your documents

### New project from the three fundamental inputs
- Upload **door layouts** (floor-wise or complete), the **master door schedule** and the **hardware / ironmongery sets**, in PDF, Excel, CSV, Word (.docx), text, DXF, DWG or image form.
- Everything is read in the browser:
  - PDF text layer, including Bluebeam / Acrobat markups, page rotation and Unicode CAD fonts
  - Word paragraphs and tables, Excel, CSV and text
  - DXF text and block attributes
- Extracted automatically, each value with its source:
  - project name, number, client, consultant, location, date and revision
  - the schedule table, with its columns matched
  - door marks on each layout, with the floor taken from the file name or title
  - hardware sets (set headings, "Doors:" lists, quantity, item, model, finish, maker)
- **Cross-check** before creating the project:
  - scheduled doors not found on the layouts, and marks on the layouts that are not scheduled
  - legend totals ("LEGEND - 46 DOORS") and the categories that make them up
  - sets used but not defined, and sets defined but not used
  - set and door conflicts between the schedule and the hardware file
- When there is no floor column, doors are placed by the floor-wise layout they appear on. Hardware sets are assigned from the hardware file's door lists.
- Every value can be reviewed and edited before the project is created, and afterwards. Nothing missing is invented.
- **Images and scans** can be transcribed by the optional DORSCH server (`POST /v1/dochs/extract`), with DORSCH's own extraction run on the result.
- **DWG** is detected and explained, not parsed: it is a closed format, so save it as DXF or PDF first.
- "Try with sample files" loads two floor layout PDFs, a CSV schedule and a Word ironmongery schedule.

### 2D drawings
- **PDF export:** true-scale vector A3/A2/A1 sheets, for one sheet or the whole set, and included in the issue package.
- **Company title block** from PDF (kept as vector, logos included), DXF or image. Placement options:
  - full sheet frame, with the right / bottom title strip found automatically and kept clear
  - strip along the bottom
  - strip down the right side
- `{PROJECT}`, `{DRAWING_NO}`, `{SCALE}`, `{DATE}`, `{REV}` and other placeholders in your block are filled per sheet. Without placeholders a compact DORSCH data box is added.

### 3D & Render
- Realistic front (outside), back (inside), side-section and top-plan renders, with:
  - timber, paint, laminate, glass, metal and stone surfaces
  - light and soft shadows
- The hardware set is drawn on the correct face in its stated finish:
  - lever, pull, push plate, kick / armour plate, closer, panic bar
  - hinges, cylinder / thumbturn, hotel card lock, indicator, viewer, flush bolts, wall reader, track
- **A3 render sheet**, as PNG at 300 dpi or PDF, carrying the project details, door data, finish swatches and the hardware set table.
- Shapes are generic in the stated finishes, not manufacturer models. Any assumption is printed on the sheet.

### Brand and interface
- New **DORSCH** brand header with the tagline "Door Schedule Solutions" and a door-frame mark.
- Simple client navigation. Settings, import mapping, backup and About / test guide moved to the gear menu.
- Floating **Design your door** button: a door-open sound, then the design page. Sound can be turned off in the gear menu.


## 1.0.0-demo - first shareable demo (Phase 1, web based)

**Share link:** https://j-janko420.github.io/DOCHS/?demo (sample projects only; nothing is saved).

### What testers can do
- Follow the guided test (About & test guide): 10 scenarios with expected results, pass / issue / fail and notes.
- Send results as a copied report, a downloaded `.txt` file, or a GitHub issue.
- Work in three sample projects: office, anonymised hospitality level, and an imperial school wing created by import.

### Included
- **Door register:** buildings, floors and project categories, plus automatic classification (leaf, operation, material, glazed, fire-rated, acoustic, access-controlled).
- **QA engine:** errors, warnings and info, each with the check performed, its source and the corrective action. Errors block DXF issue, and missing data is never guessed.
- **Schedules, scoped by floor and category:**
  - door schedule, quantity summary, hardware by set and by product, material schedule, QA issues
  - Excel export (6 sheets) and CSV
- **2D CAD:**
  - dimensioned A3/A2/A1 sheets: outside and inside elevations, plan with swing, head, jamb and threshold sections, title block and notes
  - editable DXF (R12, mm) with layers, linetypes and DIMENSION entities, plus a set DXF per scope
- **3D model:** rotate, outside / inside / top views, opening (swing, pivot, sliding) and exploded view.
- **Design your door:**
  - enter the structural opening, then click options: style, configuration, handing, fire / acoustic rating, materials, finishes, glass and hardware function
  - live drawing and 3D model; add the door to the project with linked materials and a hardware set
- **Door library:** 15 door types, 51 materials and finishes, 72 hardware types with their function, and 10 hardware functions.
- **Hardware and materials libraries:**
  - source references and a verified flag, plus material submittal status
  - quantity overrides with a required reason
  - CSV import and export
- **Schedule import (.xlsx / .csv):**
  - automatic column matching, with optional AI suggestions through the DOCHS server
  - unit conversion (mm, inches, feet-inches) and fire / acoustic parsing
  - a preview before importing, and a report that reconciles every row
- **Issue package (.zip):** Excel, CSVs, one DXF per door, set DXF, manifest and JSON backup.
- **Optional API server (`server/`):** FastAPI and Docker, with AI provider keys kept server-side.

### Verified for this release
- 62 automated tests: geometry, QA rules, schedules, DXF structure, ZIP/XLSX, importer, designer matrix, samples, 3D scene, and the guided-test expectations.
- A browser run of all 10 guided-test scenarios at desktop size, plus a phone-width check of every screen. No page errors.
- The exported zip and xlsx pass `unzip -t`.
- The DXF is well formed: AC1009, EOF, 38 DIMENSION entities on a sample sheet.

### Known limits
- DXF output has not yet been opened in an independent CAD application. This is the first acceptance check for testers who have one.
- No DWG output, and no PDF or image drawing extraction.
- No compliance assessment (fire, acoustic, egress, access control).
- Projects live in the browser; use the JSON backup to keep or share them.
- Sample data and library items are illustrative, not manufacturer data.
