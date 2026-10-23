# DOCHS - DoorChisolution: release notes

Designed by i3 Design.

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
