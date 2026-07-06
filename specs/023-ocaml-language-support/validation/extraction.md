# SPEC-023 Extraction Evidence

## Command

```bash
npx vitest run __tests__/ocaml-extraction.test.ts
```

## Result

Passed: 1 test file, 7 tests.

## Coverage

- `.ml` and `.mli` detection as `ocaml`.
- Implementation and interface parsers load separately under the public
  `ocaml` language.
- Implicit file module extraction.
- Modules, functors, module types/signatures, source and interface declarations.
- Records, fields, variants, GADT constructors, and polymorphic variants.
- Function-valued `let`, constants, external declarations, labeled/optional
  parameters, local modules, first-class modules, classes, class types, methods,
  and object fields.
- Open/include/functor/first-class-module references are recorded
  conservatively as unresolved references for resolution.
