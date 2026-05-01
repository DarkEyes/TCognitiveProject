# Trajectory Cognition Schema (TCog Schema v0.3)

**Status:** Draft specification. Subject to revision through v1.0.
**Format version:** 0.3
**License:** CC-BY 4.0 for this specification document.
**Companion documents:** `tcog-ingestion.md`, `tcog-retrieval.md`.

---

## 0. Purpose

This document specifies the data format for **Trajectory Cognition packages**: installable bundles of structured cognitive content that can be loaded by a runtime system or by an LLM-assisted toolchain.

A TCog package is not a normal knowledge base and not merely a retrieval corpus. It is a **basis package**: a structured representation of a disciplinary or conceptual frame. It contains units, clusters, admissibility constraints, transitions, trajectories, tests, and metadata that allow a system to reason with the package as an organized cognitive structure rather than as loose text.

The schema is the contract between four parties:

- **Package authors** produce well-formed packages with anchors, provenance, and review status.
- **Ingestion systems** extract package candidates from vetted sources while preserving reading order and source accountability.
- **Retrieval systems** activate clusters, load units, check constraints, follow trajectories, and cite anchors faithfully.
- **Users and reviewers** vet, correct, deprecate, or extend packages over time.

This schema defines the data format. The ingestion and retrieval companion documents define how packages are produced and used.

---

## 1. Design principles

### 1.1 JSON-native, human-inspectable

Packages are stored as JSON or JSONL. They should be readable in a text editor, diffable in version control, and mechanically validatable.

### 1.2 Stable identifiers

Every package object has a stable identifier. Identifiers do not change when labels, definitions, cues, anchors, or notes are revised. If an object is replaced, the new object points to the old one via `supersedes`.

### 1.3 Anchors are mandatory for units

Every committed unit must have at least one anchor. Anchors connect the unit to a source location, demonstration, dataset, package reference, or explicit axiomatic declaration. Units without anchors remain candidates and should not be used as committed knowledge.

### 1.4 Clusters are activation objects, not folders

A cluster is not merely a topic label. It is an activation object: a basis-like coordinate and executable cognitive state. Every cluster must declare cues, default behavior, failure modes, and an activation policy.

### 1.5 Constraints are admissibility gates

Constraints define what counts as incomplete, invalid, unsafe, or frame-inappropriate reasoning under the package. Retrieval systems should surface violated constraints rather than silently answering around them.

### 1.6 Trajectories preserve disciplined reasoning

A trajectory is an ordered path through clusters. It represents how the package teaches a reader to think, analyze, diagnose, explain, or decide.

### 1.7 Frame sensitivity over axiom dictatorship

A package is a cognitive frame, not a universal truth machine. Packages must declare when they should activate, when they should not activate, and what their limits are. This is especially important for economics, law, medicine, strategy, ethics, and other domains that can overextend themselves.

### 1.8 Copyright-safe anchoring

Packages should store enough source information for verification without copying large amounts of copyrighted text. Prefer source identifiers, locations, short excerpts, and hashes over long verbatim spans.

### 1.9 Embeddings are runtime artifacts

Packages do not require precomputed embeddings. Consumers may compute embeddings at install time from labels, definitions, cues, and descriptions. If included, embeddings must be marked as non-canonical and model-specific.

### 1.10 Validation separates structure from truth

A validator checks structure, references, required fields, status values, and anchor presence. It does not certify conceptual correctness. Human or expert review remains necessary.

### 1.11 Merge history is preserved

When a package is created by merging earlier packages or sources, the merge history is recorded in the manifest. This makes the package's lineage auditable and supports the package factory workflow.

---

## 2. Package layout

A package is a directory:

```text
my_package/
  manifest.json          REQUIRED
  units.jsonl            REQUIRED
  clusters.jsonl         REQUIRED
  constraints.jsonl      OPTIONAL
  transitions.jsonl      OPTIONAL
  trajectories.jsonl     OPTIONAL
  tests.jsonl            OPTIONAL
  relations.jsonl        OPTIONAL
  index.json             OPTIONAL
  README.md              OPTIONAL
```

Each JSONL file contains one JSON object per line. Blank lines are ignored.

A package may also be distributed as a single JSON bundle:

```json
{
  "manifest": { },
  "units": [ ],
  "clusters": [ ],
  "constraints": [ ],
  "transitions": [ ],
  "trajectories": [ ],
  "tests": [ ],
  "relations": [ ],
  "index": { }
}
```

Directory form is preferred for storage and version control. Bundle form is preferred for LLM ingestion, transmission, or compact inspection.

---

## 3. Identifiers

Identifiers are namespaced strings:

```text
<package_id>:<type_prefix>_<short_name>
```

Allowed prefixes:

| Prefix | Object type |
|---|---|
| `u_` | unit |
| `k_` | cluster |
| `c_` | constraint |
| `e_` | transition edge |
| `tr_` | trajectory |
| `test_` | test |
| `rel_` | relation |

Examples:

```text
econ_core:u_opportunity_cost
econ_core:k_choice_under_scarcity
tcog_architecture:c_anchor_required
medicine_diagnostic:tr_differential_diagnosis
econ_core:rel_rationality_conflict
```

Rules:

- `package_id` is lowercase snake_case.
- Identifiers are case-sensitive.
- Identifiers are stable.
- Cross-package references use full namespaced identifiers.
- Within-package references may use short identifiers only in local authoring tools; stored packages should use full identifiers.

---

## 4. Common fields

Most object types may include the following common fields:

```json
{
  "id": "econ_core:u_opportunity_cost",
  "label": "opportunity cost",
  "status": "draft",
  "confidence": 0.82,
  "vetted": false,
  "quality_level": "extracted",
  "notes": "Needs expert review.",
  "supersedes": [],
  "deprecated_by": null
}
```

### 4.1 Status values

`status` records object lifecycle:

| Status | Meaning |
|---|---|
| `candidate` | proposed but not committed |
| `draft` | committed for review, not yet stable |
| `human_vetted` | reviewed by a human curator |
| `expert_vetted` | reviewed by domain expert |
| `field_tested` | used successfully in retrieval or runtime tests |
| `deprecated` | retained for history but not preferred |

### 4.2 Quality levels

`quality_level` is lighter-weight than `status`:

| Quality level | Meaning |
|---|---|
| `extracted` | machine-extracted from source |
| `merged` | deduplicated/merged from several candidates |
| `reviewed` | checked by user or curator |
| `validated` | passed package tests |
| `unstable` | known weakness or unresolved issue |

### 4.3 Confidence

`confidence` is a number between 0 and 1. It is not truth probability. It records confidence in extraction, classification, or structural placement.

---

## 5. Object types

## 5.1 Manifest

`manifest.json` describes the package.

Required fields:

- `package_id` — unique snake_case package id.
- `name` — human-readable package name.
- `version` — semantic version `MAJOR.MINOR.PATCH`.
- `protocol_version` — schema version, e.g. `0.3`.
- `description` — one paragraph description.
- `domain` — broad domain.
- `authors` — array of author objects.
- `license` — SPDX license or `custom`.
- `created` — ISO 8601 date.
- `updated` — ISO 8601 date.
- `status` — package lifecycle status.

Recommended fields:

- `source_documents` — sources used.
- `extracted_by` — model/tool/protocol used.
- `activation_policy` — package-level activation/avoidance logic.
- `frame_limits` — statement of scope and misuse risk.
- `dependencies` — required packages.
- `conflicts_with` — packages that should not be merged uncritically.
- `merge_intent` — records whether and how this package was created from other packages (see §5.1.1).
- `tags` — discoverability tags.
- `homepage` — package home.
- `notes` — author notes.

Example:

```json
{
  "package_id": "econ_core",
  "name": "Core Economics",
  "version": "0.2.0",
  "protocol_version": "0.3",
  "description": "Foundational economic reasoning: scarcity, opportunity cost, incentives, marginal analysis, equilibrium, and comparative statics.",
  "domain": "economics",
  "authors": [{"name": "Package Author"}],
  "license": "CC-BY-4.0",
  "created": "2026-04-29",
  "updated": "2026-04-29",
  "status": "draft",
  "activation_policy": {
    "activate_when": ["resource allocation", "policy analysis", "market behavior", "incentive design"],
    "avoid_when": ["trauma response", "ritual meaning", "non-instrumental care", "identity preservation"],
    "requires_user_confirmation": false
  },
  "frame_limits": "Use as an instrumental reasoning frame under scarcity and incentives; do not treat as a universal account of human value.",
  "source_documents": [],
  "dependencies": [],
  "conflicts_with": [],
  "merge_intent": null
}
```

### 5.1.1 Merge intent

`merge_intent` records the package's lineage when it was created by merging earlier packages or by extending an existing package with a new source. It is `null` for fresh packages.

```json
{
  "merge_intent": {
    "type": "extension",
    "base_package": "econ_core",
    "base_version": "0.2.0",
    "source_added": "thaler_misbehaving",
    "merge_date": "2026-05-01",
    "additions": 12,
    "refinements": 4,
    "conflicts_resolved": 2,
    "branches_added": 1,
    "summary": "Added behavioral economics units; introduced bounded-rationality branch off rational-agent cluster; surfaced conflict over rational-agent assumption."
  }
}
```

`type` values:

- `"fresh"` — package created from scratch (or use `merge_intent: null`).
- `"extension"` — base package extended with new source(s).
- `"merge"` — multiple existing packages merged into one.
- `"split"` — extracted from a parent package.

The merge history can be deeper than one step. If a package has been merged multiple times, prior merges are accessible through the version history, not by recursive `merge_intent`.

## 5.2 Unit

A **unit** is an anchored cognitive distinction: a definition, principle, relationship, theorem, method, or named idea.

Required fields:

- `id`
- `label`
- `definition`
- `anchors` — array of one or more anchor objects.
- `provenance`

Recommended fields:

- `features` — conceptual tags.
- `cluster_memberships` — clusters containing this unit.
- `status`, `confidence`, `quality_level`, `vetted`.
- `translations`.
- `cites` — related units.
- `notes`.

Example:

```json
{
  "id": "econ_core:u_opportunity_cost",
  "label": "opportunity cost",
  "definition": "The cost of choosing an option includes the value of the best alternative forgone.",
  "anchors": [
    {
      "type": "document_span",
      "source_id": "econ_source_001",
      "location": "Chapter 1, section 2",
      "excerpt": "...best alternative forgone...",
      "excerpt_char_limit": 120,
      "span_hash": "sha256:optional_hash_of_source_span"
    }
  ],
  "features": ["choice", "tradeoff", "forgone alternative", "scarcity"],
  "cluster_memberships": ["econ_core:k_choice_under_scarcity"],
  "provenance": {
    "package": "econ_core",
    "chunk_index": 1,
    "position_in_chunk": 4,
    "source_order": 17,
    "extraction_protocol_version": "0.3"
  },
  "status": "draft",
  "confidence": 0.9,
  "vetted": false
}
```

## 5.3 Cluster

A **cluster** groups units that share an organizational role. It functions as a basis-like coordinate and as an executable cognitive state.

Required fields:

- `id`
- `label`
- `description`
- `members` — array of unit ids.
- `cues` — activation phrases; minimum 4, recommended 6-12.
- `default_behavior` — what the cluster does when active.
- `activation_policy`

Recommended fields:

- `basis_role` — what representational distinction the cluster makes available.
- `failure_modes` — what happens when the cluster should activate but does not.
- `frame_limits` — local scope limits.
- `negative_cues` — cues that suggest the cluster should not activate.
- `compatible_with` / `incompatible_with` — cluster-level relations.
- `runtime_hints` — cache priority, exploration tendency, etc.

Example:

```json
{
  "id": "econ_core:k_choice_under_scarcity",
  "label": "choice under scarcity",
  "description": "Reasoning about choices when resources, time, attention, or money are limited.",
  "members": ["econ_core:u_scarcity", "econ_core:u_opportunity_cost"],
  "cues": ["scarcity", "tradeoff", "limited resource", "allocation", "budget", "what is given up"],
  "negative_cues": ["pure gift", "ritual devotion", "panic support"],
  "default_behavior": "Identify the scarce resource and the best alternative displaced by the proposed action.",
  "basis_role": "Local coordinate for distinguishing feasible choice from unconstrained desire.",
  "activation_policy": {
    "activate_when": ["allocation problem", "policy choice", "budget decision"],
    "avoid_when": ["non-instrumental care", "symbolic ritual", "emergency emotional support"],
    "frame_limits": "Applies to instrumental choice; does not exhaust moral or relational meaning."
  },
  "failure_modes": ["treating benefits as free", "ignoring displaced alternatives", "confusing desire with feasibility"],
  "runtime_hints": {
    "cache_priority": 0.7,
    "default_epsilon": 0.05
  },
  "status": "draft",
  "confidence": 0.86
}
```

## 5.4 Constraint

A **constraint** is an admissibility rule. It identifies missing checks, invalid moves, unsafe conclusions, or frame misuse.

Required fields:

- `id`
- `label`
- `type` — one of `admissibility`, `normative`, `empirical`, `definitional`, `safety`, `scope`.
- `rule`
- `applies_to`
- `repair`
- `severity` — `low`, `medium`, `high`, `critical`.

Recommended fields:

- `trigger_cues`
- `blocks_answer` — boolean.
- `related_clusters`
- `anchors`
- `status`, `confidence`.

Example:

```json
{
  "id": "econ_core:c_opportunity_cost_check",
  "label": "opportunity cost completeness check",
  "type": "admissibility",
  "rule": "A recommendation about scarce resources is incomplete if it does not identify the major alternative use displaced by the choice.",
  "applies_to": ["policy analysis", "resource allocation", "strategic choice"],
  "trigger_cues": ["invest", "spend", "allocate", "choose", "budget"],
  "repair": "Ask what alternative use of the same resource is being displaced.",
  "severity": "medium",
  "blocks_answer": false,
  "related_clusters": ["econ_core:k_choice_under_scarcity"]
}
```

## 5.5 Transition

A **transition** is a typed edge between clusters.

Required fields:

- `id`
- `from`
- `to`
- `type` — `logical`, `temporal`, `methodological`, `causal`, `contrastive`, `repair`, `frame_shift`.
- `rank` — positive integer; lower means preferred.
- `rationale`

Recommended fields:

- `trigger_cues`
- `coherence_delta` — expected effect on coherence.
- `conditions`
- `status`, `confidence`.

Example:

```json
{
  "id": "econ_core:e_scarcity_to_incentives",
  "from": "econ_core:k_choice_under_scarcity",
  "to": "econ_core:k_incentive_response",
  "type": "logical",
  "rank": 1,
  "rationale": "Once scarcity is identified, examine how affected agents respond to the available choices.",
  "coherence_delta": 0.1
}
```

## 5.6 Trajectory

A **trajectory** is an ordered reusable path through clusters.

Required fields:

- `id`
- `label`
- `trigger`
- `path` — ordered list of cluster ids.
- `output_template`

Recommended fields:

- `constraints` — constraints to check during execution.
- `default_epsilon`
- `failure_modes`
- `entry_conditions`
- `exit_conditions`
- `status`, `confidence`.
- `branch_of` — if this trajectory branches off another at a known cluster.

Example:

```json
{
  "id": "econ_core:tr_basic_policy_analysis",
  "label": "basic economic policy analysis",
  "trigger": {
    "input_types": ["policy proposal", "institutional reform", "resource allocation problem"],
    "cues": ["should invest", "policy", "program", "subsidy", "regulation"]
  },
  "path": [
    "econ_core:k_choice_under_scarcity",
    "econ_core:k_incentive_response",
    "econ_core:k_marginal_reasoning",
    "econ_core:k_unintended_consequences"
  ],
  "constraints": ["econ_core:c_opportunity_cost_check"],
  "default_epsilon": 0.05,
  "output_template": [
    "Identify scarce resource",
    "Identify actors and incentives",
    "Identify opportunity cost",
    "Analyze marginal change",
    "Check unintended consequences"
  ],
  "status": "draft"
}
```

### 5.6.1 Branching trajectories

When a new source introduces a path that diverges from an existing trajectory at a known junction, the branch is recorded as a separate trajectory with a `branch_of` field:

```json
{
  "id": "econ_core:tr_behavioral_policy_analysis",
  "label": "behavioral economic policy analysis",
  "branch_of": {
    "parent": "econ_core:tr_basic_policy_analysis",
    "junction_cluster": "econ_core:k_incentive_response",
    "rationale": "Where standard analysis assumes rational response, behavioral analysis introduces bounded rationality."
  },
  "path": [
    "econ_core:k_choice_under_scarcity",
    "econ_core:k_incentive_response",
    "econ_core:k_bounded_rationality",
    "econ_core:k_choice_architecture",
    "econ_core:k_unintended_consequences"
  ],
  "trigger": { "cues": ["bounded rationality", "behavioral", "nudge"] }
}
```

Branching trajectories are first-class. They are not silently merged into the parent.

## 5.7 Test

A **test** specifies expected behavior for retrieval or runtime use.

Required fields:

- `id`
- `input`
- `expected_activated_clusters`

Recommended fields:

- `expected_units`
- `expected_constraints_triggered`
- `expected_trajectory`
- `expected_repair_questions`
- `should_not_activate`
- `notes`

Example:

```json
{
  "id": "econ_core:test_ai_program_policy",
  "input": "The university should spend more money on AI profile-building programs because students will benefit.",
  "expected_activated_clusters": ["econ_core:k_choice_under_scarcity", "econ_core:k_incentive_response"],
  "expected_constraints_triggered": ["econ_core:c_opportunity_cost_check"],
  "expected_repair_questions": ["What alternative use of the budget is displaced?"],
  "should_not_activate": ["econ_core:k_equilibrium_modeling"]
}
```

## 5.8 Relation

A **relation** records non-transition relationships between objects, especially cross-package conflicts.

Allowed relation types:

- `supports`
- `extends`
- `refines`
- `contrasts_with`
- `conflicts_with`
- `depends_on`
- `supersedes`
- `frame_limited_by`

Example:

```json
{
  "id": "econ_core:rel_rational_choice_vs_bounded_rationality",
  "type": "conflicts_with",
  "source": "econ_core:k_rational_choice",
  "target": "behavioral_econ:k_bounded_rationality",
  "note": "Standard rational-choice assumptions conflict with bounded-rationality assumptions under cognitive limitation.",
  "retrieval_behavior": "surface_both_frames"
}
```

`retrieval_behavior` values:

- `"surface_both_frames"` — present both positions with attribution.
- `"prefer_source"` — use source side as primary, mention target as alternative.
- `"prefer_target"` — use target side as primary, mention source as alternative.
- `"require_user_choice"` — do not answer until user selects a frame.

---

## 6. Anchors

### 6.1 Standard anchor types

- `document_span` — source location plus short excerpt.
- `demonstration` — procedural or observed demonstration.
- `dataset` — dataset or computation reference.
- `package_reference` — another package object.
- `axiomatic` — explicit primitive declared by the package author.
- `expert_assertion` — expert-reviewed statement without a conventional textual source.

### 6.2 Copyright-safe document anchor

Use:

```json
{
  "type": "document_span",
  "source_id": "source_001",
  "location": "Chapter 2, section 1, paragraph 4",
  "excerpt": "Short verification excerpt only.",
  "excerpt_char_limit": 280,
  "span_hash": "sha256:optional_hash",
  "notes": "Long source text is not stored in package."
}
```

Rules:

- Store a specific location.
- Store only a short excerpt, preferably under 280 characters.
- Do not store pages of copyrighted text.
- If exact source text is available locally, `span_hash` may verify the original span without copying it.
- If a unit is synthesized from multiple sources, use multiple anchors.

### 6.3 Axiomatic anchor

Use `axiomatic` only when the package intentionally installs a primitive modeling commitment:

```json
{
  "type": "axiomatic",
  "rationale": "The package treats scarcity as a primitive starting point of economic reasoning.",
  "asserted_by": "package_author",
  "scope": "economics frame only"
}
```

Axiomatic anchors must declare scope. They should not masquerade as empirical facts.

---

## 7. Provenance

Minimum provenance:

```json
{
  "package": "econ_core",
  "extraction_protocol_version": "0.3"
}
```

Recommended provenance:

```json
{
  "package": "econ_core",
  "extracted_by": "model_or_tool_name",
  "extraction_date": "2026-04-29",
  "chunk_index": 3,
  "position_in_chunk": 2,
  "source_order": 17,
  "reviewed_by": "curator_name_or_id",
  "review_date": "2026-04-30",
  "revisions": [
    {"date": "2026-05-01", "editor": "curator", "summary": "Sharpened definition and added negative cue."}
  ]
}
```

`source_order` is important for trajectory derivation.

---

## 8. Activation policy

Activation policy appears at package and cluster level.

```json
{
  "activate_when": ["resource allocation", "policy analysis"],
  "avoid_when": ["trauma response", "ritual meaning"],
  "requires_user_confirmation": false,
  "frame_limits": "Use only as an instrumental reasoning frame."
}
```

Retrieval systems should treat `avoid_when` and `frame_limits` seriously. A high cue match is not sufficient if the query falls inside an avoidance condition.

---

## 9. Index

`index.json` is optional and non-canonical. It may include:

```json
{
  "cue_index": {
    "scarcity": ["econ_core:k_choice_under_scarcity"],
    "tradeoff": ["econ_core:k_choice_under_scarcity"]
  },
  "negative_cue_index": {
    "ritual devotion": ["econ_core:k_choice_under_scarcity"]
  },
  "unit_index": {
    "opportunity cost": ["econ_core:u_opportunity_cost"]
  },
  "trajectory_index": {
    "policy proposal": ["econ_core:tr_basic_policy_analysis"]
  },
  "constraint_trigger_index": {
    "spend": ["econ_core:c_opportunity_cost_check"]
  }
}
```

If the index is absent or stale, consumers rebuild it from package files.

---

## 10. Versioning

Use semantic versioning:

- **MAJOR**: breaking object removals, schema incompatibility, changed identifiers.
- **MINOR**: new objects, new cues, new constraints, new trajectories.
- **PATCH**: typo fixes, clarified definitions, corrected anchors.

Consumers should pin package versions for reproducibility.

When a package is extended via merge (a new source added to an existing package), the merge results in a new minor or major version depending on whether existing units or clusters were modified or only added to. The `merge_intent` field in the manifest records what changed.

---

## 11. Validation rules

A package is structurally well-formed if:

1. `manifest.json`, `units.jsonl`, and `clusters.jsonl` exist.
2. Manifest contains all required fields, including `protocol_version`.
3. All ids follow the namespaced scheme and begin with `package_id:`.
4. No duplicate ids exist.
5. All references resolve within the package or declared dependencies.
6. Every unit has at least one anchor and provenance.
7. Every committed unit has status other than `candidate`.
8. Every cluster has at least one member, at least four cues, default behavior, and activation policy.
9. Every constraint has rule, applies_to, repair, severity, and type.
10. Every trajectory path points to existing clusters.
11. Every relation source and target resolves or is explicitly marked external.
12. `document_span` anchors include `source_id`, `location`, and short `excerpt` or `span_hash`.
13. `excerpt` fields, where present, do not exceed 500 characters (recommended ≤280).
14. If `merge_intent` is present, its `base_package` is a declared dependency or visible in version history.
15. Unknown optional fields are ignored by consumers but preserved by editors when possible.

A validator reports structural errors and warnings. It does not certify truth.

---

## 12. Multilingual packages

Objects may include `translations`:

```json
{
  "translations": {
    "th": {
      "label": "ต้นทุนค่าเสียโอกาส",
      "definition": "ต้นทุนของการเลือกทางเลือกหนึ่งรวมถึงมูลค่าของทางเลือกที่ดีที่สุดที่ต้องสละไป"
    }
  }
}
```

The manifest may declare:

```json
{
  "primary_language": "en",
  "supported_languages": ["en", "th"]
}
```

Cues may be language-keyed. Retrieval should use the cue set matching the query language when available.

---

## 13. Glossary

- **Unit**: anchored cognitive distinction.
- **Cluster**: group of units functioning as local coordinate and executable state.
- **Cue**: phrase that activates a cluster.
- **Negative cue**: phrase that suppresses or cautions against activation.
- **Anchor**: external warrant for a unit.
- **Constraint**: admissibility rule.
- **Transition**: typed edge from one cluster to another.
- **Trajectory**: reusable ordered path through clusters.
- **Branching trajectory**: a trajectory that diverges from an existing trajectory at a known junction cluster.
- **Relation**: non-transition relation, including cross-package conflict.
- **Activation policy**: conditions for using or avoiding a package/cluster.
- **Frame limits**: explicit statement of scope and misuse risk.
- **Test**: input with expected retrieval/runtime behavior.
- **Package**: installable cognitive frame.
- **Merge intent**: record of how a package was created from prior packages or sources.

---

## 14. Compatibility note

This is TCog Schema v0.3. Changes from v0.2:

- Added `merge_intent` field to manifest, recording the package's merge lineage.
- Added `branch_of` field to trajectories, supporting first-class branching trajectories.
- Added `negative_cue_index` and `constraint_trigger_index` to optional index structure.
- Added `retrieval_behavior` field to relations, with explicit values.
- Added `excerpt_char_limit` recommendation (≤280) made explicit in validation rules.
- Added validation rule for merge_intent base_package consistency.

These are additive changes. v0.2 packages remain valid under v0.3 if their `protocol_version` is updated.

Implementations should pin to a schema version and treat upgrades as deliberate migrations.
