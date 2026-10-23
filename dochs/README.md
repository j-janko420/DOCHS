# DOCHS - DoorChisolution

DOCHS turns a door register into floor-wise and category-wise door schedules and editable 2D CAD door drawings (DXF). It is a static web app with no runtime dependencies.

**Release 0.1 scope (Milestone 1).** The full workflow runs end to end: select a floor, classify the doors, generate the door schedule, create the matching 2D DXF drawings, then export both.

## Workflow

1. **Project setup:** title block data, buildings, floors (custom names and order) and project categories.
2. **Door register:** one record per door. Blank fields stay blank and are flagged. DOCHS never fills in a specification.
3. **Classification:** automatic classes are derived from the door data: single/double leaf, operation, material, glazed, fire-rated, acoustic, access-controlled. Project categories are added on top. A door can belong to several classes.
4. **QA:** rule-based checks, split into errors, warnings and info. Each finding names the door, the check performed, its source and the corrective action. Hard errors block DXF issue.
5. **Schedules:** door schedule, quantity summary (floor x configuration, leaves, fire-rated, acoustic), hardware takeoff with the calculation basis, and the QA list. All are scoped by the same floor/category filter.
6. **2D CAD studio:** parametric A3/A2/A1 sheets containing:
   - outside and inside elevations, a plan with swing, and head, jamb and threshold sections
   - dimensions, a title block and notes
7. **Issue:** a ZIP package containing `schedule.xlsx` (4 sheets), CSVs, one DXF per door, one set DXF for the scope, `MANIFEST.txt` and a JSON backup.

## Door library and Door Designer

- **Door library (reference):** generic door types, materials, finishes and hardware types, each with what it does, plus typical hardware functions. Nothing in it is manufacturer data.
  - Door types: timber, fire-rated, acoustic, steel, stainless, aluminium, glass, stone-clad, pivot, sliding and concealed.
  - Materials and finishes: veneer, laminate (HPL), paint, powder coat, anodised, stainless, PVD, stone and glass.
  - Hardware types: hinges, pivots, locks, cylinders, handles, closers, panic devices, bolts, seals, thresholds, stops, protection, access control and sliding gear.
  - Typical hardware functions: passage, privacy, office, storeroom, fire door, exit, access controlled, push/pull and sliding.
  - "Add all" copies items into the project libraries as unverified entries.
- **Design your door (pop-up, or `#/designer` full page):**
  1. Enter the structural opening width, height and wall thickness.
  2. Click the style, configuration, handing, fire / acoustic rating, materials, finishes, glass and hardware function.
  3. Leaf sizes are calculated from the opening using the frame-fit formula below, and the drawing sheet updates live.
  4. "Add door to project" creates the door with linked materials and a hardware set. An identical set is reused, otherwise a new DD-xx set is created.
  - Frame, gap, hinge, handle and vision-panel values are editable starting assumptions. The door is saved as Draft with a note to verify them.

## Hardware library (Phase 4)

- **Catalogue:** products with category, manufacturer, model, finish, dimensions, mounting, fire rating, power need, source reference, verified flag and compatibility notes.
  - Values come from manufacturer sources only. A product can be marked verified only once it has a source reference.
  - CSV import/export lets you load or share manufacturer libraries. Rows with an unknown category or no description are reported, not guessed.
- **Sets:** each line links to a catalogue product (or stays as free text, flagged as info), with a quantity and a per-door or per-leaf basis.
- **Quantities:** per door = qty x door qty. Per leaf = qty x door qty x leaves.
- **Overrides:** a door can override any line's total. A reason is required, and every override is listed in the takeoff.
- **Takeoff:** by set (with the calculation basis) and by product across sets. Both are included in the Excel export.
- **Hardware QA:**
  - empty sets and duplicate set codes
  - the same product listed twice in a set, or a link to a deleted product
  - zero quantities
  - overrides with no reason, or for items not in the door's set
  - incompatibilities, only where a rule you entered says so, with its source
  - fire-rated doors using products stated as not fire-rated, or with fire rating not stated
  - access-control mismatches between door and set
  - powered products needing electrical coordination
  - pair doors with no inactive-leaf hardware

  DOCHS never decides compatibility or compliance.

## Material and finish library (Phase 4)

- **Library:** leaf materials and systems, cores, facings, finishes, frames and glazing. Each item can record:
  - manufacturer, product, code and thickness
  - fire rating and acoustic rating, as stated by the source
  - source reference, verified flag (requires a source), and material submittal reference and status
- **CSV:** import/export. Unknown kinds or statuses and non-numeric thicknesses are reported, not guessed.
- **Door links:** each door material field (leaf, core, facing, finishes, frame, frame finish, glazing) can link to a library item.
  - Linking copies the library name into the field.
  - Typing a different value removes the link.
  - "Link door fields by name" links exact, unambiguous name matches only.
- **QA:**
  - unlinked fields
  - links to deleted items
  - vision panels without a glazing type
  - fire-rated doors using materials stated as not fire-rated, or not stated
  - leaf thickness differing from the linked leaf system
  - submittals rejected or marked revise & resubmit
  - approved doors with material submittals not yet approved
  - duplicate library entries
- **Material schedule:** every material in scope with submittal status, doors, door qty and finish leaf faces. It's in the Schedules tab, the Materials screen and the Excel export.

## CAD output

- **Format:** ASCII DXF, AutoCAD R12 (`AC1009`), units in mm. Entities are LINE, POLYLINE, ARC, CIRCLE and TEXT, plus true **DIMENSION** entities, each backed by its own `*D` block.
- **Layers:** `A-WALL A-HATCH A-FRAME A-DOOR A-GLAZ A-HDWR A-SWING A-HIDDEN A-CENTER A-DIMS A-TEXT A-SHEET A-TITLE`.
- **Linetypes:** CONTINUOUS, DASHED, HIDDEN and CENTER. `$LTSCALE` equals the sheet scale.
- **Scale:** the sheet is drawn in model space at 1:1 with a scaled border. Detail views are scaled geometry, and their dimension text carries the true value.
- **Preview:** the in-app preview is an SVG render of the *same* entity list. It is not the CAD deliverable.
- **DWG:** not produced. It needs a separately licensed and tested DWG engine.
- **Section details:** schematic, built from the entered frame width, depth, rebate and gaps. Verify them against the approved manufacturer shop drawing.

### Dimension conventions (shared by QA, schedules and drawings)

| Quantity | Formula |
|---|---|
| Frame outer width | S.O. width - 2 x install gap |
| Aperture (stop to stop) | frame outer - 2 x frame face width |
| Expected leaf total | aperture + 2 x rebate - 2 x edge gap - (leaves-1) x edge gap |
| Expected leaf height | S.O. height - install gap - frame width + rebate - edge gap - undercut |
| Nominal clear width | aperture - leaf thickness (single swing at 90 deg, excludes hardware) |

- **Handing:** LH/RH/LHR/RHR, viewed from the outside (front elevation). Leaf 1 is the left leaf as seen from outside.
- **Hinge positions:** measured in mm from the bottom of the leaf.
- **Handle height:** measured from finished floor.

## Run locally

```bash
cd dochs
npm install          # TypeScript only
npm test             # 54 tests: geometry, QA rules, schedules, DXF structure, ZIP/XLSX
npm run build        # -> dist/ (static site)
npm start            # http://localhost:5173
```

## Deploy

`dist/` is a plain static site with relative paths, so any static host works.

- **GitHub Pages (wired up):** `.github/workflows/dochs.yml` tests and builds every change under `dochs/`, and deploys the default branch to Pages. One-time setup: *Settings > Pages > Source: GitHub Actions*. Pages on a private repository needs a paid GitHub plan.
- **Netlify or Vercel:** set the base directory to `dochs`, the build command to `npm run build` and the publish directory to `dist`.

Data is stored in the browser (localStorage) per device. Use **Project data > Export JSON backup** to keep or share a project.

## Not in this release

| Item | Status |
|---|---|
| 3D door viewer (Three.js) | Phase 5 |
| Team database, login, roles (Supabase/PostgreSQL) | Phase 6 |
| OCR / drawing extraction | Not configured. Shown as unavailable in the app, never simulated |
| DWG import/export | Needs a licensed engine |

## Acceptance test before production use

1. Enter one real, approved door from the reference package. Use verified dimensions, frame profile values and hardware.
2. Export the DXF and open it in an independent CAD application (AutoCAD, BricsCAD or LibreCAD).
3. Check the following against the approved shop drawing:
   - units and scale
   - layers and linetypes
   - dimension values and positions
   - text
   - printed scale
4. Record any deviations as defects before rolling out to a full project.

## Code layout

| Path | Purpose |
|---|---|
| `src/core/` | Data model, geometry rules, classification, QA rules, schedules, CSV/XLSX/ZIP writers. No DOM |
| `src/cad/` | Parametric views, sheet composer and title block, DXF R12 writer, SVG preview |
| `src/ui/` | Browser UI: vanilla TypeScript, no framework |
| `tests/` | `node:test` suite on the compiled output |
