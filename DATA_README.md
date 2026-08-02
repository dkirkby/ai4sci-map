# AI/ML concept graph

The data/ directory contains a human-editable seed database for an interactive map
of artificial-intelligence and machine-learning concepts.

## Layout

```text
data/
  manifest.yaml
  schema.yaml
  relationship-types.yaml
  concepts/
    fields.yaml
    learning-paradigms.yaml
    model-roles.yaml
    tasks.yaml
    classical-models.yaml
    architectures.yaml
    model-families.yaml
    training.yaml
    systems.yaml
    products.yaml
    infrastructure.yaml
  relationships/
    taxonomy.yaml
    architecture.yaml
    training.yaml
    applications.yaml
    products.yaml
    infrastructure.yaml
```

`manifest.yaml` defines the complete source set and its merge order.
Each other data file is a fragment with a `fragment_type`. A build step should:

1. read the files listed in the manifest;
2. concatenate each fragment's records;
3. validate the assembled graph;
4. emit canonical JSON for the web application.

## Editing conventions

- IDs are stable, lowercase, hyphen-separated identifiers.
- Labels and descriptions may change without changing IDs.
- Relationships reference IDs, never labels.
- `kind` is a single structural classification used by the application.
- Semantic classifications are expressed with relationships such as `is_a`.
- Use `typically_uses` or a `frequency` qualifier when a relationship is not
  universally true.
- An omitted attribute means "not asserted", not `false`.
- Descriptions should explain the concept without relying on its position in a
  hierarchy.

## Validation beyond the schema

JSON Schema validates individual records. A graph validator should additionally
check:

- concept IDs are unique across all concept files;
- relationship-type IDs are unique;
- every relationship source, target, modality, and typical-task reference
  resolves to a concept;
- every relationship uses a declared relationship type;
- duplicate relationships are rejected;
- `is_a` and `is_subfield_of` contain no unintended cycles.

