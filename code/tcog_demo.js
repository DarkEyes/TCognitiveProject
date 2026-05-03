
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

const PHYSICS_GRAVITY_TOKENS = [
  'gravity', 'gravitational', 'fall', 'falling', 'downward', 'above',
  'below', 'unsupported object', 'acceleration', 'local gravitational field',
  'near earth', 'near-earth', 'unsupported', 'accelerates', 'motion', 'force', 'mass'
];

// Deprecated PACKAGE_PATCHES vocabulary. Used ONLY by applyPackageIntegrationPatch
// to backfill statistics_core packages that ship without strict_domain_tokens.
// Runtime routing logic must NOT reference this constant directly — domain
// vocabulary belongs in package metadata. New packages should author their own
// strict_domain_tokens in the manifest instead.
const STATISTICS_CUE_TOKENS = [
  'statistics', 'statistical', 't-test', 't test', 'ttest',
  'hypothesis test', 'null hypothesis', 'alternative hypothesis',
  'p-value', 'p value', 'pvalue', 'test statistic',
  'degrees of freedom', 'confidence interval', 'statistical test',
  'significance test', 'inferential statistics', 'sample',
  'population', 'variance', 'standard error'
];

function ensureArrayUnique(arr, values) {
  for (const value of values) {
    if (!arr.some(existing => normalize(existing) === normalize(value))) arr.push(value);
  }
}

function applyPackageIntegrationPatch(pkg) {
  const id = pkg.manifest && pkg.manifest.package_id;
  if (!id) return;

  if (id === 'statistics_core') {
    const policy = pkg.manifest.activation_policy || (pkg.manifest.activation_policy = {});
    policy.strict_domain_tokens = policy.strict_domain_tokens || pkg.manifest.strict_domain_tokens || [];
    ensureArrayUnique(policy.strict_domain_tokens, STATISTICS_CUE_TOKENS);
    policy.activate_when = policy.activate_when || [];
    ensureArrayUnique(policy.activate_when, STATISTICS_CUE_TOKENS);

    const unitId = `${id}:u_statistical_hypothesis_tests`;
    if (!pkg.units.some(u => u.id === unitId)) {
      pkg.units.push({
        id: unitId,
        label: 'Statistical hypothesis tests',
        definition: 'T-tests, p-values, test statistics, confidence intervals, null hypotheses, and alternative hypotheses belong to inferential statistics and require explicit statistical framing.',
        status: 'draft',
        anchors: [{
          source_id: `${id}:package_authored_axiom`,
          location: 'package-authored draft unit',
          excerpt: 'Statistical test claims require inferential-statistics framing.'
        }]
      });
    }

    const clusterId = `${id}:k_statistical_hypothesis_tests`;
    if (!pkg.clusters.some(c => c.id === clusterId)) {
      pkg.clusters.push({
        id: clusterId,
        label: 'statistical hypothesis tests',
        description: 'Frames inferential-statistics claims about t-tests, p-values, null and alternative hypotheses, test statistics, confidence intervals, samples, and populations.',
        cues: STATISTICS_CUE_TOKENS.slice(),
        negative_cues: ['unit test', 'integration test', 'software test', 'regression test', 'test suite'],
        members: [unitId]
      });
    }
    return;
  }

  if (id !== 'physics_dynamical_constraints_core') return;
  const policy = pkg.manifest.activation_policy || (pkg.manifest.activation_policy = {});
  policy.strict_domain_tokens = policy.strict_domain_tokens || pkg.manifest.strict_domain_tokens || [];
  ensureArrayUnique(policy.strict_domain_tokens, PHYSICS_GRAVITY_TOKENS);
  policy.activate_when = policy.activate_when || [];
  ensureArrayUnique(policy.activate_when, PHYSICS_GRAVITY_TOKENS);

  const unitId = `${id}:u_local_gravity_scope`;
  if (!pkg.units.some(u => u.id === unitId)) {
    pkg.units.push({
      id: unitId,
      label: 'Local gravitational acceleration and scope',
      definition: 'Near Earth, an unsupported object accelerates relative to the local gravitational field; claims about falling require scope conditions such as reference frame, support, and local field.',
      status: 'draft',
      anchors: [{
        source_id: `${id}:package_authored_axiom`,
        location: 'package-authored draft unit',
        excerpt: 'Near-Earth falling claims require local gravitational field, support, and reference-frame scope.'
      }]
    });
  }

  const clusterId = `${id}:k_falling_under_gravity`;
  if (!pkg.clusters.some(c => c.id === clusterId)) {
    pkg.clusters.push({
      id: clusterId,
      label: 'falling under gravity / local gravitational field',
      description: 'Frames claims about falling, gravity, downward motion, unsupported objects, and local gravitational fields.',
      cues: PHYSICS_GRAVITY_TOKENS.slice(),
      members: [unitId]
    });
  }

  const constraintId = `${id}:c_scope_physical_universal_claims`;
  if (!pkg.constraints.some(c => c.id === constraintId)) {
    pkg.constraints.push({
      id: constraintId,
      label: 'physical universal claims require scope',
      rule: 'Unrestricted physical universal claims require scope conditions such as reference frame, support conditions, and local gravitational field.',
      repair: 'Specify the reference frame, whether the object is unsupported, and the local gravitational field or environment.',
      severity: 'medium',
      blocks_answer: false,
      trigger_cues: ['every', 'must', 'always', 'all', 'gravity', 'fall', 'falling'],
      related_clusters: [clusterId]
    });
  }
}

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

function queryIsNormativeOrEthical(query) {
  return query && /\b(should|ought|moral|morally|ethical|ethics|fair|fairness|justice|right|wrong|value|values|legitimate|good|bad)\b/i.test(query);
}

// Generic: does the query mention any of this package's authored strict-domain
// tokens? Domain vocabulary lives in package metadata; runtime logic stays
// generic.
function queryHitsPackageDomainTokens(query, pkg) {
  const tokens = getStrictDomainTokens(pkg);
  if (!tokens || tokens.length === 0) return false;
  const queryNorm = normalize(query || '');
  return tokens.some(t => phraseMatchInQuery(t, queryNorm));
}

function getPackageRole(query, pkg) {
  const role = pkg.manifest && pkg.manifest.package_role;
  const allowed = new Set(['primary_domain', 'auxiliary_checker', 'safety_gate', 'method_frame', 'unknown']);
  if (allowed.has(role)) return role;

  const id = pkg.manifest?.package_id || '';
  if (id === 'math_proof_core') return 'auxiliary_checker';
  // Generic: a method-frame package becomes primary only when its own strict
  // domain tokens appear in the query.
  if (id === 'statistics_core') return queryHitsPackageDomainTokens(query, pkg) ? 'primary_domain' : 'auxiliary_checker';
  if (id === 'philosophy_ethics_core') return queryIsNormativeOrEthical(query) ? 'primary_domain' : 'auxiliary_checker';
  if (id === 'physics_dynamical_constraints_core') return 'primary_domain';
  if (id === 'chemistry_interactions_core') return 'primary_domain';
  if (id === 'economics_core') return 'primary_domain';
  if (id === 'medicine_diagnostic_safety_core') return 'safety_gate';
  if (id === 'counselling_practice_core') return 'safety_gate';
  if (id === 'law_practice_core') return 'primary_domain';
  if (/\b(method|proof|logic|statistics|statistical|probability|epistemic)\b/i.test(id)) return 'method_frame';
  return 'primary_domain';
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
const CUE_STOPWORDS = new Set([
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'by', 'with',
  'and', 'or', 'but', 'as', 'at', 'from', 'this', 'that', 'it', 'its'
]);

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

function technicalTermVariants(term) {
  const norm = normalize(term);
  const variants = new Set(norm ? [norm] : []);
  const compactable = new Set(['t test', 'p value', 'chi square', 'f test']);
  if (compactable.has(norm)) variants.add(norm.replace(/\s+/g, ''));
  if (['ttest', 'pvalue', 'chisquare', 'ftest'].includes(norm)) {
    variants.add(norm);
    const spaced = {
      ttest: 't test',
      pvalue: 'p value',
      chisquare: 'chi square',
      ftest: 'f test'
    }[norm];
    variants.add(spaced);
  }
  return [...variants].filter(Boolean);
}

function isKnownTechnicalCompactCue(cueNorm) {
  return ['ttest', 'pvalue', 'chisquare', 'ftest'].includes(cueNorm.replace(/\s+/g, ''));
}

function genericSingleCueAllowed(cueNorm, queryNorm) {
  if (cueNorm !== 'test') return true;
  const softwareTestNeighbors = [
    'unit test', 'integration test', 'software test', 'regression test', 'test suite'
  ];
  return softwareTestNeighbors.some(term => phraseMatchInQuery(term, queryNorm));
}

function technicalCueMatches(cueNorm, queryNorm) {
  const cueVariants = technicalTermVariants(cueNorm);
  if (cueVariants.length <= 1 && !isKnownTechnicalCompactCue(cueNorm)) return false;
  const queryTokens = tokenize(queryNorm);
  const queryCompact = queryNorm.replace(/\s+/g, '');
  for (const variant of cueVariants) {
    if (variant.includes(' ')) {
      if (` ${queryNorm} `.includes(` ${variant} `)) return true;
    } else if (queryTokens.includes(variant) || queryCompact.includes(variant)) {
      return true;
    }
  }
  return false;
}

// Lemma match: "incentives" matches "incentive", "incentivizing" matches "incentive".
// Matching is intentionally one-way: query token may carry a suffix, but a
// short query token may not expand into a longer cue ("is" must not match "Iser").
function lemmaMatch(token, cue) {
  const t = normalize(token);
  const c = normalize(cue);
  if (!t || !c) return false;
  if (t === c) return true;
  if (CUE_STOPWORDS.has(t) || CUE_STOPWORDS.has(c)) return false;
  if (t.length < 4 || c.length < 4) return false;
  if (t.startsWith(c) && t.length > c.length) {
    const suffix = t.slice(c.length);
    if (['s','es','ed','ing','er','ly','ation','tion'].includes(suffix)) return true;
  }
  return false;
}

function phraseMatchDetails(cue, queryNormalized) {
  const cueNorm = normalize(cue);
  const queryNorm = normalize(queryNormalized);
  const queryTokens = tokenize(queryNorm);
  if (cueNorm.length === 0) {
    return { matched: false, reason: 'empty cue' };
  }
  const cueTokens = cueNorm.split(' ');
  const cueContentTokens = cueTokens.filter(t => !CUE_STOPWORDS.has(t));
  if (cueContentTokens.length === 0) {
    return { matched: false, reason: 'cue contains only stopwords' };
  }
  if (technicalCueMatches(cueNorm, queryNorm)) {
    return { matched: true, reason: 'technical term variant match' };
  }
  if (cueTokens.length === 1) {
    if (CUE_STOPWORDS.has(cueNorm)) {
      return { matched: false, reason: 'single-token cue is a stopword' };
    }
    if (!genericSingleCueAllowed(cueNorm, queryNorm)) {
      return { matched: false, reason: 'generic single-token cue lacks required domain neighbor' };
    }
    const matchedToken = queryTokens
      .filter(t => !CUE_STOPWORDS.has(t))
      .find(t => lemmaMatch(t, cueNorm));
    return matchedToken
      ? { matched: true, reason: `single-token lemma match: ${matchedToken}` }
      : { matched: false, reason: 'no non-stopword token matched cue' };
  }

  if (queryNorm.includes(cueNorm) && cueContentTokens.some(ct => queryTokens.some(qt => lemmaMatch(qt, ct)))) {
    return { matched: true, reason: 'multi-token phrase containment with content token match' };
  }

  // Multi-word cues are matched over their content words in order. Stopwords in
  // the cue may help readability, but cannot be the only reason a package fires.
  let qi = 0;
  for (const cueToken of cueContentTokens) {
    let found = false;
    while (qi < queryTokens.length) {
      const queryToken = queryTokens[qi++];
      if (CUE_STOPWORDS.has(queryToken)) continue;
      if (lemmaMatch(queryToken, cueToken)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return { matched: false, reason: `missing cue content token: ${cueToken}` };
    }
  }

  return { matched: true, reason: 'multi-token content words matched in order' };
}

// Phrase match: cue can be multi-word phrase
function phraseMatchInQuery(cue, queryNormalized) {
  return phraseMatchDetails(cue, queryNormalized).matched;
}

function debugCueMatch(cue, query) {
  const normalizedCue = normalize(cue);
  const normalizedQuery = normalize(query);
  const details = phraseMatchDetails(cue, query);
  return {
    cue,
    query,
    normalizedCue,
    normalizedQuery,
    queryTokens: tokenize(query),
    matched: details.matched,
    reason: details.reason
  };
}

if (typeof window !== 'undefined') {
  window.debugCueMatch = debugCueMatch;
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
    const tagMatch = tags.some(t => phraseMatchInQuery(t, queryNorm));
    const domainMatch = domain && phraseMatchInQuery(domain, queryNorm);
    classification = (tagMatch || domainMatch) ? 'candidate' : 'check_clusters';
  }

  return {
    package_id: pkg.manifest.package_id,
    classification,
    activate_matches: activateMatches,
    avoid_matches: avoidMatches
  };
}

function debugPackageCueMatches(query, packageId = null) {
  const queryNorm = normalize(query);
  return LOADED_PACKAGES
    .filter(pkg => !packageId || pkg.manifest.package_id === packageId)
    .map(pkg => {
      const routing = routeOnePackage(query, pkg);
      const gate = checkDomainGate(query, pkg);
      const clusters = activateClustersInPackage(query, pkg, routing).map(a => ({
        id: a.cluster.id,
        label: a.cluster.label,
        score: a.score,
        positive_matches: a.positive_matches,
        negative_matches: a.negative_matches,
        match_details: (a.positive_matches || []).map(cue => ({
          cue,
          ...phraseMatchDetails(cue, queryNorm)
        }))
      }));
      return {
        package_id: pkg.manifest.package_id,
        routing,
        strict_domain_gate: gate,
        activated_clusters: clusters
      };
    });
}

if (typeof window !== 'undefined') {
  window.debugPackageCueMatches = debugPackageCueMatches;
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
// Constraint firing policy (TCog Protocol v0.3.1, fixed 2026-05-03):
// A constraint fires when AND ONLY when at least one of:
//   1. one of its `trigger_cues` phrase-matches the query, OR
//   2. it is structurally implicated by an active trajectory (the trajectory's
//      `constraints` array names this constraint id).
// `related_clusters` membership and `applies_to` no longer drive firing on
// their own — they were over-firing constraints unrelated to the query when
// any cluster in the package activated. Both fields remain on the constraint
// object for documentation / audit; this just stops them from acting as fire
// triggers.
function checkConstraintsInPackage(query, activatedClusters, pkg, activeTrajectoryConstraintIds) {
  const queryNorm = normalize(query);
  const trajImplicated = activeTrajectoryConstraintIds instanceof Set
    ? activeTrajectoryConstraintIds
    : new Set(activeTrajectoryConstraintIds || []);

  const triggered = [];
  for (const c of (pkg.constraints || [])) {
    const reasons = [];

    const triggerCues = c.trigger_cues || [];
    const cueMatches = triggerCues.filter(t => phraseMatchInQuery(t, queryNorm));
    if (cueMatches.length > 0) reasons.push(`cues: ${cueMatches.join(', ')}`);

    if (trajImplicated.has(c.id)) reasons.push('trajectory-implicated');

    if (reasons.length > 0) {
      triggered.push({ constraint: c, reasons, package_id: pkg.manifest.package_id });
    }
  }
  return triggered;
}

// True if the package the constraint hit comes from is marked
// `safety_critical: true` in its manifest. Manifests without the flag are
// treated as non-safety-critical (default false).
function isPackageSafetyCritical(pkg) {
  return !!(pkg && pkg.manifest && pkg.manifest.safety_critical === true);
}

function isSafetyCriticalConstraintHit(triggeredConstraintHit) {
  if (!triggeredConstraintHit) return false;
  // Hit may carry a package_id (from checkConstraintsInPackage); look up the
  // package from LOADED_PACKAGES so we read the live manifest.
  const pkgId = triggeredConstraintHit.package_id;
  const pkg = pkgId
    ? LOADED_PACKAGES.find(p => p.manifest && p.manifest.package_id === pkgId)
    : null;
  return isPackageSafetyCritical(pkg);
}

// Active trajectory implication: gather the set of constraint ids named by
// any trajectory whose path/cues currently match.
function constraintIdsImplicatedByTrajectories(matchedTrajectories) {
  const ids = new Set();
  for (const m of matchedTrajectories || []) {
    const tr = m && m.trajectory;
    if (!tr) continue;
    const cs = tr.constraints || tr.constraint_ids || [];
    for (const cid of cs) if (typeof cid === 'string') ids.add(cid);
  }
  return ids;
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
    suppressed_packages: [],     // packages mechanically suppressed (avoid / overreach)
    domain_coverage_gaps: [],    // primary-domain tokens matched but no clusters fired
    covers_routing: null,        // covers pre-pass result (TCog Protocol v0.3.1 §4.4)
    frame_roles: null            // assigned after activation, before rendering
  };

  if (LOADED_PACKAGES.length === 0) {
    trace.disposition = 'no_packages_loaded';
    return trace;
  }

  // Covers-routed pre-pass (definitional/procedural queries only). Skipped
  // cleanly for other query classes and for pipelines without covers metadata.
  trace.covers_routing = coversRoute(query);

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
    // Domain-gate (overreach) check. Tentatively activate first to expose
    // generic cue matches that would have activated without strict gating. If
    // nothing in the package matched at all, keep it out of suppressed output;
    // it did not participate in the retrieval decision.
    const gate = checkDomainGate(query, pkg);
    if (!gate.passes) {
      const tentative = activateClustersInPackage(query, pkg, routing);
      if (tentative.length === 0) continue;
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
    if (activated.length === 0 && gate.matched.length > 0 && getPackageRole(query, pkg) === 'primary_domain') {
      trace.domain_coverage_gaps.push({
        package_id: pkg.manifest.package_id,
        domain: pkg.manifest.domain || '',
        matched_tokens: gate.matched,
        reason: 'domain_detected_no_cluster',
        detail: `The query appears to involve ${pkg.manifest.domain || pkg.manifest.package_id}, but no ${pkg.manifest.package_id} cluster matched mechanically.`
      });
    }
    for (const a of activated) {
      a.package_id = pkg.manifest.package_id;
      a.package = pkg;
      const domainBonus = getPackageRole(query, pkg) === 'primary_domain' && gate.matched.length > 0 ? 2 : 0;
      if (domainBonus) {
        a.frame_bonus = domainBonus;
        a.score += domainBonus;
      }
      allActivated.push(a);
    }
  }

  // Take top 7 across all packages
  allActivated.sort((a, b) => b.score - a.score);
  trace.activated_clusters = allActivated.slice(0, 7);

  // Track which packages contributed
  const activePkgIds = new Set(trace.activated_clusters.map(a => a.package_id));
  // Covers-routed packages augment the candidate set even if no cluster fired
  // for them — covers explicitly addresses the cue-based blind spot for bare
  // definitional phrasings. avoid_when has already excluded suppressed packages
  // in coversRoute(), so this is safe.
  if (trace.covers_routing && trace.covers_routing.matches.length) {
    for (const m of trace.covers_routing.matches) activePkgIds.add(m.package_id);
  }
  trace.active_packages = LOADED_PACKAGES.filter(p => activePkgIds.has(p.manifest.package_id));

  // Step 3: Load units from each package's contributing clusters
  for (const pkg of trace.active_packages) {
    const pkgClusters = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    const units = loadUnitsForPackage(pkgClusters, pkg);
    trace.units.push(...units);
  }

  // Step 4 (was 5): Match trajectories per package — runs BEFORE constraint
  // checking so trajectory-implicated constraint ids can drive firing.
  for (const pkg of LOADED_PACKAGES) {
    const pkgActivated = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    if (pkgActivated.length === 0) continue;
    const matches = matchTrajectoriesInPackage(query, pkgActivated, pkg);
    trace.matched_trajectories.push(...matches);
  }
  trace.matched_trajectories.sort((a, b) => b.score - a.score);
  trace.matched_trajectories = trace.matched_trajectories.slice(0, 2);  // up to 2 across packages
  const trajectoryImplicatedConstraintIds = constraintIdsImplicatedByTrajectories(trace.matched_trajectories);

  // Step 5 (was 4): Check constraints per package — fires only on trigger_cue
  // match against the query or on trajectory implication. Active-cluster
  // membership alone does NOT fire a constraint (TCog Protocol v0.3.1 fix).
  for (const pkg of LOADED_PACKAGES) {
    const pkgActivated = trace.activated_clusters.filter(a => a.package_id === pkg.manifest.package_id);
    if (pkgActivated.length === 0) continue;
    const triggered = checkConstraintsInPackage(query, pkgActivated, pkg, trajectoryImplicatedConstraintIds);
    trace.triggered_constraints.push(...triggered);
  }

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

  trace.frame_roles = assignFrameRoles(query, trace);
  trace.units = orderUnitsByFrameRole(trace.units, trace);

  // Determine response disposition
  const blocking = trace.triggered_constraints.filter(t => t.constraint.blocks_answer);
  // Safety-critical block detection: a blocking constraint from a package
  // whose manifest has `safety_critical: true` cannot be user-overridden.
  trace.safety_critical_blocked = blocking.some(t => isSafetyCriticalConstraintHit(t));
  trace.bypassed_blocking_constraints = []; // populated only on user override
  trace.user_overridden = false;
  const allAvoided = trace.routing_per_package.length > 0 &&
                     trace.routing_per_package.every(r => r.classification === 'avoid');
  const noClusters = trace.activated_clusters.length === 0;

  const onlyAuxiliary = trace.active_packages.length > 0 &&
    trace.active_packages.every(p => getPackageRole(query, p) === 'auxiliary_checker' || getPackageRole(query, p) === 'method_frame');

  if (allAvoided) {
    trace.disposition = 'refuse_out_of_frame';
  } else if (noClusters) {
    trace.disposition = 'no_match';
  } else if (onlyAuxiliary) {
    trace.disposition = 'auxiliary_only';
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

function unitPackageId(unit) {
  return String(unit.id || '').split(':')[0];
}

function orderUnitsByFrameRole(units, trace) {
  const roles = trace.frame_roles || {};
  const primary = new Set((roles.primary_frames || []).map(f => f.package_id));
  const safety = new Set((roles.safety_frames || []).map(f => f.package_id));
  const auxiliary = new Set((roles.auxiliary_frames || []).map(f => f.package_id));
  return (units || []).slice().sort((a, b) => {
    const rank = (u) => {
      const pkg = unitPackageId(u);
      if (primary.has(pkg)) return 0;
      if (safety.has(pkg)) return 1;
      if (auxiliary.has(pkg)) return 3;
      return 2;
    };
    return rank(a) - rank(b);
  });
}

function detectDomainCoverageGaps(trace) {
  return trace.domain_coverage_gaps || [];
}

function friendlyFrameRoleSummary(trace) {
  const roles = trace.frame_roles || {};
  const list = (items) => items && items.length ? items.map(f => f.package_id).join(', ') : 'none';
  return {
    primary: list(roles.primary_frames || []),
    auxiliary: list(roles.auxiliary_frames || []),
    safety: list(roles.safety_frames || []),
    suppressed: list(roles.suppressed_frames || []),
    gaps: detectDomainCoverageGaps(trace)
  };
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
    frame_roles: trace.frame_roles || null,
    domain_coverage_gaps: detectDomainCoverageGaps(trace),
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
    const gaps = detectDomainCoverageGaps(trace);
    if (gaps.length > 0) {
      sections.sectionB_note = gaps.map(g => escapeHtml(g.detail)).join(' ');
    } else {
      const pkgIds = LOADED_PACKAGES.map(p => p.manifest.package_id).join(', ');
      sections.sectionB_note = `No clusters in any loaded package (${pkgIds}) matched terms in this query above the activation threshold. No package-bound claims are available from the current package set.`;
    }
  } else if (trace.disposition === 'auxiliary_only') {
    sections.sectionB_note = `Only generic checker frames activated. TCog-R did not find a primary domain frame for this query.`;
  } else {
    sections.sectionB_units = unitsToCitedSentences(orderUnitsByFrameRole(trace.units, trace));
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
      model: model || 'claude-haiku-4-5',
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
      model: model || 'claude-haiku-4-5',
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
      model: model || 'claude-haiku-4-5',
      max_tokens: COMPOSITION_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!response.ok) throw new Error(`API error (${response.status}): ${await parseProviderError(response)}`);
  return (await response.json()).content.map(b => b.text || '').join('\n');
}

// ============================================================================
// LLM-guided TCog-R pipeline
// ============================================================================
// Pipeline: query → query understanding → broad mechanical candidate retrieval
// → LLM candidate selection → mechanical validation → constraint gate → answer.
//
// LLM interprets language and selects among candidates; TCog-R packages and
// constraint gates remain authoritative. The LLM may NOT retrieve from training
// memory, invent ids, override blocks_answer constraints, or use suppressed
// packages as evidence.
// ============================================================================

// Robust JSON extraction: providers sometimes wrap JSON in code fences or add
// preface text. Returns a parsed object or throws.
function parseLLMJsonStrict(text) {
  if (!text) throw new Error('Empty LLM response.');
  let trimmed = String(text).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) trimmed = fence[1].trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error('LLM response was not valid JSON.');
  }
}

// ---------- TASK 2: query understanding ----------
function buildQueryUnderstandingPrompt(query) {
  const systemPrompt = `You are the query-understanding layer for TCog-R. Your job is to propose retrieval guidance only. Do not answer the user. Do not add external facts. Do not invent package ids. Return JSON only.`;
  const userPrompt = `User query:
${query}

Return ONLY a JSON object with this exact shape (no prose, no code fences):

{
  "interpreted_query": "",
  "domain_hints": [],
  "must_include_terms": [],
  "must_exclude_frames": [],
  "auxiliary_checks": [],
  "search_queries": []
}

Field guidance:
- interpreted_query: a concise restatement of what the user is asking.
- domain_hints: short domain labels you think are relevant (e.g. "healthcare policy", "ethics", "statistics"). Use natural language; do not invent package ids.
- must_include_terms: keywords or phrases that should drive retrieval (lowercase preferred).
- must_exclude_frames: domain labels that would be misleading here (e.g. "art aesthetics" for a healthcare query).
- auxiliary_checks: side checks the answer should consider (e.g. "fairness", "uncertainty").
- search_queries: 1–4 alternative phrasings to broaden mechanical retrieval. Each should be a complete short phrase.

Return JSON only.`;
  return { systemPrompt, userPrompt };
}

// ---------- TASK 3: broad mechanical candidate retrieval ----------
function mergeCandidateById(target, items, key = 'id') {
  for (const item of items || []) {
    const k = item && item[key];
    if (!k) continue;
    if (!target.some(x => x[key] === k)) target.push(item);
  }
}

function flattenConstraints(trace) {
  return (trace.triggered_constraints || []).map(t => {
    const pkg = LOADED_PACKAGES.find(p => p.manifest.package_id === t.package_id);
    return {
      id: t.constraint.id,
      label: t.constraint.label || '',
      rule: t.constraint.rule || '',
      repair: t.constraint.repair || '',
      severity: t.constraint.severity || '',
      blocks_answer: !!t.constraint.blocks_answer,
      package_id: t.package_id,
      safety_critical: isPackageSafetyCritical(pkg)
    };
  });
}

function flattenUnits(trace) {
  return (trace.units || []).map(u => ({
    id: u.id,
    label: u.label || '',
    definition: u.definition || '',
    package_id: unitPackageId(u),
    anchors: u.anchors || []
  }));
}

function flattenClusters(trace) {
  return (trace.activated_clusters || []).map(a => ({
    id: a.cluster.id,
    label: a.cluster.label || '',
    package_id: a.package_id,
    score: a.score,
    cues: a.positive_matches || []
  }));
}

function flattenTrajectories(trace) {
  return (trace.matched_trajectories || []).map(t => ({
    id: t.trajectory.id,
    label: t.trajectory.label || '',
    score: t.score,
    output_template: t.trajectory.output_template || []
  }));
}

function flattenPackages(trace) {
  return (trace.active_packages || []).map(p => ({
    id: p.manifest.package_id,
    domain: p.manifest.domain || ''
  }));
}

function flattenSuppressed(trace) {
  return (trace.suppressed_packages || []).map(s => ({
    package_id: s.package_id,
    domain: s.domain || '',
    reason: s.reason,
    detail: s.detail
  }));
}

function flattenFrameIssues(trace) {
  return (trace.frame_issues || []).map(i => ({
    kind: i.kind,
    message: i.message
  }));
}

function retrieveWithGuidance(query, guidance) {
  const baseTrace = retrieve(query);
  const traces = [baseTrace];
  const seenQueries = new Set([normalize(query || '')]);
  const searchQueries = Array.isArray(guidance?.search_queries) ? guidance.search_queries : [];
  for (const sq of searchQueries) {
    if (typeof sq !== 'string') continue;
    const normSq = normalize(sq);
    if (!normSq || seenQueries.has(normSq)) continue;
    seenQueries.add(normSq);
    traces.push(retrieve(sq));
  }

  const payload = {
    query,
    guidance: guidance || {},
    candidate_packages: [],
    candidate_clusters: [],
    candidate_units: [],
    candidate_constraints: [],
    candidate_trajectories: [],
    suppressed_packages: [],
    frame_issues: [],
    covers_matches: [],
    covers_query_class: null,
    covers_target: null,
    mechanical_traces: []
  };

  for (const t of traces) {
    mergeCandidateById(payload.candidate_packages, flattenPackages(t), 'id');
    mergeCandidateById(payload.candidate_clusters, flattenClusters(t), 'id');
    mergeCandidateById(payload.candidate_units, flattenUnits(t), 'id');
    mergeCandidateById(payload.candidate_constraints, flattenConstraints(t), 'id');
    mergeCandidateById(payload.candidate_trajectories, flattenTrajectories(t), 'id');
    for (const s of flattenSuppressed(t)) {
      if (!payload.suppressed_packages.some(x => x.package_id === s.package_id && x.reason === s.reason)) {
        payload.suppressed_packages.push(s);
      }
    }
    for (const f of flattenFrameIssues(t)) {
      if (!payload.frame_issues.some(x => x.kind === f.kind && x.message === f.message)) {
        payload.frame_issues.push(f);
      }
    }
    if (t.covers_routing && t.covers_routing.matches) {
      if (!payload.covers_query_class) payload.covers_query_class = t.covers_routing.query_class;
      if (!payload.covers_target) payload.covers_target = t.covers_routing.target;
      for (const m of t.covers_routing.matches) {
        const exists = payload.covers_matches.some(x =>
          x.package_id === m.package_id && x.concept === m.concept && x.role === m.role);
        if (!exists) {
          payload.covers_matches.push({
            package_id: m.package_id,
            concept: m.concept,
            scope: m.scope || '',
            role: m.role,
            source: m.source
          });
        }
      }
    }
    payload.mechanical_traces.push(t);
  }
  // Make sure every covers-matched package is represented in candidate_packages,
  // even if no cluster fired for it (covers' whole purpose is the cue blind spot).
  for (const m of payload.covers_matches) {
    if (!payload.candidate_packages.some(p => p.id === m.package_id)) {
      const pkg = LOADED_PACKAGES.find(p => p.manifest.package_id === m.package_id);
      payload.candidate_packages.push({
        id: m.package_id,
        domain: (pkg && pkg.manifest && pkg.manifest.domain) || ''
      });
    }
  }
  return payload;
}

// ---------- TASK 4: LLM candidate-selection prompt ----------
function buildCandidateSelectionPrompt(query, candidatePayload) {
  const pkgList = (candidatePayload.candidate_packages || [])
    .map(p => `- ${p.id} (${p.domain || '—'})`).join('\n') || '(none)';
  const clusterList = (candidatePayload.candidate_clusters || [])
    .map(c => `- ${c.id} [pkg ${c.package_id}] score ${c.score}: ${c.label}`).join('\n') || '(none)';
  const unitList = (candidatePayload.candidate_units || [])
    .map(u => `- ${u.id} [pkg ${u.package_id}]: ${u.label} — ${u.definition}`).join('\n') || '(none)';
  const constraintList = (candidatePayload.candidate_constraints || [])
    .map(c => `- ${c.id} [pkg ${c.package_id}] blocks_answer=${c.blocks_answer} severity=${c.severity}: ${c.rule}`).join('\n') || '(none)';
  const trajectoryList = (candidatePayload.candidate_trajectories || [])
    .map(t => `- ${t.id}: ${t.label} (score ${t.score})`).join('\n') || '(none)';
  const suppressedList = (candidatePayload.suppressed_packages || [])
    .map(s => `- ${s.package_id} [${s.reason}] ${s.detail || ''}`).join('\n') || '(none)';
  const guidance = candidatePayload.guidance || {};
  const guidanceBlock = JSON.stringify({
    interpreted_query: guidance.interpreted_query || '',
    domain_hints: guidance.domain_hints || [],
    must_include_terms: guidance.must_include_terms || [],
    must_exclude_frames: guidance.must_exclude_frames || [],
    auxiliary_checks: guidance.auxiliary_checks || []
  }, null, 2);

  const systemPrompt = `You are the candidate-selection layer for TCog-R. You select among already-retrieved package objects. You must NOT use external knowledge, invent ids, or retrieve anything from your own memory. You may only choose ids that appear in the candidate payload below. Return JSON only.`;

  const coversBlock = (candidatePayload.covers_matches || [])
    .map(m => `- ${m.package_id} [${m.role}] concept="${m.concept}"${m.scope ? ` scope="${m.scope}"` : ''}`)
    .join('\n') || '(none)';
  const coversHeader = candidatePayload.covers_target
    ? `Covers-routed pre-pass (query_class=${candidatePayload.covers_query_class || 'definitional'}, target="${candidatePayload.covers_target}"). Multiple package matches with different scope qualifiers are legitimate and the architecture supports surfacing all of them; pick whichever frame fits the user's intent best, or several as primary/auxiliary.`
    : 'Covers-routed pre-pass: not applicable for this query.';

  const userPrompt = `User query:
${query}

Query-understanding guidance:
${guidanceBlock}

${coversHeader}
Covers matches:
${coversBlock}

Candidate packages:
${pkgList}

Candidate clusters:
${clusterList}

Candidate units (the only units that may appear in selected_units):
${unitList}

Candidate constraints (the only constraints that may appear in selected_constraints / blocking_constraints):
${constraintList}

Candidate trajectories:
${trajectoryList}

Suppressed packages (NOT eligible as evidence):
${suppressedList}

Rules:
- Use only ids that appear above. Do NOT invent ids.
- Drop irrelevant candidates explicitly via dropped_frames.
- Choose primary_frames and auxiliary_frames from candidate_packages only.
- selected_units must be a subset of the candidate units list.
- selected_constraints must be a subset of the candidate constraints list.
- If any candidate constraint has blocks_answer=true and is relevant, include it in blocking_constraints.
- Suppressed packages must NOT be selected as evidence.
- If no adequate package support exists for the query, list specific issues in coverage_gaps.
- Do NOT use external knowledge. Do NOT answer the user here.

Return ONLY a JSON object with this exact shape:

{
  "primary_frames": [],
  "auxiliary_frames": [],
  "dropped_frames": [
    {"package_id": "", "reason": ""}
  ],
  "selected_units": [],
  "selected_constraints": [],
  "selected_trajectory": null,
  "blocking_constraints": [],
  "coverage_gaps": [],
  "answer_plan": [],
  "selection_rationale": ""
}

Where primary_frames, auxiliary_frames are arrays of package_id strings; selected_units, selected_constraints, blocking_constraints are arrays of unit/constraint id strings; selected_trajectory is a trajectory id string or null; coverage_gaps and answer_plan are arrays of short strings; dropped_frames is an array of {package_id, reason} objects.`;
  return { systemPrompt, userPrompt };
}

// ---------- TASK 5: mechanical validation ----------
function validateLLMSelection(selection, candidatePayload) {
  const warnings = [];
  const candidatePkgIds = new Set((candidatePayload.candidate_packages || []).map(p => p.id));
  const candidateUnitIds = new Set((candidatePayload.candidate_units || []).map(u => u.id));
  const candidateConstraintIds = new Set((candidatePayload.candidate_constraints || []).map(c => c.id));
  const candidateTrajectoryIds = new Set((candidatePayload.candidate_trajectories || []).map(t => t.id));
  const suppressedIds = new Set((candidatePayload.suppressed_packages || []).map(s => s.package_id));

  const filterIds = (label, items, allowed) => {
    const kept = [];
    for (const id of items || []) {
      if (typeof id !== 'string') {
        warnings.push(`${label}: dropped non-string entry`);
        continue;
      }
      if (!allowed.has(id)) {
        warnings.push(`${label}: unknown id "${id}" not in candidate payload — dropped`);
        continue;
      }
      kept.push(id);
    }
    return kept;
  };

  const filterPkgs = (label, items) => {
    const kept = filterIds(label, items, candidatePkgIds);
    return kept.filter(id => {
      if (suppressedIds.has(id)) {
        warnings.push(`${label}: package "${id}" is suppressed — cannot be used as evidence`);
        return false;
      }
      return true;
    });
  };

  const primary_frames = filterPkgs('primary_frames', selection.primary_frames);
  const auxiliary_frames = filterPkgs('auxiliary_frames', selection.auxiliary_frames);
  const selected_units_pre = filterIds('selected_units', selection.selected_units, candidateUnitIds);
  // drop units belonging to suppressed packages
  const selected_units = selected_units_pre.filter(uid => {
    const unit = (candidatePayload.candidate_units || []).find(u => u.id === uid);
    if (unit && suppressedIds.has(unit.package_id)) {
      warnings.push(`selected_units: unit "${uid}" belongs to suppressed package "${unit.package_id}" — dropped`);
      return false;
    }
    return true;
  });
  const selected_constraints = filterIds('selected_constraints', selection.selected_constraints, candidateConstraintIds);

  // Force-include any mechanically blocking constraint, even if LLM omitted it.
  const llmBlocking = filterIds('blocking_constraints', selection.blocking_constraints, candidateConstraintIds);
  const mechBlocking = (candidatePayload.candidate_constraints || []).filter(c => c.blocks_answer).map(c => c.id);
  const blocking_constraints = Array.from(new Set([...llmBlocking, ...mechBlocking]));
  for (const id of mechBlocking) {
    if (!llmBlocking.includes(id)) {
      warnings.push(`blocking_constraints: mechanically triggered "${id}" was missing from LLM output — added back`);
    }
  }

  let selected_trajectory = null;
  if (selection.selected_trajectory && typeof selection.selected_trajectory === 'string') {
    if (candidateTrajectoryIds.has(selection.selected_trajectory)) {
      selected_trajectory = selection.selected_trajectory;
    } else {
      warnings.push(`selected_trajectory: unknown id "${selection.selected_trajectory}" — dropped`);
    }
  }

  const dropped_frames = Array.isArray(selection.dropped_frames)
    ? selection.dropped_frames.filter(d => d && typeof d === 'object' && typeof d.package_id === 'string')
    : [];

  const coverage_gaps = (Array.isArray(selection.coverage_gaps) ? selection.coverage_gaps : []).filter(g => typeof g === 'string');
  const answer_plan = (Array.isArray(selection.answer_plan) ? selection.answer_plan : []).filter(s => typeof s === 'string');
  const selection_rationale = typeof selection.selection_rationale === 'string' ? selection.selection_rationale : '';

  // Coverage gap: if all selected units were dropped during validation, surface it.
  if ((selection.selected_units || []).length > 0 && selected_units.length === 0) {
    coverage_gaps.push('All LLM-selected units were dropped during validation (unknown ids or suppressed packages).');
  }

  return {
    primary_frames,
    auxiliary_frames,
    dropped_frames,
    selected_units,
    selected_constraints,
    selected_trajectory,
    blocking_constraints,
    coverage_gaps,
    answer_plan,
    selection_rationale,
    validation_warnings: warnings
  };
}

// ---------- TASK 6: mechanical constraint gate ----------
function applyConstraintGate(validatedSelection, candidatePayload) {
  const blocking = validatedSelection.blocking_constraints || [];
  const hasUnits = (validatedSelection.selected_units || []).length > 0;
  const hasCandidates =
    (candidatePayload.candidate_packages || []).length > 0 ||
    (candidatePayload.candidate_clusters || []).length > 0 ||
    (candidatePayload.candidate_units || []).length > 0;

  let disposition;
  if (blocking.length > 0) {
    disposition = 'blocked_by_constraint';
  } else if (hasUnits) {
    disposition = 'selection_grounded_answer';
  } else if (hasCandidates) {
    disposition = 'coverage_gap';
  } else {
    disposition = 'no_package_support';
  }

  // Build repair questions from mechanical constraint metadata; the LLM never
  // authors these.
  const repair_questions = [];
  // Safety-critical detection: any blocking constraint from a package whose
  // manifest has safety_critical=true forces the gate closed (no override).
  let safety_critical_blocked = false;
  const safety_critical_blocking = [];
  for (const cid of blocking) {
    const c = (candidatePayload.candidate_constraints || []).find(x => x.id === cid);
    if (c && c.repair) repair_questions.push({ constraint_id: cid, repair: c.repair });
    if (c && c.safety_critical) {
      safety_critical_blocked = true;
      safety_critical_blocking.push(cid);
    }
  }

  return {
    disposition,
    blocking_constraints: blocking,
    repair_questions,
    safety_critical_blocked,
    safety_critical_blocking,
    user_overridden: false,
    bypassed_blocking_constraints: []
  };
}

// ---------- TASK 7: selection-grounded answer composition prompt ----------
function buildSelectionGroundedCompositionPrompt(query, candidatePayload, validatedSelection, gatedResult) {
  const unitsById = new Map((candidatePayload.candidate_units || []).map(u => [u.id, u]));
  const constraintsById = new Map((candidatePayload.candidate_constraints || []).map(c => [c.id, c]));
  const unitsBlock = (validatedSelection.selected_units || []).map(uid => {
    const u = unitsById.get(uid);
    return u ? `[${u.id}] ${u.label}: ${u.definition}` : `[${uid}] (missing)`;
  }).join('\n') || '(none)';
  const constraintsBlock = (validatedSelection.selected_constraints || []).map(cid => {
    const c = constraintsById.get(cid);
    return c ? `[${c.id}] (severity ${c.severity}, blocks=${c.blocks_answer}) ${c.rule} | Repair: ${c.repair}` : `[${cid}] (missing)`;
  }).join('\n') || '(none)';
  const blockingBlock = (gatedResult.blocking_constraints || []).map(cid => {
    const c = constraintsById.get(cid);
    return c ? `[${c.id}] ${c.rule} | Repair: ${c.repair}` : `[${cid}] (missing)`;
  }).join('\n') || '(none)';
  const droppedBlock = (validatedSelection.dropped_frames || [])
    .map(d => `- ${d.package_id}: ${d.reason || ''}`).join('\n') || '(none)';
  const coverageBlock = (validatedSelection.coverage_gaps || [])
    .map(g => `- ${g}`).join('\n') || '(none)';
  const planBlock = (validatedSelection.answer_plan || [])
    .map(p => `- ${p}`).join('\n') || '(none)';

  const dispositionGuidance = {
    selection_grounded_answer: 'Compose a concise package-bound answer using ONLY the selected units. Cite each factual claim by appending [unit_id] using exact ids. Surface any selected constraints inline.',
    blocked_by_constraint: 'A blocking constraint fired. Do NOT assert a direct answer. Surface the constraint, present the repair question, and explain in plain language why this query cannot be reduced to a yes/no until the repair question is answered.',
    coverage_gap: 'No selected units passed validation. State plainly that the loaded packages do not provide adequate support, and summarise the coverage gap. Do NOT invent claims.',
    no_package_support: 'No package candidates exist for this query. State this plainly. Do NOT answer from training memory.'
  }[gatedResult.disposition] || '';

  const systemPrompt = `You are the answer-composition layer of TCog-R. LLM interprets language and selects among candidates; TCog-R packages and constraint gates remain authoritative.

ABSOLUTE RULES:
1. Use ONLY the validated selected units below for package-supported claims. Cite each factual claim with [unit_id] using exact ids.
2. Do NOT use dropped frames as evidence.
3. Do NOT add external facts as package-supported claims. If a plain-language connective is helpful, mark it explicitly as "synthesis" — never invent supporting ids.
4. Surface every blocking constraint and its repair question. The mechanical gate has already decided the disposition; you cannot override it.
5. If coverage_gaps are present, state them; do not paper over with inferred content.
6. Do not output a protocol trace; the UI renders it separately.
7. Start with the answer to the user's question, not with TCog internals.

Disposition: ${gatedResult.disposition}
Disposition guidance: ${dispositionGuidance}`;

  const userPrompt = `User query:
${query}

=== Validated selected units (the ONLY units you may cite) ===
${unitsBlock}

=== Selected constraints ===
${constraintsBlock}

=== Blocking constraints (mechanically authoritative) ===
${blockingBlock}

=== Dropped frames (not evidence) ===
${droppedBlock}

=== Coverage gaps ===
${coverageBlock}

=== Answer plan (LLM-proposed; treat as outline only) ===
${planBlock}

Compose the answer now in plain language. Cite [unit_id] for every package-supported claim. Surface blocking constraints with their repair questions. Do not invent ids.`;
  return { systemPrompt, userPrompt };
}

// ---------- TASK 8: provider wrapper ----------
async function runLLMGuidedTCogR(query, providerConfig) {
  // Remember the provider for the user-override re-composition path.
  LAST_LLM_GUIDED_PROVIDER = providerConfig || null;
  const result = {
    query,
    guidance: null,
    candidatePayload: null,
    rawSelection: null,
    validatedSelection: null,
    gatedResult: null,
    answerText: null,
    errors: [],
    fellBackToMechanical: false,
    mechanicalSections: null,
    mechanicalTrace: null
  };

  if (!providerConfig || !providerConfig.apiKey) {
    result.errors.push('No provider key set; cannot run LLM-guided TCog-R.');
    const trace = retrieve(query);
    result.mechanicalTrace = trace;
    result.mechanicalSections = buildRawResponse(query, trace);
    result.fellBackToMechanical = true;
    return result;
  }

  // 1. Query understanding
  try {
    const qu = buildQueryUnderstandingPrompt(query);
    const guidanceText = await generatePromptWithProvider(
      providerConfig.provider, qu.systemPrompt, qu.userPrompt,
      providerConfig.apiKey, providerConfig.model
    );
    result.guidance = parseLLMJsonStrict(guidanceText);
  } catch (e) {
    result.errors.push(`Query understanding failed: ${e.message}`);
    result.guidance = { interpreted_query: query, search_queries: [] };
  }

  // 2. Broad mechanical candidate retrieval
  try {
    result.candidatePayload = retrieveWithGuidance(query, result.guidance);
  } catch (e) {
    result.errors.push(`Candidate retrieval failed: ${e.message}`);
  }

  if (!result.candidatePayload) {
    const trace = retrieve(query);
    result.mechanicalTrace = trace;
    result.mechanicalSections = buildRawResponse(query, trace);
    result.fellBackToMechanical = true;
    return result;
  }

  // Always keep the base mechanical trace/sections for fallback rendering.
  const baseTrace = result.candidatePayload.mechanical_traces[0] || retrieve(query);
  result.mechanicalTrace = baseTrace;
  result.mechanicalSections = buildRawResponse(query, baseTrace);

  // 3. LLM candidate selection
  try {
    const sel = buildCandidateSelectionPrompt(query, result.candidatePayload);
    const selText = await generatePromptWithProvider(
      providerConfig.provider, sel.systemPrompt, sel.userPrompt,
      providerConfig.apiKey, providerConfig.model
    );
    result.rawSelection = parseLLMJsonStrict(selText);
  } catch (e) {
    result.errors.push(`Candidate selection failed: ${e.message}`);
  }

  if (!result.rawSelection) {
    result.fellBackToMechanical = true;
    return result;
  }

  // 4. Mechanical validation
  result.validatedSelection = validateLLMSelection(result.rawSelection, result.candidatePayload);

  // 5. Mechanical constraint gate
  result.gatedResult = applyConstraintGate(result.validatedSelection, result.candidatePayload);

  // 6. Selection-grounded answer composition
  try {
    const cmp = buildSelectionGroundedCompositionPrompt(
      query, result.candidatePayload, result.validatedSelection, result.gatedResult
    );
    result.answerText = await generatePromptWithProvider(
      providerConfig.provider, cmp.systemPrompt, cmp.userPrompt,
      providerConfig.apiKey, providerConfig.model
    );
  } catch (e) {
    result.errors.push(`Answer composition failed: ${e.message}`);
  }

  return result;
}

// ---------- TASK 9: render LLM-guided result ----------
function renderListBlock(items, emptyMsg, mapFn) {
  if (!items || items.length === 0) {
    return `<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>${escapeHtml(emptyMsg)}</em></p>`;
  }
  return '<ul class="trace-list">' + items.map(mapFn).join('') + '</ul>';
}

function renderQueryUnderstandingCard(guidance) {
  const div = document.createElement('div');
  div.className = 'section section-A';
  const g = guidance || {};
  const interpreted = g.interpreted_query || '(none)';
  const domains = renderListBlock(g.domain_hints || [], 'No domain hints.', s => `<li>${escapeHtml(s)}</li>`);
  const searches = renderListBlock(g.search_queries || [], 'No search queries proposed.', s => `<li><code>${escapeHtml(s)}</code></li>`);
  const exclude = renderListBlock(g.must_exclude_frames || [], 'No exclusions.', s => `<li>${escapeHtml(s)}</li>`);
  const includes = renderListBlock(g.must_include_terms || [], 'No must-include terms.', s => `<li><code>${escapeHtml(s)}</code></li>`);
  const aux = renderListBlock(g.auxiliary_checks || [], 'No auxiliary checks.', s => `<li>${escapeHtml(s)}</li>`);
  div.innerHTML = `
    <div class="section-label"><span>Query understanding (LLM)</span></div>
    <div class="section-content">
      <p><strong>Interpreted query:</strong> ${escapeHtml(interpreted)}</p>
      <div class="trace-row"><div class="trace-row-label">Domain hints</div><div class="trace-row-body">${domains}</div></div>
      <div class="trace-row"><div class="trace-row-label">Search queries</div><div class="trace-row-body">${searches}</div></div>
      <div class="trace-row"><div class="trace-row-label">Must-include terms</div><div class="trace-row-body">${includes}</div></div>
      <div class="trace-row"><div class="trace-row-label">Must-exclude frames</div><div class="trace-row-body">${exclude}</div></div>
      <div class="trace-row"><div class="trace-row-label">Auxiliary checks</div><div class="trace-row-body">${aux}</div></div>
    </div>
  `;
  return div;
}

function renderSelectionCard(validatedSelection, candidatePayload) {
  const div = document.createElement('div');
  div.className = 'section section-B';
  const v = validatedSelection || {};
  const primary = renderListBlock(v.primary_frames || [], 'No primary frames selected.', s => `<li><code>${escapeHtml(s)}</code></li>`);
  const aux = renderListBlock(v.auxiliary_frames || [], 'No auxiliary frames selected.', s => `<li><code>${escapeHtml(s)}</code></li>`);
  const dropped = renderListBlock(v.dropped_frames || [], 'No frames dropped.',
    d => `<li><code>${escapeHtml(d.package_id)}</code> — ${escapeHtml(d.reason || '')}</li>`);
  const unitsById = new Map((candidatePayload.candidate_units || []).map(u => [u.id, u]));
  const units = renderListBlock(v.selected_units || [], 'No units selected.', uid => {
    const u = unitsById.get(uid);
    return `<li><code>${escapeHtml(uid)}</code> ${u ? '— ' + escapeHtml(u.label || '') : ''}</li>`;
  });
  const constraintsById = new Map((candidatePayload.candidate_constraints || []).map(c => [c.id, c]));
  const constraints = renderListBlock(v.selected_constraints || [], 'No constraints selected.', cid => {
    const c = constraintsById.get(cid);
    return `<li><code>${escapeHtml(cid)}</code> ${c ? '— ' + escapeHtml(c.label || c.rule || '') : ''}</li>`;
  });
  const warnings = renderListBlock(v.validation_warnings || [], 'No validation warnings.', w => `<li>${escapeHtml(w)}</li>`);
  const rationale = v.selection_rationale ? `<p style="margin:6px 0 0;">${escapeHtml(v.selection_rationale)}</p>` : '';
  div.innerHTML = `
    <div class="section-label"><span>LLM candidate selection (validated)</span></div>
    <div class="section-content">
      <div class="trace-row"><div class="trace-row-label">Primary frames</div><div class="trace-row-body">${primary}</div></div>
      <div class="trace-row"><div class="trace-row-label">Auxiliary frames</div><div class="trace-row-body">${aux}</div></div>
      <div class="trace-row"><div class="trace-row-label">Dropped frames</div><div class="trace-row-body">${dropped}</div></div>
      <div class="trace-row"><div class="trace-row-label">Selected units</div><div class="trace-row-body">${units}</div></div>
      <div class="trace-row"><div class="trace-row-label">Selected constraints</div><div class="trace-row-body">${constraints}</div></div>
      <div class="trace-row"><div class="trace-row-label">Validation warnings</div><div class="trace-row-body">${warnings}</div></div>
      ${rationale}
    </div>
  `;
  return div;
}

function renderTcogRGuidedAnswerCard(answerText, gatedResult) {
  const div = document.createElement('div');
  div.className = 'section section-B';
  let body;
  if (answerText) {
    let html = answerText
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, ' ');
    body = `<div class="section-content"><p>${renderCitations(html)}</p></div>`;
  } else {
    const note = gatedResult && gatedResult.disposition === 'no_package_support'
      ? 'No package candidates were retrieved for this query.'
      : 'Composition unavailable.';
    body = `<div class="section-content"><p style="color:var(--ink-faint);"><em>${escapeHtml(note)}</em></p></div>`;
  }
  div.innerHTML = `<div class="section-label"><span>TCog-R answer (selection-grounded)</span></div>${body}`;
  attachCitationHandlers(div);
  return div;
}

function renderConstraintGateCard(gatedResult, candidatePayload) {
  const div = document.createElement('div');
  div.className = 'section section-C';
  const constraintsById = new Map((candidatePayload.candidate_constraints || []).map(c => [c.id, c]));
  const blockingHtml = renderListBlock(gatedResult.blocking_constraints || [], 'No blocking constraints.', cid => {
    const c = constraintsById.get(cid);
    const sc = c && c.safety_critical ? ' <span class="status-pill" style="background:rgba(184,92,0,0.12); color:var(--warn);">safety-critical</span>' : '';
    return `<li><code>${escapeHtml(cid)}</code>${sc}${c ? ' — ' + escapeHtml(c.rule || '') : ''}</li>`;
  });
  const repairHtml = renderListBlock(gatedResult.repair_questions || [], 'No repair questions.', r =>
    `<li><code>${escapeHtml(r.constraint_id)}</code>: ${escapeHtml(r.repair || '')}</li>`);

  const dispositionBadge = gatedResult.user_overridden
    ? `${escapeHtml(gatedResult.disposition || '—')} (user_overridden)`
    : escapeHtml(gatedResult.disposition || '—');

  // Render the one-click override button only when:
  //   disposition === 'blocked_by_constraint' AND safety_critical_blocked === false
  // AND the override has not already been applied to this result.
  const showOverrideButton =
    gatedResult.disposition === 'blocked_by_constraint' &&
    gatedResult.safety_critical_blocked === false &&
    !gatedResult.user_overridden;

  const overrideButtonHtml = showOverrideButton
    ? `<div style="margin-top:10px;"><button class="btn" id="override-blocking-constraint" type="button">Show answer with caveats</button></div>`
    : '';

  const safetyNoteHtml = gatedResult.safety_critical_blocked
    ? `<p style="margin:6px 0 0; color:var(--warn); font-size:12px;"><strong>Safety-critical block:</strong> blocked by ${(gatedResult.safety_critical_blocking || []).map(escapeHtml).join(', ') || 'a safety-critical constraint'}. This package's blocking is part of the architecture (e.g. medicine/counselling/law). The user cannot override; address the constraint or rephrase.</p>`
    : '';

  const overriddenNoteHtml = gatedResult.user_overridden
    ? `<p style="margin:6px 0 0; font-size:12px; color:var(--ink-soft);"><strong>User override applied.</strong> Bypassed: ${(gatedResult.bypassed_blocking_constraints || []).map(c => `<code>${escapeHtml(c)}</code>`).join(', ') || '(none recorded)'}.</p>`
    : '';

  div.innerHTML = `
    <div class="section-label"><span>Mechanical constraint gate</span><span style="color:var(--ink-faint);">disposition: ${dispositionBadge}</span></div>
    <div class="section-content">
      <div class="trace-row"><div class="trace-row-label">Blocking constraints</div><div class="trace-row-body">${blockingHtml}${overrideButtonHtml}</div></div>
      <div class="trace-row"><div class="trace-row-label">Repair questions</div><div class="trace-row-body">${repairHtml}</div></div>
      ${safetyNoteHtml}
      ${overriddenNoteHtml}
    </div>
  `;
  if (showOverrideButton) {
    const btn = div.querySelector('#override-blocking-constraint');
    if (btn) btn.addEventListener('click', onShowAnswerWithCaveats);
  }
  return div;
}

// Click handler for the "Show answer with caveats" override. Reads the last
// LLM-guided result from module state, runs an answer-with-caveats composition,
// updates the audit trail, and re-renders. One click; no second confirmation.
async function onShowAnswerWithCaveats() {
  const result = LAST_LLM_GUIDED_RESULT;
  const providerConfig = LAST_LLM_GUIDED_PROVIDER;
  if (!result || !result.gatedResult) return;
  if (result.gatedResult.safety_critical_blocked) return; // double-guard

  const out = document.getElementById('output');
  // Disable button while we compose; the loader replaces the card on re-render.
  const btn = out.querySelector('#override-blocking-constraint');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Composing answer with caveats…';
  }

  const bypassed = (result.gatedResult.blocking_constraints || []).slice();
  const overriddenGate = Object.assign({}, result.gatedResult, {
    disposition: 'blocked_by_constraint',
    user_overridden: true,
    bypassed_blocking_constraints: bypassed,
    // Compose now under selection-grounded guidance to surface caveats and answer.
    _override_compose_disposition: 'selection_grounded_answer'
  });

  let answerText = result.answerText;
  if (providerConfig && providerConfig.apiKey) {
    try {
      const cmp = buildSelectionGroundedCompositionPrompt(
        result.query,
        result.candidatePayload,
        result.validatedSelection,
        // Pass an answer-with-caveats variant so the LLM composes content,
        // not a refusal. Surface the caveats explicitly in the prompt.
        Object.assign({}, overriddenGate, { disposition: 'selection_grounded_answer' })
      );
      const cavSystem = cmp.systemPrompt + `\n\nUser-overridden block: the user has chosen to see the answer with caveats. ${bypassed.length} blocking constraint(s) are bypassed (${bypassed.join(', ')}). Begin the answer with a "Caveats" section that surfaces every bypassed constraint by id and rule, then provide the answer using only the selected units. Do not refuse.`;
      answerText = await generatePromptWithProvider(
        providerConfig.provider,
        cavSystem,
        cmp.userPrompt,
        providerConfig.apiKey,
        providerConfig.model
      );
    } catch (e) {
      // Compose failed: keep the original drafted answer; surface a warning.
      result.errors = result.errors || [];
      result.errors.push(`Override composition failed: ${e.message}`);
    }
  }

  result.gatedResult = overriddenGate;
  result.answerText = answerText;
  if (result.mechanicalTrace) {
    result.mechanicalTrace.user_overridden = true;
    result.mechanicalTrace.bypassed_blocking_constraints = bypassed;
  }
  renderLLMGuidedResult(result);
}

function renderCandidateTraceDetails(candidatePayload, mechanicalSections) {
  const details = document.createElement('details');
  details.className = 'protocol-trace';
  const pkgs = renderListBlock(candidatePayload.candidate_packages || [], 'No candidate packages.',
    p => `<li><code>${escapeHtml(p.id)}</code> <span style="color:var(--ink-faint);">(${escapeHtml(p.domain || '—')})</span></li>`);
  const clusters = renderListBlock(candidatePayload.candidate_clusters || [], 'No candidate clusters.',
    c => `<li><code>${escapeHtml(c.package_id)}:${escapeHtml(shortClusterId(c.id))}</code> <span style="color:var(--ink-faint);">score ${c.score}</span></li>`);
  const units = renderListBlock(candidatePayload.candidate_units || [], 'No candidate units.',
    u => `<li><code>${escapeHtml(u.id)}</code> — ${escapeHtml(u.label || '')}</li>`);
  const constraints = renderListBlock(candidatePayload.candidate_constraints || [], 'No candidate constraints.',
    c => `<li><code>${escapeHtml(c.id)}</code> ${c.blocks_answer ? '<strong style="color:var(--accent);">blocks</strong> · ' : ''}severity ${escapeHtml(c.severity || '—')}</li>`);
  const suppressed = renderListBlock(candidatePayload.suppressed_packages || [], 'No suppressed packages.',
    s => `<li><code>${escapeHtml(s.package_id)}</code> [${escapeHtml(s.reason)}] ${escapeHtml(s.detail || '')}</li>`);
  const frameIssues = renderListBlock(candidatePayload.frame_issues || [], 'No frame issues.',
    i => `<li>[${escapeHtml(i.kind)}] ${escapeHtml(i.message)}</li>`);

  details.innerHTML = `
    <summary>Broad mechanical candidates and full protocol trace</summary>
    <div class="section section-A">
      <div class="section-label"><span>Candidate trace (post-broad retrieval)</span></div>
      <div class="section-content">
        <div class="trace-row"><div class="trace-row-label">Candidate packages</div><div class="trace-row-body">${pkgs}</div></div>
        <div class="trace-row"><div class="trace-row-label">Candidate clusters</div><div class="trace-row-body">${clusters}</div></div>
        <div class="trace-row"><div class="trace-row-label">Candidate units</div><div class="trace-row-body">${units}</div></div>
        <div class="trace-row"><div class="trace-row-label">Candidate constraints</div><div class="trace-row-body">${constraints}</div></div>
        <div class="trace-row"><div class="trace-row-label">Suppressed packages</div><div class="trace-row-body">${suppressed}</div></div>
        <div class="trace-row"><div class="trace-row-label">Frame issues</div><div class="trace-row-body">${frameIssues}</div></div>
      </div>
    </div>
  `;
  details.appendChild(renderProtocolTraceDetails(mechanicalSections || { sectionA_trace: null }));
  return details;
}

function renderLLMGuidedErrorBanner(errors) {
  if (!errors || errors.length === 0) return null;
  const div = document.createElement('div');
  div.className = 'section section-G';
  div.innerHTML = `
    <div class="section-label"><span><span class="marker">!</span>LLM-guided pipeline issues</span></div>
    <div class="section-content"><ul class="trace-list">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>
  `;
  return div;
}

function renderLLMGuidedResult(result) {
  // Stash the result so the override click handler can re-render after a
  // recomposition without rerunning the full pipeline.
  LAST_LLM_GUIDED_RESULT = result;
  const out = document.getElementById('output');
  out.innerHTML = '';

  // If the pipeline could not produce a candidatePayload, fall back to mechanical only.
  if (result.fellBackToMechanical && !result.candidatePayload) {
    const banner = renderLLMGuidedErrorBanner(result.errors);
    if (banner) out.appendChild(banner);
    if (result.mechanicalTrace && result.mechanicalSections) {
      const fallbackCovers = renderCoversCard(result.mechanicalTrace.covers_routing);
      if (fallbackCovers) out.appendChild(fallbackCovers);
      const summary = renderAnswerSummaryCard(result.query, result.mechanicalTrace, result.mechanicalSections);
      out.appendChild(renderFrameRolesCard(result.mechanicalTrace));
      out.appendChild(summary.div);
      out.appendChild(renderPackageBoundCard(result.mechanicalSections));
      out.appendChild(renderConstraintsCard(result.mechanicalSections));
      out.appendChild(renderNextMoveCard(summary.next));
      out.appendChild(renderProtocolTraceDetails(result.mechanicalSections));
    }
    return;
  }

  const banner = renderLLMGuidedErrorBanner(result.errors);
  if (banner) out.appendChild(banner);

  // Render the answer first — users want to see it before the supporting cards.
  if (result.gatedResult) {
    out.appendChild(renderTcogRGuidedAnswerCard(result.answerText, result.gatedResult));
    out.appendChild(renderConstraintGateCard(result.gatedResult, result.candidatePayload));
  } else if (result.fellBackToMechanical && result.mechanicalSections) {
    // Selection step failed; show mechanical answer as fallback.
    out.appendChild(renderPackageBoundCard(result.mechanicalSections));
    out.appendChild(renderConstraintsCard(result.mechanicalSections));
  }

  out.appendChild(renderQueryUnderstandingCard(result.guidance));

  // Surface covers matches above the LLM selection card so users can see what
  // the covers pre-pass routed before the LLM made its choice.
  const coversCard = renderCoversCard(result.candidatePayload);
  if (coversCard) out.appendChild(coversCard);

  if (result.validatedSelection) {
    out.appendChild(renderSelectionCard(result.validatedSelection, result.candidatePayload));
  }

  out.appendChild(renderCandidateTraceDetails(result.candidatePayload, result.mechanicalSections));
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

function isGenericFramePackage(pkg) {
  const m = pkg.manifest || {};
  const haystack = [
    m.package_id || '',
    m.domain || '',
    (m.tags || []).join(' ')
  ].join(' ');
  return /\b(universal|proof|logic|statistics|statistical|probability|math|mathematics|epistemic|reasoning|method)\b/i.test(haystack);
}

function packageSpecificCueMatches(sentence, pkg) {
  const sentenceNorm = normalize(sentence);
  const manifest = pkg.manifest || {};
  const policy = manifest.activation_policy || {};
  const tokens = []
    .concat(getStrictDomainTokens(pkg) || [])
    .concat(policy.activate_when || [])
    .concat(manifest.tags || [])
    .concat(manifest.domain || []);
  return [...new Set(tokens.filter(t => t && phraseMatchInQuery(t, sentenceNorm)))];
}

function frameCandidateScore(sentence, trace, pkg) {
  const pkgId = pkg.manifest.package_id;
  const cueMatches = packageSpecificCueMatches(sentence, pkg);
  const clusterScore = (trace.activated_clusters || [])
    .filter(a => a.package_id === pkgId)
    .reduce((sum, a) => sum + (a.score || 0), 0);
  const unitCount = (trace.units || []).filter(u => String(u.id || '').startsWith(`${pkgId}:`)).length;
  const role = getPackageRole(sentence, pkg);
  const genericPenalty = role === 'auxiliary_checker' || role === 'method_frame' || isGenericFramePackage(pkg) ? 5 : 0;
  const primaryBonus = role === 'primary_domain' && cueMatches.length > 0 ? 6 : 0;
  return {
    package_id: pkgId,
    domain: pkg.manifest.domain || '',
    role,
    cue_matches: cueMatches,
    score: cueMatches.length * 4 + clusterScore + unitCount + primaryBonus - genericPenalty,
    is_generic: isGenericFramePackage(pkg)
  };
}

function assignFrameRoles(sentence, trace) {
  const active = (trace.active_packages || []).map(pkg => frameCandidateScore(sentence, trace, pkg));
  const domainSpecific = active
    .filter(f => f.role === 'primary_domain' && f.cue_matches.length > 0)
    .sort((a, b) => b.score - a.score);
  const ranked = active.slice().sort((a, b) => b.score - a.score);
  const primary = domainSpecific[0] || ranked[0] || null;
  const primaryId = primary ? primary.package_id : null;
  const constraintIds = new Set((trace.triggered_constraints || []).map(t => t.package_id));
  const primaryFrames = ranked.filter(f => f.role === 'primary_domain');
  const auxiliaryFrames = ranked.filter(f => f.role === 'auxiliary_checker' || f.role === 'method_frame');
  const safetyFrames = ranked.filter(f => f.role === 'safety_gate');

  return {
    primary_frame: primary,
    primary_frames: primaryFrames,
    auxiliary_frames: auxiliaryFrames.filter(f => f.package_id !== primaryId),
    safety_frames: safetyFrames,
    constraint_frames: ranked.filter(f => constraintIds.has(f.package_id)),
    suppressed_frames: (trace.suppressed_packages || []).map(s => ({
      package_id: s.package_id,
      domain: s.domain || '',
      reason: s.reason,
      detail: s.detail
    })),
    considered_frames: ranked,
    note: domainSpecific.length > 0
      ? 'Primary frame chosen by strongest domain-specific cue match.'
      : 'Primary frame chosen from active packages; no domain-specific cue dominated.'
  };
}

function detectPrimaryDomain(sentence, trace) {
  const roles = trace.frame_roles || assignFrameRoles(sentence, trace);
  if (roles.primary_frame && roles.primary_frame.role === 'primary_domain') return roles.primary_frame;
  const activePrimary = (roles.primary_frames || []).find(f => f.cue_matches && f.cue_matches.length > 0);
  if (activePrimary) return activePrimary;
  const gap = (trace.domain_coverage_gaps || [])[0];
  if (gap) {
    return {
      package_id: gap.package_id,
      domain: gap.domain || '',
      role: 'primary_domain',
      cue_matches: gap.matched_tokens || [],
      coverage_gap: true
    };
  }
  return null;
}

function hasPrimaryDomainSupport(sentence, trace) {
  const primary = detectPrimaryDomain(sentence, trace);
  if (!primary || primary.coverage_gap) return false;
  const hasCluster = (trace.activated_clusters || []).some(a => a.package_id === primary.package_id);
  const hasUnit = (trace.units || []).some(u => unitPackageId(u) === primary.package_id);
  return hasCluster || hasUnit;
}

function hasCoverageGap(sentence, trace) {
  const primary = detectPrimaryDomain(sentence, trace);
  return !!primary && !hasPrimaryDomainSupport(sentence, trace);
}

function detectedDomainPackages(sentence, trace) {
  const sentenceNorm = normalize(sentence);
  const detected = [];
  for (const pkg of LOADED_PACKAGES) {
    if (getPackageRole(sentence, pkg) !== 'primary_domain') continue;
    const matches = packageSpecificCueMatches(sentence, pkg)
      .concat((getStrictDomainTokens(pkg) || []).filter(t => phraseMatchInQuery(t, sentenceNorm)));
    const unique = [...new Set(matches)];
    if (unique.length > 0) {
      detected.push({
        package_id: pkg.manifest.package_id,
        domain: pkg.manifest.domain || '',
        matches: unique,
        active: (trace.active_packages || []).some(p => p.manifest.package_id === pkg.manifest.package_id),
        has_support: (trace.activated_clusters || []).some(a => a.package_id === pkg.manifest.package_id) ||
          (trace.units || []).some(u => unitPackageId(u) === pkg.manifest.package_id)
      });
    }
  }
  for (const gap of (trace.domain_coverage_gaps || [])) {
    if (!detected.some(d => d.package_id === gap.package_id)) {
      detected.push({
        package_id: gap.package_id,
        domain: gap.domain || '',
        matches: gap.matched_tokens || [],
        active: false,
        has_support: false,
        coverage_gap: true
      });
    }
  }
  return detected;
}

function buildDomainInfo(sentence, trace) {
  const detected = detectedDomainPackages(sentence, trace);
  return {
    detected_domain_packages: detected,
    primary_domain_packages: detected.map(d => d.package_id),
    has_domain_support: detected.some(d => d.has_support),
    has_detected_primary_domain: detected.length > 0,
    uses_detected_domain_vocabulary: detected.some(d => (d.matches || []).length > 0)
  };
}

function frameMisalignmentReasons(sentence, trace, domainInfo) {
  const reasons = [];
  if (!domainInfo.has_detected_primary_domain) {
    const activeNonDomain = (trace.active_packages || []).filter(pkg => getPackageRole(sentence, pkg) !== 'primary_domain');
    if (activeNonDomain.length > 0) {
      reasons.push(`Non-domain package(s) active with no detected primary domain: ${activeNonDomain.map(p => p.manifest.package_id).join(', ')}`);
    }
  }

  if (!domainInfo.has_domain_support) {
    const sentNorm = normalize(sentence);
    const suppressedPrimaryUse = (trace.suppressed_packages || [])
      .filter(s => s.reason === 'suppressed_due_to_overreach')
      .some(suppressed => {
        const pkg = LOADED_PACKAGES.find(p => p.manifest.package_id === suppressed.package_id);
        if (!pkg || getPackageRole(sentence, pkg) !== 'primary_domain') return false;
        const matches = packageDomainVocabulary(pkg, suppressed).filter(v => phraseMatchInQuery(v, sentNorm));
        return matches.length >= 3;
      });
    if (suppressedPrimaryUse && domainInfo.has_detected_primary_domain) {
      reasons.push('A suppressed primary-domain package appears to be used as the main explanatory frame while another primary domain is active.');
    }
  }

  for (const issue of (trace.frame_issues || [])) {
    if (issue.kind === 'conflict' || issue.kind === 'frame_limit') {
      reasons.push(`Explicit frame issue: ${issue.message}`);
    }
  }
  return reasons;
}

function isTrueFrameMisalignment(sentence, trace, domainInfo = buildDomainInfo(sentence, trace)) {
  if (hasPrimaryDomainSupport(sentence, trace)) return false;
  const activeRoles = trace.frame_roles || assignFrameRoles(sentence, trace);
  const onlyChecker = (activeRoles.considered_frames || []).length > 0 &&
    (activeRoles.considered_frames || []).every(f => f.role === 'auxiliary_checker' || f.role === 'method_frame');
  if (onlyChecker && domainInfo.has_detected_primary_domain) return false;
  return frameMisalignmentReasons(sentence, trace, domainInfo).length > 0;
}

function coverageGapReasons(sentence, trace, domainInfo) {
  if (!domainInfo.has_detected_primary_domain || domainInfo.has_domain_support) return [];
  return domainInfo.detected_domain_packages.map(d =>
    `${d.package_id} domain vocabulary detected (${(d.matches || []).join(', ') || 'domain cue'}), but no adequate cluster/unit support activated.`
  );
}

function frameFitDetails(sentence, trace, domainInfo = buildDomainInfo(sentence, trace)) {
  const roles = trace.frame_roles || assignFrameRoles(sentence, trace);
  const primaryFrame = roles.primary_frame || detectPrimaryDomain(sentence, trace);
  const primaryId = primaryFrame?.package_id || null;
  const auxiliaryFrames = (roles.auxiliary_frames || []).concat(roles.safety_frames || []);
  const activeUnrelatedFrames = (trace.active_packages || [])
    .filter(pkg => {
      const pkgId = pkg.manifest.package_id;
      if (pkgId === primaryId) return false;
      const role = getPackageRole(sentence, pkg);
      if (role === 'auxiliary_checker' || role === 'method_frame' || role === 'safety_gate') return false;
      return !domainInfo.detected_domain_packages.some(d => d.package_id === pkgId);
    })
    .map(pkg => pkg.manifest.package_id);

  const coverageReasons = coverageGapReasons(sentence, trace, domainInfo);
  if (coverageReasons.length > 0) {
    return {
      detected_domain: domainInfo.detected_domain_packages.map(d => d.package_id),
      primary_frame: primaryId || 'none',
      auxiliary_frames: auxiliaryFrames.map(f => f.package_id),
      active_unrelated_frames: activeUnrelatedFrames,
      frame_fit_status: 'coverage_gap',
      reason: coverageReasons.join(' ')
    };
  }

  const misalignmentReasons = frameMisalignmentReasons(sentence, trace, domainInfo);
  if (isTrueFrameMisalignment(sentence, trace, domainInfo)) {
    return {
      detected_domain: domainInfo.detected_domain_packages.map(d => d.package_id),
      primary_frame: primaryId || 'none',
      auxiliary_frames: auxiliaryFrames.map(f => f.package_id),
      active_unrelated_frames: activeUnrelatedFrames,
      frame_fit_status: 'frame_misaligned',
      reason: misalignmentReasons.join(' ') || 'Wrong or incompatible frame dominates the claim.'
    };
  }

  const relevantFrameCount = (trace.active_packages || []).filter(pkg => {
    const role = getPackageRole(sentence, pkg);
    return role === 'primary_domain' || role === 'auxiliary_checker' || role === 'method_frame' || role === 'safety_gate';
  }).length;
  if (relevantFrameCount > 1 || auxiliaryFrames.length > 0) {
    return {
      detected_domain: domainInfo.detected_domain_packages.map(d => d.package_id),
      primary_frame: primaryId || 'none',
      auxiliary_frames: auxiliaryFrames.map(f => f.package_id),
      active_unrelated_frames: activeUnrelatedFrames,
      frame_fit_status: 'valid_multi_frame',
      reason: 'Multiple packages activated, but non-primary frames are compatible, auxiliary, or constraint-checking rather than dominant wrong frames.'
    };
  }

  return {
    detected_domain: domainInfo.detected_domain_packages.map(d => d.package_id),
    primary_frame: primaryId || 'none',
    auxiliary_frames: auxiliaryFrames.map(f => f.package_id),
    active_unrelated_frames: activeUnrelatedFrames,
    frame_fit_status: 'frame_aligned',
    reason: domainInfo.has_domain_support
      ? 'Primary domain package matches the claim and provides cluster or unit support.'
      : 'No wrong-frame condition was detected.'
  };
}

function domainGuardCorrectVerdict(sentence, trace, verdict, domainInfo) {
  if (verdict !== 'MISFRAMED') return { verdict, rule: 'no_guard_needed' };
  if (!domainInfo.has_detected_primary_domain || !domainInfo.uses_detected_domain_vocabulary) {
    return { verdict, rule: 'misframed_no_detected_domain_guard' };
  }
  const blocking = (trace.triggered_constraints || []).some(t => t.constraint.blocks_answer);
  const hasConstraints = (trace.triggered_constraints || []).length > 0;
  if (blocking) return { verdict: 'BLOCKED', rule: 'domain_guard_blocking_constraint' };
  if (domainInfo.has_domain_support) {
    return {
      verdict: hasConstraints ? 'PARTIAL' : 'SOLID',
      rule: hasConstraints ? 'domain_guard_supported_with_constraints' : 'domain_guard_supported'
    };
  }
  return { verdict: 'COVERAGE_GAP', rule: 'domain_guard_coverage_gap' };
}

function verdictDebugBase(sentence, trace, domainInfo) {
  const frameFit = frameFitDetails(sentence, trace, domainInfo);
  return {
    detected_domain_packages: domainInfo.detected_domain_packages.map(d => ({
      package_id: d.package_id,
      matches: d.matches || [],
      active: !!d.active,
      has_support: !!d.has_support
    })),
    primary_domain_packages: domainInfo.primary_domain_packages,
    active_packages: (trace.active_packages || []).map(p => p.manifest.package_id),
    suppressed_packages: (trace.suppressed_packages || []).map(s => s.package_id),
    triggered_constraints: (trace.triggered_constraints || []).map(t => t.constraint.id),
    has_domain_support: domainInfo.has_domain_support,
    has_any_support: (trace.units || []).length > 0 || (trace.activated_clusters || []).length > 0,
    frame_misalignment_reasons: frameMisalignmentReasons(sentence, trace, domainInfo),
    coverage_gap_reasons: coverageGapReasons(sentence, trace, domainInfo),
    frame_fit: frameFit,
    final_rule_applied: ''
  };
}

function classifyClaimSentenceDetailed(sentence, trace) {
  const domainInfo = buildDomainInfo(sentence, trace);
  const debug = verdictDebugBase(sentence, trace, domainInfo);
  const blocking = (trace.triggered_constraints || []).filter(t => t.constraint.blocks_answer);
  const units = trace.units || [];
  const clusters = trace.activated_clusters || [];
  const multiFrame = (trace.active_packages || []).length > 1;
  const hasConstraints = (trace.triggered_constraints || []).length > 0;

  let verdict;
  let rule;
  if (blocking.length > 0) {
    verdict = 'BLOCKED';
    rule = 'blocking_constraint';
  } else if (coverageGapReasons(sentence, trace, domainInfo).length > 0) {
    verdict = 'COVERAGE_GAP';
    rule = 'detected_domain_without_support';
  } else if (isTrueFrameMisalignment(sentence, trace, domainInfo)) {
    verdict = 'MISFRAMED';
    rule = 'explicit_true_frame_misalignment';
  } else if (units.length > 0 && (hasConstraints || multiFrame)) {
    verdict = 'PARTIAL';
    rule = 'support_with_constraints_or_multiframe';
  } else if (units.length >= 2 && clusters.length > 0) {
    verdict = 'SOLID';
    rule = 'clusters_and_units_no_major_constraints';
  } else if (units.length > 0 || clusters.length > 0) {
    verdict = 'FRAGILE';
    rule = 'weak_support';
  } else if (isClaimLikeSentence(sentence)) {
    verdict = 'UNSUPPORTED';
    rule = 'claim_like_no_support';
  } else {
    verdict = 'FRAGILE';
    rule = 'short_or_weak_claim';
  }

  const corrected = domainGuardCorrectVerdict(sentence, trace, verdict, domainInfo);
  debug.final_rule_applied = corrected.rule === 'no_guard_needed' ? rule : corrected.rule;
  if (corrected.verdict !== verdict) {
    debug.original_verdict = verdict;
    debug.original_rule = rule;
  }
  return { verdict: corrected.verdict, verdict_debug: debug };
}

function classifyClaimSentence(sentence, trace) {
  return classifyClaimSentenceDetailed(sentence, trace).verdict;
}

function appraiseClaimSentence(sentence) {
  const trace = retrieve(sentence);
  const frame_roles = assignFrameRoles(sentence, trace);
  trace.frame_roles = frame_roles;
  const detailed = classifyClaimSentenceDetailed(sentence, trace);
  const verdict = detailed.verdict;
  const display_status = claimDisplayStatus(verdict, trace, detailed.verdict_debug);
  return {
    sentence,
    trace,
    verdict,
    display_status,
    verdict_debug: detailed.verdict_debug,
    frame_fit: detailed.verdict_debug.frame_fit,
    frame_roles,
    primary_frame: frame_roles.primary_frame,
    auxiliary_frames: frame_roles.auxiliary_frames,
    constraint_frames: frame_roles.constraint_frames,
    suppressed_frames: frame_roles.suppressed_frames,
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
  if (verdict === 'COVERAGE_GAP') return 'Treat this as a package coverage issue: load or author a package cluster/unit for the relevant domain before making a stronger package-supported claim.';
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
  if (verdicts.includes('COVERAGE_GAP')) return 'COVERAGE_GAP';
  if (claims.length > 0 && verdicts.every(v => v === 'SOLID')) return 'SOLID';
  if (verdicts.includes('PARTIAL') || verdicts.includes('SOLID') || verdicts.includes('FRAGILE')) return 'PARTIAL';
  return 'UNSUPPORTED';
}

function isSupportedWithCaveatDebug(debug) {
  return !!debug &&
    debug.final_rule_applied === 'support_with_constraints_or_multiframe' &&
    debug.has_domain_support === true &&
    debug.has_any_support === true &&
    (debug.frame_misalignment_reasons || []).length === 0 &&
    (debug.coverage_gap_reasons || []).length === 0;
}

function claimDisplayStatus(verdict, trace, debug) {
  const frameStatus = debug?.frame_fit?.frame_fit_status || 'unknown';
  const blocking = (trace.triggered_constraints || []).some(t => t.constraint.blocks_answer);
  const triggered = (trace.triggered_constraints || []).length > 0;
  const caveatNeeded = isSupportedWithCaveatDebug(debug) || frameStatus === 'valid_multi_frame' || triggered;

  let support_verdict;
  if (blocking || verdict === 'BLOCKED') {
    support_verdict = 'Blocked';
  } else if (verdict === 'COVERAGE_GAP' || frameStatus === 'coverage_gap') {
    support_verdict = 'Coverage gap';
  } else if (verdict === 'UNSUPPORTED' || verdict === 'MISFRAMED') {
    support_verdict = 'Unsupported';
  } else if (debug?.has_domain_support && debug?.has_any_support) {
    support_verdict = 'Package-supported';
  } else if (verdict === 'FRAGILE' || (trace.units || []).length > 0 || (trace.activated_clusters || []).length > 0) {
    support_verdict = 'Weakly supported';
  } else {
    support_verdict = 'Unsupported';
  }

  const frame_fit = {
    frame_aligned: 'Aligned',
    valid_multi_frame: 'Valid multi-frame',
    frame_misaligned: 'Frame-misaligned',
    coverage_gap: 'Coverage gap'
  }[frameStatus] || 'Aligned';

  let caveat_status = 'No caveat triggered';
  if (blocking) {
    caveat_status = 'Blocking constraint triggered';
  } else if (triggered && verdict !== 'SOLID') {
    caveat_status = 'Constraint repair needed';
  } else if (caveatNeeded) {
    caveat_status = 'Caveat needed';
  }

  const main_label = support_verdict === 'Package-supported' && caveat_status !== 'No caveat triggered'
    ? 'Package-supported, caveat needed'
    : support_verdict;

  const explanation = support_verdict === 'Package-supported' && caveat_status !== 'No caveat triggered'
    ? 'This means TCog-R found package support and no frame mismatch, but at least one constraint/caveat was triggered. The claim is not rejected; it needs a more precise formulation.'
    : '';

  return {
    support_verdict,
    frame_fit,
    frame_fit_status: frameStatus,
    caveat_status,
    main_label,
    explanation
  };
}

function appraiseClaimSolidity(text) {
  const claims = claimsFromMechanicalSplitter(text);
  const record = buildSolidityAppraisalRecord(text, claims);
  record.extraction_used = 'mechanical';
  return record;
}

// ============================================================================
// LLM-assisted claim extraction
// ============================================================================
// The mechanical sentence splitter appraises sentences in isolation, which
// breaks on anaphora and contrastive continuation ("This distinguishes it
// from..."). When a provider key is available, we let the LLM extract
// coherent claims from the user's text and resolve references using only the
// provided text. TCog packages remain the source of support; the LLM is not
// allowed to invent ids, citations, or facts. Mechanical splitting remains
// the audit baseline and the no-key fallback.
// ============================================================================

// Backwards-compatible alias so callers can use the suggested name.
const parseJsonFromProviderText = parseLLMJsonStrict;

// Mechanical fallback path; produces the same per-claim shape as the LLM path.
function claimsFromMechanicalSplitter(text) {
  return splitIntoClaimSentences(text)
    .filter(s => tokenize(s).length >= 5)
    .map(appraiseClaimSentence);
}

function buildClaimExtractionPrompt(text) {
  const systemPrompt = `You are the claim-extraction layer for TCog-R Claim Solidity Appraisal. Your job is to extract coherent claims from the user's text and canonicalize them so each claim can be appraised in isolation. You may resolve pronouns and demonstratives ("this", "that", "it", "these", "those", "such", "the former", "the latter") using ONLY the local text. Do NOT add new facts. Do NOT evaluate the claims. Do NOT mention TCog packages. Return JSON only.`;

  const userPrompt = `Original text:
${text}

Extract claims as JSON. Rules:
- Extract coherent claims; a claim may span more than one sentence when discourse continuation requires it.
- Preserve the author's intended meaning. Do not invent claims that are not present.
- Resolve references ("this", "that", "it", "these", "those", "such", "former", "latter", "this distinguishes", "this implies", "this contrasts with") using ONLY the local text. If a reference cannot be resolved confidently from the text, leave it and note this in confidence_note.
- For contrastive claims, the canonical_claim should include both sides of the contrast so it stands alone.
- original_text_span must be a verbatim substring (or near-verbatim) of the original text.
- canonical_claim is the standalone, reference-resolved version used for retrieval.
- claim_type should be one of: definition, contrast, causal, normative, empirical, procedural, other.
- depends_on_previous=true when the claim only makes sense after an earlier claim's content has been resolved into it.
- Do not add facts, package ids, unit ids, constraints, or citations.

Return ONLY a JSON object with this exact shape:

{
  "claims": [
    {
      "claim_id": "claim_1",
      "original_text_span": "",
      "canonical_claim": "",
      "claim_type": "definition | contrast | causal | normative | empirical | procedural | other",
      "depends_on_previous": false,
      "resolved_references": [
        {"original": "", "resolved_as": ""}
      ],
      "context_needed": "",
      "confidence_note": ""
    }
  ]
}`;
  return { systemPrompt, userPrompt };
}

// Validation: ensures each extracted claim has the minimum fields and is
// grounded in the original text. canonical_claim does not need to be a
// verbatim substring (it may resolve pronouns), but it must not be wildly
// untethered from the source. Returns { claims, warnings, ok }.
function validateExtractedClaims(extraction, originalText) {
  const warnings = [];
  if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.claims)) {
    return { claims: [], warnings: ['extraction: missing or malformed "claims" array'], ok: false };
  }

  const originalNorm = normalize(originalText || '');
  const originalTokens = new Set(tokenize(originalText || ''));
  const kept = [];
  let claimCounter = 0;
  const seenIds = new Set();

  for (const raw of extraction.claims) {
    if (!raw || typeof raw !== 'object') {
      warnings.push('extraction: dropped non-object claim entry');
      continue;
    }
    let claim_id = typeof raw.claim_id === 'string' && raw.claim_id ? raw.claim_id : null;
    if (!claim_id || seenIds.has(claim_id)) {
      claim_id = `claim_${++claimCounter}`;
      while (seenIds.has(claim_id)) claim_id = `claim_${++claimCounter}`;
    }
    seenIds.add(claim_id);

    const canonical = typeof raw.canonical_claim === 'string' ? raw.canonical_claim.trim() : '';
    const span = typeof raw.original_text_span === 'string' ? raw.original_text_span.trim() : '';

    if (!canonical) {
      warnings.push(`${claim_id}: empty canonical_claim — dropped`);
      continue;
    }
    if (!span) {
      warnings.push(`${claim_id}: missing original_text_span — using canonical_claim for display`);
    }

    // Soft grounding check: the canonical claim should share most content
    // tokens with the original text. We don't require exact substring match
    // (pronouns get resolved), but we do flag claims whose tokens look
    // mostly disjoint from the source.
    const claimTokens = tokenize(canonical).filter(t => t.length > 2);
    const overlap = claimTokens.filter(t => originalTokens.has(t)).length;
    const ratio = claimTokens.length ? overlap / claimTokens.length : 0;
    if (ratio < 0.3) {
      warnings.push(`${claim_id}: canonical_claim has low token overlap with original text (${overlap}/${claimTokens.length}) — may have introduced new content`);
    }

    // Span grounding: when present, the span should appear in the original.
    if (span) {
      const spanNorm = normalize(span);
      if (spanNorm && !originalNorm.includes(spanNorm)) {
        warnings.push(`${claim_id}: original_text_span not found verbatim in source — kept for display only`);
      }
    }

    const allowedTypes = new Set(['definition', 'contrast', 'causal', 'normative', 'empirical', 'procedural', 'other']);
    const claim_type = allowedTypes.has(raw.claim_type) ? raw.claim_type : 'other';

    kept.push({
      claim_id,
      original_text_span: span || canonical,
      canonical_claim: canonical,
      claim_type,
      depends_on_previous: !!raw.depends_on_previous,
      resolved_references: Array.isArray(raw.resolved_references)
        ? raw.resolved_references.filter(r => r && typeof r === 'object' && typeof r.original === 'string' && typeof r.resolved_as === 'string')
        : [],
      context_needed: typeof raw.context_needed === 'string' ? raw.context_needed : '',
      confidence_note: typeof raw.confidence_note === 'string' ? raw.confidence_note : ''
    });
  }

  return { claims: kept, warnings, ok: kept.length > 0 };
}

// Appraises a single LLM-extracted claim by running TCog retrieval on the
// canonical_claim while preserving the original_text_span for display and
// keeping extraction metadata available in debug.
function appraiseExtractedClaim(extracted) {
  const appraisal = appraiseClaimSentence(extracted.canonical_claim);
  appraisal.sentence = extracted.original_text_span || extracted.canonical_claim;
  appraisal.canonical_claim = extracted.canonical_claim;
  appraisal.original_text_span = extracted.original_text_span || extracted.canonical_claim;
  appraisal.extraction_meta = {
    claim_id: extracted.claim_id,
    claim_type: extracted.claim_type,
    depends_on_previous: !!extracted.depends_on_previous,
    resolved_references: extracted.resolved_references || [],
    context_needed: extracted.context_needed || '',
    confidence_note: extracted.confidence_note || ''
  };
  return appraisal;
}

// LLM extraction wrapper. Returns either a successful extraction record or
// throws so the caller can fall back to mechanical splitting.
async function runLLMClaimExtraction(text, providerConfig) {
  const prompt = buildClaimExtractionPrompt(text);
  const responseText = await generatePromptWithProvider(
    providerConfig.provider,
    prompt.systemPrompt,
    prompt.userPrompt,
    providerConfig.apiKey,
    providerConfig.model
  );
  const parsed = parseJsonFromProviderText(responseText);
  const validated = validateExtractedClaims(parsed, text);
  return validated;
}

// Builds the appraisal-level summary record from per-claim results. Extracted
// so that the LLM relevance filter can rebuild the record after mutating
// per-claim verdicts/display_status without re-running mechanical retrieval.
function buildSolidityAppraisalRecord(text, claims) {
  const overall = aggregateSolidityVerdict(claims);
  const overallDisplayLabel = overallDisplayLabelForClaims(overall, claims);

  const supportedCount = claims.filter(c => c.verdict === 'SOLID' || c.verdict === 'PARTIAL').length;
  const constraintCount = claims.filter(c => c.triggered_constraints.length > 0).length;
  const caveatCount = claims.filter(c => c.display_status?.caveat_status !== 'No caveat triggered').length;
  const supportCounts = {
    package_supported: claims.filter(c => c.display_status?.support_verdict === 'Package-supported').length,
    weakly_supported: claims.filter(c => c.display_status?.support_verdict === 'Weakly supported').length,
    unsupported: claims.filter(c => c.display_status?.support_verdict === 'Unsupported').length,
    coverage_gap: claims.filter(c => c.display_status?.support_verdict === 'Coverage gap').length,
    blocked: claims.filter(c => c.display_status?.support_verdict === 'Blocked').length
  };
  const caveatCounts = {
    no_caveat: claims.filter(c => c.display_status?.caveat_status === 'No caveat triggered').length,
    caveat_needed: claims.filter(c => c.display_status?.caveat_status === 'Caveat needed').length,
    constraint_repair_needed: claims.filter(c => c.display_status?.caveat_status === 'Constraint repair needed').length,
    blocking_constraint: claims.filter(c => c.display_status?.caveat_status === 'Blocking constraint triggered').length
  };
  const frameCounts = {
    frame_aligned: claims.filter(c => c.frame_fit?.frame_fit_status === 'frame_aligned').length,
    valid_multi_frame: claims.filter(c => c.frame_fit?.frame_fit_status === 'valid_multi_frame').length,
    frame_misaligned: claims.filter(c => c.frame_fit?.frame_fit_status === 'frame_misaligned').length,
    coverage_gap: claims.filter(c => c.frame_fit?.frame_fit_status === 'coverage_gap').length
  };
  const primaryFrames = [...new Set(claims.map(c => c.primary_frame?.package_id).filter(Boolean))];
  const constraintFrames = [...new Set(claims.flatMap(c => c.constraint_frames || []).map(f => f.package_id))];
  const suppressedFrames = [...new Set(claims.flatMap(c => c.suppressed_frames || []).map(f => f.package_id))];

  return {
    input: text,
    overall,
    overall_display_label: overallDisplayLabel,
    claims,
    frame_roles: {
      primary_frame: primaryFrames[0] || null,
      auxiliary_frames: primaryFrames.slice(1),
      constraint_frames: constraintFrames,
      suppressed_frames: suppressedFrames
    },
    support_summary: claims.length
      ? `${supportedCount} of ${claims.length} claims package-supported or partially package-supported.`
      : 'No claim-like sentences were found.',
    constraint_summary: constraintCount
      ? `${constraintCount} claim${constraintCount !== 1 ? 's' : ''} constraint-triggered.`
      : 'No constraints triggered.',
    support_counts: supportCounts,
    caveat_counts: caveatCounts,
    support_verdict_summary: claims.length
      ? `${supportCounts.package_supported} package-supported.\n${supportCounts.weakly_supported} weakly supported.\n${supportCounts.unsupported} unsupported.\n${supportCounts.coverage_gap} coverage gap${supportCounts.coverage_gap !== 1 ? 's' : ''}.\n${supportCounts.blocked} blocked.`
      : '0 package-supported.\n0 weakly supported.\n0 unsupported.\n0 coverage gaps.\n0 blocked.',
    caveat_status_summary: claims.length
      ? `${caveatCounts.no_caveat} no caveat triggered.\n${caveatCounts.caveat_needed} caveat needed.\n${caveatCounts.constraint_repair_needed} constraint repair needed.\n${caveatCounts.blocking_constraint} blocking constraint triggered.\n${caveatCount} claim${caveatCount !== 1 ? 's have' : ' has'} a caveat or triggered constraint.`
      : '0 no caveat triggered.\n0 caveat needed.\n0 constraint repair needed.\n0 blocking constraint triggered.\n0 claims have a caveat or triggered constraint.',
    frame_fit_counts: frameCounts,
    frame_fit_summary: claims.length
      ? `${frameCounts.frame_aligned} claim${frameCounts.frame_aligned !== 1 ? 's' : ''} frame-aligned.\n${frameCounts.valid_multi_frame} valid multi-frame.\n${frameCounts.frame_misaligned} frame-misaligned.\n${frameCounts.coverage_gap} coverage gap${frameCounts.coverage_gap !== 1 ? 's' : ''}.`
      : '0 claims frame-aligned.\n0 valid multi-frame.\n0 frame-misaligned.\n0 coverage gaps.'
  };
}

function debugSoliditySentence(sentence) {
  return appraiseClaimSentence(sentence);
}

window.debugSoliditySentence = debugSoliditySentence;

// ============================================================================
// Covers test runner (TCog Protocol v0.3.1 §4.4)
// ============================================================================
// Run from the browser console after loading the relevant packages:
//   window.tcogCoversTests()                  // run all
//   window.tcogCoversTests('what is a tree?') // ad-hoc probe
// Tests assert routing decisions, not specific package contents — they are
// generic over the loaded package set and skip cases when required packages
// are not loaded, rather than failing.
function tcogCoversTests(adHocQuery) {
  if (typeof adHocQuery === 'string' && adHocQuery) {
    const result = coversRoute(adHocQuery);
    console.log('[covers] ad-hoc:', adHocQuery, result);
    return result;
  }
  const have = id => LOADED_PACKAGES.some(p => p.manifest && p.manifest.package_id === id);
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}`, detail || '');
  };
  const skip = (name, why) => {
    results.push({ name, ok: null, skipped: why });
    console.log(`- ${name} (skipped: ${why})`);
  };

  // 1. Definitional + single-package match (uses any package with covers)
  (() => {
    if (have('economics_core')) {
      const r = coversRoute('what is opportunity cost?');
      const hit = r.matches.some(m => m.package_id === 'economics_core' && /opportunity cost/i.test(m.concept));
      record('1. definitional single-package: opportunity cost → economics_core', hit, r);
    } else {
      skip('1. opportunity cost', 'economics_core not loaded');
    }
  })();

  // 2. Productive cross-package overlap
  if (have('graph_theory_core') && have('combinatorics_discrete_structures_core')) {
    const r = coversRoute('what is a tree?');
    const gt = r.matches.some(m => m.package_id === 'graph_theory_core');
    const cb = r.matches.some(m => m.package_id === 'combinatorics_discrete_structures_core');
    record('2a. tree → both graph_theory_core AND combinatorics_discrete_structures_core', gt && cb, r);
  } else {
    skip('2a. tree multi-package', 'graph_theory_core or combinatorics_discrete_structures_core not loaded');
  }
  if (have('probability_stats_core') && have('ml_core')) {
    const r = coversRoute('what is sampling bias?');
    const ps = r.matches.some(m => m.package_id === 'probability_stats_core');
    const ml = r.matches.some(m => m.package_id === 'ml_core');
    record('2b. sampling bias → both probability_stats_core AND ml_core', ps && ml, r);
  } else {
    skip('2b. sampling bias multi-package', 'probability_stats_core or ml_core not loaded');
  }

  // 3. Non-definitional query: covers does NOT fire
  (() => {
    const r = coversRoute('how do I analyze this data?');
    record('3. non-definitional: how do I analyze this data?',
      r.query_class === 'procedural' || r.matches.length === 0,
      { query_class: r.query_class, matches: r.matches.length });
  })();
  (() => {
    const r = coversRoute('Compare frequentist and Bayesian inference.');
    record('3b. non-definitional: comparative does not run covers',
      r.query_class !== 'definitional' && r.matches.length === 0, r);
  })();

  // 4. avoid_when override
  (() => {
    const r = coversRoute('how should I comfort someone panicking?');
    const technical = r.matches.filter(m => m.package_id === 'probability_stats_core' || m.package_id === 'algorithm_design_core');
    record('4. avoid_when overrides covers (no technical packages routed)',
      technical.length === 0, r);
  })();

  // 5. Definitional + no covers match
  (() => {
    const r = coversRoute('what is the Banach fixed point theorem?');
    record('5. definitional + no covers match falls through cleanly',
      r.query_class === 'definitional' && Array.isArray(r.matches), r);
  })();

  // 6. Bare noun-phrase definitional
  if (have('probability_stats_core')) {
    const r = coversRoute('Bayes factor');
    const hit = r.matches.some(m => m.package_id === 'probability_stats_core' && /bayes factor/i.test(m.concept));
    record('6. bare noun-phrase: "Bayes factor" routes to probability_stats_core',
      r.query_class === 'definitional' && hit, r);
  } else {
    skip('6. Bayes factor bare-NP', 'probability_stats_core not loaded');
  }

  // 7. Package without covers still works (no errors, no surfacing via covers)
  (() => {
    const noCovers = LOADED_PACKAGES.filter(p => !getCoversIndex(p));
    if (noCovers.length === 0) {
      skip('7. covers-less packages skipped cleanly', 'no covers-less packages currently loaded');
      return;
    }
    let ok = true;
    try {
      coversRoute('what is anything?');
    } catch (e) {
      ok = false;
    }
    record('7. covers-less packages do not break covers stage', ok,
      `covers-less packages: ${noCovers.map(p => p.manifest.package_id).join(', ')}`);
  })();

  // 8. Substring containment is intentional
  if (have('probability_stats_core')) {
    const r = coversRoute('what is a confidence interval?');
    const exact = r.matches.some(m => m.package_id === 'probability_stats_core' && normalizeForCovers(m.concept) === 'confidence interval');
    const containment = r.matches.some(m => m.package_id === 'probability_stats_core' && /credible interval vs confidence interval/i.test(m.concept));
    record('8. substring containment: surfaces both exact and "credible interval vs confidence interval"',
      exact && containment, r);
  } else {
    skip('8. confidence interval containment', 'probability_stats_core not loaded');
  }

  const passed = results.filter(r => r.ok === true).length;
  const failed = results.filter(r => r.ok === false).length;
  const skipped = results.filter(r => r.ok === null).length;
  console.log(`covers tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  return { passed, failed, skipped, results };
}

window.tcogCoversTests = tcogCoversTests;
window.coversRoute = coversRoute;
window.detectQueryClass = detectQueryClass;
window.extractCoversTarget = extractCoversTarget;

function verdictClassLabel(verdict) {
  return {
    SOLID: 'Package-supported',
    PARTIAL: 'Package-supported, caveat needed',
    FRAGILE: 'Weakly supported',
    COVERAGE_GAP: 'Coverage gap',
    MISFRAMED: 'Frame-misaligned',
    UNSUPPORTED: 'Unsupported',
    BLOCKED: 'Blocked'
  }[verdict] || verdict;
}

function frameLabel(frame) {
  if (!frame) return 'none';
  return typeof frame === 'string' ? frame : frame.package_id;
}

function frameListLabel(frames) {
  return frames && frames.length ? frames.map(frameLabel).join(', ') : 'none';
}

function verdictExplanation(verdict) {
  if (verdict === 'COVERAGE_GAP') {
    return 'The text appears to belong to a domain frame, but the loaded packages did not provide enough matching clusters or units. This is a package coverage issue, not necessarily a problem with the claim.';
  }
  if (verdict === 'MISFRAMED') {
    return 'The text appears to use a frame that does not fit the claim, or it collapses incompatible frames.';
  }
  return '';
}

function frameFitStatusLabel(status) {
  return {
    frame_aligned: 'Aligned',
    valid_multi_frame: 'Valid multi-frame',
    frame_misaligned: 'Frame-misaligned',
    coverage_gap: 'Coverage gap'
  }[status] || status || 'unknown';
}

function appraisalOverallDisplayLabel(appraisal) {
  return appraisal.overall_display_label || overallDisplayLabelForClaims(appraisal.overall, appraisal.claims || []);
}

function overallDisplayLabelForClaims(overall, claims) {
  if (claims.length > 0 &&
      claims.every(c => c.display_status?.support_verdict === 'Package-supported') &&
      claims.some(c => c.display_status?.caveat_status !== 'No caveat triggered')) {
    return 'Package-supported, caveat needed';
  }
  if (claims.length > 0 && claims.every(c => c.display_status?.support_verdict === 'Package-supported')) {
    return 'Package-supported';
  }
  return verdictClassLabel(overall);
}

function renderVerdictDebug(debug) {
  if (!debug) return '';
  const fmt = (value) => Array.isArray(value)
    ? (value.length ? value.map(v => typeof v === 'string' ? v : `${v.package_id}${v.matches?.length ? ` (${v.matches.join(', ')})` : ''}`).join('; ') : 'none')
    : String(value);
  return `
    <details style="margin-top:6px;">
      <summary>Why this verdict?</summary>
      <div style="font-size:12px; color:var(--ink-soft); margin-top:6px;">
        <p><strong>Detected domain packages:</strong> ${escapeHtml(fmt(debug.detected_domain_packages))}</p>
        <p><strong>Primary domain packages:</strong> ${escapeHtml(fmt(debug.primary_domain_packages))}</p>
        <p><strong>Active packages:</strong> ${escapeHtml(fmt(debug.active_packages))}</p>
        <p><strong>Suppressed packages:</strong> ${escapeHtml(fmt(debug.suppressed_packages))}</p>
        <p><strong>Triggered constraints:</strong> ${escapeHtml(fmt(debug.triggered_constraints))}</p>
        <p><strong>Has domain support:</strong> ${debug.has_domain_support ? 'true' : 'false'} · <strong>Has any support:</strong> ${debug.has_any_support ? 'true' : 'false'}</p>
        <p><strong>Frame-misalignment reasons:</strong> ${escapeHtml(fmt(debug.frame_misalignment_reasons))}</p>
        <p><strong>Coverage-gap reasons:</strong> ${escapeHtml(fmt(debug.coverage_gap_reasons))}</p>
        <p><strong>frame_fit:</strong></p>
        <pre style="white-space:pre-wrap; margin:4px 0 8px; color:var(--ink-soft);">${escapeHtml(JSON.stringify(debug.frame_fit || {}, null, 2))}</pre>
        <p><strong>Final rule applied:</strong> <code>${escapeHtml(debug.final_rule_applied || '—')}</code></p>
        ${debug.original_verdict ? `<p><strong>Corrected from:</strong> ${escapeHtml(debug.original_verdict)} via ${escapeHtml(debug.original_rule || '')}</p>` : ''}
      </div>
    </details>
  `;
}

function renderFrameRoleSummary(appraisal) {
  const primaryClaims = appraisal.claims.filter(c => c.primary_frame);
  const primaryFrame = appraisal.frame_roles.primary_frame || 'none';
  const auxiliary = appraisal.frame_roles.auxiliary_frames || [];
  const constraints = appraisal.frame_roles.constraint_frames || [];
  const suppressed = appraisal.frame_roles.suppressed_frames || [];
  const claimLines = primaryClaims.length
    ? '<ul class="trace-list">' + primaryClaims.map(c =>
        `<li><code>${escapeHtml(c.primary_frame.package_id)}</code> <span style="color:var(--ink-faint);">for</span> ${escapeHtml(c.sentence)}<div style="font-size:12px; color:var(--ink-soft);">domain cues: ${escapeHtml(diagnosticValue(c.primary_frame.cue_matches || []))}</div></li>`
      ).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); margin:0;"><em>No primary frame assigned.</em></p>';

  return `
    <div class="comparison-pane">
      <h4>Primary frame</h4>
      <p><code>${escapeHtml(primaryFrame)}</code></p>
      ${claimLines}
    </div>
    <div class="comparison-pane">
      <h4>Auxiliary constraints</h4>
      <p><strong>Auxiliary frames:</strong> ${escapeHtml(frameListLabel(auxiliary))}</p>
      <p><strong>Constraint frames:</strong> ${escapeHtml(frameListLabel(constraints))}</p>
      <p><strong>Suppressed frames:</strong> ${escapeHtml(frameListLabel(suppressed))}</p>
    </div>
  `;
}

function renderClaimInterpretation(claim) {
  // Only meaningful when the LLM extracted the claim (canonical_claim differs
  // from the original_text_span, or extraction metadata is present).
  const meta = claim.extraction_meta;
  if (!meta) return '';
  const canonical = claim.canonical_claim || '';
  const sentence = claim.sentence || '';
  const sameAsSentence = normalize(canonical) === normalize(sentence);
  const refs = (meta.resolved_references || []).filter(r => r && r.original);
  const refsHtml = refs.length
    ? '<ul class="trace-list">' + refs.map(r => `<li><code>${escapeHtml(r.original)}</code> → ${escapeHtml(r.resolved_as || '')}</li>`).join('') + '</ul>'
    : '';
  const summary = sameAsSentence
    ? `Claim interpreted as: <em>same as written</em>${meta.depends_on_previous ? ' · depends on previous' : ''}`
    : `Claim interpreted as: ${escapeHtml(canonical)}${meta.depends_on_previous ? ' <span style="color:var(--ink-faint);">(depends on previous)</span>' : ''}`;
  const noteHtml = meta.confidence_note
    ? `<div style="margin-top:4px; color:var(--ink-soft);">${escapeHtml(meta.confidence_note)}</div>`
    : '';
  const contextHtml = meta.context_needed
    ? `<div style="margin-top:4px; color:var(--ink-soft);"><strong>Context needed:</strong> ${escapeHtml(meta.context_needed)}</div>`
    : '';
  return `
    <details style="margin-top:6px; font-size:12px; color:var(--ink-soft);">
      <summary>${summary}</summary>
      <div style="margin-top:6px;">
        <div><strong>Canonical claim:</strong></div>
        <div style="margin-top:2px;">${escapeHtml(canonical)}</div>
        ${refs.length ? `<div style="margin-top:6px;"><strong>Resolved references:</strong></div>${refsHtml}` : ''}
        ${contextHtml}
        ${noteHtml}
        <div style="margin-top:6px; color:var(--ink-faint);">claim_id: <code>${escapeHtml(meta.claim_id || '')}</code> · type: <code>${escapeHtml(meta.claim_type || '')}</code></div>
      </div>
    </details>
  `;
}

function renderExtractionMetaCard(appraisal) {
  if (appraisal.extraction_used !== 'llm') return null;
  const warnings = appraisal.extraction_warnings || [];
  const div = document.createElement('div');
  div.className = 'section section-A';
  const warningsHtml = warnings.length
    ? '<details style="margin-top:6px;"><summary>Extraction warnings (' + warnings.length + ')</summary><ul class="trace-list">' + warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('') + '</ul></details>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No extraction warnings.</em></p>';
  div.innerHTML = `
    <div class="section-label"><span>LLM-assisted claim extraction</span><span style="color:var(--ink-faint);">${appraisal.claims.length} claim${appraisal.claims.length !== 1 ? 's' : ''} extracted</span></div>
    <div class="section-content">
      <p style="font-size:13px; color:var(--ink-soft); margin:0;">Coherent claims were extracted from the original text and references were resolved using only the local text. Mechanical retrieval ran on the canonical claims; click "Claim interpreted as" in any row to see the resolved form.</p>
      ${warningsHtml}
    </div>
  `;
  return div;
}

function renderConstraintRelevanceCell(claim) {
  const cr = claim.constraint_relevance;
  if (!cr) return '';
  const fmtIds = items => (items && items.length)
    ? '<ul class="trace-list">' + items.map(id => `<li><code>${escapeHtml(id)}</code></li>`).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:12px; margin:0;"><em>none</em></p>';
  const fmtObjs = items => (items && items.length)
    ? '<ul class="trace-list">' + items.map(e => `<li><code>${escapeHtml(e.constraint_id)}</code>${e.reason ? ` — ${escapeHtml(e.reason)}` : ''}</li>`).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:12px; margin:0;"><em>none</em></p>';
  const warningsHtml = (cr.validation_warnings && cr.validation_warnings.length)
    ? `<div style="margin-top:6px;"><strong>Validation warnings:</strong></div><ul class="trace-list">${cr.validation_warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : '';
  const mechanicalHtml = (claim.mechanical_triggered_constraints && claim.mechanical_triggered_constraints.length)
    ? `<div style="margin-top:6px; font-size:12px; color:var(--ink-soft);"><strong>Original mechanical triggers:</strong> ${escapeHtml(diagnosticValue(claim.mechanical_triggered_constraints))}</div>`
    : '';
  const rationale = cr.relevance_rationale
    ? `<p style="margin:4px 0 0; font-size:12px; color:var(--ink-soft);">${escapeHtml(cr.relevance_rationale)}</p>`
    : '';
  return `
    <div class="constraint-relevance" style="font-size:12px; margin-top:8px; padding-top:8px; border-top:1px dotted var(--rule);">
      <div><strong>Governing constraints</strong></div>
      ${fmtIds(cr.governing_constraints)}
      <div style="margin-top:6px;"><strong>Relevant auxiliary constraints</strong></div>
      ${fmtObjs(cr.relevant_auxiliary_constraints)}
      <details style="margin-top:6px;">
        <summary>Ignored lexical matches: these packages matched surface terms but were not treated as relevant constraints for this claim.</summary>
        ${fmtObjs(cr.ignored_lexical_constraints)}
        ${warningsHtml}
        ${mechanicalHtml}
      </details>
      ${rationale}
    </div>
  `;
}

function renderSolidityAppraisal(appraisal, repairedText = null) {
  const div = document.createElement('div');
  div.className = 'section section-compare';
  const rows = appraisal.claims.length
    ? appraisal.claims.map(c => `
      <tr>
        <td>${escapeHtml(c.sentence)}${renderClaimInterpretation(c)}</td>
        <td>${escapeHtml(frameLabel(c.primary_frame))}</td>
        <td>${escapeHtml(diagnosticValue(c.active_packages))}</td>
        <td>${escapeHtml(diagnosticValue(c.active_clusters.map(shortClusterId)))}</td>
        <td>${escapeHtml(diagnosticValue(c.triggered_constraints))}</td>
        <td>
          <span class="verdict-pill">${escapeHtml(c.display_status?.main_label || verdictClassLabel(c.verdict))}</span>
          ${c.display_status?.explanation ? `<div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(c.display_status.explanation)}</div>` : ''}
          ${verdictExplanation(c.verdict) ? `<div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(verdictExplanation(c.verdict))}</div>` : ''}
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Support verdict: <code>${escapeHtml(c.display_status?.support_verdict || 'unknown')}</code></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Frame fit: <code>${escapeHtml(c.display_status?.frame_fit || frameFitStatusLabel(c.frame_fit?.frame_fit_status))}</code>${c.frame_fit?.reason ? ` — ${escapeHtml(c.frame_fit.reason)}` : ''}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Caveat status: <code>${escapeHtml(c.display_status?.caveat_status || 'unknown')}</code></div>
          ${renderConstraintRelevanceCell(c)}
          ${renderVerdictDebug(c.verdict_debug)}
        </td>
        <td>${escapeHtml(c.suggested_repair)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7" style="color:var(--ink-faint);"><em>No claim-like sentences found.</em></td></tr>`;

  div.innerHTML = `
    <div class="section-label"><span>Claim Solidity Appraisal</span><span class="verdict-pill">${escapeHtml(appraisalOverallDisplayLabel(appraisal))}</span></div>
    <div class="comparison-grid">
      ${renderFrameRoleSummary(appraisal)}
      <div class="comparison-pane">
        <h4>Support verdict</h4>
        <p style="white-space:pre-line;">${escapeHtml(appraisal.support_verdict_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Frame fit</h4>
        <p style="white-space:pre-line;">${escapeHtml(appraisal.frame_fit_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Caveat status</h4>
        <p style="white-space:pre-line;">${escapeHtml(appraisal.caveat_status_summary)}</p>
      </div>
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
        <p style="white-space:pre-line;">${escapeHtml(appraisal.frame_fit_summary)}</p>
      </div>
      <div class="comparison-pane">
        <h4>Overall verdict</h4>
        <p><span class="verdict-pill">${escapeHtml(appraisalOverallDisplayLabel(appraisal))}</span></p>
        ${appraisal.claims.some(c => c.display_status?.explanation) ? `<p style="font-size:12px; color:var(--ink-soft);">${escapeHtml('This means TCog-R found package support and no frame mismatch, but at least one constraint/caveat was triggered. The claim is not rejected; it needs a more precise formulation.')}</p>` : ''}
      </div>
    </div>
    <div style="overflow-x:auto; margin-top:14px;">
      <table class="claim-table">
        <thead>
          <tr>
            <th>Claim sentence</th>
            <th>Primary frame</th>
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
Primary frame: ${frameLabel(c.primary_frame)}
Auxiliary frames: ${frameListLabel(c.auxiliary_frames)}
Constraint frames: ${frameListLabel(c.constraint_frames)}
Suppressed frames: ${frameListLabel(c.suppressed_frames)}
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
    const cr = c.constraint_relevance;
    const governingLine = cr
      ? `Governing constraints: ${diagnosticValue(cr.governing_constraints)}`
      : `Triggered constraints: ${diagnosticValue(c.triggered_constraints)}`;
    const relevantLine = cr
      ? `Relevant auxiliary constraints: ${diagnosticValue((cr.relevant_auxiliary_constraints || []).map(e => e.constraint_id))}`
      : '';
    const ignoredLine = cr
      ? `Ignored lexical matches (DO NOT use as reasons for the verdict): ${diagnosticValue((cr.ignored_lexical_constraints || []).map(e => e.constraint_id))}`
      : '';
    return [
      `${idx + 1}. Claim: ${c.sentence}`,
      `Verdict: ${c.verdict}`,
      `Primary frame: ${frameLabel(c.primary_frame)}`,
      `Auxiliary frames: ${frameListLabel(c.auxiliary_frames)}`,
      `Constraint frames: ${frameListLabel(c.constraint_frames)}`,
      `Suppressed frames: ${frameListLabel(c.suppressed_frames)}`,
      `Active packages: ${diagnosticValue(c.active_packages)}`,
      `Active clusters: ${diagnosticValue(c.active_clusters)}`,
      governingLine,
      relevantLine,
      ignoredLine,
      `Unit ids: ${unitIds}`,
      `Suggested repair: ${c.suggested_repair}`
    ].filter(Boolean).join('\n');
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
    systemPrompt: 'You are the prose-summary layer for TCog-R Claim Solidity Appraisal. The appraisal has already been computed mechanically; the LLM relevance filter (when present) has already classified constraints into governing, relevant_auxiliary, and ignored_lexical categories. Do not perform new retrieval, do not add external knowledge, and do not change the verdict. Summarize the findings clearly for a human reader. Ignored lexical constraints are not substantive cross-frame conflicts. Do not use them as reasons for the main verdict; you may mention them only under a brief "Ignored lexical matches, not used for verdict." aside.',
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

// ============================================================================
// Constraint relevance filter (LLM)
// ============================================================================
// Mechanical retrieval is broad; many constraints can fire from non-primary
// frames because terms are overloaded across domains. The relevance filter
// asks the LLM to classify each mechanically triggered constraint as
// governing / relevant_auxiliary / ignored_lexical so the verdict reflects
// substantive relevance instead of surface-term collisions. Mechanical
// validation remains authoritative — sticky safety constraints and primary-
// frame constraints cannot be silently removed by the LLM.
// ============================================================================

const SAFETY_PACKAGE_HINTS = [
  'medicine', 'medical', 'counsel', 'safety', 'crisis', 'emergency', 'red_flag', 'law'
];

// Sticky: critical/high blocking constraints from safety-like packages must
// remain visible regardless of LLM classification.
function isStickySafetyConstraint(constraintHit) {
  if (!constraintHit || !constraintHit.constraint) return false;
  const c = constraintHit.constraint;
  if (!c.blocks_answer) return false;
  const sev = String(c.severity || '').toLowerCase();
  if (sev !== 'critical' && sev !== 'high') return false;
  const pkgId = String(constraintHit.package_id || '').toLowerCase();
  const cId = String(c.id || '').toLowerCase();
  if (SAFETY_PACKAGE_HINTS.some(h => pkgId.includes(h))) return true;
  return /\b(safety|red_flag|crisis)\b/.test(cId);
}

function buildConstraintRelevancePrompt(sentence, sentenceAppraisal) {
  const trace = sentenceAppraisal.trace || {};
  const primary = sentenceAppraisal.primary_frame;
  const primaryId = primary ? primary.package_id : null;
  const constraintsBlock = (trace.triggered_constraints || []).map(t => {
    const c = t.constraint;
    return `- ${c.id} [pkg ${t.package_id}] severity=${c.severity || '—'} blocks_answer=${!!c.blocks_answer} | rule: ${c.rule || ''} | repair: ${c.repair || ''}`;
  }).join('\n') || '(none)';
  const pkgsBlock = (trace.active_packages || [])
    .map(p => `- ${p.manifest.package_id} (${p.manifest.domain || '—'})${primaryId === p.manifest.package_id ? ' [PRIMARY]' : ''}`)
    .join('\n') || '(none)';
  const clustersBlock = (trace.activated_clusters || [])
    .map(a => `- ${a.cluster.id} [pkg ${a.package_id}] cues: ${(a.positive_matches || []).join(', ') || '—'}`)
    .join('\n') || '(none)';
  const primaryUnits = (trace.units || [])
    .filter(u => primaryId && unitPackageId(u) === primaryId)
    .map(u => `- [${u.id}] ${u.label || ''}: ${u.definition || ''}`)
    .join('\n') || '(no primary-frame units retrieved)';

  const systemPrompt = `You are the constraint relevance-filtering layer for TCog-R Claim Solidity Appraisal. Mechanical retrieval is broad and may over-trigger constraints from non-primary packages because terms are overloaded across domains. Your job is to classify which mechanically triggered constraints are substantively relevant to the sentence and which matched only on overloaded surface terms. Do NOT use external knowledge. Do NOT invent constraint ids. Do NOT change the primary frame. Do NOT answer the user's claim. Return JSON only.`;

  const userPrompt = `Sentence:
${sentence}

Primary frame: ${primaryId || '(none)'}

Active packages:
${pkgsBlock}

Active clusters and cue matches:
${clustersBlock}

Primary-frame supporting units (if any):
${primaryUnits}

Mechanically triggered constraints (the only ids you may classify):
${constraintsBlock}

Rules:
- Classify only constraints listed above. Do NOT invent ids.
- Each constraint id must appear in exactly one category.
- Primary-frame constraints typically belong in governing_constraints.
- Non-primary constraints belong in relevant_auxiliary_constraints only when the sentence substantively invokes that domain frame.
- If a non-primary constraint matched only because of overloaded generic terms (e.g. "decision rule", "function", "evidence", "design", "model", "stability"), classify it as ignored_lexical_constraints with a brief reason.
- Do not treat ignored lexical constraints as cross-frame conflicts.
- Critical or high blocks_answer constraints from safety-like packages should not be ignored; the validator will keep them sticky.

Return ONLY a JSON object with this exact shape:

{
  "governing_constraints": [],
  "relevant_auxiliary_constraints": [
    {"constraint_id": "", "reason": ""}
  ],
  "ignored_lexical_constraints": [
    {"constraint_id": "", "reason": ""}
  ],
  "relevance_rationale": ""
}

governing_constraints is an array of constraint id strings.
The other two lists are arrays of {constraint_id, reason} objects.`;
  return { systemPrompt, userPrompt };
}

function validateConstraintRelevanceFilter(filterResult, sentenceAppraisal) {
  const warnings = [];
  const triggered = (sentenceAppraisal.trace && sentenceAppraisal.trace.triggered_constraints) || [];
  const constraintIndex = new Map(triggered.map(t => [t.constraint.id, t]));
  const primaryPkgId = sentenceAppraisal.primary_frame ? sentenceAppraisal.primary_frame.package_id : null;
  const seen = new Set();

  const filterIdList = (items, label) => {
    const kept = [];
    for (const id of items || []) {
      if (typeof id !== 'string') { warnings.push(`${label}: dropped non-string entry`); continue; }
      if (!constraintIndex.has(id)) { warnings.push(`${label}: unknown constraint id "${id}" — dropped`); continue; }
      if (seen.has(id)) { warnings.push(`${label}: "${id}" already classified — dropped from this category`); continue; }
      seen.add(id);
      kept.push(id);
    }
    return kept;
  };
  const filterObjList = (items, label) => {
    const kept = [];
    for (const obj of items || []) {
      if (!obj || typeof obj !== 'object') continue;
      const id = obj.constraint_id;
      if (typeof id !== 'string') { warnings.push(`${label}: dropped entry without constraint_id`); continue; }
      if (!constraintIndex.has(id)) { warnings.push(`${label}: unknown constraint id "${id}" — dropped`); continue; }
      if (seen.has(id)) { warnings.push(`${label}: "${id}" already classified — dropped from this category`); continue; }
      seen.add(id);
      kept.push({ constraint_id: id, reason: typeof obj.reason === 'string' ? obj.reason : '' });
    }
    return kept;
  };

  const governing_constraints = filterIdList(filterResult.governing_constraints, 'governing_constraints');
  const relevant_auxiliary_constraints = filterObjList(filterResult.relevant_auxiliary_constraints, 'relevant_auxiliary_constraints');
  let ignored_lexical_constraints = filterObjList(filterResult.ignored_lexical_constraints, 'ignored_lexical_constraints');

  // Sticky safety override: critical/high blocking safety constraints cannot be ignored.
  const stickyMoved = [];
  ignored_lexical_constraints = ignored_lexical_constraints.filter(entry => {
    if (isStickySafetyConstraint(constraintIndex.get(entry.constraint_id))) {
      stickyMoved.push(entry.constraint_id);
      return false;
    }
    return true;
  });
  for (const id of stickyMoved) {
    if (!governing_constraints.includes(id)) governing_constraints.push(id);
    warnings.push(`safety_override: "${id}" is a critical/high blocking safety constraint — kept as governing`);
  }

  // Primary-frame override: primary-frame constraints cannot be silently ignored.
  const primaryMoved = [];
  ignored_lexical_constraints = ignored_lexical_constraints.filter(entry => {
    const hit = constraintIndex.get(entry.constraint_id);
    if (primaryPkgId && hit && hit.package_id === primaryPkgId) {
      primaryMoved.push(entry.constraint_id);
      return false;
    }
    return true;
  });
  for (const id of primaryMoved) {
    if (!governing_constraints.includes(id)) governing_constraints.push(id);
    warnings.push(`primary_frame_override: "${id}" is a primary-frame constraint and cannot be ignored — kept as governing`);
  }

  // Conservative default: any triggered constraint NOT classified should not be silently dropped.
  for (const t of triggered) {
    const id = t.constraint.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (isStickySafetyConstraint(t) || (primaryPkgId && t.package_id === primaryPkgId)) {
      governing_constraints.push(id);
      warnings.push(`unclassified: "${id}" not in LLM output — added to governing`);
    } else {
      relevant_auxiliary_constraints.push({ constraint_id: id, reason: '(LLM did not classify; mechanically triggered)' });
      warnings.push(`unclassified: "${id}" not in LLM output — added to relevant_auxiliary as a conservative default`);
    }
  }

  return {
    governing_constraints,
    relevant_auxiliary_constraints,
    ignored_lexical_constraints,
    relevance_rationale: typeof filterResult.relevance_rationale === 'string' ? filterResult.relevance_rationale : '',
    validation_warnings: warnings
  };
}

// Re-derive verdict and display_status from the filtered constraint set,
// preserving the original mechanical fields under mechanical_*.
function applyConstraintRelevanceToClaim(claim, validatedFilter) {
  const ignoredIds = new Set((validatedFilter.ignored_lexical_constraints || []).map(e => e.constraint_id));
  const filteredTrace = Object.assign({}, claim.trace, {
    triggered_constraints: (claim.trace.triggered_constraints || []).filter(t => !ignoredIds.has(t.constraint.id))
  });
  const detailed = classifyClaimSentenceDetailed(claim.sentence, filteredTrace);
  const verdict = detailed.verdict;
  const display_status = claimDisplayStatus(verdict, filteredTrace, detailed.verdict_debug);

  // Preserve mechanical originals for transparency.
  claim.mechanical_verdict = claim.verdict;
  claim.mechanical_display_status = claim.display_status;
  claim.mechanical_triggered_constraints = claim.triggered_constraints.slice();
  claim.mechanical_verdict_debug = claim.verdict_debug;
  claim.mechanical_frame_fit = claim.frame_fit;
  claim.mechanical_suggested_repair = claim.suggested_repair;

  claim.constraint_relevance = validatedFilter;
  claim.verdict = verdict;
  claim.verdict_debug = detailed.verdict_debug;
  claim.display_status = display_status;
  claim.frame_fit = detailed.verdict_debug.frame_fit;
  claim.triggered_constraints = filteredTrace.triggered_constraints.map(t => t.constraint.id);
  claim.suggested_repair = suggestedClaimRepair(verdict, filteredTrace);
  return claim;
}

async function runConstraintRelevanceFiltersOnAppraisal(appraisal, providerConfig) {
  const errors = [];
  await Promise.all((appraisal.claims || []).map(async claim => {
    if (!claim.trace || (claim.trace.triggered_constraints || []).length === 0) return;
    try {
      const prompt = buildConstraintRelevancePrompt(claim.sentence, claim);
      const text = await generatePromptWithProvider(
        providerConfig.provider,
        prompt.systemPrompt,
        prompt.userPrompt,
        providerConfig.apiKey,
        providerConfig.model
      );
      const raw = parseLLMJsonStrict(text);
      const validated = validateConstraintRelevanceFilter(raw, claim);
      applyConstraintRelevanceToClaim(claim, validated);
    } catch (e) {
      errors.push({ sentence: claim.sentence, error: e.message });
    }
  }));

  // Rebuild the appraisal-level summary record from the (now possibly mutated) claims.
  const refreshed = buildSolidityAppraisalRecord(appraisal.input, appraisal.claims);
  Object.assign(appraisal, refreshed);
  appraisal.has_constraint_relevance_filter = true;
  appraisal.constraint_relevance_errors = errors;
  return appraisal;
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
// Module state used by the user-override click handler so it can recompose
// without re-running the full pipeline.
let LAST_LLM_GUIDED_RESULT = null;
let LAST_LLM_GUIDED_PROVIDER = null;
let LAST_APPRAISAL = null;
let LAST_SOLIDITY_SUMMARY = null;
let LAST_SOLIDITY_NOTICE = null;
let LAST_SOLIDITY_SUMMARY_WARNINGS = [];

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
    auxiliary_only: 'Only checker frames activated',
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

  if (trace.disposition === 'auxiliary_only') {
    return {
      text: 'Only generic checker frames activated. TCog-R did not find a primary domain frame for this query.',
      why: [
        'Auxiliary checker packages can flag proof, quantifier, or uncertainty issues.',
        'A complete package-bound answer requires a primary domain frame or a package coverage gap.'
      ],
      next: 'Load or patch a primary domain package for this topic, or rephrase with domain-specific terms.'
    };
  }

  if (trace.disposition === 'no_match') {
    const gaps = detectDomainCoverageGaps(trace);
    if (gaps.length > 0) {
      return {
        text: gaps[0].detail,
        why: ['A primary domain frame was detected by strict domain tokens, but no cluster passed the mechanical activation threshold.'],
        next: 'Patch or load a package cluster covering this domain-specific claim before treating checker-frame output as complete.'
      };
    }
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

function renderFrameRolesCard(trace) {
  const summary = friendlyFrameRoleSummary(trace);
  const gaps = summary.gaps || [];
  const gapHtml = gaps.length
    ? '<ul class="trace-list">' + gaps.map(g =>
        `<li><code>${escapeHtml(g.package_id)}</code> <span class="status-pill" style="background:rgba(184,92,0,0.10); color:var(--warn);">domain_detected_no_cluster</span><div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(g.detail)}</div></li>`
      ).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); margin:0;"><em>No package coverage gaps.</em></p>';

  const div = document.createElement('div');
  div.className = 'section section-A';
  div.innerHTML = `
    <div class="section-label"><span>Frame roles</span><span style="color:var(--ink-faint);">primary before auxiliary</span></div>
    <div class="section-content">
      <div class="trace-row"><div class="trace-row-label">Primary frame(s)</div><div class="trace-row-body"><code>${escapeHtml(summary.primary)}</code></div></div>
      <div class="trace-row"><div class="trace-row-label">Auxiliary checker frame(s)</div><div class="trace-row-body"><code>${escapeHtml(summary.auxiliary)}</code></div></div>
      <div class="trace-row"><div class="trace-row-label">Safety frame(s)</div><div class="trace-row-body"><code>${escapeHtml(summary.safety)}</code></div></div>
      <div class="trace-row"><div class="trace-row-label">Package coverage gaps</div><div class="trace-row-body">${gapHtml}</div></div>
    </div>
  `;
  return div;
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
  const roleSummary = t.frame_roles ? friendlyFrameRoleSummary({
    frame_roles: t.frame_roles,
    domain_coverage_gaps: t.domain_coverage_gaps || []
  }) : null;
  const roleHtml = roleSummary
    ? `<p style="margin:0; font-size:13px;"><strong>Primary:</strong> ${escapeHtml(roleSummary.primary)}<br><strong>Auxiliary:</strong> ${escapeHtml(roleSummary.auxiliary)}<br><strong>Safety:</strong> ${escapeHtml(roleSummary.safety)}</p>`
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No frame roles assigned.</em></p>';
  const gapHtml = t.domain_coverage_gaps && t.domain_coverage_gaps.length
    ? '<ul class="trace-list">' + t.domain_coverage_gaps.map(g => `<li><code>${escapeHtml(g.package_id)}</code> ${escapeHtml(g.detail)}</li>`).join('') + '</ul>'
    : '<p style="color:var(--ink-faint); font-size:13px; margin:0;"><em>No package coverage gaps.</em></p>';

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
        <div class="trace-row"><div class="trace-row-label">Frame roles</div><div class="trace-row-body">${roleHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Coverage gaps</div><div class="trace-row-body">${gapHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Package-bound citations</div><div class="trace-row-body">${citationHtml}</div></div>
        <div class="trace-row"><div class="trace-row-label">Synthesis boundary</div><div class="trace-row-body">${synthesisHtml}</div></div>
      </div>
    </div>
  `;
  attachCitationHandlers(details);
  return details;
}

// Renders a "Covers matches" card from a trace.covers_routing or from a list
// of covers_matches objects. Surfaces package, concept, scope, and role.
// Returns null when there is nothing to show (covers stage not run, or no
// matches) so callers can append conditionally.
function renderCoversCard(coversRouting, opts) {
  if (!coversRouting) return null;
  const matches = coversRouting.matches || coversRouting.covers_matches || [];
  const target = coversRouting.target || coversRouting.covers_target || '';
  const queryClass = coversRouting.query_class || coversRouting.covers_query_class || '';
  // Don't render when covers wasn't applicable.
  if (!queryClass || (queryClass !== 'definitional' && queryClass !== 'procedural')) return null;
  if (matches.length === 0 && !(opts && opts.alwaysShow)) return null;
  const div = document.createElement('div');
  div.className = 'section section-A';
  const header = matches.length
    ? `Matched via covers (${escapeHtml(queryClass)}, target "${escapeHtml(target)}"): ${matches.length} package${matches.length !== 1 ? 's' : ''}`
    : `Covers pre-pass ran (${escapeHtml(queryClass)}, target "${escapeHtml(target)}") but found no matches; falling through to broad retrieval.`;
  const list = matches.length
    ? '<ul class="trace-list">' + matches.map(m =>
        `<li><code>${escapeHtml(m.package_id)}</code> → "${escapeHtml(m.concept)}"${m.scope ? ` <span style="color:var(--ink-faint);">(${escapeHtml(m.scope)})</span>` : ''} <span class="status-pill" style="background:rgba(45,74,62,0.10); color:var(--accent-2);">${escapeHtml(m.role)}</span></li>`
      ).join('') + '</ul>'
    : '';
  div.innerHTML = `
    <div class="section-label"><span>Covers-routed pre-pass</span><span style="color:var(--ink-faint);">TCog Protocol v0.3.1 §4.4</span></div>
    <div class="section-content">
      <p style="margin:0 0 8px;">${header}</p>
      ${list}
    </div>
  `;
  return div;
}

function renderRawResponse(trace, sections, query = '') {
  const out = document.getElementById('output');
  out.innerHTML = '';
  const coversCard = renderCoversCard(trace.covers_routing);
  if (coversCard) out.appendChild(coversCard);
  const summary = renderAnswerSummaryCard(query, trace, sections);
  out.appendChild(renderFrameRolesCard(trace));
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
  out.appendChild(renderFrameRolesCard(trace));
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

  // Mechanical only: existing deterministic baseline (unchanged).
  if (mode !== 'llm_guided') {
    const trace = retrieve(query);
    LAST_RETRIEVAL = { query, trace };
    updatePipeline(trace);
    renderTrace(trace);
    const sections = buildRawResponse(query, trace);
    renderRawResponse(trace, sections, query);
    return;
  }

  // LLM-guided TCog-R: query understanding → broad candidate retrieval →
  // LLM candidate selection → mechanical validation → constraint gate →
  // selection-grounded composition. TCog-R packages and constraint gates
  // remain authoritative throughout.
  if (!providerConfig.apiKey) {
    const trace = retrieve(query);
    LAST_RETRIEVAL = { query, trace };
    updatePipeline(trace);
    renderTrace(trace);
    const sections = buildRawResponse(query, trace);
    out.innerHTML = '';
    out.appendChild(renderSmallErrorCard(
      'LLM-guided TCog-R unavailable',
      `Add a ${providerConfig.label} API key to use the LLM-guided pipeline. Showing Mechanical only output instead.`
    ));
    const summary = renderAnswerSummaryCard(query, trace, sections);
    out.appendChild(renderFrameRolesCard(trace));
    out.appendChild(summary.div);
    out.appendChild(renderPackageBoundCard(sections));
    out.appendChild(renderConstraintsCard(sections));
    out.appendChild(renderNextMoveCard(summary.next));
    out.appendChild(renderProtocolTraceDetails(sections));
    return;
  }

  out.innerHTML = `<div class="empty-state"><div class="marks">...</div><div class="loading-dots">Running LLM-guided TCog-R with ${providerConfig.label}</div></div>`;
  const result = await runLLMGuidedTCogR(query, providerConfig);
  if (result.mechanicalTrace) {
    LAST_RETRIEVAL = { query, trace: result.mechanicalTrace };
    updatePipeline(result.mechanicalTrace);
    renderTrace(result.mechanicalTrace);
  }
  renderLLMGuidedResult(result);
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
  out.innerHTML = `<div class="empty-state"><div class="marks">...</div><div class="loading-dots">Generating vanilla LLM answer and LLM-guided TCog-R answer</div></div>`;

  // The TCog-R side now runs the LLM-guided TCog-R pipeline. The vanilla side
  // remains a raw query → LLM answer with no retrieval guidance.
  const [normalSettled, guidedResult] = await Promise.all([
    normalWithProvider(
      providerConfig.provider,
      query,
      providerConfig.apiKey,
      providerConfig.model
    ).then(text => ({ status: 'fulfilled', value: text }), reason => ({ status: 'rejected', reason })),
    runLLMGuidedTCogR(query, providerConfig)
  ]);

  const trace = guidedResult.mechanicalTrace || retrieve(query);
  const sections = guidedResult.mechanicalSections || buildRawResponse(query, trace);
  LAST_RETRIEVAL = { query, trace };
  updatePipeline(trace);
  renderTrace(trace);

  const normalResult = normalSettled.status === 'fulfilled'
    ? { ok: true, text: normalSettled.value }
    : { ok: false, error: `Vanilla LLM generation failed: ${normalSettled.reason?.message || normalSettled.reason}` };

  let tcogResult;
  if (guidedResult.answerText) {
    tcogResult = { ok: true, text: guidedResult.answerText };
  } else {
    const errMsg = (guidedResult.errors || []).join(' | ') || 'LLM-guided TCog-R produced no answer.';
    tcogResult = { ok: false, error: `TCog-R composition failed; showing raw retrieval output below. ${errMsg}` };
  }

  // Audit the vanilla answer against the same mechanical trace used by the
  // candidate payload so the audit reflects the actual retrieval state.
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

  // Surface the LLM-guided pipeline trace below the comparison card so the
  // vanilla answer can be checked against the actual selection / gate result.
  if (guidedResult.candidatePayload) {
    if (guidedResult.validatedSelection) {
      out.appendChild(renderSelectionCard(guidedResult.validatedSelection, guidedResult.candidatePayload));
    }
    if (guidedResult.gatedResult) {
      out.appendChild(renderConstraintGateCard(guidedResult.gatedResult, guidedResult.candidatePayload));
    }
    out.appendChild(renderCandidateTraceDetails(guidedResult.candidatePayload, guidedResult.mechanicalSections));
  }
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
  const extractionCard = LAST_APPRAISAL ? renderExtractionMetaCard(LAST_APPRAISAL) : null;
  if (extractionCard) out.appendChild(extractionCard);
  if (LAST_SOLIDITY_SUMMARY_WARNINGS && LAST_SOLIDITY_SUMMARY_WARNINGS.length) {
    out.appendChild(renderSummaryConsistencyWarningsCard(LAST_SOLIDITY_SUMMARY_WARNINGS));
  }
  if (LAST_SOLIDITY_SUMMARY) out.appendChild(renderSoliditySummaryCard(LAST_SOLIDITY_SUMMARY));
  out.appendChild(renderClaimAppraisal(LAST_APPRAISAL, repairedText));
}

async function runClaimAppraisal() {
  const text = document.getElementById('appraise-text').value.trim();
  if (!text) return;
  resetPipeline();

  const providerConfig = getSelectedProviderConfig();
  const wantExtraction = document.getElementById('solidity-llm-claim-extraction')?.checked;

  // Step 1: build the appraisal. LLM-assisted extraction when available;
  // mechanical sentence splitting as fallback / audit baseline.
  let appraisal;
  let extractionNotice = null;
  if (wantExtraction && providerConfig.apiKey) {
    const out = document.getElementById('output');
    out.innerHTML = `<div class="empty-state"><div class="marks">...</div><div class="loading-dots">Extracting coherent claims with ${escapeHtml(providerConfig.label)}</div></div>`;
    try {
      const extraction = await runLLMClaimExtraction(text, providerConfig);
      if (!extraction.ok || extraction.claims.length === 0) {
        extractionNotice = {
          title: 'LLM claim extraction unavailable',
          message: 'No claims were extracted. Falling back to mechanical sentence splitting. ' + (extraction.warnings || []).join(' | ')
        };
        appraisal = appraiseClaimSolidity(text);
      } else {
        const claims = extraction.claims.map(appraiseExtractedClaim);
        appraisal = buildSolidityAppraisalRecord(text, claims);
        appraisal.extraction_used = 'llm';
        appraisal.extraction_warnings = extraction.warnings || [];
      }
    } catch (e) {
      extractionNotice = {
        title: 'LLM claim extraction unavailable',
        message: `Falling back to mechanical sentence splitting. ${e.message}`
      };
      appraisal = appraiseClaimSolidity(text);
    }
  } else {
    appraisal = appraiseClaimSolidity(text);
    if (wantExtraction && !providerConfig.apiKey) {
      extractionNotice = {
        title: 'Mechanical sentence splitting in use',
        message: 'Mechanical sentence splitting is being used. Add a provider key to use LLM-assisted claim extraction.'
      };
    }
  }

  LAST_APPRAISAL = appraisal;
  LAST_SOLIDITY_SUMMARY = null;
  LAST_SOLIDITY_SUMMARY_WARNINGS = [];
  LAST_SOLIDITY_NOTICE = extractionNotice;
  renderCurrentSolidityOutput();
  updateRepairedDraftButton();

  // Optional LLM relevance filter for non-primary constraints. Mechanical
  // appraisal stays authoritative; the filter only re-classifies which of
  // the already-triggered constraints govern the verdict and which were
  // overloaded surface-term matches.
  const filterEnabled = document.getElementById('solidity-llm-relevance-filter')?.checked;
  if (filterEnabled) {
    if (!providerConfig.apiKey) {
      LAST_SOLIDITY_NOTICE = {
        title: 'LLM relevance filter unavailable',
        message: 'Mechanical appraisal completed. Add a provider key to filter non-primary constraints with LLM relevance arbitration.'
      };
      renderCurrentSolidityOutput();
    } else {
      const out = document.getElementById('output');
      const banner = document.createElement('div');
      banner.id = 'relevance-filter-loading';
      banner.className = 'empty-state';
      banner.innerHTML = `<div class="marks">...</div><div class="loading-dots">Filtering non-primary constraints with ${escapeHtml(providerConfig.label)}</div>`;
      out.insertBefore(banner, out.firstChild);
      try {
        await runConstraintRelevanceFiltersOnAppraisal(appraisal, providerConfig);
        if (appraisal.constraint_relevance_errors && appraisal.constraint_relevance_errors.length) {
          LAST_SOLIDITY_NOTICE = {
            title: 'LLM relevance filter — partial',
            message: `Some claims could not be filtered: ${appraisal.constraint_relevance_errors.map(e => e.error).join(' | ')}`
          };
        } else {
          LAST_SOLIDITY_NOTICE = null;
        }
      } catch (e) {
        LAST_SOLIDITY_NOTICE = { title: 'LLM relevance filter unavailable', message: e.message };
      }
      const stillThere = document.getElementById('relevance-filter-loading');
      if (stillThere) stillThere.remove();
      renderCurrentSolidityOutput();
    }
  }

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

// Consistency check: scan the readable summary against the structured
// appraisal and flag obvious contradictions (claiming "unsupported" when
// the structured verdict is supported, or treating ignored lexical
// constraints as cross-frame tensions). Returns a list of warning strings.
function summaryConsistencyWarnings(summaryText, appraisal) {
  const warnings = [];
  if (!summaryText || !appraisal) return warnings;
  const lower = String(summaryText).toLowerCase();
  const claims = appraisal.claims || [];

  // 1. "unsupported" / "no support" rhetoric vs. structured verdicts
  const hasUnsupportedVerdict = claims.some(c => {
    const sv = c.display_status?.support_verdict;
    return sv === 'Unsupported' || c.verdict === 'UNSUPPORTED';
  });
  const allClaimsHaveSupport = claims.length > 0 && claims.every(c => {
    const sv = c.display_status?.support_verdict;
    return sv === 'Package-supported' || sv === 'Weakly supported' || sv === 'Coverage gap';
  });
  if (allClaimsHaveSupport && !hasUnsupportedVerdict && /\bunsupported\b|\bno (?:package )?support\b/.test(lower)) {
    warnings.push('Summary mentions "unsupported"/"no support" but the structured verdict is not unsupported for any claim.');
  }

  // 2. Treating ignored lexical constraints as cross-frame tensions
  const ignoredIds = new Set();
  for (const c of claims) {
    for (const e of (c.constraint_relevance && c.constraint_relevance.ignored_lexical_constraints) || []) {
      if (e && e.constraint_id) ignoredIds.add(e.constraint_id);
    }
  }
  for (const id of ignoredIds) {
    if (lower.includes(id.toLowerCase())) {
      const idx = lower.indexOf(id.toLowerCase());
      const window = lower.slice(Math.max(0, idx - 80), Math.min(lower.length, idx + 80));
      // Treat it as a problem only if the surrounding text reads like a tension/conflict claim.
      if (/\b(conflict|tension|cross-frame|incompat|requires|must address|undermines?|fails to)\b/.test(window) &&
          !/\bignored lexical\b/.test(window) &&
          !/\bnot used for verdict\b/.test(window)) {
        warnings.push(`Summary appears to treat "${id}" as a substantive tension, but it was classified as an ignored lexical match.`);
      }
    }
  }
  return warnings;
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
    let summary = await summarizeSolidityWithProvider(LAST_APPRAISAL);
    let warnings = summaryConsistencyWarnings(summary, LAST_APPRAISAL);

    // One-shot regeneration if the summary contradicts the structured appraisal.
    if (warnings.length > 0) {
      const reinforcement = `\n\nThe previous draft had these consistency issues against the structured appraisal — fix them:\n${warnings.map(w => `- ${w}`).join('\n')}\nFollow the structured verdicts exactly. Do not call a claim unsupported when its structured verdict is package-supported, package-supported with caveat, weakly supported, or coverage gap. Do not treat ignored lexical constraints as substantive cross-frame tensions.`;
      try {
        const prompt = buildSoliditySummaryPrompt(LAST_APPRAISAL.input, LAST_APPRAISAL);
        const retried = await generatePromptWithProvider(
          providerConfig.provider,
          prompt.systemPrompt + reinforcement,
          prompt.userPrompt,
          providerConfig.apiKey,
          providerConfig.model
        );
        summary = retried;
        warnings = summaryConsistencyWarnings(summary, LAST_APPRAISAL);
      } catch (e) {
        // Keep the first draft; surface the original warnings.
      }
    }

    LAST_SOLIDITY_SUMMARY = summary;
    LAST_SOLIDITY_SUMMARY_WARNINGS = warnings;
    LAST_SOLIDITY_NOTICE = null;
    const loading = document.getElementById('summary-loading');
    if (loading) loading.remove();
    showSoliditySummaryAboveAppraisal(LAST_SOLIDITY_SUMMARY);
    if (warnings.length) {
      // Re-render to surface the warnings card above the summary.
      renderCurrentSolidityOutput();
    }
  } catch (e) {
    const loading = document.getElementById('summary-loading');
    if (loading) loading.remove();
    showSolidityNoticeAboveAppraisal('Readable summary unavailable', e.message);
  }
}

function renderSummaryConsistencyWarningsCard(warnings) {
  const div = document.createElement('div');
  div.className = 'section section-G';
  div.innerHTML = `
    <div class="section-label"><span><span class="marker">!</span>Readable summary consistency check</span></div>
    <div class="section-content">
      <p style="margin-top:0;">The readable summary still disagrees with the structured appraisal on these points. The structured appraisal below is authoritative.</p>
      <ul class="trace-list">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
    </div>
  `;
  return div;
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
    LAST_SOLIDITY_SUMMARY_WARNINGS = [];
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
    group: 'Solidity appraisal demos',
    items: [
      {
        label: 'ML passage (LLM relevance filter regression)',
        query: 'Machine learning is a computational approach to producing decision rules when the target function is unknown. It contrasts with traditional design, where a rule is derived analytically from given specifications; learning instead uses data as the primary evidence about how to map inputs to outputs.',
        mode: 'solidity',
        requires: ['ml_core'],
        watch: 'Mechanical retrieval over-triggers constraints from political_science, biology, communication, medicine, economics, and CS via overloaded terms (decision rule, function, evidence, design). With the LLM relevance filter on and a provider key, those should land in ignored_lexical_constraints and the verdict should not be driven by them. ml_core remains primary.'
      },
      {
        // Regression category: anaphoric continuation. Mechanical splitting
        // appraises the second sentence in isolation; LLM extraction must
        // resolve "this" before retrieval.
        label: 'anaphoric continuation regression',
        query: 'A market is a coordination mechanism that aggregates dispersed information through prices. This shows why central planners struggle with the same allocation problem.',
        mode: 'solidity',
        requires: ['economics_core'],
        watch: 'With LLM claim extraction on, the second canonical claim should resolve "This" to the prior definition of the price mechanism, not be appraised in isolation as a generic claim about central planners.'
      },
      {
        // Regression category: contrastive continuation. The contrast carries
        // half its meaning in a prior clause; the canonical_claim should hold
        // both sides.
        label: 'contrastive continuation regression',
        query: 'A statistical model assigns probabilities to outcomes given the data. This distinguishes it from a deterministic rule, which assigns a single outcome.',
        mode: 'solidity',
        requires: ['statistics_core'],
        watch: 'The canonical claim of the second sentence should include both sides of the contrast — statistical model vs. deterministic rule — so retrieval doesn\'t treat "This distinguishes it" as a free-standing assertion.'
      }
    ]
  },
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
      },
      {
        label: 'rock falling: physics primary',
        query: 'Every rock must fall from above to below because of the gravity.',
        requires: ['physics_dynamical_constraints_core', 'math_proof_core'],
        watch: 'physics_dynamical_constraints_core should be primary or surface a domain_detected_no_cluster gap. math_proof_core may appear only as an auxiliary universal-claim checker; statistics_core should not dominate.'
      },
      {
        label: 'near-Earth rock: not frame-misaligned',
        query: 'Under ordinary near-Earth conditions, an unsupported rock accelerates downward relative to the local gravitational field.',
        requires: ['physics_dynamical_constraints_core'],
        watch: 'Claim Solidity Appraisal regression: acceptable verdicts are Package-supported, Package-supported with caveat, Weakly supported, or Coverage gap. Unacceptable: Frame-misaligned.'
      },
      {
        label: 't-test cue routing (no Iser false match)',
        query: 't-test is hypothesis test',
        requires: ['statistics_core'],
        watch: 'Lexical regression: art_form_affect_core must not activate from cue "Iser"; statistics_core should be primary when statistical-test cues are available; generic "test" alone should not let CS or proof frames dominate.'
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

async function runScenarioInMode(sc) {
  const targetMode = sc.mode || 'ask';
  setActiveMode(targetMode);
  if (targetMode === 'solidity') {
    document.getElementById('appraise-text').value = sc.query;
    await runClaimAppraisal();
  } else {
    document.getElementById('query').value = sc.query;
    await runQuery();
  }
}

async function onScenarioClick(e) {
  const groupIdx = parseInt(e.currentTarget.dataset.group);
  const itemIdx = parseInt(e.currentTarget.dataset.item);
  const sc = SCENARIOS[groupIdx].items[itemIdx];
  const missing = sc.requires.filter(r => !isPkgLoaded(r));

  if (missing.length === 0) {
    await runScenarioInMode(sc);
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
    await runScenarioInMode(scenario);
  });
}

// ============================================================================
// Packages folder fetch
// ============================================================================
// Browsers cannot enumerate local folders by themselves. This loader supports:
// 1. an HTTP directory listing, such as Python's `python3 -m http.server`
// 2. optional packages/index.json containing ["file.zip", "package.combined.json"]
//    or { "files": [...] } for servers that disable directory listings.
const PACKAGES_DIR_URL = './packages/';

async function discoverPackageFiles() {
  const files = new Set();
  const addPackageFile = (name) => {
    const cleanName = name.replace(/^\.?\/*/, '').replace(/[?#].*$/, '');
    if (/^(?:packages\/)?index\.json$/i.test(cleanName)) return;
    if (/\.(zip|json)$/i.test(cleanName)) files.add(cleanName);
  };

  try {
    const resp = await fetch(PACKAGES_DIR_URL + 'index.json');
    if (resp.ok) {
      const manifest = await resp.json();
      const listed = Array.isArray(manifest) ? manifest : (manifest.files || []);
      for (const item of listed) {
        const name = typeof item === 'string' ? item : item?.path || item?.name;
        if (name) addPackageFile(name);
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
          addPackageFile(href);
        }
      }
    }
  } catch (e) {
    // Directory listings may be disabled; packages/index.json is the portable path.
  }

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
    return { ok: false, error: 'no .zip or .json package files found in packages/. Serve with an HTTP server that exposes directory listings, or add an optional packages/index.json manifest.' };
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

// Non-fatal validator: surface mismatches between the safety_critical flag
// and the constraint set. Authors may have legitimate reasons to deviate, so
// these are warnings (console.warn), not load errors.
function warnOnSafetyCriticalMismatch(pkg) {
  const m = (pkg && pkg.manifest) || {};
  const constraints = pkg.constraints || [];
  const hasCriticalBlocking = constraints.some(c =>
    c && c.blocks_answer === true && String(c.severity || '').toLowerCase() === 'critical');
  if (m.safety_critical === true && !hasCriticalBlocking) {
    console.warn(`[tcog] package ${m.package_id} declares safety_critical:true but has no constraints with severity:"critical" and blocks_answer:true. The flag does nothing without enforcement to back it up.`);
  }
  if (hasCriticalBlocking && m.safety_critical !== true) {
    console.warn(`[tcog] package ${m.package_id} has critical blocking constraints but is NOT marked safety_critical:true. Review whether the flag should be set so the user-override gate respects this package's blocking.`);
  }
}

function isDuplicate(pkg) {
  return LOADED_PACKAGES.some(p => p.manifest.package_id === pkg.manifest.package_id);
}

// ============================================================================
// Covers-routed retrieval (TCog Protocol v0.3.1 §4.3–§4.5)
// ============================================================================
// Covers is metadata declared on a package manifest that names the concepts
// the package is the authoritative home of. For definitional and procedural
// queries we route via covers BEFORE broad cue-based retrieval — the
// structural blind spot in cue-based routing is that a package may be the
// canonical home of a concept but lack cues for the bare definitional
// phrasing. Covers is purely additive and metadata-only: packages without
// `manifest.covers` continue to participate in cue-based routing only.
//
// Mechanical-mode matching is intentional bidirectional substring containment
// after a canonical normalization. This surfaces productive cross-package
// overlaps (e.g. "function" surfaces in stats via "loss function",
// combinatorics via "generating function"); the downstream LLM selection
// stage disambiguates by scope qualifier. Do NOT add semantic similarity
// here — that is a separate semantic-augmented mode and out of scope.
// ============================================================================

// Canonical normalizer used by package validators. Keep this exact — small
// variations break covers matches.
function normalizeForCovers(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  s = s.replace(/[‘’']/g, '');
  s = s.replace(/[-_]/g, ' ');
  s = s.replace(/[^\w\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Per-package covers index. Built lazily and cached on the package object.
function buildCoversIndexForPackage(pkg) {
  const m = (pkg && pkg.manifest) || {};
  const covers = m.covers;
  if (!covers || typeof covers !== 'object' || !Array.isArray(covers.primary)) {
    return null;
  }
  const primary = [];
  for (const entry of covers.primary) {
    if (!entry || typeof entry !== 'object') continue;
    const concept = typeof entry.concept === 'string' ? entry.concept : '';
    if (!concept) continue;
    primary.push({
      concept,
      scope: typeof entry.scope === 'string' ? entry.scope : '',
      normalized_concept: normalizeForCovers(concept)
    });
  }
  const secondary = [];
  if (covers.secondary_auto_indexed) {
    for (const u of pkg.units || []) {
      if (u && typeof u.label === 'string' && u.label) {
        secondary.push({
          label: u.label,
          source: 'unit_label',
          source_id: u.id || '',
          normalized: normalizeForCovers(u.label)
        });
      }
      if (u && Array.isArray(u.features)) {
        for (const f of u.features) {
          const text = typeof f === 'string' ? f : (f && f.label) || (f && f.name) || '';
          if (text) {
            secondary.push({
              label: text,
              source: 'unit_feature',
              source_id: u.id || '',
              normalized: normalizeForCovers(text)
            });
          }
        }
      }
    }
    for (const c of pkg.clusters || []) {
      if (c && typeof c.label === 'string' && c.label) {
        secondary.push({
          label: c.label,
          source: 'cluster_label',
          source_id: c.id || '',
          normalized: normalizeForCovers(c.label)
        });
      }
    }
  }
  return {
    primary,
    secondary_auto_indexed: !!covers.secondary_auto_indexed,
    secondary
  };
}

function getCoversIndex(pkg) {
  if (!pkg) return null;
  if (pkg._coversIndex !== undefined) return pkg._coversIndex; // null is a valid cached result
  pkg._coversIndex = buildCoversIndexForPackage(pkg);
  return pkg._coversIndex;
}

// Query class detection (mechanical, pattern-based).
function detectQueryClass(query) {
  const q = String(query || '').trim();
  if (!q) return 'other';
  const lower = q.toLowerCase().replace(/[?.!]+$/g, '').trim();
  if (/^(what is|what are|what does|what do)\b/.test(lower)) return 'definitional';
  if (/\bdefinition of\b|\bmeaning of\b|^define\b|^explain (the )?(concept|definition|meaning) of\b/.test(lower)) return 'definitional';
  if (/^how (do|can|should|would) i\b|^how to\b|\bprocedure for\b|\bsteps? to\b/.test(lower)) return 'procedural';
  if (/^compare\b|\b(vs|versus)\b|\bdifference between\b/.test(lower)) return 'comparative';
  if (/\b(audit|appraise|evaluate)\b/.test(lower)) return 'appraisal';
  // Bare noun phrase 1–4 words with no verb-ish trailing — treat as definitional.
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length >= 1 && tokens.length <= 4) {
    const verbish = /\b(is|are|was|were|be|been|being|do|does|did|has|have|had|will|would|should|can|could|may|might|must|shall|use|uses|used|run|runs|ran|make|makes|made|find|finds|found|show|shows|showed|prove|proves|proved|cause|causes|caused|imply|implies|mean|means|meant|distinguish|distinguishes|distinguished)\b/;
    if (!verbish.test(lower)) return 'definitional';
  }
  return 'analytical';
}

function extractCoversTarget(query) {
  let q = String(query || '').trim().replace(/[?.!]+$/g, '').trim();
  q = q.replace(/^(what is|what are|what does|what do)\s+/i, '');
  q = q.replace(/^define\s+/i, '');
  q = q.replace(/^(definition of|meaning of)\s+/i, '');
  q = q.replace(/^explain (the )?(concept|definition|meaning) of\s+/i, '');
  q = q.replace(/^how (do|can|should|would) i\s+/i, '');
  q = q.replace(/^how to\s+/i, '');
  q = q.replace(/^(a|an|the)\s+/i, '');
  q = q.replace(/\s+(mean|means|defined as)$/i, '');
  return q.trim();
}

// Mechanical bidirectional containment match after normalization.
function coversMatchTarget(target, conceptOrLabel) {
  const tn = normalizeForCovers(target);
  const cn = normalizeForCovers(conceptOrLabel);
  if (!tn || !cn) return false;
  return cn === tn || cn.includes(tn) || tn.includes(cn);
}

// Reuses the existing phrase-match the rest of the pipeline uses for
// avoid_when. Returns true if any avoid_when entry phrase-matches the query.
function queryHitsAvoidWhen(query, pkg) {
  const policy = (pkg && pkg.manifest && pkg.manifest.activation_policy) || {};
  const avoid = Array.isArray(policy.avoid_when) ? policy.avoid_when : [];
  if (avoid.length === 0) return false;
  const queryNorm = normalize(query || '');
  return avoid.some(a => typeof a === 'string' && phraseMatchInQuery(a, queryNorm));
}

// Run covers-routed retrieval. Returns { query_class, target, matches } where
// matches is an array of {package_id, package, concept, scope, role, source}.
// avoid_when overrides covers (a package whose avoid_when matches is excluded
// regardless of covers).
function coversRoute(query) {
  const query_class = detectQueryClass(query);
  if (query_class !== 'definitional' && query_class !== 'procedural') {
    return { query_class, target: null, matches: [] };
  }
  const target = extractCoversTarget(query);
  if (!target) return { query_class, target, matches: [] };

  const matches = [];
  for (const pkg of LOADED_PACKAGES) {
    const idx = getCoversIndex(pkg);
    if (!idx) continue;
    if (queryHitsAvoidWhen(query, pkg)) continue; // avoid_when overrides covers

    let hit = false;
    for (const entry of idx.primary) {
      if (coversMatchTarget(target, entry.concept)) {
        matches.push({
          package_id: pkg.manifest.package_id,
          package: pkg,
          concept: entry.concept,
          scope: entry.scope,
          role: 'primary',
          source: 'covers.primary'
        });
        hit = true;
      }
    }
    // Secondary only if no primary match in this package, per spec ("Else if").
    if (!hit && idx.secondary_auto_indexed) {
      for (const entry of idx.secondary) {
        if (coversMatchTarget(target, entry.label)) {
          matches.push({
            package_id: pkg.manifest.package_id,
            package: pkg,
            concept: entry.label,
            scope: `(${entry.source}${entry.source_id ? ': ' + entry.source_id : ''})`,
            role: 'auxiliary',
            source: entry.source
          });
          // One secondary hit per package is enough to surface it; avoid spam.
          break;
        }
      }
    }
  }
  return { query_class, target, matches };
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
  applyPackageIntegrationPatch(obj);
  // Build the covers index eagerly now that the package is finalized. Packages
  // without manifest.covers cache `null` and skip the covers stage cleanly.
  obj._coversIndex = buildCoversIndexForPackage(obj);
  warnOnSafetyCriticalMismatch(obj);
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
