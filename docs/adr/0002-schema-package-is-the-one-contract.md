# packages/schema is the one contract

The design document, the API and every job's inputs and outputs are defined once in zod in `packages/schema`. TypeScript types, OpenAPI and the Python (Pydantic) models are generated from it, and CI fails if a generated file is stale. Python models are never edited by hand.
