# Parity Gate

## Commands

```text
node scripts/spec-008-parity-gate.mjs
```

Expected result: pass, 16 language rows, 17 capability rows, 0 unowned rows.

```text
node scripts/spec-008-parity-gate.mjs --language <negative-language-fixture> --capability specs/008-lsp-client-integration/validation/capability-parity.md --json
```

Expected result: fail when a language row is marked `Unowned`.

```text
node scripts/spec-008-parity-gate.mjs --language specs/008-lsp-client-integration/validation/language-parity.md --capability <negative-capability-fixture> --json
```

Expected result: fail when a capability row is marked `Backlog` or lacks a
concrete numbered future owner for a future-owned row.

## Result

Pass:

```text
SPEC-008 parity gate passed: 16 language rows, 17 capability rows, 0 unowned rows.
```

Negative fixtures:

```text
negative parity fixtures failed as expected
```
