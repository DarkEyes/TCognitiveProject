# Trajectory Cognition Ingestion Protocol (TCog Ingestion v0.3)

**Status:** Draft protocol. Companion to TCog Schema v0.3.
**Audience:** A capable LLM or human-assisted extraction system producing a conforming TCog package.
**Output:** A candidate basis package for human review, not an automatically final authority.

---

## 0. Read this first

You are performing **package ingestion**. Your job is to read a vetted source or curated corpus and produce a structured TCog package that later systems can use without rereading the entire source.

A TCog package is durable cognitive infrastructure. It is not a summary, outline, textbook replacement, or ordinary retrieval index. It is a structured cognitive frame composed of:

- anchored units;
- clusters that can activate as basis-like coordinates and cognitive states;
- constraints that define admissible reasoning;
- transitions that encode likely conceptual movement;
- trajectories that encode disciplined reasoning paths;
- tests that make retrieval behavior inspectable.

Your output is a candidate package. The user may approve, revise, split, merge, or reject elements. Do not pretend that ingestion alone creates expert-certified knowledge.

This protocol covers two ingestion modes:

- **Fresh ingestion** (§§1-9): produce a new package from a source.
- **Merge ingestion** (§10): extend an existing package with a new source, producing a delta for user review.

---

## 1. What you produce

For fresh ingestion, produce a TCog package in directory or bundle form:

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

For long or evolving projects, prefer directory form:

```text
package_id/
  manifest.json
  units.jsonl
  clusters.jsonl
  constraints.jsonl
  transitions.jsonl
  trajectories.jsonl
  tests.jsonl
  relations.jsonl
  index.json
  README.md
```

For merge ingestion, produce a delta document (see §10).

---

## 2. Non-negotiable discipline rules

### Rule 1: Every committed unit has an anchor

No committed unit may be added without an anchor. If no anchor can be supplied, keep the item as `candidate` and surface it for review.

### Rule 2: Anchors must be copyright-safe

Do not copy long passages. Use source location, short excerpt (≤280 chars recommended), and optional hash. A short excerpt is for verification, not source reproduction.

### Rule 3: Faithfulness before cleverness

Extract what the source actually supports. Do not add external knowledge merely because it is true or useful. If you add a primitive modeling commitment, mark it as `axiomatic` and declare scope.

### Rule 4: Clusters are functional, not topical

Do not create clusters like "economics things" or "chapter 2 concepts." A cluster must say what it does when active.

### Rule 5: Reading order matters

Preserve source order using `chunk_index`, `position_in_chunk`, and `source_order`. Trajectories depend on this.

### Rule 6: Separate extraction from synthesis

Package objects extracted from the source must be marked differently from synthesis, commentary, or bridging relations. Do not hide synthesis inside unit definitions.

### Rule 7: Declare frame limits

Every package and important cluster must say when it should activate, when it should not activate, and how it can be misused.

### Rule 8: Surface conflicts; do not resolve them silently

When merging or extending, conflicts between sources or packages must be made visible to the user, not papered over.

---

## 3. High-level ingestion pipeline

### Fresh ingestion: four passes

```text
Pass 0: source setup and metadata
Pass 1: local extraction by chunk
Pass 2: global consolidation and package formation
Pass 3: validation and test generation
Pass 4: human review preparation
```

### Merge ingestion: five passes

```text
Pass 0: source setup and existing-package loading
Pass 1: local extraction by chunk (same as fresh)
Pass 2: classification against existing package (duplicate / refinement / novel / conflict)
Pass 3: delta construction (additions, refinements, conflicts, branches)
Pass 4: validation and human review preparation
```

For very short sources, Pass 1 and Pass 2 may be combined, but the distinction should remain conceptually clear.

---

## 4. Pass 0: source setup

### Step 0.1: Identify source metadata

Record:

- title;
- author(s);
- publication date and edition;
- ISBN, DOI, URL, or local source id;
- domain;
- source type: textbook, paper, manual, legal document, corpus, notes, or mixed;
- rights/license status when known;
- extraction date;
- extractor model/tool.

### Step 0.2: Decide ingestion mode

If no existing package covers this domain (or no existing package is provided), perform **fresh ingestion**.

If an existing package is provided to extend or merge, perform **merge ingestion**. In merge mode, also load:

- the existing package's manifest, units, clusters, constraints, transitions, trajectories, and relations;
- any declared dependencies of that package;
- prior `merge_intent` history if available.

### Step 0.3: Decide package boundary

Ask what package is being built (or extended):

- one source package;
- one domain core package;
- one author-specific package;
- one method package;
- one corpus package;
- one project-specific package.

Do not mix these without declaring the boundary.

Example:

```text
Good: econ_core = foundational economic reasoning concepts.
Good: mankiw_principles = package tied to a specific textbook.
Risky: economics_everything = too broad for reliable extraction.
```

### Step 0.4: Plan chunking

If the source is under 10,000 words, process as one chunk. Otherwise chunk by natural boundaries:

- chapters;
- sections;
- subsections;
- theorem/proof blocks;
- procedural steps;
- legal clauses.

Each chunk should usually be 2,000-5,000 words. Record chunk index and source range.

---

## 5. Pass 1: local unit extraction

Process chunks in order. This pass is the same for fresh and merge ingestion.

### Step 1.1: Identify candidate units

A unit is an **anchored cognitive distinction**. Extract candidates when the source commits to a reusable distinction such as:

- definition;
- named principle;
- theorem;
- rule;
- method step;
- relation between concepts;
- diagnostic category;
- admissibility condition;
- recurring distinction used later.

Do not extract:

- casual mentions;
- examples as standalone units;
- anecdotes;
- rhetorical flourishes;
- duplicate restatements;
- your own inferred implications unless marked separately.

### Step 1.2: Write the unit

For each unit:

- `label`: 2-5 words, lowercase preferred.
- `definition`: one sentence; state the distinction, not a textbook paragraph.
- `anchors`: source location, short excerpt (≤280 chars), optional hash.
- `features`: 3-7 matching tags.
- `provenance`: package, chunk index, position, source order, extraction protocol.
- `status`: usually `draft`.
- `confidence`: 0.4-0.95.

Good unit definition:

```text
Opportunity cost is the value of the best alternative forgone when choosing one option over another.
```

Bad unit definition:

```text
The chapter talks a lot about choices and costs.
```

### Step 1.3: Assign local confidence

Use:

- `0.9-0.95` for explicit definitions or formal statements;
- `0.75-0.89` for clearly supported recurring distinctions;
- `0.55-0.74` for plausible but interpretive extractions;
- `0.4-0.54` for uncertain candidates that need review.

Low-confidence objects should remain visible, not silently discarded.

### Step 1.4: Preserve local order

Every unit must include:

```json
{
  "chunk_index": 3,
  "position_in_chunk": 5,
  "source_order": 47
}
```

`source_order` is the global running order across all chunks.

---

## 6. Pass 2 (fresh): global consolidation

For fresh ingestion, after local extraction, consolidate globally.

For merge ingestion, skip to §10.

### Step 2.1: Deduplicate units

Compare candidates by:

- label similarity;
- definition similarity;
- feature overlap;
- anchor proximity;
- conceptual role.

When duplicates exist:

1. keep the clearest unit;
2. merge anchors if they support the same distinction;
3. record aliases in `notes` or `translations` if useful;
4. mark discarded candidates as superseded if they were already emitted.

Do not merge genuinely different distinctions just because they share a term.

### Step 2.2: Create clusters

A cluster groups units with shared organizational role. For each cluster, write:

- `label`;
- `description`;
- `members`;
- `cues`;
- `negative_cues` when relevant;
- `default_behavior`;
- `basis_role`;
- `activation_policy`;
- `failure_modes`;
- `frame_limits`.

Cluster quality test:

> If this cluster activates during retrieval, does it tell the system what kind of reasoning move to make?

If not, it is probably only a topic folder.

### Step 2.3: Check cluster size

As a heuristic:

- 1 member: maybe too narrow;
- 2-8 members: usually healthy;
- 9-15 members: inspect for overbreadth;
- more than 15: probably split.

Exceptions are allowed for formal packages with dense taxonomies.

### Step 2.4: Declare activation and avoidance conditions

For every package and important cluster, specify:

```json
{
  "activate_when": ["policy analysis", "resource allocation"],
  "avoid_when": ["ritual meaning", "emergency emotional support"],
  "frame_limits": "Use as instrumental analysis, not as a complete theory of value."
}
```

This prevents package overreach.

---

## 7. Extract constraints

Constraints are admissibility rules: what the package says must be checked for reasoning to be adequate.

Extract constraints when the source states or strongly institutionalizes:

- an analysis is incomplete without X;
- a conclusion is invalid unless Y;
- a procedure must include Z;
- a definition rules out certain uses;
- a method has scope conditions;
- a frame should not be used in certain cases.

For each constraint:

- `label`;
- `type`: `admissibility`, `normative`, `empirical`, `definitional`, `safety`, or `scope`;
- `rule`;
- `applies_to`;
- `trigger_cues`;
- `repair`;
- `severity`;
- `blocks_answer`;
- related clusters.

Be conservative. Do not invent constraints merely because they would improve the package.

---

## 8. Derive transitions

Transitions are typed edges between clusters. They seed the state graph.

Create a transition when the source clearly moves from one cluster to another by:

- logical implication;
- methodological sequence;
- contrast;
- causal explanation;
- repair move;
- frame shift.

Example:

```json
{
  "id": "econ_core:e_scarcity_to_incentives",
  "from": "econ_core:k_choice_under_scarcity",
  "to": "econ_core:k_incentive_response",
  "type": "logical",
  "rank": 1,
  "rationale": "Once scarcity is identified, the analysis turns to how agents respond to constrained choices."
}
```

Do not create a transition merely because two clusters appear near each other. The movement should be conceptually meaningful.

---

## 9. Derive trajectories

A trajectory is an ordered path through clusters that the source teaches the reader to follow.

### 9.1 Top-level trajectory from reading order

The top-level trajectory often follows the source order:

```text
foundation → distinction → method → application → limitation
```

To derive it:

1. For each cluster, compute its position as the median `source_order` of its member units.
2. Order clusters by these positions.
3. The resulting cluster sequence is a candidate trajectory.

This is a deliberately lazy derivation. It uses reading order as a proxy for prerequisite structure. The runtime tolerates the imprecision through ranked-with-noise transition selection. Do not attempt sophisticated dependency parsing; reading order is sufficient.

### 9.2 Procedural trajectories

Extract explicit methods such as:

- diagnostic procedure;
- policy analysis sequence;
- proof strategy;
- legal reasoning test;
- clinical differential process;
- philosophical interpretation sequence.

These are often stated by the source ("to analyze a policy, first do X, then Y, then Z"). Capture them as separate trajectories alongside the top-level one.

### 9.3 Trajectory fields

For each trajectory:

- `label`;
- `trigger`;
- `path`;
- `constraints` checked along the path;
- `output_template`;
- `failure_modes`;
- `entry_conditions` and `exit_conditions` where useful.

A trajectory should teach the retrieval system how to move, not just what to mention.

---

## 10. Merge ingestion: extending an existing package

This is the package factory workflow: adding a new source to an existing package, producing a delta for user review.

### 10.1 Goal

Given an existing package P (with units, clusters, constraints, trajectories) and a new source S, produce a delta document that proposes:

- units to ADD (novel distinctions in S not in P);
- units to REFINE (units in P that S defines more precisely or with different scope);
- clusters to EXTEND (P's clusters that gain new members from S);
- clusters to ADD (new clusters introduced by S);
- branches to ADD (new trajectories that diverge from P's at known junctions);
- conflicts to FLAG (places where S contradicts P, requiring user adjudication);
- relations to ADD (typed cross-references between S's content and P's).

The user reviews the delta, accepts/edits/rejects each item, and the engine commits.

### 10.2 Pass 2 (merge): classification

After Pass 1 (local extraction of candidates from S), classify each candidate against the existing package P.

For each candidate unit `u_new` extracted from S:

```text
For each existing unit u_old in P:
  similarity = compare(u_new, u_old) by label, definition, features, anchor proximity
  If similarity > 0.85 AND definitions agree:
    classify u_new as DUPLICATE of u_old
  Else if similarity > 0.7 AND definitions describe the same distinction with different scope:
    classify u_new as REFINEMENT of u_old
  Else if similarity > 0.7 AND definitions contradict:
    classify u_new as CONFLICT with u_old
  Else:
    (no match)

If no matches, classify u_new as NOVEL.
```

For each candidate cluster `k_new` proposed over S's units:

```text
For each existing cluster k_old in P:
  member_overlap = |k_new.members ∩ k_old.members| / |k_new.members ∪ k_old.members|
  description_similarity = compare(k_new.description, k_old.description)
  If member_overlap > 0.5:
    classify k_new as SAME-CLUSTER (extending k_old with new members)
  Else if k_new attaches to P's graph at known junction k_junction (some k_new members or successors are in P):
    classify k_new as BRANCH at k_junction
  Else if k_new.description sharpens k_old.description for a sub-case:
    classify k_new as SUB-CLUSTER of k_old
  Else:
    classify k_new as NOVEL-CLUSTER

(no match → NOVEL-REGION, indicating the new source covers territory P does not)
```

### 10.3 Pass 3 (merge): delta construction

Build a delta document with the following structure:

```json
{
  "delta": {
    "from_package": "econ_core",
    "from_version": "0.2.0",
    "merge_intent": {
      "type": "extension",
      "base_package": "econ_core",
      "base_version": "0.2.0",
      "source_added": "thaler_misbehaving",
      "merge_date": "2026-05-01",
      "summary": "..."
    },
    "additions": {
      "units": [...],
      "clusters": [...],
      "constraints": [...],
      "transitions": [...],
      "trajectories": [...]
    },
    "refinements": [
      {
        "target_id": "econ_core:u_rational_agent",
        "current_definition": "Agents make choices that maximize expected utility given their preferences.",
        "proposed_definition": "Agents make choices that maximize expected utility given their preferences, under the standard rationality assumption (which behavioral economics treats as scope-conditional).",
        "rationale": "The new source argues this assumption is scope-conditional, not universal. Refining to add scope qualification.",
        "confidence": 0.8
      }
    ],
    "branches": [
      {
        "id_proposed": "econ_core:tr_behavioral_policy_analysis",
        "branch_of": {
          "parent": "econ_core:tr_basic_policy_analysis",
          "junction_cluster": "econ_core:k_incentive_response"
        },
        "path": [
          "econ_core:k_choice_under_scarcity",
          "econ_core:k_incentive_response",
          "econ_core:k_bounded_rationality",
          "econ_core:k_choice_architecture",
          "econ_core:k_unintended_consequences"
        ],
        "rationale": "New source teaches a behavioral analysis path that diverges at incentive_response and proceeds through bounded rationality."
      }
    ],
    "conflicts": [
      {
        "id_proposed": "econ_core:rel_rational_choice_vs_bounded_rationality",
        "type": "conflicts_with",
        "existing_object": "econ_core:k_rational_choice",
        "new_object": "econ_core:k_bounded_rationality (proposed)",
        "nature": "The existing cluster treats rational choice as a global modeling assumption. The new cluster from the source treats it as one regime among others, with bounded rationality as an alternative regime under cognitive limitations.",
        "proposed_resolutions": [
          "(A) Adopt bounded rationality as a scope-conditional refinement: rational choice applies under low cognitive load; bounded rationality applies under high load.",
          "(B) Maintain both as parallel frames with explicit relation, surface_both_frames at retrieval.",
          "(C) Split into a separate package (behavioral_econ) and link via dependencies."
        ],
        "recommended_resolution": "B",
        "user_decision_required": true
      }
    ],
    "summary": {
      "additions_count": {
        "units": 12,
        "clusters": 3,
        "constraints": 1,
        "transitions": 4,
        "trajectories": 1
      },
      "refinements_count": 4,
      "branches_count": 1,
      "conflicts_count": 2,
      "low_confidence_items": 5,
      "high_severity_conflicts": 1,
      "review_estimated_time_minutes": 25
    }
  }
}
```

### 10.4 Pass 4 (merge): trajectory branch detection

For each candidate trajectory derived from S's reading order:

1. Compute S's cluster sequence by median `source_order` of cluster members.
2. Align this sequence against P's existing trajectories cluster-by-cluster.
3. Identify alignment points (clusters present in both S's sequence and a P trajectory).
4. Where S's sequence diverges from P's after an alignment point, mark the divergence as a candidate branch with `junction_cluster` = the last shared cluster.

This is the lazy version of branch detection. It does not perform graph isomorphism. It uses sequence alignment, which is cheap and produces useful branch candidates. The runtime selection rule absorbs imprecise branch placement through ranked-with-noise transitions.

### 10.5 Pass 5 (merge): conflict surfacing

Conflicts are not resolved automatically. They are surfaced to the user with:

- both positions stated clearly;
- their respective anchors in their respective sources;
- the structural nature of the conflict (definitional, empirical, normative, scope);
- two or three proposed resolutions with their structural implications;
- a recommended resolution if one is clearly better, with rationale;
- a flag for whether user decision is required (yes if `severity` would be `high` or `critical`; otherwise the engine may proceed with the recommendation pending review).

The user reviews each conflict and chooses a resolution. The chosen resolution is committed; the rejected alternatives are recorded in `notes` for traceability.

### 10.6 Merge intent in the resulting package

When the merge is committed, the resulting package's manifest gets a `merge_intent` field:

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
    "summary": "Added behavioral economics units; introduced bounded-rationality branch off rational-agent cluster; surfaced and resolved conflict over rational-agent assumption (resolution B: parallel frames with explicit relation)."
  }
}
```

The package version advances per semver: minor bump if only additions; major bump if conflicts changed existing behavior.

---

## 11. Generate tests

Every useful package needs tests. Tests prevent packages from becoming vibes.

Create tests for:

- obvious activation cases;
- non-activation cases;
- constraint violations;
- trajectory use;
- package-overreach prevention;
- conflicts between frames.

Example:

```json
{
  "id": "econ_core:test_ai_program_budget",
  "input": "The university should spend more money on AI profile-building programs because students will benefit.",
  "expected_activated_clusters": ["econ_core:k_choice_under_scarcity", "econ_core:k_incentive_response"],
  "expected_constraints_triggered": ["econ_core:c_opportunity_cost_check"],
  "expected_repair_questions": ["What alternative use of the same budget is displaced?"],
  "should_not_activate": ["econ_core:k_equilibrium_modeling"]
}
```

For merged packages, also create tests that exercise:

- the new branches (trajectory selection at junction clusters);
- the resolved conflicts (do retrieval responses surface the frame distinction correctly?);
- the refined units (does retrieval pick up the sharper definition?).

Include at least five tests for a small package and at least one test per major cluster for a serious package.

---

## 12. Build the index

The index is optional and can be rebuilt. If produced, include:

- cue index;
- negative cue index;
- unit label index;
- trajectory trigger index;
- constraint trigger index.

Do not treat the index as canonical. The package objects are canonical.

---

## 13. Validation checklist

Before returning the package, check:

- Manifest has required fields including `protocol_version: "0.3"`.
- All ids are namespaced and unique.
- Every committed unit has anchor(s) and provenance.
- Every cluster has members, cues (≥4), default behavior, and activation policy.
- Every constraint has rule, applies_to, repair, and severity.
- Every transition points to existing clusters.
- Every trajectory path points to existing clusters.
- Every relation source and target resolves or is marked external.
- Every test references expected objects that exist.
- Cues are discriminative, not generic.
- Negative cues and avoid conditions exist for overreach-prone frames.
- Copyright-safe anchor excerpts are short (≤280 chars recommended).
- Low-confidence objects are marked as such.
- For merge ingestion: `merge_intent` is present and base_package is consistent.
- For branched trajectories: `branch_of.junction_cluster` references an existing cluster.

---

## 14. Handling difficult content

### 14.1 Ambiguous concepts

If the source uses a concept inconsistently, do not force a clean unit. Use notes:

```json
"notes": "The source uses this term in two senses; split may be needed after review."
```

### 14.2 Implicit structure

If a structure is implied but not explicit, do not present it as extracted fact. Mark it as a synthesized relation or candidate trajectory.

### 14.3 Normative disagreement

If the source makes a normative claim, preserve it as the source's commitment. Do not neutralize it, but do not universalize it beyond the source frame.

### 14.4 Multi-source packages (single ingestion pass)

If a single ingestion pass covers multiple sources, distinguish:

- source-specific units;
- consensus units;
- contested units;
- synthesized bridging units.

Use relations to record disagreement.

### 14.5 Multi-source packages (across merges)

If the package was built incrementally by merging sources over time, the `merge_intent` history records the additions. Do not re-process prior sources; trust the existing package as the base.

### 14.6 External axioms

If a package includes axioms not extracted from a source, use `axiomatic` anchors and declare scope. Axioms must be visible as modeling commitments.

---

## 15. Preparing for human review

Return a review summary:

```text
Package summary:
- ingestion mode: fresh / merge
- number of units (additions, refinements, conflicts if merge)
- number of clusters
- number of constraints
- number of trajectories (including branches)
- low-confidence objects requiring attention
- orphan units
- clusters with few or many members
- likely overreach risks
- unresolved source ambiguities
- conflicts requiring user decision
- suggested expert review points
```

Also provide a short changelog if revising an existing package.

---

## 16. Minimal output standard

For a small usable package, produce at least:

- manifest;
- 10-30 anchored units;
- 3-8 clusters;
- 2-5 constraints;
- 3-10 transitions;
- 1-3 trajectories;
- 5 tests.

For a source-specific package, fewer may be acceptable if the source is short.

For merge ingestion, the minimum is whatever the new source genuinely contributes; an extension can be small (a few units) or large (a major branch with new clusters and trajectories).

---

## 17. Final reminders

Your job is not to show how much you know. Your job is to produce a durable, auditable cognitive package.

A good TCog package lets a later system say:

- which frame is active;
- which clusters are active;
- which units support the answer;
- which constraints are triggered;
- which trajectory is being followed;
- which frame limits apply;
- which claims are extracted versus synthesized.

For merged packages, additionally:

- which units came from which source;
- which conflicts were resolved how;
- which trajectories are branches and where they diverge.

If the package cannot do that, it is not yet a TCog package.
