---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting language reference only.

# SOPHIA Copy Dictionary

Last updated: 2026-03-11  
Status: active  
Owner: product + engineering

This file is the baseline for all user-facing copy in SOPHIA.

## Voice Baseline
- Tone: warmly intellectual, clear, unhurried, confident.
- Personality: reflective, invitational, articulate.
- Register: academic mentor + deep conversation partner.
- Keep precision in advanced views, but phrase helper text for a curious learner.

## Preferred Terms
- Begin
- Explore
- Insight
- Depth
- Inquiry
- Reflection

## Avoid Terms
- Submit
- token
- cost
- credits
- runtime

## Global UI Replacements
| Old | New |
|---|---|
| New | + New Inquiry |
| Run cost | Insight depth estimate |
| Begin analysis | Begin Reasoning -> |
| Continue to checkout | Proceed Securely -> |
| Return to app | Back to SOPHIA |
| Hide Rejected Layer | Hide Low-Confidence Ideas |
| Open in Side Panel | Study Side by Side |
| Fit / Reset Layout | Recenter Graph |

## Landing / Home
- Hero line: "Ask a question that matters. SOPHIA will explore it through analysis, critique, and synthesis - three voices in one conversation."
- Input placeholder: "What do you want to think about today?"
- CTA: "Begin Inquiry ->"
- Subtext: "You can just start typing. Or choose a sample question below."
- Samples label: "Try one of these timeless questions:"

## Advanced Options
- Section header: "Advanced settings ->"
- Description: "Adjust SOPHIA's reasoning depth, domain focus, or data sources. These options are for when you want to steer her reasoning more precisely."
- Domain -> "Reasoning Focus"
- Model -> "Thinking Engine"
- Lens -> "Perspective (optional)"
- Depth -> "Level of Exploration"
- External Sources -> "Reference Material (optional)"
- Helper text: "Add URLs you want SOPHIA to consider in her analysis."
- Depth options:
  - Quick (~10s): "A concise overview"
  - Standard (~25s): "Full three-pass dialectic"
  - Deep (~40s): "Extended reasoning and refinement"

## Results Flow
- Summary heading: "How the idea unfolded"
- Analysis: "Identifies the core ideas and assumptions."
- Critique: "Puts those ideas under pressure - seeking contradiction or limitation."
- Synthesis: "Integrates both views into one balanced insight."
- Follow-up button: "Open full reasoning workspace ->"

## Scholar View Labels
- Analysis -> Foundations
- Critique -> Challenges
- Synthesis -> Resolution
- Verification -> Evidence & Sources
- Shortest Path -> Explore Logical Pathways
- Why this node? -> Reason for this connection
- Retrieval Explainability -> How SOPHIA built this argument
- Rejected nodes -> Ideas withheld for low confidence
- TRUST HOTSPOTS -> Areas well supported
- CONTRADICTION HOTSPOTS -> Areas of internal tension

## Pricing
- Header: "Simple plans for thoughtful people."
- Intro: "Start free, then upgrade if you want SOPHIA to explore more ideas each month. Payments and taxes are managed securely through Paddle."
- Free -> Curious Thinker
- Pro -> Deep Inquirer
- Premium -> Philosopher's Desk
- Wallet Top-Ups -> Insight Credits (Small / Large)
- Helper text: "Insight credits cover deeper reasoning or API usage. They never expire."
- Terms line: "Top-ups are pre-paid and used for deeper runs. Refunds are only provided where the law requires."

## Verification
- Verification Report -> Scholarly Review
- Executive Summary -> Overview
- Grounded Claims -> Established Positions
- Partially Grounded -> Interpretive Proposals
- Novel Synthesis -> Original Integrations

## Loading / Empty States
- Before result: "SOPHIA is assembling the first pass of your question - let her think for a moment..."
- After result: "Thought complete. Here's what emerged."
- Failure: "The reasoning stream broke mid-thought. Try re-running or adjusting the depth."

## Lens Copy
- Balanced Dialogue: "Clear, even-handed reasoning guided by empathy and logic."
- Socratic: "Exploratory questioning - answers built through dialogue."
- Realist / Pragmatist: "Emphasis on grounded consequences and moral clarity."
- Continental: "Rich, interpretive language, teasing out hidden meanings."
- Helper text: "Each lens changes SOPHIA's reasoning voice - not her intelligence, but her style of engagement."

## Change Control
- Any UI copy change must update this file in the same PR.
- If a change intentionally deviates, document the reason in the PR description.
