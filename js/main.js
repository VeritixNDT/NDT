// Entry module. The shell used to load 32 <script defer> tags whose order WAS
// the dependency graph; it now loads this one module, and the graph is explicit
// in each file's imports.
//
// Every module is imported here for its side effects, in the original script
// order. Modules that other modules import are pulled in by those imports too —
// listing them all here keeps the full set in one readable place, so a module
// with no importer (help.js, tests.js) still loads.
//
// Actual evaluation order is depth-first over the import graph, not this list.
// That is safe because Phase 1 removed the cross-module load-time work that
// depended on ordering — see
// docs/superpowers/specs/2026-07-29-es-module-conversion-design.md.
//
// js/qrcode.min.js stays a classic <script> in the shell: a vendored UMD bundle
// that assigns a global, excluded from the analyser for the same reason.
// js/ai-vision.js is deliberately absent — dormant scaffolding, see VISION_SPEC.md.

import './constants.js';
import './acceptance.js';
import './utils.js';
import './a11y.js';
import './i18n.js';
import './platform.js';
import './ui.js';
import './select.js';
import './datepicker.js';
import './tooltip.js';
import './settings.js';
import './reports.js';
import './dashboard.js';
import './jobs.js';
import './planner.js';
import './billing.js';
import './portal.js';
import './verify.js';
import './help.js';
import './defects.js';
import './inspector.js';
import './admin.js';
import './hardness.js';
import './pmi.js';
import './ferrite.js';
import './reports-mgmt.js';
import './ai-review.js';
import './cad-editor.js';
import './editor.js';
import './export.js';
import './tests.js';
import './boot.js';
