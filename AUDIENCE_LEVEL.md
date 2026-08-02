# Audience level

## Purpose

Each concept has an `audience_level` from 1 through 5. The level estimates how
likely a member of the reference audience is to have encountered the term in
the intended AI/ML sense.

The field is used as a visibility threshold. If a viewer selects level `N`, the
default view includes concepts whose `audience_level` is less than or equal to
`N`.

Audience level measures **recognition of the term**, not:

- whether the audience can define it correctly;
- how difficult the concept is to understand;
- how much mathematics is needed for a complete treatment;
- how difficult it is to explain clearly;
- how important, foundational, or useful the concept is; or
- the technical level of the description shown by the application.

For example, `GPT` can be level 1 because it is widely encountered as a name,
even though `generative`, `pretrained`, and `transformer` may each have higher
levels. Ratings are not inherited from a concept's components, parents,
children, or related concepts.

## Reference audience

Unless a deployment specifies a different audience, use this reference
audience:

> An adult English-speaking general audience with ordinary exposure to current
> news, education, entertainment, and consumer technology, but no assumed
> education or professional experience in computer science, statistics, AI, or
> machine learning.

The audience definition matters. Recognition varies with language, country,
age, education, occupation, and time. A database intended for a different
population should document that population and recalibrate all levels
consistently.

## Level definitions

```yaml
levels:
  - value: 1
    label: Widely recognized
    description: >
      A term that most members of the reference audience are likely to have
      encountered and recognize as related to AI, computing, or technology,
      even if they cannot explain it accurately.

  - value: 2
    label: Commonly encountered
    description: >
      A term that a substantial portion of the reference audience is likely
      to have encountered through general news, education, entertainment,
      advertising, consumer products, or public discussion.

  - value: 3
    label: Familiar to an interested audience
    description: >
      A term that technology-interested non-specialists are reasonably likely
      to have encountered, but that most of the general audience probably has
      not.

  - value: 4
    label: Mainly technical
    description: >
      A term encountered primarily by students, practitioners, or people who
      regularly follow technical AI/ML material, with little recognition among
      the broader public.

  - value: 5
    label: Specialist
    description: >
      A term encountered mainly within a specialized technical or research
      community and likely to be unfamiliar even to many people with general
      AI/ML knowledge.
```

The levels describe progressively smaller audiences. They do not describe
progressively more difficult explanations.

## Assignment procedure

Assign a level using the following steps.

### 1. Identify the term being rated

Rate the concept under the label and aliases that users will actually see or
search for. Recognition of either the primary label or a well-established alias
counts as recognition of the concept.

If an alias is much more familiar than the expanded name, include the alias in
the concept record and rate using the familiar alias. For example, recognition
of `GPT` counts even if the audience does not know that it expands to
“generative pretrained transformer.”

If separate labels refer to materially different concepts, keep separate
concept records rather than allowing a familiar label to lower the level of an
unfamiliar concept.

### 2. Require recognition in the intended sense

Hearing the same word in an unrelated context does not count. The ordinary
word “transformer,” for example, does not make the neural-network architecture
widely recognized. The audience should be likely to associate the term with
the intended AI/ML concept, although a precise definition is not required.

Partial but relevant recognition does count. Someone who knows that GPT is
associated with systems such as ChatGPT has encountered the term in the
relevant sense, even if they misunderstand the acronym or model architecture.

### 3. Apply the audience tests in order

Start at level 1 and proceed through the higher-numbered levels until the first
description that fits.

1. **Level 1:** Would most members of the reference audience recognize the
   term in the relevant context?
2. **Level 2:** If not most, would a substantial portion recognize it from
   general media, consumer products, school, work, or public discussion?
3. **Level 3:** If not, would a technology-interested non-specialist be
   reasonably likely to have encountered it?
4. **Level 4:** If not, is it nevertheless common across introductory AI/ML
   education, technical practice, or broadly technical AI material?
5. **Level 5:** Is recognition largely confined to a subfield, advanced
   course, technical report, or research literature?

Assign the lowest numerical level that is clearly supported. If a concept lies
near a boundary and there is no good evidence, choose the higher numerical
level and record lower confidence. This avoids overwhelming viewers with terms
whose familiarity has been overestimated.

### 4. Evaluate the whole term, not its parts

Do not calculate a compound term's level from the levels of its constituent
words. Public exposure can make a compound name or acronym much more familiar
than its technical components. Conversely, familiar words can form an obscure
technical term.

Examples:

- `GPT` may be level 1 while `transformer` is level 3 or 4.
- `neural network` may be level 2 even though many people cannot describe a
  neuron, layer, weight, or activation function.
- `normalizing flow` should not receive a low level merely because both
  “normalizing” and “flow” are ordinary words.

### 5. Do not infer levels through graph relationships

Audience level is non-hierarchical. Do not require a child concept to have an
equal or higher level than its parent, and do not average the levels of related
concepts.

A named product, acronym, or model family can be more widely recognized than
the general model class or architecture that explains it. This is expected and
should remain visible in the data.

### 6. Record uncertainty and review date

Audience familiarity changes, especially for products and terms receiving
heavy news coverage. When possible, store the assessment date and confidence
alongside the level:

```yaml
audience_level: 1
audience_level_confidence: high
audience_level_reviewed: 2026-08-01
audience_level_note: Widely encountered through the ChatGPT product name.
```

Recommended confidence meanings:

- `high`: strong evidence or an unambiguous anchor case;
- `medium`: reasonable editorial judgment but no direct measurement;
- `low`: close boundary, rapidly changing usage, or audience-dependent term.

Review low-confidence and product-related ratings frequently. Review the full
scale periodically so that changes in public vocabulary do not accumulate as
inconsistencies.

## Evidence for difficult assignments

The levels are editorial judgments unless recognition data are available. The
following evidence can improve consistency:

- surveys asking whether respondents have heard the term;
- user testing with members of the reference audience;
- use of the term in general-interest headlines or broadcasts;
- use in mass-market product names, advertising, and entertainment;
- whether general-interest sources use the term without first introducing it;
- search-interest trends, interpreted cautiously; and
- comparison with established anchor concepts at adjacent levels.

Raw occurrence counts are not sufficient. Technical publications can make an
obscure term appear frequent, and a news spike may temporarily inflate public
exposure without producing durable recognition.

## Calibration examples

The following are provisional anchors for the default reference audience, not
permanent facts. They should be reviewed as public usage changes.

| Level | Illustrative concepts | Rationale |
| ---: | --- | --- |
| 1 | artificial intelligence, ChatGPT, GPT | Widely encountered in mass-market discussion and product usage. |
| 2 | machine learning, generative AI, neural network, large language model | Common in general technology coverage, but not necessarily recognized by most people. |
| 3 | supervised learning, reinforcement learning, transformer, diffusion model, GAN | Likely to have been encountered by people who follow AI explanations or technology closely. |
| 4 | loss function, variational autoencoder, convolutional neural network, instruction tuning | Primarily encountered in AI/ML courses and technical material. |
| 5 | normalizing flow, score-based generative model, RLAIF | Mainly encountered in specialized technical or research contexts. |

These examples calibrate recognition only. They do not imply that every concept
in a row is equally difficult to explain or equally important.

## Common rating errors

Avoid these mistakes:

- **Rating understanding instead of recognition:** “Most people cannot explain
  GPT” is not a reason to raise its level.
- **Rating technical difficulty:** A mathematically deep concept can still have
  a low level if its name is widely encountered.
- **Expanding acronyms before rating:** Rate `GPT` as encountered, not as three
  separately rated technical words.
- **Counting an unrelated meaning:** Familiarity with electrical transformers
  does not count as familiarity with transformer neural networks.
- **Assuming taxonomic inheritance:** The level of a model family need not match
  the level of its architecture or training method.
- **Equating importance with familiarity:** Foundational concepts are not
  necessarily familiar, and fashionable terms are not necessarily
  foundational.
- **Using the intended description as the test:** A clear description can make
  an unfamiliar concept understandable; that does not lower its audience
  level.
- **Treating ratings as permanent:** Public familiarity with AI terminology can
  change rapidly.

## Relationship to explanation detail

`audience_level` controls whether a concept is shown by default. It should not
control the wording or depth of the concept's explanation. If the application
needs explanations at multiple technical depths, represent that separately,
for example:

```yaml
audience_level: 1
descriptions:
  plain_language: ...
  introductory: ...
  technical: ...
```

This separation allows a widely recognized term such as GPT to appear at level
1 while still supporting progressively deeper explanations of how it works.
