# TCog Protocol v0.3 Changelog

Revision target: v0.3 draft, building on v0.2.

## Schema changes (additive, v0.2 packages remain valid)

- Added `merge_intent` field to manifest. Records package lineage when a package was created from prior packages (extension, merge, split) or fresh.
- Added `branch_of` field to trajectories. Branches are now first-class artifacts with explicit junction clusters.
- Added `negative_cue_index` and `constraint_trigger_index` to optional index structure.
- Added explicit `retrieval_behavior` enum on relations: `surface_both_frames`, `prefer_source`, `prefer_target`, `require_user_choice`.
- Added `excerpt_char_limit` recommendation (≤280) made explicit in validation rules.
- Added validation rule for `merge_intent.base_package` consistency with declared dependencies.

## Ingestion changes

- **Restored explicit package-merge procedure as §10.** v0.2 had compressed this; v0.3 makes it dedicated. Includes:
  - five-pass merge workflow (Pass 0 setup → Pass 1 local extraction → Pass 2 classification → Pass 3 delta construction → Pass 4 trajectory branch detection → Pass 5 conflict surfacing).
  - explicit duplicate / refinement / novel / conflict classification rules with similarity thresholds.
  - full delta document JSON structure with additions, refinements, branches, conflicts, summary.
  - trajectory branch detection via reading-order alignment (no graph isomorphism needed).
  - conflict surfacing with proposed resolutions, recommended resolution, and user-decision flag.
- Added Rule 8 to discipline rules: surface conflicts; do not resolve them silently.
- Added merge-intent recording when merge is committed.

## Retrieval changes

- **Two retrieval modes specified explicitly.** This restores the small-LLM-first design center:
  - **Mechanical mode (default):** cue matching, negative cues, activation policy, trajectory phrase matching, conversation state. No semantic similarity. Auditable, model-independent, runs on small local LLMs.
  - **Semantic-augmented mode (opt-in):** adds semantic similarity to cluster description and unit definition. For capable models when cue coverage is incomplete.
- Score formulas given for both modes; mechanical is the documented baseline.
- Mode declared in runtime state via `retrieval_mode` field.
- Added `retrieval_behavior` dispatch in conflict-check step. Conflicts now have machine-readable presentation rules.
- Added branching trajectory handling: when a trajectory has `branch_of`, retrieval can use parent up to junction and branch beyond, or surface both.
- Added cluster activation cap (7) with tie-breaking rules.
- Added explicit `coherence_budget` placeholder note: declared in runtime state but concrete rules deferred to v0.4.

## Carried forward from v0.2 unchanged

- Activation policies at package and cluster level.
- Lifecycle status (`candidate / draft / human_vetted / expert_vetted / field_tested / deprecated`).
- Quality levels orthogonal to status.
- Copyright-safe anchors.
- Relations as first-class objects.
- Required cluster fields: cues, default_behavior, activation_policy.
- Two-pass ingestion (local extraction + global consolidation).
- Layered response format with Sections A–D.
- Runtime state object.
- Worked examples for grief-frame overreach, hospital allocation, conflicting frames.

## Migration from v0.2

v0.2 packages are forward-compatible with v0.3 if `protocol_version` is updated. New optional fields (`merge_intent`, `branch_of`, `retrieval_behavior` in relations) are added as packages are revised.

v0.1 packages (e.g., the kolmogorov_wiki package) require migration: `default` → `default_behavior`, addition of cluster `activation_policy`, anchor excerpts shortened to ≤280 chars.

## Suggested next steps

1. Build a validator for TCog Schema v0.3 that checks IDs, references, anchors, cluster cues, activation policies, trajectory paths, merge-intent consistency, and branch junctions.
2. Migrate the kolmogorov_wiki package to v0.3 as a worked example.
3. Test the merge-ingestion procedure with a small worked example: an existing package extended by a new source.
4. Build the web app with API key supply, package loading, mechanical-mode retrieval default, and the runtime state object persisted across sessions.
5. Defer to v0.4: concrete coherence budget rules, semantic-similarity threshold defaults, ecosystem-level concerns (registry, signing, revocation).
