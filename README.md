# TCognitive Project

**Trajectory Cognition (TCog)** is an experimental framework for turning static knowledge into an active, frame-aware cognitive architecture.

Instead of treating AI reasoning as isolated query-response events, TCog organizes knowledge into **basis packages**: structured bundles of anchored units, clusters, constraints, trajectories, relations, and tests. A TCog system does not merely retrieve relevant text. It asks:

- Which frame is active?
- Which clusters fire?
- Which constraints govern the answer?
- Which trajectory should structure the reasoning?
- Which claims are unsupported, misframed, or inadmissible?

## Live Demo

Try the current TCog-R demo here:

**[Open TCog-R Demo](https://darkeyes.github.io/TCognitiveProject/code/tcog_demo.html)**

TCog-R stands for:

> **Package-Bound Mechanical Retrieval for Frame-Aware LLM Reasoning**

The demo runs in the browser. Package routing, cluster activation, constraint checking, trajectory matching, and frame-overreach detection are performed mechanically. LLM composition is optional and only used to phrase the result after TCog-R has already produced the retrieval/appraisal trace.

## Architecture Overview


[Open the live TCog-R demo](https://darkeyes.github.io/TCognitiveProject/code/tcog_demo.html)

![TCog Architecture](assets/TCogArch.png)