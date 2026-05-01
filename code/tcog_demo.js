
// No embedded default package; packages load from the local packages/ folder.


// ============================================================================
// TCog v0.3 Mechanical Retrieval Engine
// ============================================================================
// Implements the retrieval pipeline from tcog-retrieval.md v0.3:
//   1. Package routing (activate_when / avoid_when check)
//   2. Cluster activation (cue matching, negative cue penalties)
//   3. Unit loading
//   4. Constraint checking (trigger_cues, applies_to, blocks_answer)
//   5. Trajectory matching
//   6. Frame-limit and conflict check
//   7. Answer planning (mechanical only — no semantic similarity)
// ============================================================================

// ============================================================================
// Multi-package state. The packages/ folder is loaded automatically when
// the page is served over http://localhost; manual package loading remains
// available for local-file use and experiments. Each entry has the full v0.3
// combined structure: { manifest, units, clusters, constraints, transitions,
// trajectories, relations, tests, index }.
// ============================================================================
const LOADED_PACKAGES = [];

// ---------------------------------------------------------------------------
// Package activation patches
// ---------------------------------------------------------------------------
// Some "light" / scaffold packages in the v0.3.7 bundle ship with very loose
// cluster cues (single generic words like "ratio", "structure", "constrains",
// "stability", "force", "model"). On a healthcare-rationing or social-policy
// query that uses those words in non-chemical / non-physical senses, the
// retrieval engine over-activates these packages.
//
// Deprecated fallback: package-authored metadata is now the preferred source of
// truth for strict domain gating. Keep these JS patches only so older packages
// without strict_domain_tokens still behave safely in this static demo.
const PACKAGE_PATCHES = {
  chemistry_interactions_core: {
    activation_policy: {
      activate_when: [
        'chemistry', 'chemical', 'molecule', 'molecular', 'compound',
        'reaction', 'reagent', 'reactant', 'product yield',
        'catalyst', 'catalysis', 'catalyze',
        'stoichiometry', 'stoichiometric',
        'equilibrium constant', 'le chatelier',
        'ph', 'acid', 'base ', 'acidic', 'alkaline', 'buffer',
        'solvent', 'solute', 'solution chemistry',
        'concentration', 'dosage chemistry', 'dose-response',
        'synthesis', 'substance', 'polymer', 'monomer',
        'ion', 'ionic', 'covalent', 'bond', 'bonding',
        'thermodynamic reaction', 'kinetic rate',
        'enzyme', 'atom', 'atomic', 'isotope',
        'oxidation', 'reduction', 'redox',
        'mole', 'molarity', 'titration',
        'organic chemistry', 'inorganic chemistry'
      ],
      avoid_when: [
        'healthcare policy', 'healthcare rationing', 'ration healthcare',
        'fairness', 'equity', 'ability to pay',
        'rationing', 'distributive justice',
        'economic policy', 'economics question',
        'ethics question', 'moral question', 'morality',
        'political legitimacy', 'political question',
        'organizational policy', 'organisational policy',
        'corporate policy', 'social justice',
        'opportunity cost', 'grief', 'mental health policy',
        'out-of-domain query',
        'when another package is explicitly selected and this frame would distort the task'
      ],
      frame_limits: 'Activate ONLY for chemistry-specific content: substances, reactions, molecules, compounds, catalysts, stoichiometry, equilibrium, pH, solvents, dosage chemistry, material interactions. Do NOT activate from generic constraint / ratio / structure / equilibrium language; require an explicit chemical referent.'
    },
    // Strong-domain gate: the package's clusters are allowed to score only
    // if at least one of these tokens appears in the query (lemma-tolerant).
    // Otherwise the package is suppressed_due_to_overreach.
    _strict_domain_tokens: [
      'chemistry', 'chemical', 'molecule', 'molecular', 'compound',
      'reaction', 'reagent', 'reactant', 'catalyst', 'catalysis',
      'stoichiometry', 'equilibrium', 'ph', 'acid', 'base',
      'alkaline', 'solvent', 'solute', 'concentration',
      'dosage', 'substance', 'polymer', 'ion', 'ionic',
      'covalent', 'bond', 'thermodynamic', 'kinetic',
      'enzyme', 'atom', 'atomic', 'isotope', 'oxidation',
      'reduction', 'redox', 'mole', 'molarity', 'titration',
      'organic', 'inorganic'
    ]
  },
  physics_dynamical_constraints_core: {
    activation_policy: {
      activate_when: [
        'physics', 'physical system', 'force', 'energy',
        'momentum', 'mass', 'velocity', 'acceleration',
        'conservation law', 'thermodynamic', 'kinetic energy',
        'potential energy', 'phase transition', 'oscillation',
        'wave', 'field equation', 'particle', 'quantum', 'relativity',
        'newtonian', 'lagrangian', 'hamiltonian',
        'mechanical equilibrium', 'dynamical system',
        'perturbation theory', 'linear stability',
        'phase space', 'attractor', 'limit cycle',
        'differential equation', 'ode', 'pde',
        'scaling law', 'dimensional analysis',
        'classical mechanics', 'fluid dynamics'
      ],
      avoid_when: [
        'social stability', 'political stability',
        'market force', 'social pressure', 'peer pressure',
        'organizational momentum', 'career momentum',
        'cultural force', 'metaphorical force',
        'gain momentum', 'lose momentum',
        'out-of-domain query',
        'when another package is explicitly selected and this frame would distort the task'
      ],
      frame_limits: 'Activate ONLY for physical systems, forces, energy, conservation laws, dynamics, perturbation, stability of physical/modeling systems. Do NOT activate from social/economic/organizational metaphors of "stability", "force", "pressure", or "momentum".'
    },
    _strict_domain_tokens: [
      'physics', 'physical', 'force', 'energy', 'momentum',
      'velocity', 'acceleration', 'conservation',
      'thermodynamic', 'kinetic', 'potential', 'newtonian',
      'lagrangian', 'hamiltonian', 'particle', 'quantum',
      'relativity', 'wave', 'oscillation', 'perturbation',
      'attractor', 'differential equation', 'ode', 'pde',
      'dynamical system', 'simulation', 'phase space',
      'phase transition', 'mechanics', 'fluid', 'gravity'
    ]
  }
};

function getPackageAuthoredStrictDomainTokens(pkg) {
  const manifest = pkg.manifest || {};
  const policyTokens = manifest.activation_policy && manifest.activation_policy.strict_domain_tokens;
  if (Array.isArray(policyTokens) && policyTokens.length > 0) return policyTokens;
  if (Array.isArray(manifest.strict_domain_tokens) && manifest.strict_domain_tokens.length > 0) return manifest.strict_domain_tokens;
  if (Array.isArray(pkg.strict_domain_tokens) && pkg.strict_domain_tokens.length > 0) return pkg.strict_domain_tokens;
  return null;
}

function getStrictDomainTokens(pkg) {
  return getPackageAuthoredStrictDomainTokens(pkg) || pkg._strict_domain_tokens || [];
}

function applyPackagePatch(pkg) {
  const id = pkg.manifest && pkg.manifest.package_id;
  const patch = PACKAGE_PATCHES[id];
  if (!patch) return;

  // Deprecated fallback only: if the package already authored strict domain
  // tokens, do not layer the old JS overreach patch on top of it.
  if (getPackageAuthoredStrictDomainTokens(pkg)) return;

  if (patch.activation_policy) {
    pkg.manifest.activation_policy = {
      ...(pkg.manifest.activation_policy || {}),
      ...patch.activation_policy
    };
  }
  if (patch._strict_domain_tokens) {
    pkg._strict_domain_tokens = patch._strict_domain_tokens.slice();
  }
  pkg._patched = true;
}

// ---------------------------------------------------------------------------
// Cue normalization — exactly per protocol §5.3
// ---------------------------------------------------------------------------
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")  // smart quotes → straight
    .replace(/[\.\,\!\?\;\:\(\)\[\]\{\}'"`]/g, ' ')
    .replace(/[\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text).split(' ').filter(t => t.length > 0);
}

// Lemma match: "incentives" matches "incentive", "incentivizing" matches "incentive"
function lemmaMatch(token, cue) {
  const t = token.toLowerCase();
  const c = cue.toLowerCase();
  if (t === c) return true;
  // crude lemma: token starts with cue and remainder is a common suffix
  if (t.startsWith(c) && t.length > c.length) {
    const suffix = t.slice(c.length);
    if (['s','es','ed','ing','er','ly','ation','tion'].includes(suffix)) return true;
  }
  if (c.startsWith(t) && c.length > t.length) {
    const suffix = c.slice(t.length);
    if (['s','es','ed','ing','er','ly'].includes(suffix)) return true;
  }
  return false;
}

// Phrase match: cue can be multi-word phrase
function phraseMatchInQuery(cue, queryNormalized) {
  const cueNorm = normalize(cue);
  if (cueNorm.length === 0) return false;
  const cueTokens = cueNorm.split(' ');
  // Substring containment is only safe for multi-word cues, where the spaces
  // act as word boundaries. For single-token cues, raw substring containment
  // produces false positives such as cue "ratio" matching query token "ration"
  // — which caused chemistry_interactions_core to over-activate on healthcare
  // rationing queries. Single-token cues must match a query token via lemma.
  if (cueTokens.length > 1 && queryNormalized.includes(cueNorm)) return true;
  if (cueTokens.length === 1) {
    // single-token cue: lemma-match against query tokens
    return tokenize(queryNormalized).some(t => lemmaMatch(t, cueNorm));
  }
  // multi-word: check sequential occurrence with at most 1 stop-word gap
  const queryTokens = tokenize(queryNormalized);
  const stopWords = new Set(['the','a','an','of','to','in','for','is','are','be','was','were']);
  outer: for (let i = 0; i <= queryTokens.length - cueTokens.length; i++) {
    let qi = i;
    for (let ci = 0; ci < cueTokens.length; ci++) {
      // skip stop words
      while (qi < queryTokens.length && stopWords.has(queryTokens[qi]) && !lemmaMatch(queryTokens[qi], cueTokens[ci])) qi++;
      if (qi >= queryTokens.length) continue outer;
      if (!lemmaMatch(queryTokens[qi], cueTokens[ci])) continue outer;
      qi++;
    }
    return true;
  }
  // Fallback for short multi-word cues (2 words): bag-of-tokens match.
  // If both cue tokens appear anywhere in the query (lemma-tolerant), count as match.
  // This handles word-order variations like "random string" vs "string to be random".
  // Limited to 2-token cues to stay disciplined.
  if (cueTokens.length === 2) {
    const allMatch = cueTokens.every(ct =>
      queryTokens.some(qt => lemmaMatch(qt, ct))
    );
    if (allMatch) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 1: Package routing (per package)
// ---------------------------------------------------------------------------
function routeOnePackage(query, pkg) {
  const queryNorm = normalize(query);
  const policy = pkg.manifest.activation_policy || {};
  const activate = policy.activate_when || [];
  const avoid = policy.avoid_when || [];

  const activateMatches = activate.filter(t => phraseMatchInQuery(t, queryNorm));
  const avoidMatches = avoid.filter(t => phraseMatchInQuery(t, queryNorm));

  let classification;
  if (avoidMatches.length > 0) {
    classification = 'avoid';
  } else if (activateMatches.length > 0) {
    classification = 'activate';
  } else {
    const tags = pkg.manifest.tags || [];
    const domain = pkg.manifest.domain || '';
    const tagMatch = tags.some(t => queryNorm.includes(normalize(t)));
    const domainMatch = domain && queryNorm.includes(normalize(domain));
    classification = (tagMatch || domainMatch) ? 'candidate' : 'check_clusters';
  }

  return {
    package_id: pkg.manifest.package_id,
    classification,
    activate_matches: activateMatches,
    avoid_matches: avoidMatches
  };
}

// ---------------------------------------------------------------------------
// Step 2: Cluster activation (mechanical mode score) per package
// ---------------------------------------------------------------------------
function scoreCluster(cluster, query) {
  const queryNorm = normalize(query);
  const cues = cluster.cues || [];
  const negCues = cluster.negative_cues || [];

  const positiveMatches = cues.filter(c => phraseMatchInQuery(c, queryNorm));
  const negativeMatches = negCues.filter(c => phraseMatchInQuery(c, queryNorm));

  const clusterPolicy = cluster.activation_policy || {};
  const clusterAvoid = (clusterPolicy.avoid_when || []).filter(t => phraseMatchInQuery(t, queryNorm));
  const policyPenalty = clusterAvoid.length > 0 ? 3 : 0;

  const score = positiveMatches.length - 2 * negativeMatches.length - policyPenalty;

  return {
    cluster,
    score,
    positive_matches: positiveMatches,
    negative_matches: negativeMatches,
    policy_avoid: clusterAvoid
  };
}

function activateClustersInPackage(query, pkg, packageRouting) {
  if (packageRouting.classification === 'avoid') {
    return [];
  }
  const scored = pkg.clusters.map(c => scoreCluster(c, query));
  return scored
    .filter(s => s.score >= 1)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Step 3: Load member units for active clusters
// ---------------------------------------------------------------------------
function loadUnitsForPackage(activatedClusters, pkg) {
  const unitIds = new Set();
  for (const a of activatedClusters) {
    for (const m of (a.cluster.members || [])) unitIds.add(m);
  }
  return pkg.units.filter(u => unitIds.has(u.id));
}

// ---------------------------------------------------------------------------
// Step 4: Check constraints per package
// ---------------------------------------------------------------------------
function checkConstraintsInPackage(query, activatedClusters, pkg) {
  const queryNorm = normalize(query);
  const activeClusterIds = new Set(activatedClusters.map(a => a.cluster.id));

  const triggered = [];
  for (const c of (pkg.constraints || [])) {
    let triggers = false;
    const reasons = [];

    const triggerCues = c.trigger_cues || [];
    const cueMatches = triggerCues.filter(t => phraseMatchInQuery(t, queryNorm));
    if (cueMatches.length > 0) {
      triggers = true;
      reasons.push(`cues: ${cueMatches.join(', ')}`);
    }

    const related = c.related_clusters || [];
    const relatedActive = related.filter(r => activeClusterIds.has(r));
    if (relatedActive.length > 0) {
      triggers = true;
      reasons.push(`active cluster: ${relatedActive[0]}`);
    }

    const appliesTo = c.applies_to || [];
    const appliesMatch = appliesTo.filter(a => phraseMatchInQuery(a, queryNorm));
    if (appliesMatch.length > 0) {
      triggers = true;
      reasons.push(`applies_to: ${appliesMatch.join(', ')}`);
    }

    if (triggers) {
      triggered.push({ constraint: c, reasons, package_id: pkg.manifest.package_id });
    }
  }
  return triggered;
}

// ---------------------------------------------------------------------------
// Step 5: Match trajectories per package
// ---------------------------------------------------------------------------
function matchTrajectoriesInPackage(query, activatedClusters, pkg) {
  const queryNorm = normalize(query);
  const activeClusterIds = new Set(activatedClusters.map(a => a.cluster.id));
  const trajectories = pkg.trajectories || [];

  const matches = [];
  for (const tr of trajectories) {
    const triggers = tr.trigger || tr.triggers || {};
    const phrases = triggers.cues || triggers.query_phrases || [];
    const patterns = triggers.input_types || triggers.query_patterns || [];

    const phraseMatches = phrases.filter(p => phraseMatchInQuery(p, queryNorm));
    const patternMatches = patterns.filter(p => phraseMatchInQuery(p, queryNorm));

    const pathActive = (tr.path || []).filter(c => activeClusterIds.has(c)).length;

    const score = phraseMatches.length * 2 + patternMatches.length * 2 + pathActive;
    if (score >= 2) {
      matches.push({
        trajectory: tr, score,
        phrase_matches: phraseMatches, pattern_matches: patternMatches, path_active: pathActive,
        package_id: pkg.manifest.package_id
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// ---------------------------------------------------------------------------
// Step 6: Frame-limit / conflict check per package
// ---------------------------------------------------------------------------
function frameCheckInPackage(query, packageRouting, activatedClusters, pkg) {
  const issues = [];
  if (packageRouting.classification === 'avoid') {
    issues.push({
      kind: 'package_avoid',
      package_id: pkg.manifest.package_id,
      message: `Package ${pkg.manifest.package_id} frame limits exclude this query: ${packageRouting.avoid_matches.join(', ')}`
    });
  }
  const activeIds = new Set(activatedClusters.map(a => a.cluster.id));
  const relations = (pkg.relations || []).filter(r => {
    return (activeIds.has(r.source) && activeIds.has(r.target)) ||
           (r.type === 'frame_limited_by' && activeIds.has(r.source));
  });
  for (const r of relations) {
    if (r.type === 'conflicts_with') {
      issues.push({
        kind: 'conflict',
        package_id: pkg.manifest.package_id,
        relation: r,
        message: `Conflict between ${r.source} and ${r.target} (retrieval_behavior: ${r.retrieval_behavior || 'unspecified'})`
      });
    } else if (r.type === 'frame_limited_by') {
      issues.push({
        kind: 'frame_limit',
        package_id: pkg.manifest.package_id,
        relation: r,
        message: `${r.source} is frame-limited by ${r.target}: ${r.note || ''}`
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Main retrieval pipeline (multi-package)
// ---------------------------------------------------------------------------
// Overreach gate: package-authored strict_domain_tokens require at least one
// strong domain token (lemma-tolerant) in the query. The lookup priority is:
// manifest.activation_policy.strict_domain_tokens, manifest.strict_domain_tokens,
// package.strict_domain_tokens, then deprecated JS PACKAGE_PATCHES fallback.
// If the gate fails, the package is `suppressed_due_to_overreach` and its
// clusters do NOT enter the pool, even if generic cues scored above threshold.
function checkDomainGate(query, pkg) {
  const tokens = getStrictDomainTokens(pkg);
  if (!tokens || tokens.length === 0) return { passes: true, matched: [] };
  const queryNorm = normalize(query);
  const matched = tokens.filter(t => phraseMatchInQuery(t, queryNorm));
  return { passes: matched.length > 0, matched };
}

function retrieve(query) {
  const trace = {
    routing_per_package: [],     // routing classification per package
    activated_clusters: [],      // flat list across all packages, score-sorted, max 7
    units: [],                   // flat list of cited units
    triggered_constraints: [],   // flat list of triggered constraints
    matched_trajectories: [],    // top trajectory matches across packages
    frame_issues: [],            // frame issues across packages
    active_packages: [],         // packages that contributed clusters
    suppressed_packages: []      // packages mechanically suppressed (avoid / overreach)
  };

  if (LOADED_PACKAGES.length === 0) {
    trace.disposition = 'no_packages_loaded';
    return trace;
  }

  // Step 1+2: Per-package routing and cluster activation
  const allActivated = [];
  for (const pkg of LOADED_PACKAGES) {
    const routing = routeOnePackage(query, pkg);
    trace.routing_per_package.push(routing);
    if (routing.classification === 'avoid') {
      trace.suppressed_packages.push({
        package_id: pkg.manifest.package_id,
        domain: pkg.manifest.domain,
        reason: 'avoid_when',
        detail: `avoid_when matched: ${routing.avoid_matches.join(', ')}`
      });
      continue;
    }
    // Domain-gate (overreach) check.
    // For a package with strict domain tokens from metadata or deprecated JS
    // fallback, always surface the gate result. If the gate fails, the package
    // is marked `suppressed_due_to_overreach` and contributes no clusters.
    // We tentatively activate first to expose any generic cue matches that
    // *would* have activated under a less strict regime — that's the
    // architectural point the demo is making visible.
    const gate = checkDomainGate(query, pkg);
    if (!gate.passes) {
      const tentative = activateClustersInPackage(query, pkg, routing);
      const cuesUsed = [...new Set(tentative.flatMap(a => a.positive_matches))];
      const detail = tentative.length > 0
        ? `Generic cues matched (${cuesUsed.join(', ')}) but no strong-domain token from this package appears in the query. Clusters dropped to prevent overreach.`
        : `No strong-domain token from this package appears in the query. The package was considered and dropped — its frame does not apply here.`;
      trace.suppressed_packages.push({
        package_id: pkg.manifest.package_id,
        domain: pkg.manifest.domain,
        reason: 'suppressed_due_to_overreach',
        detail,
        would_have_activated: tentative.map(a => ({
          id: a.cluster.id,
          label: a.cluster.label,
          score: a.score,
          cues: a.positive_matches
        }))
      });
      continue;
    }
    const activated = activateClustersInPackage(query, pkg, routing);
    for (const a of activated) {
      a.package_id = pkg.manifest.package_id;
      a.package = pkg;
      allActivated.push(a);
    }
  }

  // Take top 7 across all packages
  allActivated.sort((a, b) => b.score - a.score);
  trace.activated_clusters = allActivated.slice(0, 7);

  // Track which packages contributed
  const activePkgIds = new Set(trace.activated_clusters.map(a => a.package_id));
  trace.active_packages = LOADED_PACKAGES.filter(p => activePkgIds.has(p.manifest.package_id));

  // Step 3: Load units from each package's contributing clusters
  for (const pkg of trace.active_packages) {
    const pkgClusters = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    const units = loadUnitsForPackage(pkgClusters, pkg);
    trace.units.push(...units);
  }

  // Step 4: Check constraints per package using the active clusters from that package
  for (const pkg of LOADED_PACKAGES) {
    const pkgActivated = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    if (pkgActivated.length === 0) continue;
    const triggered = checkConstraintsInPackage(query, pkgActivated, pkg);
    trace.triggered_constraints.push(...triggered);
  }

  // Step 5: Match trajectories per package
  for (const pkg of LOADED_PACKAGES) {
    const pkgActivated = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    if (pkgActivated.length === 0) continue;
    const matches = matchTrajectoriesInPackage(query, pkgActivated, pkg);
    trace.matched_trajectories.push(...matches);
  }
  trace.matched_trajectories.sort((a, b) => b.score - a.score);
  trace.matched_trajectories = trace.matched_trajectories.slice(0, 2);  // up to 2 across packages

  // Step 6: Frame issues per package
  for (const pkg of LOADED_PACKAGES) {
    const routing = trace.routing_per_package.find(r => r.package_id === pkg.manifest.package_id);
    const pkgActivated = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    const issues = frameCheckInPackage(query, routing, pkgActivated, pkg);
    trace.frame_issues.push(...issues);
  }

  // Detect cross-package frame conflicts: when multiple packages activated for the same query
  // with different frame limits, that's a frame conflict the architecture should surface.
  if (trace.active_packages.length >= 2) {
    trace.frame_issues.push({
      kind: 'multi_package_active',
      message: `${trace.active_packages.length} packages activated: ${trace.active_packages.map(p => p.manifest.package_id).join(', ')}. Different packages may bring different normative frames to the same query.`,
      packages: trace.active_packages.map(p => p.manifest.package_id)
    });
  }

  // Determine response disposition
  const blocking = trace.triggered_constraints.filter(t => t.constraint.blocks_answer);
  const allAvoided = trace.routing_per_package.length > 0 &&
                     trace.routing_per_package.every(r => r.classification === 'avoid');
  const noClusters = trace.activated_clusters.length === 0;

  if (allAvoided) {
    trace.disposition = 'refuse_out_of_frame';
  } else if (noClusters) {
    trace.disposition = 'no_match';
  } else if (blocking.length > 0) {
    trace.disposition = 'partial_with_blocking_constraints';
  } else {
    trace.disposition = 'normal_answer';
  }
  return trace;
}

// ---------------------------------------------------------------------------
// Build raw retrieval prose (no LLM, fully mechanical)
// ---------------------------------------------------------------------------
function unitsToCitedSentences(units, maxUnits = 8) {
  const ranked = units.slice(0, maxUnits);
  return ranked.map(u => {
    return {
      text: u.definition,
      cite: u.id,
      label: u.label,
      anchor: (u.anchors && u.anchors[0]) || null
    };
  });
}

function buildRawResponse(query, trace) {
  if (trace.disposition === 'no_packages_loaded') {
    return {
      sectionG: `No packages are loaded. Use the "Load package" button in the sidebar to load a TCog v0.3 package.combined.json file.`
    };
  }

  const sections = {};

  // ---------- Section A: TCog protocol trace ----------
  // This is the core differentiator from a vanilla LLM answer: the audit trace
  // is the public-facing default, before any prose. It shows what the engine
  // mechanically decided, what it suppressed, and why.
  sections.sectionA_trace = {
    activated_packages: trace.active_packages.map(p => ({
      id: p.manifest.package_id,
      domain: p.manifest.domain,
      cluster_count: trace.activated_clusters.filter(a => a.package_id === p.manifest.package_id).length
    })),
    suppressed_packages: trace.suppressed_packages || [],
    activated_clusters: trace.activated_clusters.map(a => ({
      id: a.cluster.id,
      label: a.cluster.label,
      score: a.score,
      cues: a.positive_matches,
      package_id: a.package_id
    })),
    triggered_constraints: trace.triggered_constraints.map(t => ({
      id: t.constraint.id,
      rule: t.constraint.rule,
      repair: t.constraint.repair,
      severity: t.constraint.severity,
      blocks: !!t.constraint.blocks_answer,
      package_id: t.package_id
    })),
    matched_trajectory: trace.matched_trajectories[0] ? {
      id: trace.matched_trajectories[0].trajectory.id,
      label: trace.matched_trajectories[0].trajectory.label,
      score: trace.matched_trajectories[0].score,
      template: trace.matched_trajectories[0].trajectory.output_template || []
    } : null,
    frame_conflicts: (trace.frame_issues || []).map(i => ({
      kind: i.kind,
      message: i.message,
      package_id: i.package_id
    })),
    multi_frame: trace.active_packages.length >= 2
      ? trace.active_packages.map(p => ({ id: p.manifest.package_id, domain: p.manifest.domain }))
      : null,
    disposition: trace.disposition
  };

  // ---------- Section B: package-bound answer (cited from units) ----------
  if (trace.disposition === 'refuse_out_of_frame') {
    const avoided = trace.routing_per_package.filter(r => r.classification === 'avoid');
    const detail = avoided.map(a => `${a.package_id} (avoid: ${a.avoid_matches.join(', ')})`).join('; ');
    sections.sectionB_note = `All loaded packages declared <code>avoid_when</code> matches for this query: ${detail}. No package-bound claims are available from the current package set. Loading a package covering this domain would let TCog provide a grounded answer.`;
  } else if (trace.disposition === 'no_match') {
    const pkgIds = LOADED_PACKAGES.map(p => p.manifest.package_id).join(', ');
    sections.sectionB_note = `No clusters in any loaded package (${pkgIds}) matched terms in this query above the activation threshold. No package-bound claims are available from the current package set.`;
  } else {
    sections.sectionB_units = unitsToCitedSentences(trace.units);
  }

  // ---------- Section C: constraints / repairs ----------
  if (trace.triggered_constraints.length > 0) {
    sections.sectionC_constraints = trace.triggered_constraints.map(t => ({
      id: t.constraint.id,
      rule: t.constraint.rule,
      repair: t.constraint.repair,
      severity: t.constraint.severity,
      blocks: !!t.constraint.blocks_answer,
      package_id: t.package_id
    }));
  }

  // ---------- Section D: synthesis beyond packages ----------
  // Mechanical mode does not synthesize beyond units; it surfaces a placeholder
  // marking the boundary. The LLM composition layer fills D when invoked.
  if (trace.disposition === 'partial_with_blocking_constraints') {
    sections.sectionD_note = `A direct answer is blocked until the value tradeoff is surfaced. Use the repair question above to specify the standard TCog should apply.`;
  } else if (trace.disposition === 'normal_answer') {
    sections.sectionD_note = `<em>Mechanical mode does not synthesize beyond the cited units. Run with an LLM provider key to add synthesis beyond packages; any inference beyond the packages will be marked explicitly there.</em>`;
  }

  return sections;
}

// ============================================================================
// Mechanical draft-answer auditor
// ============================================================================
// The auditor does not call an LLM. It compares a user-provided draft against
// the retrieval trace: blocking constraints, frame activation, overreach
// suppression, and package-bound citation discipline.
function keywordSetFromText(text) {
  const stop = new Set(['the','and','for','with','that','this','from','into','must','should','would','could','about','answer','question','when','where','which','what','under','does','not','are','is','to','of','in','a','an','or','by','on','as','be']);
  return [...new Set(tokenize(text || '').filter(t => t.length >= 4 && !stop.has(t)))];
}

function draftMentionsAny(draftNorm, keywords) {
  return (keywords || []).some(k => phraseMatchInQuery(k, draftNorm));
}

function draftHasDirectAnswer(draftNorm) {
  const directPhrases = [
    'yes', 'no', 'definitely', 'clearly', 'is fair', 'is efficient',
    'is correct', 'the answer is', 'you should', 'must', 'will',
    'can simply', 'therefore'
  ];
  return directPhrases.some(p => phraseMatchInQuery(p, draftNorm));
}

function draftMentionsUncertaintyOrRepair(draftNorm, constraints) {
  const safetyWords = [
    'uncertain', 'uncertainty', 'depends', 'cannot determine', 'not enough',
    'consult', 'consultation', 'emergency', 'urgent', 'repair', 'clarify',
    'specify', 'tradeoff', 'trade off', 'constraint', 'before answering'
  ];
  const repairWords = constraints.flatMap(t => keywordSetFromText(t.constraint.repair || '').slice(0, 8));
  return draftMentionsAny(draftNorm, safetyWords.concat(repairWords));
}

function constraintMentionKeywords(triggered) {
  return triggered.flatMap(t => {
    const c = t.constraint || {};
    const idParts = String(c.id || '').split(/[:_\-]+/);
    return idParts
      .concat(keywordSetFromText(c.label || ''))
      .concat(keywordSetFromText(c.rule || '').slice(0, 8))
      .concat(keywordSetFromText(c.repair || '').slice(0, 8));
  });
}

function packageDomainVocabulary(pkg, suppressed) {
  const manifest = pkg.manifest || {};
  const policy = manifest.activation_policy || {};
  const vocab = []
    .concat(manifest.domain || [])
    .concat(manifest.tags || [])
    .concat(policy.activate_when || [])
    .concat(getStrictDomainTokens(pkg) || []);
  if (suppressed && suppressed.would_have_activated) {
    for (const cl of suppressed.would_have_activated) {
      vocab.push(cl.label || '');
      vocab.push(...(cl.cues || []));
    }
  }
  return keywordSetFromText(vocab.join(' ')).concat((vocab || []).filter(v => String(v).includes(' ')));
}

function auditDraftAnswer(query, draft, trace) {
  const draftNorm = normalize(draft);
  const reasons = [];
  const repairs = [];
  let rank = 0; // 0 pass, 1 warn incomplete, 2 fail wrong-frame, 3 fail blocking

  function warn(reason, repair) {
    rank = Math.max(rank, 1);
    reasons.push(reason);
    if (repair) repairs.push(repair);
  }
  function failWrongFrame(reason, repair) {
    rank = Math.max(rank, 2);
    reasons.push(reason);
    if (repair) repairs.push(repair);
  }
  function failBlocking(reason, repair) {
    rank = Math.max(rank, 3);
    reasons.push(reason);
    if (repair) repairs.push(repair);
  }

  if (!draftNorm) {
    warn('No draft answer was provided for audit.', 'Paste a draft answer, or turn off audit mode to run retrieval only.');
  }

  const blocking = (trace.triggered_constraints || []).filter(t => t.constraint.blocks_answer);
  if (blocking.length > 0 && draftHasDirectAnswer(draftNorm) && !draftMentionsUncertaintyOrRepair(draftNorm, blocking)) {
    failBlocking(
      'A blocking constraint fired, but the draft gives a direct answer without uncertainty, consultation, emergency handling, or the constraint repair language.',
      'Rewrite the answer around the blocking repair question before making a direct claim.'
    );
  }

  const triggered = trace.triggered_constraints || [];
  if (triggered.length > 0 && !draftMentionsAny(draftNorm, constraintMentionKeywords(triggered))) {
    warn(
      'Constraints triggered, but the draft does not name a constraint label, rule keyword, or repair-question keyword.',
      'Mention the governing constraint or its repair question in the answer.'
    );
  }

  if ((trace.active_packages || []).length > 1) {
    const multiFrameWords = ['multi frame', 'multiple frame', 'tradeoff', 'trade off', 'conflict', 'under one frame', 'under another frame', 'from the economics frame', 'from the ethics frame', 'whereas'];
    if (!draftMentionsAny(draftNorm, multiFrameWords)) {
      warn(
        'Multiple packages activated, but the draft does not signal multi-frame reasoning, tradeoff, conflict, or frame-specific claims.',
        'Separate the answer by frame, for example: under one frame... under another frame...'
      );
    }
  }

  for (const suppressed of (trace.suppressed_packages || []).filter(s => s.reason === 'suppressed_due_to_overreach')) {
    const pkg = LOADED_PACKAGES.find(p => p.manifest.package_id === suppressed.package_id);
    if (!pkg) continue;
    const vocab = packageDomainVocabulary(pkg, suppressed);
    const matched = vocab.filter(v => phraseMatchInQuery(v, draftNorm)).slice(0, 8);
    if (matched.length >= 3) {
      failWrongFrame(
        `The draft uses vocabulary from suppressed package ${suppressed.package_id}: ${matched.join(', ')}.`,
        `Remove claims from ${suppressed.package_id}, or load/run a query where that package passes strict domain gating.`
      );
    } else if (matched.length > 0) {
      warn(
        `The draft appears to lean on vocabulary from suppressed package ${suppressed.package_id}: ${matched.join(', ')}.`,
        'Keep suppressed-package vocabulary out of the answer unless it is explicitly framed as excluded.'
      );
    }
  }

  const hasUnits = (trace.units || []).length > 0;
  const hasCitations = /\[[a-zA-Z_][a-zA-Z_0-9]*:[a-zA-Z_][a-zA-Z_0-9]*\]/.test(draft);
  if (hasUnits && !hasCitations) {
    warn(
      'Retrieved units exist, but the draft has no package-bound citations such as [package_id:u_xxx].',
      'Attach exact unit citations to factual package-bound claims.'
    );
  }

  if ((trace.activated_clusters || []).length === 0 && draftHasDirectAnswer(draftNorm)) {
    warn(
      'No clusters matched, but the draft makes confident package-style claims.',
      'State that the loaded packages did not retrieve support, or load a package covering this domain.'
    );
  }

  if (reasons.length === 0) {
    reasons.push('The draft stays within the active package trace, triggered constraints, and citation expectations checked by the mechanical auditor.');
    repairs.push('No repair required.');
  }

  const verdict = rank >= 3
    ? 'FAIL: violates blocking constraint'
    : rank === 2
      ? 'FAIL: wrong-frame / overreach risk'
      : rank === 1
        ? 'WARN: incomplete'
        : 'PASS: package-admissible';

  return { verdict, reasons, suggested_repair: [...new Set(repairs)].join(' ') };
}

function renderAuditCard(audit) {
  const div = document.createElement('div');
  div.className = 'section section-audit';
  const isFail = audit.verdict.startsWith('FAIL');
  const color = isFail ? 'var(--accent)' : audit.verdict.startsWith('WARN') ? 'var(--warn)' : 'var(--accent-2)';
  div.innerHTML = `
    <div class="section-label"><span>Answer Auditor</span><span class="friendly-status" style="color:${color}; background:rgba(184,92,0,0.08);">${escapeHtml(audit.verdict)}</span></div>
    <div class="section-content">
      <p style="font-weight:600; margin-bottom:6px;">Audit reasons:</p>
      <ul class="answer-why">${audit.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      <p style="font-weight:600; margin-top:12px;">Suggested repair:</p>
      <p>${escapeHtml(audit.suggested_repair || 'No repair required.')}</p>
    </div>
  `;
  return div;
}

// ============================================================================
// Ordinary RAG-style flat retrieval comparison
// ============================================================================
// This intentionally simple baseline flattens package units and cluster
// descriptions into keyword-scored documents. It has no routing, no constraint
// gating, no trajectory selection, and no overreach prevention.
function ordinaryRagDocuments() {
  const docs = [];
  for (const pkg of LOADED_PACKAGES) {
    const packageId = pkg.manifest.package_id;
    for (const u of (pkg.units || [])) {
      docs.push({
        type: 'unit',
        id: u.id,
        package_id: packageId,
        title: u.label || u.id,
        text: [u.label, u.definition, (u.anchors || []).map(a => a.excerpt || '').join(' ')].join(' ')
      });
    }
    for (const c of (pkg.clusters || [])) {
      docs.push({
        type: 'cluster',
        id: c.id,
        package_id: packageId,
        title: c.label || c.id,
        text: [c.label, c.description, (c.cues || []).join(' ')].join(' ')
      });
    }
  }
  return docs;
}

function scoreOrdinaryRag(query, topK = 8) {
  const qTokens = keywordSetFromText(query);
  return ordinaryRagDocuments()
    .map(doc => {
      const docNorm = normalize(doc.text);
      const matches = qTokens.filter(t => phraseMatchInQuery(t, docNorm));
      return { ...doc, score: matches.length, matches };
    })
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function renderFlatRetrievalBaseline(query, trace) {
  const flat = scoreOrdinaryRag(query);
  const flatHtml = flat.length > 0
    ? '<ul class="trace-list">' + flat.map(d =>
        `<li><code>${escapeHtml(d.id)}</code> <span class="status-pill" style="background:rgba(74,74,69,0.10); color:var(--ink-soft);">${escapeHtml(d.type)}</span><div style="font-size:12px; color:var(--ink-soft);">${escapeHtml(d.title)} · score ${d.score} · matches: ${escapeHtml(d.matches.join(', '))}</div></li>`
      ).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); margin:0;"><em>No flat keyword matches.</em></p>';

  const tcogHtml = `
    <ul class="trace-list">
      <li><strong>Active packages:</strong> ${(trace.active_packages || []).map(p => `<code>${escapeHtml(p.manifest.package_id)}</code>`).join(', ') || '<em>none</em>'}</li>
      <li><strong>Active clusters:</strong> ${(trace.activated_clusters || []).map(a => `<code>${escapeHtml(a.cluster.id)}</code>`).join(', ') || '<em>none</em>'}</li>
      <li><strong>Triggered constraints:</strong> ${(trace.triggered_constraints || []).map(t => `<code>${escapeHtml(t.constraint.id)}</code>`).join(', ') || '<em>none</em>'}</li>
      <li><strong>Trajectory:</strong> ${trace.matched_trajectories?.[0] ? `<code>${escapeHtml(trace.matched_trajectories[0].trajectory.id)}</code>` : '<em>none</em>'}</li>
      <li><strong>Suppressed packages:</strong> ${(trace.suppressed_packages || []).map(s => `<code>${escapeHtml(s.package_id)}</code> (${escapeHtml(s.reason)})`).join(', ') || '<em>none</em>'}</li>
    </ul>
  `;

  return `
    <details style="margin-top:16px;">
      <summary>Optional flat retrieval baseline</summary>
      <div class="comparison-grid" style="margin-top:10px;">
        <div class="comparison-pane">
          <h4>Ordinary RAG-style retrieval</h4>
          ${flatHtml}
          <p class="api-help" style="margin:10px 0 0;">Flat keyword overlap only: no frame routing, no constraint gating, no trajectory selection.</p>
        </div>
        <div class="comparison-pane">
          <h4>TCog-R retrieval</h4>
          ${tcogHtml}
          <p class="api-help" style="margin:10px 0 0;">TCog-R decides which frame is active and whether an answer is admissible.</p>
        </div>
      </div>
    </details>
  `;
}

function renderGeneratedAnswerText(text, allowCitations = false) {
  if (!text) return '<p style="color:var(--ink-faint);"><em>No answer generated.</em></p>';
  let html = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
  html = `<p>${html}</p>`;
  return allowCitations ? renderCitations(html) : html;
}

function renderComparisonError(message) {
  const div = document.createElement('div');
  div.className = 'section section-G';
  div.innerHTML = `
    <div class="section-label"><span>Comparison unavailable</span></div>
    <div class="section-content">
      <p>${escapeHtml(message)}</p>
      <p style="font-size:13px; color:var(--ink-soft); margin-top:10px;">Add a key for the selected provider in the sidebar, then click <strong>Compare vanilla LLM vs TCog-R</strong> again.</p>
    </div>
  `;
  return div;
}

function renderTcogRawFallback(sections) {
  if (sections.sectionB_units && sections.sectionB_units.length > 0) {
    return sections.sectionB_units.map(renderCitedUnit).join('');
  }
  if (sections.sectionB_note) return `<p>${sections.sectionB_note}</p>`;
  return '<p style="color:var(--ink-faint);"><em>No package-bound claims are available.</em></p>';
}

function diagnosticValue(items, empty = 'none') {
  return items && items.length ? items.join(', ') : empty;
}

function renderDiagnosticRow(trace) {
  const trajectory = trace.matched_trajectories?.[0]?.trajectory?.id || 'none';
  return `
    <div class="diagnostic-row">
      <div class="diagnostic-field"><span>Active packages</span><strong>${escapeHtml(diagnosticValue((trace.active_packages || []).map(p => p.manifest.package_id)))}</strong></div>
      <div class="diagnostic-field"><span>Clusters</span><strong>${(trace.activated_clusters || []).length}</strong></div>
      <div class="diagnostic-field"><span>Constraints</span><strong>${escapeHtml(diagnosticValue((trace.triggered_constraints || []).map(t => t.constraint.id)))}</strong></div>
      <div class="diagnostic-field"><span>Trajectory</span><strong>${escapeHtml(trajectory)}</strong></div>
      <div class="diagnostic-field"><span>Suppressed</span><strong>${escapeHtml(diagnosticValue((trace.suppressed_packages || []).map(s => `${s.package_id} (${s.reason})`)))}</strong></div>
    </div>
  `;
}

function renderNormalAuditSummary(audit) {
  return `
    <div style="margin-top:16px; padding-top:14px; border-top:1px dotted var(--rule);">
      <div class="section-label" style="margin-bottom:8px;"><span>TCog audit of vanilla answer</span><span class="friendly-status">${escapeHtml(audit.verdict)}</span></div>
      <ul class="answer-why">${audit.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      <p style="font-size:13px; color:var(--ink-soft); margin-top:10px;"><strong>Suggested repair:</strong> ${escapeHtml(audit.suggested_repair || 'No repair required.')}</p>
    </div>
  `;
}

function renderAuditPanel(audit) {
  if (!audit) {
    return '<p style="color:var(--ink-faint);"><em>Audit was not available because the vanilla answer failed to generate.</em></p>';
  }
  const categories = [
    ['Missing constraints', audit.reasons.filter(r => /constraint/i.test(r))],
    ['Wrong frame', audit.reasons.filter(r => /frame|suppressed|overreach/i.test(r))],
    ['Unsupported claims', audit.reasons.filter(r => /unsupported|no clusters|package-bound claims/i.test(r))],
    ['Missing package citations', audit.reasons.filter(r => /citation/i.test(r))],
    ['Multi-frame conflict', audit.reasons.filter(r => /multi-frame|multiple packages|tradeoff|conflict/i.test(r))],
    ['Blocking constraint violation', audit.reasons.filter(r => /blocking/i.test(r))]
  ];
  const rows = categories.map(([label, matches]) =>
    `<li><strong>${escapeHtml(label)}:</strong> ${matches.length ? matches.map(escapeHtml).join(' ') : 'Not detected.'}</li>`
  ).join('');
  return `
    <p><span class="verdict-pill">${escapeHtml(audit.verdict)}</span></p>
    <ul class="answer-why">${rows}</ul>
    <p style="font-size:13px; color:var(--ink-soft); margin-top:10px;"><strong>Suggested repair:</strong> ${escapeHtml(audit.suggested_repair || 'No repair required.')}</p>
  `;
}

function renderAnswerComparisonCard({ query, trace, sections, normalResult, tcogResult, normalAudit, repairedResult }) {
  const div = document.createElement('div');
  div.className = 'section section-compare';

  const normalBody = normalResult.ok
    ? renderGeneratedAnswerText(normalResult.text, false)
    : `<p style="color:var(--warn);">${escapeHtml(normalResult.error)}</p>`;

  const tcogBody = tcogResult.ok
    ? renderGeneratedAnswerText(tcogResult.text, true)
    : `<p style="color:var(--warn);">${escapeHtml(tcogResult.error)}</p><div style="margin-top:10px;">${renderTcogRawFallback(sections)}</div>`;

  const repairedBody = repairedResult && repairedResult.ok
    ? renderGeneratedAnswerText(repairedResult.text, true)
    : `<p style="color:var(--warn);">${escapeHtml(repairedResult?.error || 'Repaired answer was not generated.')}</p>`;

  div.innerHTML = `
    <div class="section-label"><span>Vanilla LLM answer vs. TCog-R answer</span><span style="color:var(--ink-faint);">answer-level comparison</span></div>
    <p class="api-help" style="margin:0 0 14px;">The vanilla LLM answers directly from the prompt. TCog-R first routes the query through packages, clusters, constraints, trajectories, and frame checks, then composes the answer.</p>
    <div class="comparison-grid">
      <div class="comparison-pane">
        <h4>Vanilla LLM answer</h4>
        <div class="comparison-meta">Generated directly from the query · no package routing · no constraints · no trajectory · no package citations</div>
        <div class="comparison-answer">${normalBody}</div>
      </div>
      <div class="comparison-pane">
        <h4>TCog-R answer</h4>
        <div class="comparison-meta">Generated from mechanical retrieval trace · package-bound · constraint-aware · cites units when available</div>
        <div class="comparison-answer">${tcogBody}</div>
      </div>
      <div class="comparison-pane">
        <h4>TCog audit of vanilla answer</h4>
        <div class="comparison-meta">Checks constraints, frame fit, unsupported claims, package citations, multi-frame conflict, and blocking constraints</div>
        <div class="comparison-answer">${renderAuditPanel(normalAudit)}</div>
      </div>
      <div class="comparison-pane">
        <h4>Suggested repaired answer</h4>
        <div class="comparison-meta">Constrained by the TCog-R trace · cites retrieved units where possible · avoids suppressed packages</div>
        <div class="comparison-answer">${repairedBody}</div>
      </div>
    </div>
    ${renderDiagnosticRow(trace)}
    ${renderFlatRetrievalBaseline(query, trace)}
  `;
  attachCitationHandlers(div);
  return div;
}

// ============================================================================
// Optional: Compose with an LLM provider API
// ============================================================================
const COMPOSITION_MAX_OUTPUT_TOKENS = 4096;

function buildCompositionPrompt(query, trace) {
  const activatedBlock = (trace.active_packages || [])
    .map(p => `- ${p.manifest.package_id} (${p.manifest.domain || '—'}) — ${trace.activated_clusters.filter(a => a.package_id === p.manifest.package_id).length} cluster(s)`)
    .join('\n');

  const suppressedBlock = (trace.suppressed_packages || [])
    .map(s => `- ${s.package_id} [${s.reason}] — ${s.detail}`)
    .join('\n');

  const clustersBlock = (trace.activated_clusters || [])
    .map(a => `- ${a.cluster.id} (score ${a.score}) cues: ${(a.positive_matches || []).join(', ') || '(state-only)'}`)
    .join('\n');

  const constraintsBlock = (trace.triggered_constraints || []).map(t => {
    const c = t.constraint;
    return `- [${c.id}] (severity: ${c.severity}, blocks: ${!!c.blocks_answer}) ${c.rule} | Repair: ${c.repair} | from package: ${t.package_id}`;
  }).join('\n');

  const unitsBlock = (trace.units || []).map(u =>
    `[${u.id}] ${u.label}: ${u.definition} (anchor: ${(u.anchors && u.anchors[0]?.location) || ''})`
  ).join('\n');

  const trajBlock = trace.matched_trajectories[0]
    ? `${trace.matched_trajectories[0].trajectory.id} (${trace.matched_trajectories[0].trajectory.label}). Output template: ${(trace.matched_trajectories[0].trajectory.output_template || []).join(' → ')}`
    : '(no trajectory matched)';

  const frameBlock = (trace.frame_issues || [])
    .map(i => `- [${i.kind}] ${i.message}`).join('\n');

  const dispositionGuidance = {
    refuse_out_of_frame: 'The query is OUTSIDE every loaded package frame. Refuse cleanly: name the avoid_when matches, decline to answer from training, suggest a covering package. Section B should explicitly state no package-bound claims are available. Section D may briefly note an inference is unsafe.',
    no_match: 'No clusters matched. State this plainly. Section B has no claims; Section D may briefly say a grounded answer is not available from the loaded packages.',
    partial_with_blocking_constraints: 'Blocking constraints fired. Surface the value tradeoff in plain language. Prefer "TCog cannot reduce this to a simple yes/no" over refusal wording. Section B may surface only what cited units actually say. Do NOT let efficiency settle fairness unless the cited units support that. Section C lists constraints with repair questions.',
    normal_answer: 'Section B is the answer grounded in cited units, with [unit_id] for every factual claim. Section D may add inference beyond the units, but only if there is something genuinely useful to add — and it must be marked clearly as inference.'
  }[trace.disposition];

  const systemPrompt = `You are the composition layer of TCog-R, a package-bound mechanical retrieval system. You do NOT retrieve, choose packages, choose clusters, choose constraints, or judge relevance. Retrieval has been performed mechanically by the engine and the trace is given to you below. Your job is to phrase already-retrieved content as readable prose.

ABSOLUTE RULES:
1. Do NOT invent or add packages, clusters, constraints, or relevance judgments.
2. Suppressed packages must NOT contribute substantive claims.
3. Cite every factual claim by appending [package_id:unit_id] using exact IDs from the Retrieved units block.
4. Do NOT invent units, pull analogies from packages that did not activate, or smuggle in domain knowledge from training.
5. Prefer plain language over protocol labels. Do not output a protocol trace; the UI renders the mechanical trace separately.
6. Start with the answer, not with TCog internals.

DISPOSITION GUIDANCE: ${dispositionGuidance}`;

  const userPrompt = `User query: "${query}"

=== Disposition ===
${trace.disposition}

=== Activated packages ===
${activatedBlock || '(none)'}

=== Suppressed packages ===
${suppressedBlock || '(none)'}

=== Active clusters (in score order) ===
${clustersBlock || '(none)'}

=== Triggered constraints ===
${constraintsBlock || '(none)'}

=== Matched trajectory ===
${trajBlock}

=== Frame issues ===
${frameBlock || '(none)'}

=== Retrieved units (the ONLY claims you may cite) ===
${unitsBlock || '(none)'}

Compose a concise package-bound answer now. Do not add protocol trace sections.`;

  return { systemPrompt, userPrompt };
}

function buildNormalLLMPrompt(query) {
  return {
    systemPrompt: 'You are a helpful assistant. Answer the user\'s question directly and clearly. Do not mention TCog, packages, clusters, constraints, or retrieval traces.',
    userPrompt: query
  };
}

function tracePromptBlocks(trace) {
  return {
    activated: (trace.active_packages || [])
      .map(p => `- ${p.manifest.package_id} (${p.manifest.domain || '—'})`)
      .join('\n') || '(none)',
    suppressed: (trace.suppressed_packages || [])
      .map(s => `- ${s.package_id} [${s.reason}] ${s.detail || ''}`)
      .join('\n') || '(none)',
    constraints: (trace.triggered_constraints || [])
      .map(t => `- ${t.constraint.id} blocks=${!!t.constraint.blocks_answer}: ${t.constraint.rule || ''} Repair: ${t.constraint.repair || ''}`)
      .join('\n') || '(none)',
    units: (trace.units || [])
      .map(u => `- [${u.id}] ${u.label || ''}: ${u.definition || ''}`)
      .join('\n') || '(none)'
  };
}

function buildComparisonRepairPrompt(query, vanillaAnswer, trace, audit) {
  const blocks = tracePromptBlocks(trace);
  return {
    systemPrompt: `You write repaired answers constrained by a TCog-R retrieval trace. Cite exact retrieved unit ids where possible. Surface triggered constraints. Do not use suppressed packages. If a direct answer is blocked, mark uncertainty or ask the repair question instead of making a direct claim.`,
    userPrompt: `User query:
${query}

Vanilla LLM answer to repair:
${vanillaAnswer || '(not available)'}

TCog audit verdict:
${audit ? audit.verdict : '(audit unavailable)'}

TCog audit reasons:
${audit ? audit.reasons.map(r => `- ${r}`).join('\n') : '(none)'}

Suggested repair:
${audit ? audit.suggested_repair : '(none)'}

Activated packages:
${blocks.activated}

Suppressed packages:
${blocks.suppressed}

Triggered constraints:
${blocks.constraints}

Retrieved units:
${blocks.units}

Draft a concise repaired answer now.`
  };
}

async function parseProviderError(response) {
  const errText = await response.text();
  try {
    const errJson = JSON.parse(errText);
    return errJson.error?.message || errJson.message || errText;
  } catch (e) {
    return errText;
  }
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const chunks = [];
  for (const item of (data.output || [])) {
    for (const content of (item.content || [])) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function extractGeminiText(data) {
  return (data.candidates || [])
    .flatMap(c => c.content?.parts || [])
    .map(p => p.text || '')
    .filter(Boolean)
    .join('\n');
}

async function composeWithAnthropic(query, trace, apiKey, model) {
  const { systemPrompt, userPrompt } = buildCompositionPrompt(query, trace);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-opus-4-5',
      max_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const text = data.content.map(b => b.text || '').join('\n');
  return text;
}

async function normalWithAnthropic(query, apiKey, model) {
  const { systemPrompt, userPrompt } = buildNormalLLMPrompt(query);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-opus-4-5',
      max_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  return data.content.map(b => b.text || '').join('\n');
}

async function composeWithOpenAI(query, trace, apiKey, model) {
  const { systemPrompt, userPrompt } = buildCompositionPrompt(query, trace);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4.1',
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      store: false
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const text = extractOpenAIText(data);
  if (!text) throw new Error('API response did not include output text.');
  return text;
}

async function normalWithOpenAI(query, apiKey, model) {
  const { systemPrompt, userPrompt } = buildNormalLLMPrompt(query);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4.1',
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      store: false
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const text = extractOpenAIText(data);
  if (!text) throw new Error('API response did not include output text.');
  return text;
}

async function composeWithGemini(query, trace, apiKey, model) {
  const { systemPrompt, userPrompt } = buildCompositionPrompt(query, trace);
  const safeModel = encodeURIComponent(model || 'gemini-2.5-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: userPrompt }]
      }],
      generationConfig: {
        maxOutputTokens: COMPOSITION_MAX_OUTPUT_TOKENS
      }
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);
  if (!text) throw new Error('API response did not include output text.');
  const finishReason = data.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    return `${text}\n\n**Provider note**: Gemini stopped with finishReason=${finishReason}; this composition may be incomplete.`;
  }
  return text;
}

async function normalWithGemini(query, apiKey, model) {
  const { systemPrompt, userPrompt } = buildNormalLLMPrompt(query);
  const safeModel = encodeURIComponent(model || 'gemini-2.5-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: userPrompt }]
      }],
      generationConfig: {
        maxOutputTokens: COMPOSITION_MAX_OUTPUT_TOKENS
      }
    })
  });

  if (!response.ok) {
    const errMsg = await parseProviderError(response);
    throw new Error(`API error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);
  if (!text) throw new Error('API response did not include output text.');
  const finishReason = data.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    return `${text}\n\n**Provider note**: Gemini stopped with finishReason=${finishReason}; this answer may be incomplete.`;
  }
  return text;
}

async function composeWithProvider(provider, query, trace, sections, apiKey, model) {
  if (provider === 'openai') return composeWithOpenAI(query, trace, apiKey, model);
  if (provider === 'gemini') return composeWithGemini(query, trace, apiKey, model);
  return composeWithAnthropic(query, trace, apiKey, model);
}

async function normalWithProvider(provider, query, apiKey, model) {
  if (provider === 'openai') return normalWithOpenAI(query, apiKey, model);
  if (provider === 'gemini') return normalWithGemini(query, apiKey, model);
  return normalWithAnthropic(query, apiKey, model);
}

async function generatePromptWithProvider(provider, systemPrompt, userPrompt, apiKey, model) {
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4.1',
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
        store: false
      })
    });
    if (!response.ok) throw new Error(`API error (${response.status}): ${await parseProviderError(response)}`);
    const text = extractOpenAIText(await response.json());
    if (!text) throw new Error('API response did not include output text.');
    return text;
  }

  if (provider === 'gemini') {
    const safeModel = encodeURIComponent(model || 'gemini-2.5-flash');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: COMPOSITION_MAX_OUTPUT_TOKENS }
      })
    });
    if (!response.ok) throw new Error(`API error (${response.status}): ${await parseProviderError(response)}`);
    const text = extractGeminiText(await response.json());
    if (!text) throw new Error('API response did not include output text.');
    return text;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      max_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!response.ok) throw new Error(`API error (${response.status}): ${await parseProviderError(response)}`);
  return (await response.json()).content.map(b => b.text || '').join('\n');
}

// ============================================================================
// Claim Solidity Appraisal
// ============================================================================
// Appraisal maps each sentence to the existing TCog retrieval concepts:
// package support, constraint triggers, frame fit, and overreach suppression.
function splitIntoClaimSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function isClaimLikeSentence(sentence) {
  const tokens = tokenize(sentence);
  if (tokens.length < 5) return false;
  return /(\bis\b|\bare\b|\bwas\b|\bwere\b|\bwill\b|\bshould\b|\bmust\b|\bcan\b|\bcannot\b|\bcauses?\b|\bleads?\b|\bmeans?\b|\bproves?\b|\bshows?\b)/i.test(sentence) || tokens.length >= 8;
}

function traceHasSuppressedVocabulary(sentence, trace) {
  const sentNorm = normalize(sentence);
  return (trace.suppressed_packages || [])
    .filter(s => s.reason === 'suppressed_due_to_overreach')
    .some(suppressed => {
      const pkg = LOADED_PACKAGES.find(p => p.manifest.package_id === suppressed.package_id);
      return pkg && packageDomainVocabulary(pkg, suppressed).some(v => phraseMatchInQuery(v, sentNorm));
    });
}

function classifyClaimSentence(sentence, trace) {
  const blocking = (trace.triggered_constraints || []).filter(t => t.constraint.blocks_answer);
  const units = trace.units || [];
  const clusters = trace.activated_clusters || [];
  const multiFrame = (trace.active_packages || []).length > 1;
  const hasConstraints = (trace.triggered_constraints || []).length > 0;
  const misframed = traceHasSuppressedVocabulary(sentence, trace);

  if (blocking.length > 0) return 'BLOCKED';
  if (misframed) return 'MISFRAMED';
  if (units.length > 0 && (hasConstraints || multiFrame)) return 'PARTIAL';
  if (units.length >= 2 && clusters.length > 0) return 'SOLID';
  if (units.length > 0 || clusters.length > 0) return 'FRAGILE';
  if (isClaimLikeSentence(sentence)) return 'UNSUPPORTED';
  return 'FRAGILE';
}

function appraiseClaimSentence(sentence) {
  const trace = retrieve(sentence);
  const verdict = classifyClaimSentence(sentence, trace);
  return {
    sentence,
    trace,
    verdict,
    active_packages: (trace.active_packages || []).map(p => p.manifest.package_id),
    active_clusters: (trace.activated_clusters || []).map(a => a.cluster.id),
    triggered_constraints: (trace.triggered_constraints || []).map(t => t.constraint.id),
    units: trace.units || [],
    suggested_repair: suggestedClaimRepair(verdict, trace)
  };
}

function suggestedClaimRepair(verdict, trace) {
  if (verdict === 'BLOCKED') {
    const repairs = (trace.triggered_constraints || [])
      .filter(t => t.constraint.blocks_answer)
      .map(t => t.constraint.repair)
      .filter(Boolean);
    return repairs.length ? repairs.join(' ') : 'Convert the direct claim into a repair question before answering.';
  }
  if (verdict === 'MISFRAMED') return 'Separate the claim by frame and remove vocabulary from suppressed packages unless explicitly marked as excluded.';
  if (verdict === 'PARTIAL') return 'Surface the triggered constraint or multi-frame conflict before making the claim.';
  if (verdict === 'FRAGILE') return 'Soften the claim and cite package units only for the supported part.';
  if (verdict === 'UNSUPPORTED') return 'Mark this as unsupported by the loaded packages or load a package that covers the claim.';
  return 'Package-supported as written; cite retrieved unit ids where useful.';
}

function aggregateSolidityVerdict(claims) {
  const verdicts = claims.map(c => c.verdict);
  if (verdicts.includes('BLOCKED')) return 'BLOCKED';
  if (verdicts.includes('MISFRAMED')) return 'MISFRAMED';
  if (claims.length > 0 && verdicts.every(v => v === 'SOLID')) return 'SOLID';
  if (verdicts.includes('PARTIAL') || verdicts.includes('SOLID') || verdicts.includes('FRAGILE')) return 'PARTIAL';
  return 'UNSUPPORTED';
}

function appraiseClaimSolidity(text) {
  const claims = splitIntoClaimSentences(text)
    .filter(s => tokenize(s).length >= 5)
    .map(appraiseClaimSentence);

  const overall = aggregateSolidityVerdict(claims);

  const supportedCount = claims.filter(c => c.verdict === 'SOLID' || c.verdict === 'PARTIAL').length;
  const constraintCount = claims.filter(c => c.triggered_constraints.length > 0).length;
  const frameCount = claims.filter(c => c.verdict === 'MISFRAMED' || (c.trace.active_packages || []).length > 1).length;

  return {
    input: text,
    overall,
    claims,
    support_summary: claims.length
      ? `${supportedCount} of ${claims.length} claims package-supported or partially package-supported.`
      : 'No claim-like sentences were found.',
    constraint_summary: constraintCount
      ? `${constraintCount} claim${constraintCount !== 1 ? 's' : ''} constraint-triggered.`
      : 'No constraints triggered.',
    frame_fit_summary: frameCount
      ? `${frameCount} claim${frameCount !== 1 ? 's' : ''} frame-misaligned or multi-frame.`
      : 'No major frame misalignment detected.'
  };
}

function verdictClassLabel(verdict) {
  return {
    SOLID: 'Package-supported',
    PARTIAL: 'Constraint-triggered',
    FRAGILE: 'Package-supported, fragile',
    MISFRAMED: 'Frame-misaligned',
    UNSUPPORTED: 'Unsupported',
    BLOCKED: 'Blocked'
  }[verdict] || verdict;
}

function renderSolidityAppraisal(appraisal, repairedText = null) {
  const div = document.createElement('div');
  div.className = 'section section-compare';
  const rows = appraisal.claims.length
    ? appraisal.claims.map(c => `
      <tr>
        <td>${escapeHtml(c.sentence)}</td>
        <td>${escapeHtml(diagnosticValue(c.active_packages))}</td>
        <td>${escapeHtml(diagnosticValue(c.active_clusters.map(shortClusterId)))}</td>
        <td>${escapeHtml(diagnosticValue(c.triggered_constraints))}</td>
        <td><span class="verdict-pill">${escapeHtml(verdictClassLabel(c.verdict))}</span></td>
        <td>${escapeHtml(c.suggested_repair)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="6" style="color:var(--ink-faint);"><em>No claim-like sentences found.</em></td></tr>`;

  div.innerHTML = `
    <div class="section-label"><span>Claim Solidity Appraisal</span><span class="verdict-pill">${escapeHtml(verdictClassLabel(appraisal.overall))}</span></div>
    <div class="comparison-grid">
      <div class="comparison-pane">
        <h4>Support summary</h4>
        <p>${escapeHtml(appraisal.support_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Constraint summary</h4>
        <p>${escapeHtml(appraisal.constraint_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Frame-fit summary</h4>
        <p>${escapeHtml(appraisal.frame_fit_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Overall verdict</h4>
        <p><span class="verdict-pill">${escapeHtml(verdictClassLabel(appraisal.overall))}</span></p>
      </div>
    </div>
    <div style="overflow-x:auto; margin-top:14px;">
      <table class="claim-table">
        <thead>
          <tr>
            <th>Claim sentence</th>
            <th>Active packages</th>
            <th>Active clusters</th>
            <th>Triggered constraints</th>
            <th>Verdict</th>
            <th>Suggested repair</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${repairedText ? `<div style="margin-top:16px; padding-top:14px; border-top:1px dotted var(--rule);"><div class="section-label"><span>Repaired answer</span></div><div class="section-content">${renderGeneratedAnswerText(repairedText, true)}</div></div>` : ''}
  `;
  attachCitationHandlers(div);
  return div;
}

function renderClaimAppraisal(appraisal, repairedText = null) {
  return renderSolidityAppraisal(appraisal, repairedText);
}

function buildClaimRepairPrompt(appraisal) {
  const claimLines = appraisal.claims.map((c, idx) => {
    const unitIds = c.units.map(u => u.id).join(', ') || 'none';
    const unitDetails = c.units.map(u => `[${u.id}] ${u.label || ''}: ${u.definition || ''}`).join('\n') || 'none';
    return `${idx + 1}. ${c.sentence}
Verdict: ${c.verdict}
Active packages: ${diagnosticValue(c.active_packages)}
Triggered constraints: ${diagnosticValue(c.triggered_constraints)}
Retrieved unit ids: ${unitIds}
Retrieved units:
${unitDetails}
Suggested repair: ${c.suggested_repair}`;
  }).join('\n\n');

  return {
    systemPrompt: `Rewrite text using a Claim Solidity Appraisal. Unsupported claims must be softened. Missing constraints must be surfaced. Wrong-frame claims must be separated by frame. Package-supported claims should cite exact unit ids where available. Blocking constraints become repair questions instead of direct claims.`,
    userPrompt: `Original text:
${appraisal.input}

Overall verdict: ${appraisal.overall}
Support summary: ${appraisal.support_summary}
Constraint summary: ${appraisal.constraint_summary}
Frame-fit summary: ${appraisal.frame_fit_summary}

Claim appraisals:
${claimLines || '(no claim-like sentences)'}

Draft a repaired version now.`
  };
}

function buildSoliditySummaryPrompt(text, appraisalResult) {
  const claimRows = appraisalResult.claims.map((c, idx) => {
    const unitIds = c.units.map(u => u.id).join(', ') || 'none';
    return `${idx + 1}. Claim: ${c.sentence}
Verdict: ${c.verdict}
Active packages: ${diagnosticValue(c.active_packages)}
Active clusters: ${diagnosticValue(c.active_clusters)}
Triggered constraints: ${diagnosticValue(c.triggered_constraints)}
Unit ids: ${unitIds}
Suggested repair: ${c.suggested_repair}`;
  }).join('\n\n') || '(no claim-like sentences)';

  const unsupported = appraisalResult.claims
    .filter(c => c.verdict === 'UNSUPPORTED')
    .map(c => `- ${c.sentence}`)
    .join('\n') || '(none)';

  const misframed = appraisalResult.claims
    .filter(c => c.verdict === 'MISFRAMED')
    .map(c => `- ${c.sentence}`)
    .join('\n') || '(none)';

  const repairs = appraisalResult.claims
    .map(c => `- ${c.suggested_repair}`)
    .join('\n') || '(none)';

  return {
    systemPrompt: 'You are the prose-summary layer for TCog-R Claim Solidity Appraisal. The appraisal has already been computed mechanically. Do not perform new retrieval, do not add external knowledge, and do not change the verdict. Summarize the findings clearly for a human reader.',
    userPrompt: `Original text:
${text}

Overall verdict:
${appraisalResult.overall}

Support summary:
${appraisalResult.support_summary}

Constraint summary:
${appraisalResult.constraint_summary}

Frame-fit summary:
${appraisalResult.frame_fit_summary}

Claim table:
${claimRows}

Unsupported claims:
${unsupported}

Misframed claims:
${misframed}

Suggested repairs:
${repairs}

Write a readable summary. Do not add new claims. Do not perform new retrieval. Do not override the mechanical verdict. Separate package-supported findings from repair suggestions. Mention uncertainty where package support is absent. Use unit ids and constraint ids if included above.`
  };
}

async function summarizeSolidityWithProvider(appraisalResult) {
  const providerConfig = getSelectedProviderConfig();
  if (!providerConfig.apiKey) {
    throw new Error('Mechanical appraisal completed. Add a provider key to generate a readable LLM summary.');
  }
  const prompt = buildSoliditySummaryPrompt(appraisalResult.input, appraisalResult);
  return generatePromptWithProvider(
    providerConfig.provider,
    prompt.systemPrompt,
    prompt.userPrompt,
    providerConfig.apiKey,
    providerConfig.model
  );
}

function renderSoliditySummaryCard(summaryText) {
  const div = document.createElement('div');
  div.className = 'section section-D';
  div.dataset.soliditySummary = 'true';
  div.innerHTML = `
    <div class="section-label"><span>Readable summary</span><span style="color:var(--ink-faint);">Mechanical appraisal + LLM summary</span></div>
    <div class="section-content">
      <p style="color:var(--ink-soft); font-size:13px;"><em>Generated from mechanical appraisal; not a separate retrieval step.</em></p>
      ${renderGeneratedAnswerText(summaryText, true)}
    </div>
  `;
  attachCitationHandlers(div);
  return div;
}

// ============================================================================
// UI
// ============================================================================

// UNIT_MAP is rebuilt whenever packages change. Citations look up here.
const UNIT_MAP = {};
let LAST_RETRIEVAL = null;
let LAST_APPRAISAL = null;
let LAST_SOLIDITY_SUMMARY = null;
let LAST_SOLIDITY_NOTICE = null;

function rebuildUnitMap() {
  // Clear and repopulate from all loaded packages
  for (const k of Object.keys(UNIT_MAP)) delete UNIT_MAP[k];
  for (const pkg of LOADED_PACKAGES) {
    for (const u of (pkg.units || [])) {
      UNIT_MAP[u.id] = u;
    }
  }
}

function renderPackageList() {
  const container = document.getElementById('package-list');
  if (LOADED_PACKAGES.length === 0) {
    container.innerHTML = `<p style="color: var(--ink-faint); font-size: 12px; font-style: italic; margin: 0;">No packages loaded.</p>`;
    return;
  }
  let html = '';
  for (let i = 0; i < LOADED_PACKAGES.length; i++) {
    const pkg = LOADED_PACKAGES[i];
    const m = pkg.manifest;
    const ql = m.quality_level || 'extracted';
    const status = m.status || m.lifecycle_status || 'draft';
    const qlClass = ql === 'reviewed' ? 'status-vetted' : '';
    html += `
      <div style="border: 1px solid var(--rule); border-radius: 3px; padding: 8px 10px; margin-bottom: 6px; background: var(--paper);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; word-break: break-word; flex: 1;">${m.package_id}</div>
          <button data-rm="${i}" class="rm-pkg" style="background: none; border: none; color: var(--ink-faint); cursor: pointer; font-size: 14px; padding: 0; line-height: 1;" title="Remove">×</button>
        </div>
        <div style="font-size: 11px; color: var(--ink-soft); margin-top: 2px;">${m.domain || ''}</div>
        <div style="font-size: 10px; color: var(--ink-faint); margin-top: 4px; font-family: 'JetBrains Mono', monospace;">
          ${(pkg.units||[]).length}u · ${(pkg.clusters||[]).length}k · ${(pkg.constraints||[]).length}c · ${(pkg.trajectories||[]).length}tr
        </div>
        <div style="margin-top: 4px;">
          <span class="status-pill ${status === 'draft' ? 'status-draft' : 'status-vetted'}" style="font-size: 9px;">${status}</span>
          <span class="status-pill ${qlClass}" style="font-size: 9px; background: rgba(74,74,69,0.12); color: var(--ink-soft);">${ql}</span>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  // wire remove buttons
  for (const btn of container.querySelectorAll('.rm-pkg')) {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.rm);
      LOADED_PACKAGES.splice(idx, 1);
      rebuildUnitMap();
      refreshUI();
    });
  }
}

// Wraps renderPackageList + renderScenarios. Safe to call once both are
// defined (i.e., from any user-triggered handler, not from initial-load setup).
function refreshUI() {
  renderPackageList();
  if (typeof renderScenarios === 'function') renderScenarios();
}

rebuildUnitMap();
renderPackageList();

async function autoLoadPackagesFolder() {
  if (LOADED_PACKAGES.length > 0) return;
  showLoadStatus('Loading packages/ folder...', false);
  const result = await loadPackagesFolder();
  if (result.ok) {
    rebuildUnitMap();
    refreshUI();
    const msg = result.loaded > 0
      ? `Loaded ${result.loaded} package${result.loaded !== 1 ? 's' : ''} from packages/`
      : (result.note || 'Packages folder loaded');
    showLoadStatus(msg, false);
  } else {
    showLoadStatus(`Automatic packages/ load skipped: ${result.error}`, true);
  }
}

// Anchor popover handling
const popover = document.getElementById('anchor-popover');
function showPopover(unitId, x, y) {
  const u = UNIT_MAP[unitId];
  if (!u) return;
  const a = u.anchors && u.anchors[0];
  popover.innerHTML = `
    <div class="anc-loc">${a?.location || a?.source_id || 'anchor'}</div>
    <div><strong>${u.label}</strong></div>
    <div class="anc-excerpt">"${(a?.excerpt || u.definition).replace(/"/g, '&quot;')}"</div>
  `;
  popover.classList.remove('hidden');
  // Position
  const rect = popover.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;
  if (left + rect.width > window.innerWidth - 20) {
    left = window.innerWidth - rect.width - 20;
  }
  if (top + rect.height > window.innerHeight - 20) {
    top = y - rect.height - 10;
  }
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}
function hidePopover() { popover.classList.add('hidden'); }

// Render citation links — replace [unit_id] in text with clickable spans.
// Looks up the unit label so the citation can render as "Label [pkg:unit]"
// when the surrounding prose has not already named the unit.
function renderCitations(text) {
  if (!text) return '';
  return text.replace(/\[([a-zA-Z_][a-zA-Z_0-9]*:[a-zA-Z_][a-zA-Z_0-9]*)\]/g, (match, id) => {
    if (UNIT_MAP[id]) {
      const lbl = UNIT_MAP[id].label || id;
      return `<a class="citation" data-unit="${id}" title="${lbl.replace(/"/g,'&quot;')}">[${id}]</a>`;
    }
    return match;
  });
}

function attachCitationHandlers(container) {
  for (const el of container.querySelectorAll('.citation')) {
    el.addEventListener('mouseenter', e => {
      const r = e.target.getBoundingClientRect();
      showPopover(e.target.dataset.unit, r.left, r.bottom);
    });
    el.addEventListener('mouseleave', hidePopover);
    el.addEventListener('click', e => {
      e.preventDefault();
      // could expand to show anchor inline
    });
  }
}

// Update pipeline visualization
function updatePipeline(trace) {
  // Compute routing summary across packages
  const routings = trace.routing_per_package || [];
  const anyAvoid = routings.some(r => r.classification === 'avoid');
  const anyActivate = routings.some(r => r.classification === 'activate' || r.classification === 'candidate');
  const routeStr = routings.length === 0 ? '—' :
    anyAvoid && !anyActivate ? 'avoid' :
    anyActivate ? `${trace.active_packages.length}/${routings.length} pkgs` : 'check';

  const steps = {
    route: routeStr,
    cluster: `${trace.activated_clusters.length}`,
    units: `${trace.units.length}`,
    constraints: `${trace.triggered_constraints.length}`,
    trajectory: trace.matched_trajectories.length > 0 ? `${trace.matched_trajectories.length}` : '0',
    frame: `${trace.frame_issues.length}`,
    compose: trace.disposition.replace(/_/g, ' ')
  };
  for (const [step, count] of Object.entries(steps)) {
    const el = document.querySelector(`.step[data-step="${step}"]`);
    if (!el) continue;
    el.querySelector('.count').textContent = count;
    el.classList.add('active');
    if ((step === 'cluster' && trace.activated_clusters.length === 0) ||
        (step === 'units' && trace.units.length === 0) ||
        (step === 'constraints' && trace.triggered_constraints.length === 0) ||
        (step === 'trajectory' && trace.matched_trajectories.length === 0) ||
        (step === 'frame' && trace.frame_issues.length === 0)) {
      el.classList.add('skipped');
    }
  }
}

function resetPipeline() {
  for (const el of document.querySelectorAll('.step')) {
    el.classList.remove('active', 'skipped');
    el.querySelector('.count').textContent = '—';
  }
}

// Helper: short cluster id without the package prefix
function shortClusterId(id) {
  return id && id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

// Helper: render a unit citation as "Label — definition. [pkg:unit]"
function renderCitedUnit(s) {
  const lbl = s.label ? `<strong>${escapeHtml(s.label)}</strong> — ` : '';
  return `<p>${lbl}${escapeHtml(s.text)} <a class="citation" data-unit="${escapeHtml(s.cite)}" title="${escapeHtml(s.cite)}">[${escapeHtml(s.cite)}]</a></p>`;
}

function friendlyDisposition(disposition) {
  return {
    partial_with_blocking_constraints: 'Answer blocked until value tradeoff is surfaced',
    normal_answer: 'Package-grounded answer available',
    refuse_out_of_frame: 'Outside loaded package scope',
    no_match: 'No loaded package matched',
    no_packages_loaded: 'No packages loaded'
  }[disposition] || disposition.replace(/_/g, ' ');
}

function traceHasPackage(trace, pkgId) {
  return (trace.active_packages || []).some(p => p.manifest.package_id === pkgId);
}

function traceHasConstraint(trace, constraintId) {
  return (trace.triggered_constraints || []).some(t => t.constraint.id === constraintId);
}

function buildAnswerSummary(query, trace, sections) {
  const economics = traceHasPackage(trace, 'economics_core');
  const philosophy = traceHasPackage(trace, 'philosophy_ethics_core');
  const valueConflict = traceHasConstraint(trace, 'philosophy_ethics_core:c_surface_value_conflict');
  const q = normalize(query);
  const isRationingQuery = q.includes('ration') && q.includes('healthcare') && q.includes('ability') && q.includes('pay');

  if (isRationingQuery && economics && philosophy) {
    return {
      text: 'TCog does not reduce this to a simple yes/no. Rationing healthcare by ability to pay is an allocation mechanism under scarcity, but fairness is not determined by efficiency alone. The fairness judgment depends on the standard being used, such as medical need, urgency, expected benefit, equal access, or priority to the worst-off.',
      why: [
        'Economics frame: scarce healthcare resources require allocation.',
        'Ethics frame: efficiency and fairness are distinct values.',
        valueConflict
          ? 'Constraint triggered: the system must surface the value tradeoff instead of collapsing it into one answer.'
          : 'Constraint check: TCog keeps the value question separate from the efficiency question.'
      ],
      next: 'Choose a fairness standard, then TCog can analyze the policy under that standard.'
    };
  }

  if (trace.disposition === 'partial_with_blocking_constraints') {
    return {
      text: 'TCog can provide structure from the active packages, but it cannot reduce this to a direct answer until the blocking constraint is handled.',
      why: [
        `${trace.active_packages.length} package${trace.active_packages.length !== 1 ? 's' : ''} activated mechanically.`,
        `${trace.triggered_constraints.length} constraint${trace.triggered_constraints.length !== 1 ? 's' : ''} triggered.`,
        'The blocking constraint marks what must be specified before a confident direct answer is available.'
      ],
      next: 'Use the constraint repair question below to specify the missing standard or condition.'
    };
  }

  if (trace.disposition === 'normal_answer') {
    return {
      text: 'TCog found package-bound material for this query and can answer from the cited units below.',
      why: [
        `${trace.active_packages.length} package${trace.active_packages.length !== 1 ? 's' : ''} activated mechanically.`,
        `${trace.units.length} cited unit${trace.units.length !== 1 ? 's' : ''} were loaded from active clusters.`
      ],
      next: 'Read the package-bound answer, then inspect the protocol trace if you want to audit the retrieval path.'
    };
  }

  if (trace.disposition === 'no_match') {
    return {
      text: 'TCog did not find a loaded package frame that matches this query closely enough to provide package-bound claims.',
      why: ['No clusters passed the mechanical activation threshold.'],
      next: 'Load a package for this domain or rephrase using terms covered by the loaded packages.'
    };
  }

  return {
    text: sections.sectionG || 'TCog cannot answer from the currently loaded packages.',
    why: ['No package-bound answer is available from the current state.'],
    next: 'Load packages, then run the query again.'
  };
}

function renderAnswerSummaryCard(query, trace, sections) {
  const summary = buildAnswerSummary(query, trace, sections);
  const div = document.createElement('div');
  div.className = 'section section-summary';
  div.innerHTML = `
    <div class="section-label"><span>Answer Summary</span><span class="friendly-status">${escapeHtml(friendlyDisposition(trace.disposition))}</span></div>
    <div class="section-content">
      <p>${summary.text}</p>
      <p style="font-weight:600; margin-top:12px;">Why:</p>
      <ul class="answer-why">${summary.why.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
    </div>
  `;
  return { div, next: summary.next };
}

function renderPackageBoundCard(sections, composedText = null) {
  const div = document.createElement('div');
  div.className = 'section section-B';
  let body = '';

  if (composedText) {
    let html = composedText
      .replace(/\*\*Section A[^*]*\*\*/g, '')
      .replace(/\*\*Section B[^*]*\*\*/g, '')
      .replace(/\*\*Section C[^*]*\*\*/g, '<strong>Constraints:</strong>')
      .replace(/\*\*Section D[^*]*\*\*/g, '<strong>Synthesis beyond packages:</strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, ' ');
    body = `<div class="section-content"><p>${renderCitations(html)}</p></div>`;
  } else if (sections.sectionB_note) {
    body = `<div class="section-content"><p>${sections.sectionB_note}</p></div>`;
  } else if (sections.sectionB_units && sections.sectionB_units.length > 0) {
    body = '<div class="section-content">' + sections.sectionB_units.map(renderCitedUnit).join('') + '</div>';
  } else {
    body = `<div class="section-content"><p style="color:var(--ink-faint);"><em>No package-bound claims are available.</em></p></div>`;
  }

  div.innerHTML = `<div class="section-label"><span>Package-bound answer</span>${sections.sectionB_units ? `<span style="color:var(--ink-faint);">${sections.sectionB_units.length} cited unit${sections.sectionB_units.length !== 1 ? 's' : ''}</span>` : ''}</div>${body}`;
  attachCitationHandlers(div);
  return div;
}

function renderConstraintsCard(sections) {
  const div = document.createElement('div');
  div.className = 'section section-C';

  if (!sections.sectionC_constraints || sections.sectionC_constraints.length === 0) {
    div.innerHTML = `
      <div class="section-label"><span>Constraints and repairs</span></div>
      <div class="section-content"><p style="color:var(--ink-faint);"><em>No constraints triggered.</em></p></div>
    `;
    return div;
  }

  let html = `<div class="section-label"><span>Constraints and repairs</span><span style="color:var(--ink-faint);">${sections.sectionC_constraints.length}</span></div>`;
  for (const c of sections.sectionC_constraints) {
    html += `<div class="constraint">
      <div class="constraint-id">${escapeHtml(c.id)} ${c.blocks ? '· <strong style="color:var(--accent);">blocking</strong>' : ''} · severity ${escapeHtml(c.severity || '—')} · <span style="color:var(--accent-3);">${escapeHtml(c.package_id || '')}</span></div>
      <div class="constraint-rule">${escapeHtml(c.rule)}</div>
      <div class="constraint-repair">${escapeHtml(c.repair)}</div>
    </div>`;
  }
  div.innerHTML = html;
  return div;
}

function renderNextMoveCard(nextText) {
  const div = document.createElement('div');
  div.className = 'section section-next';
  div.innerHTML = `
    <div class="section-label"><span>Suggested next move</span></div>
    <div class="section-content"><p>${escapeHtml(nextText)}</p></div>
  `;
  return div;
}

function renderProtocolTraceDetails(sections) {
  const t = sections.sectionA_trace;
  const details = document.createElement('details');
  details.className = 'protocol-trace';

  if (!t) {
    details.innerHTML = `<summary>Full protocol trace</summary><div class="section section-A"><div class="section-content"><p>No trace is available.</p></div></div>`;
    return details;
  }

  const activatedHtml = t.activated_packages.length > 0
    ? '<ul class="trace-list">' + t.activated_packages.map(p =>
        `<li><code>${escapeHtml(p.id)}</code> <span style="color:var(--ink-faint);">(${escapeHtml(p.domain || '—')})</span> — ${p.cluster_count} cluster${p.cluster_count !== 1 ? 's' : ''}</li>`
      ).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No packages activated.</em></p>';

  const suppressedHtml = t.suppressed_packages.length > 0
    ? '<ul class="trace-list">' + t.suppressed_packages.map(p => {
        const tag = p.reason === 'suppressed_due_to_overreach' ? 'overreach' : 'avoid_when';
        return `<li><code>${escapeHtml(p.package_id)}</code> <span class="status-pill" style="background:rgba(184,92,0,0.10); color:var(--warn);">${tag}</span><div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(p.detail)}</div></li>`;
      }).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No packages suppressed.</em></p>';

  let clusterHtml = '';
  if (t.activated_clusters.length > 0) {
    clusterHtml = '<table class="cluster-table">';
    for (const cl of t.activated_clusters) {
      const pkgTag = cl.package_id ? `<span style="color:var(--accent-3);">${escapeHtml(cl.package_id)}</span>:` : '';
      clusterHtml += `<tr><td>${pkgTag}${escapeHtml(shortClusterId(cl.id))}</td><td>score ${cl.score} · cues: ${escapeHtml(cl.cues.join(', ')) || '(state-only)'}</td></tr>`;
    }
    clusterHtml += '</table>';
  } else {
    clusterHtml = '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No clusters above activation threshold.</em></p>';
  }

  const constraintsHtml = t.triggered_constraints.length > 0
    ? '<ul class="trace-list">' + t.triggered_constraints.map(c =>
        `<li><code>${escapeHtml(c.id)}</code> · severity ${escapeHtml(c.severity || '—')}${c.blocks ? ' · <strong style="color:var(--accent);">blocks_answer</strong>' : ''}</li>`
      ).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No constraints triggered.</em></p>';

  const trajHtml = t.matched_trajectory
    ? `<p style="margin:0; font-size:13px;"><code>${escapeHtml(t.matched_trajectory.id)}</code> — ${escapeHtml(t.matched_trajectory.label || '')} <span style="color:var(--ink-faint);">(score ${t.matched_trajectory.score})</span></p>`
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No trajectory matched.</em></p>';

  const issues = t.frame_conflicts.filter(i => i.kind !== 'multi_package_active');
  const frameParts = [];
  if (t.multi_frame) {
    frameParts.push(`<p style="margin:0 0 6px; color:var(--accent-3); font-size:13px;"><strong>Multi-frame activation:</strong> ${t.multi_frame.map(p => `<code>${escapeHtml(p.id)}</code>`).join(', ')}</p>`);
  }
  for (const i of issues) {
    frameParts.push(`<p style="margin:0 0 4px; font-size:13px;"><span style="color:var(--warn); font-family:monospace; font-size:11px;">[${escapeHtml(i.kind)}]</span> ${escapeHtml(i.message)}</p>`);
  }
  const frameHtml = frameParts.join('') || '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No frame conflicts.</em></p>';

  const citationHtml = sections.sectionB_units && sections.sectionB_units.length > 0
    ? '<ul class="trace-list">' + sections.sectionB_units.map(s => `<li><a class="citation" data-unit="${escapeHtml(s.cite)}">[${escapeHtml(s.cite)}]</a> ${escapeHtml(s.label || '')}</li>`).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No package-bound citations.</em></p>';

  const synthesisHtml = sections.sectionD_note || '<em>No synthesis beyond packages is shown before the package-bound answer.</em>';

  details.innerHTML = `
    <summary>Full protocol trace</summary>
    <div class="section section-A">
      <div class="section-label"><span>Full TCog Protocol Trace</span><span style="color:var(--ink-faint);">status: ${escapeHtml(friendlyDisposition(t.disposition))}</span></div>
      <div class="section-content">
        <div class="trace-row"><div class="trace-row-label">Activated packages</div><div class="trace-row-body">${activatedHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Suppressed packages</div><div class="trace-row-body">${suppressedHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Active clusters</div><div class="trace-row-body">${clusterHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Triggered constraints</div><div class="trace-row-body">${constraintsHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Matched trajectory</div><div class="trace-row-body">${trajHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Frame conflicts</div><div class="trace-row-body">${frameHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Package-bound citations</div><div class="trace-row-body">${citationHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Synthesis boundary</div><div class="trace-row-body">${synthesisHtml}</div></div>
      </div>
    </div>
  `;
  attachCitationHandlers(details);
  return details;
}

function renderRawResponse(trace, sections, query = '') {
  const out = document.getElementById('output');
  out.innerHTML = '';
  const summary = renderAnswerSummaryCard(query, trace, sections);
  out.appendChild(summary.div);
  out.appendChild(renderPackageBoundCard(sections));
  out.appendChild(renderConstraintsCard(sections));
  out.appendChild(renderNextMoveCard(summary.next));
  out.appendChild(renderProtocolTraceDetails(sections));
}

function renderComposedResponse(trace, sections, composedText, query = '') {
  const out = document.getElementById('output');
  out.innerHTML = '';
  const summary = renderAnswerSummaryCard(query, trace, sections);
  out.appendChild(summary.div);
  out.appendChild(renderPackageBoundCard(sections, composedText));
  out.appendChild(renderConstraintsCard(sections));
  out.appendChild(renderNextMoveCard(summary.next));
  out.appendChild(renderProtocolTraceDetails(sections));
}

function renderTrace(trace) {
  const traceCard = document.getElementById('last-trace');
  let activeClusters = '';
  for (const a of trace.activated_clusters.slice(0, 6)) {
    const shortId = a.cluster.id.split(':').slice(1).join(':');
    const pkgPrefix = a.package_id ? a.package_id.substring(0, 8) + ':' : '';
    activeClusters += `<div style="margin-bottom: 4px;"><code style="font-size: 11px;">${pkgPrefix}${shortId}</code> <span style="color: var(--ink-faint); font-size: 11px;">(${a.score})</span></div>`;
  }

  // Routing summary across packages
  const routings = trace.routing_per_package || [];
  let routingHtml = '';
  for (const r of routings) {
    let cls = r.classification;
    let color = cls === 'avoid' ? 'var(--warn)' : cls === 'activate' ? 'var(--accent-2)' : 'var(--ink-soft)';
    routingHtml += `<div style="font-size: 11px; font-family: monospace; color: ${color}; margin-bottom: 2px;">${r.package_id}: ${cls}</div>`;
  }

  let html = `
    <h3>Last query trace</h3>
    <div style="margin-bottom: 8px;">${routingHtml || '<span style="color: var(--ink-faint); font-size: 11px;">no routing yet</span>'}</div>
    <div class="field"><span>active pkgs</span><span>${trace.active_packages?.length || 0}</span></div>
    <div class="field"><span>clusters</span><span>${trace.activated_clusters.length}</span></div>
    <div class="field"><span>units</span><span>${trace.units.length}</span></div>
    <div class="field"><span>constraints</span><span>${trace.triggered_constraints.length}</span></div>
    <div class="field"><span>trajectory</span><span>${trace.matched_trajectories[0]?.trajectory.id.split(':').slice(1).join(':') || '—'}</span></div>
    <div class="field"><span>disposition</span><span style="font-size: 10px;">${trace.disposition}</span></div>
  `;
  if (activeClusters) {
    html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dotted var(--rule);">
      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin-bottom: 6px;">active clusters</div>
      ${activeClusters}
    </div>`;
  }
  traceCard.innerHTML = html;
}

function getSelectedProviderConfig() {
  const provider = document.querySelector('input[name="api-provider"]:checked').value;
  const labels = {
    anthropic: 'Claude',
    openai: 'ChatGPT',
    gemini: 'Gemini'
  };
  return {
    provider,
    label: labels[provider] || provider,
    apiKey: document.getElementById(`${provider}-api-key`).value.trim(),
    model: document.getElementById(`${provider}-model`).value.trim()
  };
}

function syncProviderPanels() {
  const { provider } = getSelectedProviderConfig();
  for (const panel of document.querySelectorAll('.api-provider-panel')) {
    panel.classList.toggle('active', panel.dataset.providerPanel === provider);
  }
}

// ---------------------------------------------------------------------------
// Wire up controls
// ---------------------------------------------------------------------------
async function runQuery() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;
  const providerConfig = getSelectedProviderConfig();
  const mode = document.querySelector('input[name="mode"]:checked').value;

  resetPipeline();
  const out = document.getElementById('output');

  // Step 1: mechanical retrieval (always, regardless of mode)
  const trace = retrieve(query);
  LAST_RETRIEVAL = { query, trace };
  updatePipeline(trace);
  renderTrace(trace);

  const sections = buildRawResponse(query, trace);

  if (mode === 'semantic_augmented' && providerConfig.apiKey) {
    out.innerHTML = `<div class="empty-state"><div class="marks">...</div><div class="loading-dots">Composing with ${providerConfig.label}</div></div>`;
    try {
      const composedText = await composeWithProvider(
        providerConfig.provider,
        query,
        trace,
        sections,
        providerConfig.apiKey,
        providerConfig.model
      );
      renderComposedResponse(trace, sections, composedText, query);
    } catch (e) {
      const errorHtml = `<div class="section section-G">
        <div class="section-label"><span><span class="marker">!</span>API error</span></div>
        <div class="section-content"><p>${escapeHtml(e.message)}</p>
        <p style="font-size: 13px; color: var(--ink-soft); margin-top: 12px;">Falling back to raw retrieval output:</p>
        </div>
      </div>`;
      renderRawResponse(trace, sections, query);
      out.insertAdjacentHTML('afterbegin', errorHtml);
    }
  } else {
    renderRawResponse(trace, sections, query);
  }
}

async function runAnswerComparison() {
  const query = document.getElementById('compare-query').value.trim();
  if (!query) return;

  const providerConfig = getSelectedProviderConfig();
  const out = document.getElementById('output');
  if (!providerConfig.apiKey) {
    out.innerHTML = '';
    out.appendChild(renderComparisonError('Comparison requires a provider API key because both sides are generated answers.'));
    return;
  }

  resetPipeline();
  out.innerHTML = `<div class="empty-state"><div class="marks">...</div><div class="loading-dots">Generating vanilla LLM answer and TCog-R answer</div></div>`;

  const trace = retrieve(query);
  LAST_RETRIEVAL = { query, trace };
  updatePipeline(trace);
  renderTrace(trace);
  const sections = buildRawResponse(query, trace);

  const [normalSettled, tcogSettled] = await Promise.allSettled([
    normalWithProvider(
      providerConfig.provider,
      query,
      providerConfig.apiKey,
      providerConfig.model
    ),
    composeWithProvider(
      providerConfig.provider,
      query,
      trace,
      sections,
      providerConfig.apiKey,
      providerConfig.model
    )
  ]);

  const normalResult = normalSettled.status === 'fulfilled'
    ? { ok: true, text: normalSettled.value }
    : { ok: false, error: `Vanilla LLM generation failed: ${normalSettled.reason?.message || normalSettled.reason}` };

  const tcogResult = tcogSettled.status === 'fulfilled'
    ? { ok: true, text: tcogSettled.value }
    : { ok: false, error: `TCog-R composition failed; showing raw retrieval output below. ${tcogSettled.reason?.message || tcogSettled.reason}` };

  const normalAudit = normalResult.ok ? auditDraftAnswer(query, normalResult.text, trace) : null;
  let repairedResult;
  try {
    const repairPrompt = buildComparisonRepairPrompt(query, normalResult.text || '', trace, normalAudit);
    const repaired = await generatePromptWithProvider(
      providerConfig.provider,
      repairPrompt.systemPrompt,
      repairPrompt.userPrompt,
      providerConfig.apiKey,
      providerConfig.model
    );
    repairedResult = { ok: true, text: repaired };
  } catch (e) {
    repairedResult = { ok: false, error: `Repaired answer generation failed: ${e.message}` };
  }

  out.innerHTML = '';
  out.appendChild(renderAnswerComparisonCard({
    query,
    trace,
    sections,
    normalResult,
    tcogResult,
    normalAudit,
    repairedResult
  }));
}

function runFlatBaseline() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;
  const trace = LAST_RETRIEVAL && LAST_RETRIEVAL.query === query
    ? LAST_RETRIEVAL.trace
    : retrieve(query);
  LAST_RETRIEVAL = { query, trace };
  updatePipeline(trace);
  renderTrace(trace);
  const out = document.getElementById('output');
  out.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'section section-compare';
  div.innerHTML = `
    <div class="section-label"><span>Optional flat retrieval baseline</span><span style="color:var(--ink-faint);">keyword overlap</span></div>
    ${renderFlatRetrievalBaseline(query, trace)}
  `;
  out.appendChild(div);
}

function renderDraftAuditResponse(query, trace, sections, audit) {
  const out = document.getElementById('output');
  out.innerHTML = '';
  out.appendChild(renderAuditCard(audit));
  const detail = document.createElement('div');
  detail.className = 'section section-audit';
  detail.innerHTML = `
    <div class="section-label"><span>Audit detail</span></div>
    <div class="section-content">${renderAuditPanel(audit)}</div>
  `;
  out.appendChild(detail);
  out.appendChild(renderConstraintsCard(sections));
  out.appendChild(renderNextMoveCard(audit.suggested_repair || 'Revise the draft according to the audit verdict.'));
  out.appendChild(renderProtocolTraceDetails(sections));
}

function runDraftAudit() {
  const query = document.getElementById('audit-query').value.trim();
  const draftAnswer = document.getElementById('draft-answer').value;
  if (!query) return;
  resetPipeline();
  const trace = retrieve(query);
  LAST_RETRIEVAL = { query, trace };
  updatePipeline(trace);
  renderTrace(trace);
  const sections = buildRawResponse(query, trace);
  const audit = auditDraftAnswer(query, draftAnswer, trace);
  renderDraftAuditResponse(query, trace, sections, audit);
}

function updateRepairedDraftButton() {
  const repairBtn = document.getElementById('draft-repaired');
  const summaryBtn = document.getElementById('summarize-appraisal');
  const providerConfig = getSelectedProviderConfig();
  if (repairBtn) repairBtn.disabled = !(LAST_APPRAISAL && providerConfig.apiKey);
  if (summaryBtn) summaryBtn.disabled = !(LAST_APPRAISAL && providerConfig.apiKey);
}

function renderCurrentSolidityOutput(repairedText = null) {
  const out = document.getElementById('output');
  out.innerHTML = '';
  if (LAST_SOLIDITY_NOTICE) out.appendChild(renderSmallErrorCard(LAST_SOLIDITY_NOTICE.title, LAST_SOLIDITY_NOTICE.message));
  if (LAST_SOLIDITY_SUMMARY) out.appendChild(renderSoliditySummaryCard(LAST_SOLIDITY_SUMMARY));
  out.appendChild(renderClaimAppraisal(LAST_APPRAISAL, repairedText));
}

async function runClaimAppraisal() {
  const text = document.getElementById('appraise-text').value.trim();
  if (!text) return;
  resetPipeline();
  const appraisal = appraiseClaimSolidity(text);
  LAST_APPRAISAL = appraisal;
  LAST_SOLIDITY_SUMMARY = null;
  LAST_SOLIDITY_NOTICE = null;
  renderCurrentSolidityOutput();
  updateRepairedDraftButton();

  if (document.getElementById('solidity-llm-summary').checked) {
    await summarizeCurrentAppraisal();
  }
}

function renderModeInputs() {
  return document.querySelector('input[name="workflow-mode"]:checked')?.value || 'solidity';
}

function setActiveMode(mode) {
  for (const input of document.querySelectorAll('input[name="workflow-mode"]')) {
    input.checked = input.value === mode;
  }
  for (const panel of document.querySelectorAll('[data-mode-panel]')) {
    panel.classList.toggle('hidden', panel.dataset.modePanel !== mode);
  }
  const out = document.getElementById('output');
  out.innerHTML = `<div class="empty-state"><div class="marks">→ → →</div>${escapeHtml(modeIntroText(mode))}</div>`;
  resetPipeline();
  updateRepairedDraftButton();
}

function modeIntroText(mode) {
  return {
    solidity: 'Paste text to appraise claim solidity',
    compare: 'Enter a query to compare Vanilla LLM and TCog-R answers',
    ask: 'Ask TCog-R to see package-bound retrieval in action',
    audit: 'Paste a query and draft answer to audit'
  }[mode] || 'Choose a mode to begin';
}

function renderSmallErrorCard(title, message) {
  const div = document.createElement('div');
  div.className = 'section section-G';
  div.dataset.solidityNotice = 'true';
  div.innerHTML = `
    <div class="section-label"><span>${escapeHtml(title)}</span></div>
    <div class="section-content"><p>${escapeHtml(message)}</p></div>
  `;
  return div;
}

function showSolidityNoticeAboveAppraisal(title, message) {
  LAST_SOLIDITY_NOTICE = { title, message };
  renderCurrentSolidityOutput();
}

function showSoliditySummaryAboveAppraisal(summaryText) {
  const out = document.getElementById('output');
  for (const old of out.querySelectorAll('[data-solidity-summary="true"]')) old.remove();
  out.insertBefore(renderSoliditySummaryCard(summaryText), out.firstChild);
}

async function summarizeCurrentAppraisal() {
  if (!LAST_APPRAISAL) return;
  const out = document.getElementById('output');
  const providerConfig = getSelectedProviderConfig();
  if (!providerConfig.apiKey) {
    showSolidityNoticeAboveAppraisal('Readable summary unavailable', 'Mechanical appraisal completed. Add a provider key to generate a readable LLM summary.');
    return;
  }
  out.insertAdjacentHTML('beforeend', `<div class="empty-state" id="summary-loading"><div class="marks">...</div><div class="loading-dots">Writing readable summary</div></div>`);
  try {
    LAST_SOLIDITY_SUMMARY = await summarizeSolidityWithProvider(LAST_APPRAISAL);
    LAST_SOLIDITY_NOTICE = null;
    const loading = document.getElementById('summary-loading');
    if (loading) loading.remove();
    showSoliditySummaryAboveAppraisal(LAST_SOLIDITY_SUMMARY);
  } catch (e) {
    const loading = document.getElementById('summary-loading');
    if (loading) loading.remove();
    showSolidityNoticeAboveAppraisal('Readable summary unavailable', e.message);
  }
}

async function draftRepairedVersion() {
  if (!LAST_APPRAISAL) return;
  const providerConfig = getSelectedProviderConfig();
  if (!providerConfig.apiKey) {
    updateRepairedDraftButton();
    return;
  }
  const out = document.getElementById('output');
  out.insertAdjacentHTML('afterbegin', `<div class="empty-state" id="repair-loading"><div class="marks">...</div><div class="loading-dots">Drafting repaired version</div></div>`);
  try {
    const prompt = buildClaimRepairPrompt(LAST_APPRAISAL);
    const repaired = await generatePromptWithProvider(
      providerConfig.provider,
      prompt.systemPrompt,
      prompt.userPrompt,
      providerConfig.apiKey,
      providerConfig.model
    );
    const loading = document.getElementById('repair-loading');
    if (loading) loading.remove();
    renderCurrentSolidityOutput(repaired);
  } catch (e) {
    const loading = document.getElementById('repair-loading');
    if (loading) loading.remove();
    out.insertAdjacentHTML('afterbegin', `<div class="section section-G"><div class="section-label"><span>Repair draft unavailable</span></div><div class="section-content"><p>${escapeHtml(e.message)}</p></div></div>`);
  }
}

for (const tab of document.querySelectorAll('input[name="api-provider"]')) {
  tab.addEventListener('change', () => {
    syncProviderPanels();
    updateRepairedDraftButton();
  });
}
syncProviderPanels();

for (const tab of document.querySelectorAll('input[name="workflow-mode"]')) {
  tab.addEventListener('change', () => setActiveMode(tab.value));
}

document.getElementById('run').addEventListener('click', runQuery);
document.getElementById('compare-rag').addEventListener('click', runAnswerComparison);
document.getElementById('appraise-claim').addEventListener('click', runClaimAppraisal);
document.getElementById('summarize-appraisal').addEventListener('click', summarizeCurrentAppraisal);
document.getElementById('draft-repaired').addEventListener('click', draftRepairedVersion);
document.getElementById('flat-baseline').addEventListener('click', runFlatBaseline);
document.getElementById('audit-draft').addEventListener('click', runDraftAudit);
for (const input of document.querySelectorAll('.api-key-input')) {
  input.addEventListener('input', updateRepairedDraftButton);
}
function clearActiveMode() {
  const mode = renderModeInputs();
  if (mode === 'solidity') {
    document.getElementById('appraise-text').value = '';
    LAST_APPRAISAL = null;
    LAST_SOLIDITY_SUMMARY = null;
    LAST_SOLIDITY_NOTICE = null;
  } else if (mode === 'compare') {
    document.getElementById('compare-query').value = '';
  } else if (mode === 'ask') {
    document.getElementById('query').value = '';
  } else if (mode === 'audit') {
    document.getElementById('audit-query').value = '';
    document.getElementById('draft-answer').value = '';
  }
  LAST_RETRIEVAL = null;
  updateRepairedDraftButton();
  document.getElementById('output').innerHTML = `<div class="empty-state"><div class="marks">→ → →</div>${escapeHtml(modeIntroText(mode))}</div>`;
  resetPipeline();
  document.getElementById('last-trace').innerHTML = `<h3>Last query trace</h3><p style="color: var(--ink-faint); font-size: 12px; font-style: italic; margin: 0;">Run a workflow to see the retrieval trace.</p>`;
}

for (const id of ['clear', 'clear-compare', 'clear-ask', 'clear-audit']) {
  document.getElementById(id).addEventListener('click', clearActiveMode);
}

function runActiveMode() {
  const mode = renderModeInputs();
  if (mode === 'solidity') return runClaimAppraisal();
  if (mode === 'compare') return runAnswerComparison();
  if (mode === 'ask') return runQuery();
  if (mode === 'audit') return runDraftAudit();
}

setActiveMode('solidity');

// Example chips
for (const chip of document.querySelectorAll('.example-chip')) {
  chip.addEventListener('click', () => {
    setActiveMode('ask');
    document.getElementById('query').value = chip.dataset.q;
    runQuery();
  });
}

// ============================================================================
// Scenario presets — curated demonstrations of architectural moves
// ============================================================================
// Each scenario lists the packages it requires; the UI shows whether they
// are loaded and (when applicable) offers to load missing ones from the
// packages/ folder. Scenarios are derived from the bundle's actual single
// and cross-package tests, so they are guaranteed to exercise something
// real about the architecture.
const SCENARIOS = [
  {
    group: 'TCog audit demos (architectural)',
    items: [
      {
        label: 'rationing healthcare (no chemistry overreach)',
        query: 'Is it efficient and fair to ration healthcare by ability to pay?',
        requires: ['economics_core', 'philosophy_ethics_core'],
        watch: 'Top card is Answer Summary. economics_core + philosophy_ethics_core activate; chemistry_interactions_core must not contribute claims. c_surface_value_conflict should trigger, and the collapsed trace remains below.'
      },
      {
        label: 'kolmogorov complexity (blocks_answer)',
        query: 'Compute the exact Kolmogorov complexity of 0101010101.',
        requires: ['kolmogorov_wiki'],
        watch: 'kolmogorov_wiki activates. Constraints include no_exact_K and specify_variant. Disposition blocks the exact answer. (kolmogorov_wiki is not in the default bundle; load it manually to run this test.)'
      },
      {
        label: 'grief via economics (overreach warning)',
        query: 'Analyze grief using economics. What is the opportunity cost of caring for someone?',
        requires: ['economics_core', 'philosophy_ethics_core', 'psychology_core', 'counselling_practice_core'],
        watch: 'economics_core may activate weakly via "opportunity cost"; philosophy/psychology/counselling should dominate. The audit trace shows economics activated but frame-limited by the human-centred packages.'
      },
      {
        label: 'quicksort vs Kolmogorov (no domain hijack)',
        query: 'What is the time complexity of quicksort? Is it related to Kolmogorov complexity?',
        requires: ['computer_science_systems_core'],
        watch: 'computer_science_systems_core handles Big-O / time complexity. kolmogorov_wiki (if loaded) only addresses the explicit Kolmogorov relation — it must not dominate the answer just because the word "complexity" appears.'
      }
    ]
  },
  {
    group: 'Single-package — focused tier',
    items: [
      {
        label: 'medicine: red flag',
        query: 'I have crushing chest pain for the last hour. What\'s wrong?',
        requires: ['medicine_diagnostic_safety_core'],
        watch: 'c_red_flag_safety_boundary fires (critical severity) — the package refuses ordinary differential-diagnosis reasoning and triages to emergency care.'
      },
      {
        label: 'philosophy: is/ought',
        query: 'Most cultures throughout history practiced X, so X must be morally acceptable.',
        requires: ['philosophy_ethics_core'],
        watch: 'c_separate_descriptive_normative fires — the descriptive premise does not license the normative conclusion.'
      },
      {
        label: 'economics: externality',
        query: "Our factory's pollution affects the neighborhood downstream.",
        requires: ['economics_core'],
        watch: 'k_externalities activates; cites Coase 1960 on social cost.'
      },
      {
        label: 'counselling: crisis',
        query: 'I want to kill myself tonight. I have a plan.',
        requires: ['counselling_practice_core'],
        watch: 'c_crisis_safety_override fires (critical severity) — the package refuses ordinary supportive-response reasoning and surfaces concrete crisis-line resources.'
      }
    ]
  },
  {
    group: 'Cross-package — frame surfacing',
    items: [
      {
        label: 'efficiency vs. fairness',
        query: 'Is it efficient and fair to ration healthcare by ability to pay?',
        requires: ['economics_core', 'philosophy_ethics_core'],
        watch: 'Both packages activate; c_surface_value_conflict fires — efficiency and fairness are not commensurable in a single calculation.'
      },
      {
        label: 'treatment with values',
        query: 'Should I sacrifice quality of life for longevity in this cancer treatment decision?',
        requires: ['medicine_diagnostic_safety_core', 'philosophy_ethics_core'],
        watch: 'medicine + philosophy both activate; the architecture surfaces the value-laden judgment rather than collapsing it into a clinical answer.'
      },
      {
        label: 'crisis blocks economics',
        query: 'I want to kill myself tonight. I have a plan. Should I take out a loan first?',
        requires: ['counselling_practice_core', 'economics_core'],
        watch: 'Crisis constraint trumps the financial framing — counselling\'s blocking constraint short-circuits ordinary economic reasoning.'
      },
      {
        label: 'clinical vs. counselling',
        query: 'I think I might have depression. Should I be on medication or try therapy?',
        requires: ['counselling_practice_core', 'medicine_diagnostic_safety_core'],
        watch: 'Both refuse direct clinical substitution and surface the need for a real provider relationship.'
      }
    ]
  }
];

function isPkgLoaded(pkgId) {
  return LOADED_PACKAGES.some(p => p.manifest && p.manifest.package_id === pkgId);
}

function renderScenarios() {
  const area = document.getElementById('scenarios-area');
  if (!area) return;
  let html = '';
  for (const group of SCENARIOS) {
    html += `<div class="scenario-group">`;
    html += `<div class="examples-label">${escapeHtml(group.group)}</div>`;
    for (let i = 0; i < group.items.length; i++) {
      const sc = group.items[i];
      const missing = sc.requires.filter(r => !isPkgLoaded(r));
      const allLoaded = missing.length === 0;
      const reqHtml = sc.requires.map(r => {
        const cls = isPkgLoaded(r) ? 'pkg-loaded' : 'pkg-missing';
        const sym = isPkgLoaded(r) ? '✓' : '○';
        return `<span class="${cls}" title="${cls === 'pkg-loaded' ? 'loaded' : 'not loaded'}">${sym} ${escapeHtml(r)}</span>`;
      }).join(' · ');
      const chipClass = allLoaded ? 'scenario-chip' : 'scenario-chip missing';
      const groupIdx = SCENARIOS.indexOf(group);
      html += `
        <div class="scenario-row">
          <span class="${chipClass}" data-group="${groupIdx}" data-item="${i}">${escapeHtml(sc.label)}</span>
          <span class="scenario-needs">${reqHtml}</span>
        </div>
        <div class="scenario-watch">${escapeHtml(sc.watch)}</div>
      `;
    }
    html += `</div>`;
  }
  area.innerHTML = html;

  // Wire chip clicks via delegation
  for (const chip of area.querySelectorAll('.scenario-chip')) {
    chip.addEventListener('click', onScenarioClick);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function onScenarioClick(e) {
  const groupIdx = parseInt(e.currentTarget.dataset.group);
  const itemIdx = parseInt(e.currentTarget.dataset.item);
  const sc = SCENARIOS[groupIdx].items[itemIdx];
  const missing = sc.requires.filter(r => !isPkgLoaded(r));

  if (missing.length === 0) {
    setActiveMode('ask');
    document.getElementById('query').value = sc.query;
    await runQuery();
    return;
  }

  // Offer to load missing packages from packages/
  showMissingPackagesBanner(sc, missing);
}

function showMissingPackagesBanner(scenario, missing) {
  const area = document.getElementById('scenarios-area');
  // Remove any existing banner
  const existing = document.getElementById('scenario-missing-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'scenario-missing-banner';
  banner.className = 'scenario-missing-banner';
  banner.innerHTML = `
    <div>This scenario needs: <span class="mono">${missing.map(escapeHtml).join(', ')}</span></div>
    <div style="margin-top: 6px;">
      <button class="btn btn-secondary" id="scenario-load-canonical">Load packages folder, then run</button>
      <button class="btn btn-secondary" id="scenario-cancel" style="margin-left: 4px;">Cancel</button>
    </div>
  `;
  area.insertBefore(banner, area.firstChild);

  document.getElementById('scenario-cancel').addEventListener('click', () => banner.remove());
  document.getElementById('scenario-load-canonical').addEventListener('click', async () => {
    banner.querySelector('div').textContent = `Loading packages folder...`;
    const result = await loadPackagesFolder();
    banner.remove();
    if (!result.ok) {
      showLoadStatus(`Could not load packages folder: ${result.error}`, true);
      return;
    }
    rebuildUnitMap();
    refreshUI();  // re-renders scenarios, which will now show ✓ for the loaded packages
    // Check again — scenarios may still be missing packages (e.g. if the bundle didn't contain them)
    const stillMissing = scenario.requires.filter(r => !isPkgLoaded(r));
    if (stillMissing.length > 0) {
      showLoadStatus(`Bundle loaded, but still missing: ${stillMissing.join(', ')}`, true);
      return;
    }
    setActiveMode('ask');
    document.getElementById('query').value = scenario.query;
    await runQuery();
  });
}

// ============================================================================
// Packages folder fetch
// ============================================================================
// Browsers cannot enumerate local folders by themselves. This loader supports:
// 1. packages/index.json containing ["file.zip", "package.combined.json"] or
//    { "files": [...] }
// 2. an HTTP directory listing, such as Python's `python3 -m http.server`
// 3. a known fallback bundle name for this demo.
const PACKAGES_DIR_URL = './packages/';
const FALLBACK_PACKAGE_FILES = [
  'tcog_field_basis_packages_v0_3_7.zip'
];

async function discoverPackageFiles() {
  const files = new Set();

  try {
    const resp = await fetch(PACKAGES_DIR_URL + 'index.json');
    if (resp.ok) {
      const manifest = await resp.json();
      const listed = Array.isArray(manifest) ? manifest : (manifest.files || []);
      for (const item of listed) {
        const name = typeof item === 'string' ? item : item?.path || item?.name;
        if (name && /\.(zip|json)$/i.test(name)) files.add(name.replace(/^\.?\/*/, ''));
      }
    }
  } catch (e) {
    // index.json is optional.
  }

  try {
    const resp = await fetch(PACKAGES_DIR_URL);
    if (resp.ok) {
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const a of doc.querySelectorAll('a[href]')) {
        const href = decodeURIComponent(a.getAttribute('href') || '');
        if (/^(?:\.\/)?[^?#]+\.(zip|json)(?:[?#].*)?$/i.test(href)) {
          files.add(href.replace(/^\.?\/*/, '').replace(/[?#].*$/, ''));
        }
      }
    }
  } catch (e) {
    // Directory listings may be disabled; fallback below covers the bundled demo.
  }

  for (const name of FALLBACK_PACKAGE_FILES) files.add(name);
  return [...files];
}

async function loadPackageUrl(relName) {
  const url = PACKAGES_DIR_URL + relName;
  const resp = await fetch(url);
  if (!resp.ok) {
    return { loaded: 0, failed: 1, errors: [`${url}: HTTP ${resp.status}`] };
  }

  if (/\.zip$/i.test(relName)) {
    const blob = await resp.blob();
    const fakeFile = new File([blob], relName.split('/').pop(), { type: 'application/zip' });
    return loadBundleZip(fakeFile);
  }

  const text = await resp.text();
  const result = loadPackageFromText(text, relName);
  return result.ok
    ? { loaded: 1, failed: 0, errors: [] }
    : { loaded: 0, failed: 1, errors: [result.error] };
}

async function loadPackagesFolder() {
  if (window.location.protocol === 'file:') {
    return {
      ok: false,
      error: 'the page is opened as a local file, and browsers block automatic fetch() access to neighboring files. Serve the code folder over http://localhost, or use "+ Load bundle" and select the zip manually.'
    };
  }

  let files;
  try {
    files = await discoverPackageFiles();
  } catch (e) {
    return { ok: false, error: e.message };
  }

  if (files.length === 0) {
    return { ok: false, error: 'no .zip or .json package files found in packages/' };
  }

  const errors = [];
  let loaded = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const result = await loadPackageUrl(file);
      loaded += result.loaded || 0;
      failed += result.failed || 0;
      errors.push(...(result.errors || []));
    } catch (e) {
      failed++;
      errors.push(`${file}: ${e.message}`);
    }
  }

  const duplicateOnly = errors.length > 0 && errors.every(e => e && e.includes('already loaded'));
  if (loaded > 0 || duplicateOnly || failed === 0) {
    return {
      ok: true,
      loaded,
      errors,
      note: loaded === 0 && duplicateOnly ? 'all package files were already loaded' : undefined
    };
  }

  return { ok: false, error: errors.join('; ') || 'no packages loaded' };
}

// Initial render of scenarios — both renderScenarios and the data are now defined
renderScenarios();
autoLoadPackagesFolder();

// Keyboard: Cmd/Ctrl+Enter to run
for (const input of document.querySelectorAll('.query-input')) {
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runActiveMode();
    }
  });
}

// ---------------------------------------------------------------------------
// Package loading
// ---------------------------------------------------------------------------

function validatePackageObject(obj) {
  if (!obj || typeof obj !== 'object') return 'not an object';
  if (!obj.manifest) return 'missing manifest';
  if (!obj.manifest.package_id) return 'manifest missing package_id';
  if (!Array.isArray(obj.units)) return 'units must be array';
  if (!Array.isArray(obj.clusters)) return 'clusters must be array';
  return null;  // valid
}

function isDuplicate(pkg) {
  return LOADED_PACKAGES.some(p => p.manifest.package_id === pkg.manifest.package_id);
}

function loadPackageFromText(text, sourceName) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${sourceName}: not valid JSON (${e.message})` };
  }
  const err = validatePackageObject(obj);
  if (err) return { ok: false, error: `${sourceName}: ${err}` };
  if (isDuplicate(obj)) {
    return { ok: false, error: `${sourceName}: ${obj.manifest.package_id} is already loaded` };
  }
  applyPackagePatch(obj);
  LOADED_PACKAGES.push(obj);
  return { ok: true, pkg_id: obj.manifest.package_id };
}

function showLoadStatus(message, isError) {
  const list = document.getElementById('package-list');
  // Insert a transient status banner above the list
  let banner = document.getElementById('load-status');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'load-status';
    banner.style.cssText = 'padding: 6px 8px; border-radius: 3px; font-size: 11px; margin-bottom: 8px; font-family: \'JetBrains Mono\', monospace;';
    list.parentElement.insertBefore(banner, list);
  }
  banner.style.background = isError ? 'rgba(184, 92, 0, 0.12)' : 'rgba(45, 74, 62, 0.12)';
  banner.style.color = isError ? 'var(--warn)' : 'var(--accent-2)';
  banner.textContent = message;
  setTimeout(() => { if (banner.parentElement) banner.remove(); }, 5000);
}

// Single-file JSON load (also accepts .zip and routes to bundle handler)
document.getElementById('pkg-file').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = '';  // allow re-loading same file
  if (files.length === 0) return;

  let loaded = 0, failed = 0;
  const errors = [];

  for (const file of files) {
    if (file.name.endsWith('.zip')) {
      // route through bundle loader
      const result = await loadBundleZip(file);
      loaded += result.loaded;
      failed += result.failed;
      errors.push(...result.errors);
    } else {
      const text = await file.text();
      const result = loadPackageFromText(text, file.name);
      if (result.ok) loaded++;
      else { failed++; errors.push(result.error); }
    }
  }

  rebuildUnitMap();
  refreshUI();

  let msg = `Loaded ${loaded} package${loaded !== 1 ? 's' : ''}`;
  if (failed > 0) msg += `, ${failed} failed`;
  showLoadStatus(msg, failed > 0);
  if (errors.length > 0) console.warn('Load errors:', errors);
});

// Bundle button — same input but suggest zip
document.getElementById('pkg-bundle-btn').addEventListener('click', () => {
  const input = document.getElementById('pkg-file');
  input.accept = '.zip';
  input.click();
  // Reset accept after click
  setTimeout(() => { input.accept = '.json,.zip'; }, 100);
});

// Bundle zip extraction using JSZip
async function loadBundleZip(file) {
  // Lazy-load JSZip from CDN
  if (typeof JSZip === 'undefined') {
    showLoadStatus('Loading zip library…', false);
    try {
      await loadJSZip();
    } catch (e) {
      return { loaded: 0, failed: 1, errors: ['Failed to load JSZip from CDN: ' + e.message] };
    }
  }

  let zipData;
  try {
    zipData = await JSZip.loadAsync(file);
  } catch (e) {
    return { loaded: 0, failed: 1, errors: [`${file.name}: not a valid zip (${e.message})`] };
  }

  const errors = [];
  let loaded = 0, failed = 0;

  // Find all package.combined.json files in the zip
  const combinedFiles = [];
  zipData.forEach((relPath, entry) => {
    if (relPath.endsWith('package.combined.json') && !entry.dir) {
      combinedFiles.push({ relPath, entry });
    }
  });

  if (combinedFiles.length === 0) {
    return { loaded: 0, failed: 1, errors: [`${file.name}: no package.combined.json files found in zip`] };
  }

  for (const { relPath, entry } of combinedFiles) {
    try {
      const text = await entry.async('string');
      const result = loadPackageFromText(text, relPath);
      if (result.ok) loaded++;
      else { failed++; errors.push(result.error); }
    } catch (e) {
      failed++;
      errors.push(`${relPath}: ${e.message}`);
    }
  }

  return { loaded, failed, errors };
}

function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (typeof JSZip !== 'undefined') return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('CDN load failed'));
    document.head.appendChild(script);
  });
}
