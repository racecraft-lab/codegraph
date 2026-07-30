# Contract: Cypher Grammar and Graph Semantics

## Supported Grammar

```ebnf
query           ::= matchClause whereClause? returnClause orderByClause? limitClause? EOF
matchClause     ::= MATCH pathBinding? nodePattern relationshipNodePattern+
pathBinding     ::= identifier "="
relationshipNodePattern ::= relationshipPattern nodePattern
nodePattern     ::= "(" identifier? label? propertyMap? ")"
label           ::= ":" identifier
relationshipPattern ::= outgoingRelationship | incomingRelationship
outgoingRelationship ::= "-[" identifier? relationshipType? range? "]->"
incomingRelationship ::= "<-[" identifier? relationshipType? range? "]-"
relationshipType ::= ":" identifier
range           ::= "*" integer? ".." integer
whereClause     ::= WHERE expression
returnClause    ::= RETURN returnItem ("," returnItem)*
returnItem      ::= expression alias?
alias           ::= AS identifier
orderByClause   ::= ORDER BY orderItem ("," orderItem)*
orderItem       ::= expression (ASC | DESC)?
limitClause     ::= LIMIT integer
stringLiteral   ::= "'" stringCharacter* "'"
```

The grammar accepts exactly one connected node-edge chain. It rejects multiple `MATCH` clauses, comma patterns, disconnected patterns, optional matches, undirected relationships, write clauses, external parameters, `DISTINCT`, non-count aggregation, nested JSON access, and `IN`.

## Identifier Rules

- Keywords are case-insensitive.
- Variables, aliases, labels, relationship types, and properties are case-sensitive.
- Bare identifiers use ASCII letters, digits, and `_`, and cannot start with a digit.
- Backtick identifiers are allowed wherever identifiers are accepted.
- A literal backtick inside a backtick identifier is written as two consecutive backticks.
- Control characters and Unicode escape forms inside backticks are unsupported.
- Unescaped values compare exactly with no Unicode normalization.

## String Literal Rules

- V1 accepts single-quoted string literals only.
- Literal single quotes and backslashes use `\'` and `\\`.
- Supported escapes are `\'`, `\\`, `\n`, `\r`, `\t`, `\b`, and `\f`.
- Raw line terminators, NUL, other raw control characters, Unicode escape forms such as `\uXXXX`, invalid escapes, incomplete escapes, double-quoted strings, and literal concatenation are unsupported.
- Decoded string values compare exactly with no Unicode normalization.
- String literal values are always emitted as bound SQLite parameters and never concatenated into SQL text.

## Labels and Relationship Types

Node labels:

```text
file, module, class, struct, interface, trait, protocol, function, method, property, field, variable, constant, enum, enum_member, type_alias, namespace, parameter, import, export, route, component
```

Relationship types:

```text
contains, calls, imports, exports, extends, implements, references, type_of, returns, instantiates, overrides, decorates
```

## Property Catalog

Node properties:

```text
id, kind, name, qualifiedName, filePath, language, startLine, endLine, startColumn, endColumn, docstring, signature, visibility, isExported, isAsync, isStatic, isAbstract, decorators, typeParameters, returnType
```

Relationship properties:

```text
source, target, kind, metadata, line, column, provenance
```

Opaque return-only fields: `metadata`, `decorators`, and `typeParameters`. They cannot be used by `WHERE`.

## Predicate Semantics

Supported operators:

```text
IS NULL, IS NOT NULL, AND, OR, NOT, =, <>, <, <=, >, >=, STARTS WITH, ENDS WITH, CONTAINS
```

Three-valued logic:

| Expression | Result |
|---|---|
| `true AND null` | null |
| `false AND null` | false |
| `true OR null` | true |
| `false OR null` | null |
| `NOT null` | null |
| comparison with null | null |
| string predicate with null | null |

`WHERE` retains only rows whose final predicate is true.

## Paths

- Variable relationships require an explicit upper bound.
- The upper bound must be <= 8.
- Returned paths cannot repeat the same relationship.
- Returned paths may revisit nodes.
- Path values preserve ordered nodes and relationships.
- Recursive expansion state must carry depth, direction, and visited relationship identity before rows reach final ordering, `LIMIT`, or row-cap truncation.
- Generated plans must not rely on a final top-level `LIMIT` as the only guard against variable-path candidate growth.

## Stable Ordering

When `ORDER BY` is absent, CodeGraph orders rows by projected values in `RETURN` order, then by full matched-chain identity as a final tie-breaker. Value comparison rules are defined in [data-model.md](../data-model.md).

Explicit ascending order places null after non-null. Explicit descending order places null before non-null.

## Performance Plan Evidence

Representative validation must include planner evidence for variable paths, stable ordering, count/grouping, and row-cap truncation on realistic graph density. Plan evidence must identify directional edge-index use and bounded temporary sort/group work where SQLite reports it.

## Diagnostics

Diagnostics include stable code, UTF-16 offset, line, column, expected construct, grammar anchor, bounded escaped excerpt, and truncation flags. Oversized input diagnostics do not echo query text. Logs, telemetry, malfunction messages, and expected error output do not persist raw full query text, string literal values outside the bounded escaped diagnostic excerpt, emitted SQL text, or bound parameters.

Diagnostic validation must include Unicode astral code points, combining characters, CRLF/LF, and multiline inputs so UTF-16 offsets, line/column values, escaped excerpts, expected constructs, and grammar anchors are proven against non-ASCII source text.

## Opaque JSON Conversion

Returned opaque JSON fields must preserve only valid public JSON shapes. Malformed storage JSON or wrong top-level shapes for `metadata`, `decorators`, or `typeParameters` surface as null/absent public values, never as raw storage strings or coerced replacement values.
