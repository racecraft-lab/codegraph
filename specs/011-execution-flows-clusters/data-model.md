# Data Model: Execution Flows & Clusters

**Feature**: SPEC-011 | **Date**: 2026-07-14 | **Store**: existing per-project `node:sqlite` (WAL + FTS5), `.codegraph/`

All new DDL ships in `src/db/schema.sql` (copied to `dist/db/schema.sql` by `copy-assets`, Constitution VII) **and** in a lockstep `src/db/migrations.ts` entry that follows the `node_vectors` v9 precedent, so already-initialized projects gain the tables on open. The migration is assigned the **next sequential schema version** after the current head (`node_vectors` = v9); schema.sql and migrations.ts must define byte-equivalent table shapes.

## Design invariants (traceability)

- **By-value graph references, NO `ON DELETE CASCADE`** (FR-022a). Catalog rows reference graph rows by value — `node_id` (TEXT) and `file_path` (TEXT) — with no foreign key to `nodes`/`files`. A cascade plus the per-file `deleteNodesByFile` of a subsequent index/sync would shred a retained-stale catalog (FR-022) *before* its replacement is even computed. The catalog tables carry **no foreign keys at all**; the atomic swap deletes and re-inserts every catalog row inside one transaction (FR-021).
- **Denormalized identity on node-bearing rows** (FR-022a). Node ids are line-position-dependent sha256 — they change when a symbol's line shifts, so by-value `node_id` references dangle after ordinary edits. Rows that reference a node (`flows.root_*`, `flow_steps`) therefore also store `name` + `kind` so they stay meaningfully displayable when the node id no longer resolves; unresolvable fields render as an explicit placeholder, never an error. File-only rows (`cluster_members`) need no such denormalization — a **file path is not position-dependent**, so it stays stable across ordinary edits.
- **Derived staleness, not a stored flag** (FR-022). Staleness = `catalog_meta.computed_from_version < graph_write_version` (recorded < live). Never stored as a mutable boolean.
- **Deterministic everything** (FR-013/FR-032, Constitution V). No random seeds; stable ordering + deterministic tie-breaks throughout.

## Project metadata (existing key-value store)

One new key in the existing project-metadata store (the same store that holds `vectors_write_version`):

| Key | Type | Semantics |
|---|---|---|
| `graph_write_version` | INTEGER (monotonic) | The **live** graph version. Advanced by +1 on **each successful index and each successful sync** when catalog analysis is active (Q13/FR-022), analogous to `vectors_write_version`. It is advanced **as part of the successful graph-update commit, before catalog analysis runs**, so that if analysis then fails, the retained catalog's `computed_from_version` is strictly less than the live token and derives as stale. Maintained **only when at least one catalog is enabled** — a fully-disabled project writes nothing (FR-025/SC-007 dormancy). |

## Table: `flows`

One row per detected execution flow (FR-001/FR-003 — exactly one per entry point, deduplicated).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | **Deterministic natural key** derived from the root entry point (FR-017a: a flow needs no minted/opaque identity — its root is its stable key). E.g. a stable hash of `entry_kind` + normalized root identity (route method+path, CLI command name, or qualified symbol). |
| `name` | TEXT NOT NULL | FR-010: `"<METHOD> <path>"` when route-rooted; CLI command name when CLI-rooted; else qualified root symbol. |
| `entry_kind` | TEXT NOT NULL | `'route' \| 'cli' \| 'event' \| 'export'` (FR-001, Entry Point entity). |
| `root_node_id` | TEXT NOT NULL | By-value ref to the root graph node (for a route-rooted flow, the `route` node itself — FR-008). No cascade. |
| `root_name` | TEXT NOT NULL | Denormalized root identity (FR-022a). |
| `root_kind` | TEXT NOT NULL | Denormalized root NodeKind (FR-022a). |
| `truncated_depth` | INTEGER NOT NULL DEFAULT 0 | Axis flag — depth cap (12 hops) reached (FR-007). |
| `truncated_width` | INTEGER NOT NULL DEFAULT 0 | Axis flag — width cap (20 out-edges/step) reached (FR-007). |
| `truncated_steps` | INTEGER NOT NULL DEFAULT 0 | Axis flag — total-step cap (200 unique steps) reached (FR-007). |
| `source_version` | INTEGER NOT NULL | The `graph_write_version` this flow's catalog was computed from (mirrors `catalog_meta`; convenience for detail reads). |

- `truncated` (the contract's disjunction, FR-027) is **derived** at read time = `truncated_depth OR truncated_width OR truncated_steps`; not stored (Simplicity First).
- Index: `flows(name, id)` supports the `list_flows` deterministic sort (name asc, then id).

## Table: `flow_steps`

One row per node in a flow's bounded branching graph (FR-004 — cycle-safe, each symbol once).

| Column | Type | Notes |
|---|---|---|
| `flow_id` | TEXT NOT NULL | Plain column linking to `flows.id` (no FK; swap deletes explicitly). Indexed. |
| `node_id` | TEXT NOT NULL | By-value ref to the step's graph node (FR-022a). No cascade. |
| `symbol_name` | TEXT NOT NULL | Denormalized identity (FR-022a). |
| `symbol_kind` | TEXT NOT NULL | Denormalized NodeKind (FR-022a). |
| `depth` | INTEGER NOT NULL | Hops from the root (0 = root). Bounded by the depth cap (Flow Step entity). |
| `parent_node_id` | TEXT | The step's parent in the branching graph (edge source); NULL for the root step. Reconstructs the DAG. |
| `edge_kind` | TEXT | `'calls' \| 'references'` — the edge class that produced this step (FR-008); NULL for the root. |
| `provenance` | TEXT | `'static' \| 'lsp' \| 'heuristic'` — provenance of the incoming call edge (FR-008/FR-009). NULL for the root step (depth 0); else `static`/`lsp`/`heuristic`. Every non-root step carries one (SC-001). |
| PRIMARY KEY | `(flow_id, node_id)` | Enforces cycle-safety: a symbol reached via multiple parents appears **once** (first deterministic visit under the FR-008a total order records its parent). |

## Table: `clusters`

One row per functional cluster (FR-011/FR-014 — total file coverage, explicit singletons).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | **Opaque DETERMINISTIC token** (FR-017a) — a content hash of the cluster's sorted member file paths, minted on first appearance and transferred across re-index per FR-015/016; NOT a rowid or positional index (those churn on the swap). |
| `canonical_label` | TEXT NOT NULL | FR-018: deterministic, from the cluster's dominant directory + name tokens. |
| `display_label` | TEXT | FR-019: optional LLM display label, **presentation-only**; NULL when no LLM configured (dormant here). Never affects membership/identity/canonical label. |
| `member_count` | INTEGER NOT NULL | Size (member file count). Sort + `minSize` filter key. |
| `is_singleton` | INTEGER NOT NULL DEFAULT 0 | FR-014: single-file community, flagged. |
| `source_version` | INTEGER NOT NULL | The `graph_write_version` this cluster's catalog was computed from. |

- Index: `clusters(member_count DESC, canonical_label ASC, id ASC)` supports the `list_clusters` deterministic sort.

## Table: `cluster_members`

One row per (cluster, file). Every indexed file appears in **exactly one** cluster (FR-014/SC-003).

| Column | Type | Notes |
|---|---|---|
| `cluster_id` | TEXT NOT NULL | Plain column linking to `clusters.id` (no FK; swap deletes explicitly). Indexed. |
| `file_path` | TEXT NOT NULL | By-value ref to the file (FR-022a). No cascade. Position-independent → no name/kind denormalization needed. |
| PRIMARY KEY | `(cluster_id, file_path)` | A file belongs to one cluster; the pair is unique. |

- Total-coverage invariant (SC-003) is a computed property of the analysis (every indexed file is assigned), verified by test, not a DB constraint.

## Table: `catalog_meta`

Per-catalog header, present even when a catalog has zero content rows. This is what distinguishes the read-time states (FR-022/FR-023, Catalog entity).

| Column | Type | Notes |
|---|---|---|
| `kind` | TEXT PRIMARY KEY | `'flows' \| 'clusters'`. |
| `computed_from_version` | INTEGER | The `graph_write_version` of the last **successfully committed** catalog of this kind. NULL iff none ever committed. |
| `first_run_failed` | INTEGER NOT NULL DEFAULT 0 | `1` ⇒ explicit **unavailable** (first analysis failed with no prior catalog, FR-023). |

**Read-time state resolution** (Catalog entity — available / stale / unavailable / available-but-empty / disabled):

| Condition | State |
|---|---|
| Live per-catalog opt-in flag OFF (regardless of any retained `catalog_meta` row) | **disabled** — resolved FIRST; retained rows/metadata are inert, never available or stale |
| No `catalog_meta` row for `kind` | **disabled / never-computed** (feature off) — distinct from unavailable |
| Row, `computed_from_version IS NULL`, `first_run_failed = 1` | **unavailable** (explicit; never partial/empty-looking, FR-023) |
| Row, `computed_from_version = v`, `v = graph_write_version`, content rows present | **available** (fresh) |
| Row, `computed_from_version = v`, `v = graph_write_version`, zero content rows | **available-but-empty** (e.g. no detectable entry points) — distinct from disabled and unavailable |
| Row, `computed_from_version = v`, `v < graph_write_version` | **stale** (derived, FR-022) — served with the recorded version + staleness guidance |

## Atomic swap (FR-021 / FR-021a)

One SQLite write transaction over the WAL store performs the full replacement of a catalog kind:

```
BEGIN;
  DELETE FROM flow_steps;  DELETE FROM flows;            -- (or clusters/cluster_members)
  INSERT ... the freshly computed rows ...
  INSERT OR REPLACE INTO catalog_meta(kind, computed_from_version, first_run_failed)
    VALUES ('flows', <live graph_write_version>, 0);
COMMIT;
```

- No generation-tagged rows, no multi-generation retention (FR-021). A concurrent reader — including a daemon query connection under WAL snapshot isolation — observes either the complete prior catalog or the complete new one.
- On analysis failure: the swap does **not** run; the prior rows + prior `catalog_meta` remain; the live `graph_write_version` has already advanced, so the retained catalog derives as stale. First-run failure writes only `catalog_meta(kind, NULL, first_run_failed=1)`.
- **Composite reads** (FR-021a): any read that composes >1 statement — notably `total` count + paged slice (`list_flows`/`list_clusters`), the `get_flow` detail read (a flow header row + its `flow_steps` rows), and the read-state probe (a `catalog_meta` row + the content-row count distinguishing available from available-but-empty) — derives its rows from a **single consistent snapshot**: a read transaction wrapping the statements, or full-fetch-then-slice per the `src/mcp/read-ops.ts` precedent. Autocommit gives each *statement* its own snapshot, so multi-statement composition is where torn cross-generation reads would arise. This holds on BOTH surfaces: MCP tools run inside the per-project daemon and read on its worker connections (WAL cross-connection snapshot isolation); the REST endpoints hold no DB connection of their own — the web `serve` process is a daemon *client* (`src/server/daemon-client.ts`, SPEC-005 FR-002) that forwards each catalog read to that same daemon, mirroring the existing `readNode`/`readSearch` forwarding, so both surfaces execute the composite read on the daemon's worker connections (one topology). Either way every composite read MUST derive its rows from a single statement or a single full-fetch-then-slice, never two separately-issued statements (the connection-topology-independent mechanism). Where WAL is unavailable (some virtualized/network mounts), the store degrades to writer-blocks-reader, preserving the same all-or-nothing guarantee.

## Entity → table map

| Spec entity | Storage |
|---|---|
| Catalog | `catalog_meta` (+ live `graph_write_version` metadata key) |
| Execution Flow | `flows` |
| Flow Step | `flow_steps` |
| Entry Point | `flows.entry_kind` + `flows.root_*` (not a separate table — an entry point is the root of exactly one flow) |
| Functional Cluster | `clusters` + `cluster_members` |
