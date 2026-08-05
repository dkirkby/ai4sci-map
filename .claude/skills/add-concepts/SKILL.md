---
name: add-concepts
description: Add one or more new concepts to the AI/ML concept graph under data/. Given a list of candidate concept names, checks each for duplication/overlap with existing concepts, flags any that are out of scope or too unfamiliar to source confidently and asks the user whether to keep them, drafts a full concept record (kind, description, audience_level, attributes) for each survivor, drafts relationships linking it to other new and existing concepts, then writes the YAML and validates with `npm run build:data`. Use whenever the user hands you a list of AI/ML terms to add to the map.
---

# Add concepts to the graph

This skill runs **inline in the conversation**, not as a background job — steps 2
and 3 below require asking the user real questions, and the final draft needs a
human sanity check before anything is written to `data/`.

Read `DATA_README.md` and `AUDIENCE_LEVEL.md` in the repo root if you have not
already loaded them this session; this skill assumes their conventions.

## Input

The candidate list comes from the user's message, or from `args` if this skill
was invoked with arguments. If no list is present in either place, ask the user
for it before doing anything else. A "concept" at this stage is just a name or
short phrase (e.g. "LoRA", "speculative decoding") — you fill in everything else.

If the list is long (roughly 15+ items), consider telling the user you'll work
through it in batches so the review step stays manageable, rather than silently
truncating anything.

## Step 0 — Load current graph state

1. Run `npm run build:data`. If it fails, stop and show the user the errors —
   there's a pre-existing data problem unrelated to this task, and adding more
   concepts on top of a broken graph will only compound the confusion.
2. Read the freshly written `public/graph.json`. It has the full assembled
   `concepts` (id, label, kind, description, aliases, acronyms, audience_level,
   ...), `relationships`, and `relationshipTypes` arrays — much easier to scan
   here than re-merging the YAML fragments by hand. This is your reference set
   for duplicate-checking, scope-checking, and relationship targets.
3. Also skim `data/manifest.yaml` (lists the concept/relationship fragment files
   you'll eventually write into) and `data/relationship-types.yaml` (the fixed
   set of declared relationship types — see the direction table below).

## Step 1 — Duplicate / overlap screen

For every candidate, compare against every existing concept's `label`,
`aliases`, and `acronyms` (case-insensitive):

- **Exact match** (same term, same sense): drop it from the list, and tell the
  user it already exists as `<id>` — don't ask, this isn't a judgment call.
- **Large overlap** (the candidate is a rename, a narrow rephrasing, or is fully
  subsumed by an existing concept's description — e.g. proposing "deep neural
  net" when `deep-neural-network` already exists, or proposing something one
  `is_a` hop from an existing node that adds no real distinction): flag it as a
  possible duplicate with the specific existing concept id it overlaps, but
  don't auto-drop it — genuinely-distinct concepts can look similar by name.
- Otherwise: it passes through as novel.

Judge overlap by reading the *description* of any name-similar or
topically-similar existing concept, not just string similarity — two concepts
can share no words and still be duplicates (or share words and be distinct).

## Step 2 — Scope / confidence screen

For every candidate that survived step 1, ask two questions:

1. **Scope fit.** Does it belong in an AI/ML concept graph as one of the 15
   `kind` values (`field`, `learning_paradigm`, `model_role`, `model_class`,
   `model_family`, `architecture`, `training_method`, `mathematical_object`,
   `task`, `system`, `product`, `property`, `data_concept`,
   `evaluation_concept`, `infrastructure`)? Named AI products/assistants/model
   families are in scope (see `chatgpt`, `siri`, `gpt-model-family` in
   `data/concepts/products.yaml`); companies, people, and non-AI-specific CS/math
   concepts are not.
2. **Confidence.** Can you write an accurate description, pick a defensible
   `kind`, assign an audience level, and propose real relationships for this
   *without guessing*? If you're unsure but it seems plausibly in scope
   (e.g. a specific recent technique you're fuzzy on), try to resolve the
   uncertainty with a web search (`ToolSearch("select:WebSearch")` then
   `WebSearch`) before giving up on it.

Collect everything that still fails either test after that effort. For each,
ask the user to keep or remove it via `AskUserQuestion` — one question per
concept, batched up to 4 questions per call (make multiple calls if there are
more than 4). Give the actual reason as the question body, e.g.:

> "'Foobar Inc.' looks like a company, not an AI/ML concept — keep or remove
> from this batch?"

Options: `Remove` and `Keep` (add a third, `Keep — I'll describe it`, when the
issue is unfamiliarity rather than scope, so the user can hand you the missing
context inline instead of just overriding blind). Default to recommending
`Remove` first for clear out-of-scope terms.

Anything not flagged proceeds automatically — don't ask about concepts that
clearly pass both checks, that would just be noise.

## Step 3 — Draft concept records

For each remaining candidate, draft a record matching `data/schema.yaml`'s
`concept` definition. **The schema has `additionalProperties: false`** — only
use fields it declares. Notably, `AUDIENCE_LEVEL.md` shows an
`audience_level_confidence` / `audience_level_reviewed` / `audience_level_note`
example that is **not** in the schema; do not add those fields, `build:data`
will reject them.

- **`id`**: kebab-case, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Derive from the
  label; check it's not already used by *any* existing concept (ids are one
  global namespace, not per-file).
- **`label`**: the natural display name.
- **`kind`**: one of the 15 enum values above. When unsure, look at how similar
  existing concepts are classified rather than guessing from first principles.
- **`description`**: one to two sentences, standalone — per `DATA_README.md`,
  it must explain the concept without leaning on its position in the hierarchy
  (i.e. don't write "A type of X that..." as the whole description). Match the
  terse, technical register of neighboring entries.
- **`audience_level`** (1–5): follow the `AUDIENCE_LEVEL.md` procedure exactly
  — rate *recognition of the term* by the reference general audience, not
  difficulty or importance; test level 1 first and stop at the first level that
  clearly fits; don't infer from parent/child concepts. Use its calibration
  table as anchors.
- **`aliases`** / **`acronyms`**: only if genuinely established alternate
  names (e.g. `MLP`, `RAG`) — omit rather than force one.
- **`introduced`**: a year, only if you're confident of it.
- **`attributes`**: freeform key/value pairs, only when they add real signal
  (most concepts have none). Existing convention favors values like `always` /
  `usually` / `sometimes` / `never` for boolean-ish properties (see `deep`,
  `probabilistic`, `invertible` in `data/concepts/training.yaml`).
- **`modalities`** / **`typical_tasks`**: reference lists of *existing concept
  ids* — only set these if you're citing real ids you've confirmed are in
  `public/graph.json`; a dangling reference fails validation.
- Omit any attribute you're not asserting — per `DATA_README.md`, an omitted
  field means "not asserted," not false/none.

## Step 4 — Draft relationships

For each added concept, draft relationships to *both* other added concepts and
existing concepts, using only the 12 declared relationship types. **Only one
direction of each inverse pair is ever stored** — always use the canonical
direction, never its inverse:

| store this (canonical) | never this (inverse) |
| --- | --- |
| `is_a` | `has_subtype` |
| `is_subfield_of` | `has_subfield` |
| `uses` | `used_by` |
| `typically_uses` | `typically_used_by` |
| `trained_by` | `trains` |
| `used_for` | `uses_method` |
| `optimizes` | `optimized_by` |
| `produces` | `produced_by` |
| `product_uses_model_family` | `model_family_powers_product` |
| `family_of` | `has_model_family` |
| `evaluates` | `evaluated_by` |
| `encompasses` | `studied_within` |

(If ever in doubt, confirm with
`grep -h "type:" data/relationships/*.yaml | sort -u` — every type in that
output is a canonical direction; if you see one that isn't in the left column
above, the table is stale and the grep wins.)

Don't invent new relationship types. If a candidate concept genuinely needs a
relationship no existing type expresses, flag it to the user rather than
improvising one.

Aim for real connectivity, not just one link — at minimum an `is_a` /
`is_subfield_of` placing it in the taxonomy, plus whatever `uses` /
`used_for` / `trained_by` / etc. edges are actually true. Look at how similar
existing concepts are connected (their neighbors in `public/graph.json`) for a
sanity check on how densely to link. Don't fabricate a relationship just to hit
a quota — omit it if you're not confident it's true. Every `source`/`target`
must be a real concept id (a just-added one or an existing one); every triple
must be unique (no duplicate `source type target`).

## Step 5 — Review checkpoint

Before writing anything, show the user a compact draft: for each concept,
label/kind/audience_level/description, and its relationships. Explicitly call
out anything you're least sure about (a borderline audience level, a
relationship you're not fully confident in). Ask them to confirm or give
corrections in plain text — this is open-ended editing, not a multiple-choice
decision, so don't force it through `AskUserQuestion`.

## Step 6 — Write the YAML

Once confirmed, add each concept to the best-fit file under `data/concepts/`
and each relationship to the best-fit file under `data/relationships/`. Prefer
matching where topically-similar existing entries already live over a rigid
kind→file mapping — the files are organized thematically and some kinds are
split across several. As a starting point:

| concept file | typically holds |
| --- | --- |
| `fields.yaml` | `field`, general `data_concept`/`evaluation_concept` |
| `learning-paradigms.yaml` | `learning_paradigm` |
| `model-roles.yaml` | `model_role`, a few `model_class` |
| `tasks.yaml` | `task` |
| `classical-models.yaml` | pre-deep-learning `model_family` |
| `architectures.yaml` | `architecture`, some `model_class` |
| `model-families.yaml` | deep-learning/foundation `model_family`, `model_class` |
| `training.yaml` | `training_method`, `mathematical_object`, training-specific `data_concept`/`property`/`evaluation_concept` |
| `systems.yaml` | `system`, agent/product-adjacent `data_concept`/`property`/`training_method` |
| `products.yaml` | `product`, company-named `model_family` |
| `infrastructure.yaml` | `infrastructure` |

| relationship file | typically holds |
| --- | --- |
| `taxonomy.yaml` | `is_a`, `is_subfield_of`, `encompasses` |
| `architecture.yaml` | structural `is_a`/`uses`/`typically_uses` among architectures/model classes |
| `training.yaml` | training methods, math objects, data concepts: `uses`, `trained_by`, `produces`, `optimizes`, ... |
| `applications.yaml` | `used_for`, `evaluates`, task-facing `uses`/`typically_uses` |
| `products.yaml` | `family_of`, `product_uses_model_family`, product-facing edges |
| `infrastructure.yaml` | infrastructure edges |

Match the existing style within whichever file you edit (field order, quoting,
blank-line-between-entries) rather than introducing a new formatting style.

## Step 7 — Validate

Run `npm run build:data` again. If it reports errors (dangling references,
duplicate ids/relationships, `is_a`/`is_subfield_of` cycles, schema
violations), fix them and re-run until it's clean. Report the final concept
and relationship counts it prints back to the user.
