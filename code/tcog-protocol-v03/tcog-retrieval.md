# Trajectory Cognition Retrieval Protocol (TCog Retrieval v0.3)

**Status:** Draft protocol. Companion to TCog Schema v0.3.
**Audience:** An LLM, agent, or runtime system using TCog packages to answer questions, support reasoning, or maintain a trajectory state.

---

## 0. Read this first

You are using a TCog package. Do not treat it as ordinary notes. A package is an installable cognitive frame with units, clusters, constraints, transitions, trajectories, tests, and frame limits.

Your job is not merely to retrieve relevant text. Your job is to:

1. identify which package frames should activate;
2. activate relevant clusters;
3. load anchored units;
4. check admissibility constraints;
5. follow or propose trajectories;
6. answer with citations to package anchors;
7. mark synthesis separately from package-supported claims;
8. avoid overextending the package beyond its frame limits.

This protocol is designed so retrieval can be performed by **small local models** (7B class and up) as the default. Larger models may opt into a semantic-augmented mode (§1). The mechanical mode is the design center — making small models reliable through structure rather than capability is the architecture's main contribution.

---

## 1. Two retrieval modes

### 1.1 Mechanical mode (default)

In mechanical mode, retrieval uses only:

- exact-and-lemma cue matching against the cue index;
- negative cue checks;
- activation policy (`activate_when` / `avoid_when` / `frame_limits`);
- trajectory trigger phrase matching;
- conversation state (active clusters, active trajectory).

No semantic similarity, no embedding, no interpretive judgment about meaning. Every retrieval decision is a token-level operation a small model can perform reliably.

This is the default mode. It is what makes the architecture work with small local LLMs. The package authors invest interpretive work at ingestion — naming distinctions, declaring cues, writing activation policies — so retrieval can be mechanical.

### 1.2 Semantic-augmented mode (opt-in)

In semantic-augmented mode, retrieval additionally uses:

- semantic similarity between the query and cluster `description` / `default_behavior`;
- semantic similarity between the query and unit `definition` / `label`;
- semantic match for trajectory triggers when no phrase matches.

This mode requires the model to have reliable semantic similarity capability. It produces better recall on novel paraphrasings but introduces model-dependent variability. Use it when:

- the model is sufficiently capable;
- the package's cues are known to be incomplete;
- the query is unusual phrasing that won't match cues.

The runtime declares the mode. If unspecified, default to mechanical.

### 1.3 Mode declaration in runtime state

```json
{
  "retrieval_mode": "mechanical"
}
```

or

```json
{
  "retrieval_mode": "semantic_augmented",
  "semantic_threshold": 0.65
}
```

When `semantic_augmented` is declared, the threshold is the minimum similarity score for a semantic match to count.

### 1.4 Why mechanical is default

Mechanical retrieval is auditable. Every decision can be traced to a specific cue match or activation policy clause. When a small local model retrieves, the decisions are reproducible — the same query against the same package produces the same active cluster set on any model that can do exact and lemma string matching.

Semantic retrieval is more powerful but model-dependent. A 7B model and a 405B model will not produce the same semantic similarity scores; their retrieval behavior diverges. For an architecture whose value is consistency and citability, mechanical is the correct default.

---

## 2. Non-negotiable retrieval rules

### Rule 1: Cite package support

When you state a package-supported claim, cite the relevant unit id or anchor. If citation rendering is unavailable, name the unit id in plain text.

### Rule 2: Do not invent package content

If the package does not contain a unit, constraint, or trajectory, do not pretend it does. You may synthesize, but you must label synthesis as synthesis.

### Rule 3: Respect activation policies

A high cue match is not enough. Check `activate_when`, `avoid_when`, negative cues, and frame limits.

### Rule 4: Surface constraints

If a constraint is triggered, mention it. If the constraint blocks a direct answer, say what repair is needed.

### Rule 5: Surface conflicts

If two packages or clusters conflict, do not silently merge them. Use the relation's `retrieval_behavior` to decide presentation.

### Rule 6: Preserve user trajectory

Use conversation state when available: active package, active clusters, active trajectory, history, and unresolved constraints.

### Rule 7: Honor mode

Operate in the declared retrieval mode. Do not silently use semantic similarity in mechanical mode.

---

## 3. Retrieval pipeline

Use this sequence for every non-trivial query.

```text
query
→ Step 1: package routing
→ Step 2: cluster activation
→ Step 3: unit loading
→ Step 4: constraint checking
→ Step 5: trajectory matching
→ Step 6: frame-limit and conflict check
→ Step 7: answer planning
→ response with citations and marked synthesis
→ state update
```

---

## 4. Step 1: Package routing

Given the query, identify candidate packages.

Use:

- package domain;
- package tags;
- manifest activation policy (`activate_when` / `avoid_when`);
- query cues (mechanical mode) or query semantics (semantic-augmented mode);
- active conversation state;
- user-selected package if provided.

For each loaded package, classify:

| Classification | Meaning |
|---|---|
| `activate` | package clearly applies; query terms match `activate_when` and no `avoid_when` triggers |
| `candidate` | package may apply; inspect clusters before commitment |
| `avoid` | package has cue overlap but `avoid_when` conditions or frame limits apply |
| `irrelevant` | no meaningful match |

If a package is avoided due to `avoid_when` or frame limits, do not use it as the main reasoning frame unless the user explicitly requests it.

### 4.1 Mechanical mode routing

```text
For each package:
  1. Lowercase and tokenize the query.
  2. Check whether any term in activate_when matches a query token or short phrase (literal substring or lemma match).
  3. Check whether any term in avoid_when matches the query.
  4. If avoid_when matches, classify as 'avoid'.
  5. Else if activate_when matches, classify as 'activate'.
  6. Else if any tag or domain term appears in query, classify as 'candidate'.
  7. Else classify as 'irrelevant'.
```

### 4.2 Worked example

```text
Query: "How should I comfort someone panicking?"

Package econ_core:
  activate_when: ["resource allocation", "policy analysis", "market behavior", "incentive design"]
  avoid_when: ["trauma response", "ritual meaning", "non-instrumental care", "identity preservation", "emergency emotional support"]

Mechanical check:
  - "comfort", "panicking" → match avoid_when entries "trauma response", "emergency emotional support"
  → classify as 'avoid'

Even though "should" might cue-match other clusters, the package is avoided.
```

---

## 5. Step 2: Cluster activation

Within active and candidate packages, score clusters.

### 5.1 Mechanical mode score

```text
score = cue_match_count + trajectory_continuity_bonus + state_continuity_bonus
        - negative_cue_penalty - activation_policy_penalty
```

Where:

- `cue_match_count`: number of cluster cues that match query terms (literal or lemma).
- `trajectory_continuity_bonus`: +1 if this cluster is the next cluster on the active trajectory's path; else 0.
- `state_continuity_bonus`: +0.5 if this cluster is in the active cluster set from the previous turn; else 0.
- `negative_cue_penalty`: number of negative cues in this cluster that match query terms, weighted ×2.
- `activation_policy_penalty`: +3 if any of the cluster's `avoid_when` terms match the query; else 0.

Activate clusters with score ≥ 1 unless capped. Cap activation at 7 clusters; if more score above threshold, take the top 7 by score.

### 5.2 Semantic-augmented mode score

```text
score = cue_match_count
        + semantic_similarity(query, cluster.description) × W_sem
        + trajectory_continuity_bonus
        + state_continuity_bonus
        - negative_cue_penalty
        - activation_policy_penalty
```

Default `W_sem = 1.0` and `semantic_similarity` is gated by `semantic_threshold` from runtime state (similarity below threshold contributes 0).

### 5.3 Cue matching: mechanical detail

When comparing cues to query terms:

- Lowercase both sides.
- Strip punctuation and extra whitespace.
- Treat hyphens and underscores as word boundaries.
- Treat plurals as matching singulars (`incentives` matches cue `incentive`).
- Treat verb forms as matching infinitives where reasonable (`incentivizing` matches cue `incentive`).

Do NOT do aggressive synonym substitution in mechanical mode. The cue list is what the cluster authoritatively declares it responds to. If a synonym is not in the cue list, it does not match in mechanical mode. Use semantic-augmented mode if synonym coverage is needed.

### 5.4 Phrase cues

A cue can be a phrase (e.g., "what would you give up"). Match phrase cues against the query as substrings, with normalization. Match if the cue's word sequence appears in the query, possibly with stop words elided.

### 5.5 Negative cues

Negative cues are cues that suppress or caution against activation. If a cluster has negative cues that match the query, the negative_cue_penalty applies. A cluster can have positive cue matches but still fail to activate if negative cues dominate.

Example:

```text
Cluster k_choice_under_scarcity:
  cues: ["scarcity", "tradeoff", "limited resource"]
  negative_cues: ["pure gift", "ritual devotion", "panic support"]

Query: "How do I support someone in panic about resources?"
  cue match: 1 ("resources")
  negative cue match: 2 ("panic support" partial; "support someone" near "panic")
  → score = 1 - 2*2 = -3 → do not activate
```

The negative cue penalty prevents the cluster from activating despite the positive cue overlap.

### 5.6 Tie-breaking and capping

When clusters have equal scores:

- Prefer clusters whose `activate_when` includes more of the query's terms.
- Prefer clusters with higher `runtime_hints.cache_priority` if present.
- Prefer clusters that include vetted/expert_vetted units.

Activate at most 7 clusters per query. If many clusters score above threshold, take the highest-scoring 7.

---

## 6. Step 3: Load units

For each active cluster:

1. Load member units (their labels, definitions, anchors).
2. Rank units by relevance to the query: a unit's `features` overlap with query terms, plus the cluster's score.
3. Prefer vetted/high-confidence units.
4. Include anchors for support.
5. Include low-confidence units only with caution; mark the caveat in the response if you use one.

Do not answer directly from cluster labels alone. Clusters guide retrieval; units support claims.

---

## 7. Step 4: Check constraints

Check constraints whose:

- `applies_to` matches the query type;
- `trigger_cues` match the query;
- `related_clusters` are active;
- trajectory includes the constraint.

Constraint outcomes:

| Outcome | Retrieval behavior |
|---|---|
| no trigger | ignore |
| low severity | mention if useful |
| medium severity | include as caveat or repair question |
| high severity | answer conditionally and repair |
| critical / `blocks_answer: true` | do not give direct answer until repaired |

If a constraint is `critical` or has `blocks_answer: true` and is triggered, the response must surface the constraint and ask for repair information rather than giving a direct answer.

---

## 8. Step 5: Match trajectories

A trajectory applies when:

- its trigger cues match the query;
- its entry conditions fit;
- several path clusters are active;
- the user asks for analysis, diagnosis, explanation, or decision support.

If a trajectory applies, use it to organize the answer.

### 8.1 Branching trajectories

If a matched trajectory has `branch_of`, check whether the parent trajectory also matches. If both match:

- Use the parent for the path up to `junction_cluster`.
- Use the branch for the path beyond `junction_cluster` if the branch's trigger or query indicates the branch's frame.
- If neither indication is clear, surface both paths and let the user choose, or proceed with parent and note that a branch exists.

This makes branches first-class without forcing the retrieval system to silently choose.

### 8.2 Multiple trajectories match

Pick the one with the most specific trigger match. If still tied, pick the one whose first cluster has the highest activation score. If still tied, surface both paths with their differences and let the answer note the choice.

### 8.3 No trajectory matches

Proceed without one. Use cluster-organized response (§11). Trajectories are aids, not requirements.

---

## 9. Step 6: Check frame limits and conflicts

Before answering, ask:

1. Are any active packages overreaching? (Their `avoid_when` matches; should be downgraded.)
2. Do any active clusters have `avoid_when` conditions matching the query? (Should be deactivated.)
3. Are there relation objects of type `conflicts_with` among active packages or clusters?
4. Does the query require a different frame than what's active?

### 9.1 Conflict relations: `retrieval_behavior` dispatch

When a `conflicts_with` relation is found between active objects, dispatch on its `retrieval_behavior`:

| Value | Action |
|---|---|
| `surface_both_frames` | Present both positions with attribution. Do not collapse them. |
| `prefer_source` | Use source-side as primary, mention target as alternative. |
| `prefer_target` | Use target-side as primary, mention source as alternative. |
| `require_user_choice` | Do not answer until the user selects a frame. |

Example:

```text
Conflict: econ_core:k_rational_choice conflicts_with behavioral_econ:k_bounded_rationality.
retrieval_behavior: surface_both_frames

Response presents both frames with their respective implications. Does not pick a winner.
```

### 9.2 Frame-limit overreach

If a query falls inside an active package's `avoid_when` or violates its `frame_limits`, the package is in overreach. Either:

- Downgrade to non-primary (use cautiously, with frame limit noted), or
- Deactivate (do not use as reasoning frame).

The choice depends on whether the user's question genuinely needs the frame at all. If they asked about hospital triage and economics is overreaching, downgrade. If they asked about grief and economics is irrelevant, deactivate.

---

## 10. Step 7: Plan the answer

Decide response mode:

| User need | Response mode |
|---|---|
| definition | unit-based concise answer |
| explanation | cluster-based explanation |
| analysis | trajectory-based answer |
| critique | constraint-based answer |
| comparison | multi-package/frame answer |
| continuation | state/trajectory update answer |
| uncertainty | cite what package supports, mark gap |

Do not overload a simple answer with every available package object. Match response complexity to query complexity.

---

## 11. Layered response format

For complex answers, use this structure:

```text
Section A: Direct retrieval (package-supported claims with citations)
Section B: Constraints triggered (and repair questions)
Section C: Patterns observed (from conversation state, optional)
Section D: Synthesis / extrapolation (clearly marked as inference, optional)
Closing: Gaps and follow-ups (what the package does not address)
```

For normal user-facing responses, compress this into prose. The structure guides reasoning even when not shown explicitly.

### 11.1 Package-supported claims

When a claim is directly supported, cite the unit:

```text
The relevant economic issue is opportunity cost: choosing one use of a scarce resource displaces the best alternative use. [econ_core:u_opportunity_cost]
```

Citations are inline, in square brackets, with the full namespaced unit identifier. Multiple citations comma-separated.

### 11.2 Synthesis

When you infer beyond package contents, mark it:

```text
Synthesis: applying the package trajectory to this case suggests that the proposal needs an incentive-response analysis. The package supports the trajectory structure, but this specific application is inference.
```

### 11.3 Missing package support

If package support is absent:

```text
The loaded packages do not contain a unit on this issue. I can answer from general reasoning, but it should not be treated as package-supported.
```

Do not silently fall back to training. Make the gap visible.

### 11.4 Frame distinction

When two frames apply with conflict:

```text
Under the standard economics frame, the issue is opportunity cost and incentives [econ_core:k_choice_under_scarcity]. Under a care/identity frame, the same decision may be evaluated by relational obligation rather than efficiency. These frames should not be collapsed; the question's answer depends on which frame is operative.
```

---

## 12. Conversation continuity and runtime state

If a TCog runtime state is available, update:

```json
{
  "retrieval_mode": "mechanical",
  "active_packages": [],
  "active_clusters": [],
  "active_cache": [],
  "history": [],
  "active_trajectory": null,
  "unresolved_constraints": [],
  "coherence_budget": 1.0
}
```

### 12.1 Cache update

Keep recently active clusters in cache. Add anticipated next clusters from trajectories and transitions. Evict least relevant or stale clusters when capacity is exceeded.

### 12.2 Transition recording

When the answer moves from one cluster to another, record transition:

```json
{
  "from": "econ_core:k_choice_under_scarcity",
  "to": "econ_core:k_incentive_response",
  "type": "logical",
  "observed_in": "conversation_turn_id"
}
```

Observed transitions can later inform package authors about which transitions are heavily used and which are rarely traversed.

### 12.3 Coherence check

Estimate informally:

- compositional coherence: do active clusters fit together as a coherent frame?
- historical coherence: does the current query follow the recent state?
- prospective coherence: is there a plausible next step?

If coherence is low, do not just answer. Repair the trajectory:

```text
This seems to shift from economics to care/identity reasoning. I will separate the frames rather than force one answer.
```

The `coherence_budget` is a v0.3 placeholder; concrete depletion and replenishment rules are not yet specified. Use it as a soft signal, not a hard gate.

### 12.4 Mode persistence

`retrieval_mode` is part of runtime state. It persists across turns unless the user or runtime explicitly changes it.

---

## 13. Worked examples

### 13.1 Simple query, mechanical mode

**Loaded package:** `econ_core` v0.2.0, mechanical mode.

**Query:** "What is opportunity cost?"

**Step 1 (routing):**

```text
Query tokens: ["what", "is", "opportunity", "cost"]
Package econ_core activate_when match: "opportunity cost" not literal in activate_when, but tag/domain match.
→ classify as 'candidate'.
```

**Step 2 (cluster activation, mechanical):**

```text
Cluster k_choice_under_scarcity:
  cues match: "opportunity cost" → matches cue "what is given up"? No. "tradeoff"? No. None match exactly.

Cluster k_opportunity_cost (if exists):
  cues match: "opportunity cost" → matches cue "opportunity cost"? Yes (1 match).
  → score = 1, activate.
```

**Step 3 (load):** Load `u_opportunity_cost` from `k_opportunity_cost`.

**Step 6 (compose):**

```text
Opportunity cost is the value of the best alternative forgone when choosing one option over another. [econ_core:u_opportunity_cost]
```

Mechanical mode handled this with one cue match. No semantic reasoning needed.

### 13.2 Policy query, mechanical mode

**Query:** "The university should spend more money on AI profile-building programs because students will benefit. Is this a good idea?"

**Step 1 (routing):** `econ_core` activate_when matches "policy analysis", "resource allocation". → activate.

**Step 2 (cluster activation, mechanical):**

```text
k_choice_under_scarcity:
  cues match: "spend" → "budget"? lemma match. "money" → "limited resource"? no. "should" → no.
  → cue_match_count = 1
  → score = 1, activate.

k_incentive_response (if defined):
  cues match: "students will benefit" → "incentive"? no direct match. "more money" → no.
  → cue_match_count = 0
  → score = 0, but tag match → candidate.

k_marginal_reasoning:
  cues match: "more" → "marginal"? no.
  → 0, do not activate from query alone.
```

After loading the policy_analysis trajectory's path (since trajectory triggers match), additional clusters from the path are activated for trajectory continuity.

**Step 5 (trajectory):** `tr_basic_policy_analysis` triggers match: "should", "policy". → trajectory active.

**Step 6 (compose):** Use trajectory's `output_template` to structure response. Constraint `c_opportunity_cost_check` triggers (cues "spend", "allocate").

```text
Under the economics frame, the proposal is incomplete as stated.

The opportunity-cost constraint is triggered: a spending recommendation needs to identify what alternative use of the budget is displaced. [econ_core:c_opportunity_cost_check]

Following the trajectory:
- Scarce resource: the university budget [econ_core:u_scarcity]
- Actors and incentives: students, faculty, administration [econ_core:u_incentives]
- Opportunity cost: what other programs or capabilities lose funding? [econ_core:u_opportunity_cost]
- Marginal reasoning: does the marginal dollar produce more here than elsewhere? [econ_core:u_marginal_analysis]
- Unintended consequences: how do affected agents change behavior? [econ_core:u_unintended_consequences]

Synthesis: the proposal may still be good, but the current argument is not yet admissible under this frame.
```

### 13.3 Out-of-domain, mechanical mode

**Query:** "How should I comfort someone panicking?"

**Step 1:** `econ_core` avoid_when contains "trauma response", "emergency emotional support". Query matches. → classify as 'avoid'.

**Step 2:** Skip; package is avoided.

**Response:**

```text
The loaded economics package's frame limits include trauma response and emergency emotional support; this query falls outside its scope. No other packages are loaded that cover this domain.

I can offer general reasoning, but without a relevant package this would be ungrounded inference. Loading a relevant package (e.g., crisis-support or psychology) would let me give a properly grounded answer.
```

The package's avoidance condition prevented overreach. Mechanical mode caught this without semantic reasoning.

### 13.4 Conflicting frames

**Loaded packages:** `econ_core`, `behavioral_econ`. Relation: `econ_core:k_rational_choice conflicts_with behavioral_econ:k_bounded_rationality`, `retrieval_behavior: "surface_both_frames"`.

**Query:** "How will consumers respond to a price increase on cigarettes?"

**Step 2:** Both `k_rational_choice` (econ_core) and `k_bounded_rationality` (behavioral_econ) activate.

**Step 6 (frame-limit/conflict check):** Conflict found, `retrieval_behavior: surface_both_frames`.

**Response:**

```text
Two frames apply, and they predict differently:

Standard rational-choice analysis [econ_core:k_rational_choice] predicts demand decreases with price, with elasticity depending on substitutes and addiction status. Quantity response is proportional to price change up to elasticity.

Bounded-rationality analysis [behavioral_econ:k_bounded_rationality] predicts a non-monotonic response: many consumers may underreact (status-quo bias, present bias) but a subset respond strongly (those for whom the new price crosses an internal threshold). Aggregate response is harder to predict and depends on choice architecture.

These frames differ in their assumption about consumer cognition. The packages flag this as a known conflict; resolution depends on which framework's empirical assumptions hold for the population in question.
```

Both frames cited, neither collapsed. The user knows the disagreement is structural and where to look for resolution.

---

## 14. Edge cases

### 14.1 No package applies

Say so explicitly. Offer to answer from general knowledge with the gap clearly marked, but do not silently fall back.

### 14.2 Package applies weakly

Use cautiously, mark low confidence in response, state which units the answer relies on.

### 14.3 Too many clusters activate

Reduce to the smallest set that supports the answer. Prefer clusters with direct unit support and triggered constraints. Cap at 7.

### 14.4 Constraint blocks answer

Ask for repair information or provide a conditional answer ("if X is true, then Y; if not, you'd need Z").

### 14.5 User asks for synthesis

You may synthesize, but separate:

- package-supported claims (cited);
- your inference (marked synthesis);
- external knowledge (marked external);
- speculation (marked speculative).

### 14.6 User asks for citations

Cite unit ids and anchors. Do not cite clusters unless the claim is about the package structure itself ("the package treats X as a separate cluster").

### 14.7 User asks to switch retrieval mode

If the user requests semantic-augmented mode and the runtime supports it, switch and persist the change in runtime state. If not supported, say so.

### 14.8 Package contradicts itself

If two units within the same package contradict, surface the contradiction with both anchors and ask the user to adjudicate. This is a package quality issue and should be flagged for the package author.

---

## 15. Retrieval quality checklist

Before final answer, check:

- Did I operate in the declared retrieval mode?
- Did I choose the right package frame, respecting `avoid_when`?
- Did I activate clusters based on cues (and semantics if mode allows), not just keywords?
- Did I check negative cues?
- Did I load units, not merely cluster labels?
- Did I surface triggered constraints?
- Did I use a trajectory only when useful?
- Did I dispatch on `retrieval_behavior` for any conflict relations?
- Did I cite package-supported claims?
- Did I mark synthesis separately?
- Did I expose conflicts between frames?
- Did I update or preserve conversation trajectory?
- Did I respect the cluster activation cap of 7?

---

## 16. Final reminders

TCog retrieval is not:

```text
query → chunk retrieval → answer
```

It is:

```text
query
→ frame routing (with activation policy)
→ cluster activation (mechanical or semantic-augmented)
→ anchored unit loading
→ constraint checking
→ trajectory selection (with branch handling)
→ frame-limit / conflict check
→ cited answer with marked synthesis
→ state update
```

The mechanical mode is the design center. Small models running mechanical retrieval against well-authored packages produce reliable, citable, auditable answers — that is the architecture's contribution. Semantic-augmented mode is available for capable models when cue coverage is incomplete, but it is not the path of least resistance; mechanical is.

The point is to move intelligence from runtime improvisation into durable cognitive structure. Use that structure faithfully.
