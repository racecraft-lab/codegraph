-- CodeGraph SQLite Schema
-- Version 1

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- Insert initial version
INSERT INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema');

-- =============================================================================
-- Core Tables
-- =============================================================================

-- Nodes: Code symbols (functions, classes, variables, etc.)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    docstring TEXT,
    signature TEXT,
    visibility TEXT,
    is_exported INTEGER DEFAULT 0,
    is_async INTEGER DEFAULT 0,
    is_static INTEGER DEFAULT 0,
    is_abstract INTEGER DEFAULT 0,
    decorators TEXT, -- JSON array
    type_parameters TEXT, -- JSON array
    return_type TEXT, -- normalized return/result type name (e.g. C++ method return, for receiver-type inference)
    updated_at INTEGER NOT NULL
);

-- Edges: Relationships between nodes
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT, -- JSON object
    line INTEGER,
    col INTEGER,
    -- Provenance is intentionally unconstrained text for forward-compatible
    -- additive sources; SPEC-008 adds "lsp" without a schema migration.
    provenance TEXT DEFAULT NULL,
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Files: Tracked source files
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    node_count INTEGER DEFAULT 0,
    errors TEXT -- JSON array
);

-- Unresolved References: References that need resolution after full indexing.
-- status lifecycle: rows are inserted 'pending' by extraction; a completed
-- resolution pass either deletes a row (resolved) or marks it 'failed'
-- (attempted, no match — kept so a later sync can retry it when a changed
-- file introduces a symbol that could satisfy it, #1240). name_tail is the
-- last segment of reference_name ('util.greet' → 'greet'), written when a
-- row is marked failed, so the retry lookup matches new node names against
-- dotted refs too. Rows follow their from_node via ON DELETE CASCADE, so
-- re-extracting or deleting a file clears its stale rows in any status.
CREATE TABLE IF NOT EXISTS unresolved_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id TEXT NOT NULL,
    reference_name TEXT NOT NULL,
    reference_kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    candidates TEXT, -- JSON array
    file_path TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'pending',
    name_tail TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- =============================================================================
-- Indexes for Query Performance
-- =============================================================================

-- Node indexes
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line);
CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));

-- Full-text search index on node names, docstrings, and signatures
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

-- Prose-word → symbol-name lookup for the prompt hook's graph-derived gate.
-- One row per (segment, name): segment is a lowercased word of a symbol name
-- ("OrderStateMachine" → order, state, machine — see identifier-segments.ts),
-- which lets natural-language prompt words be verified against the graph in
-- any language whose technical nouns are Latin script. File nodes are
-- excluded — a file's basename duplicates the symbols inside it and skews the
-- singleton-vs-cluster rarity statistics. FTS can't serve this lookup (its
-- tokenizer keeps camelCase names as single tokens), so segments are
-- materialized on the node write path.
-- Deletions leave orphan rows ON PURPOSE: rows are PROPOSALS, always
-- re-verified against nodes before being surfaced (CodeGraph.getSegmentMatches),
-- and a full index clears the table at its start. Populated lazily on old
-- databases (empty until the next index/sync heals it).
CREATE TABLE IF NOT EXISTS name_segment_vocab (
    segment TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (segment, name)
) WITHOUT ROWID;

-- Embedding vectors — one row per embedded declaration-level symbol (SPEC-001).
-- Each row carries the persisted embedding plus self-describing integrity
-- metadata: `model` is the active model name at write time, `dims` is the vector
-- length, `vector` is a little-endian f32 BLOB (byte length == dims * 4), and
-- `input_hash` is the sha256 of the composed embedding input (drives staleness
-- detection). Writes are an upsert on `node_id`, so exactly one active model's
-- vector is held per symbol.
-- There is deliberately NO foreign key to nodes(id). A sync deletes and
-- re-inserts a file's node rows during re-extraction; an FK ON DELETE CASCADE
-- would drop the vectors along with them and force a needless re-embed on every
-- edit. Orphan rows (a `node_id` no longer present in `nodes`) are transient and
-- harmless — they are swept by the embed pass's explicit anti-join
-- reconciliation, never by a cascade. Keep this definition in lockstep with the
-- v8 migration in migrations.ts.
CREATE TABLE IF NOT EXISTS node_vectors (
    node_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dims INTEGER NOT NULL,
    vector BLOB NOT NULL,
    input_hash TEXT NOT NULL
);

-- Edge indexes.
-- idx_edges_source / idx_edges_target are intentionally omitted —
-- the (source, kind) and (target, kind) composites below cover the
-- corresponding source-only / target-only lookups via SQLite's
-- left-prefix scan, so the narrow indexes are dead weight on writes.
-- Migration v4 drops them on existing databases.
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);

-- Edge identity uniqueness. An edge IS uniquely (source, target, kind, line,
-- col); insertEdge uses `INSERT OR IGNORE`, but without something UNIQUE to
-- conflict on it behaved like a plain INSERT, so two passes emitting the same
-- edge produced byte-identical duplicate rows that inflated counts and flowed
-- into callers/impact (#1034). IFNULL folds the nullable line/col so
-- coordinate-less edges (synthesized / file-level) dedup too — SQLite treats
-- each NULL as distinct otherwise. Migration v6 dedups existing rows + adds
-- this on older databases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_identity
  ON edges(source, target, kind, IFNULL(line, -1), IFNULL(col, -1));

-- File indexes
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);

-- Unresolved refs indexes
CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_status ON unresolved_refs(status);
CREATE INDEX IF NOT EXISTS idx_unresolved_failed_tail ON unresolved_refs(name_tail) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);

-- Project metadata for version/provenance tracking
CREATE TABLE IF NOT EXISTS project_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- =============================================================================
-- SPEC-011 — Execution Flows & Clusters catalogs
-- =============================================================================
-- Two opt-in, deterministically-computed, atomically-swapped catalogs over the
-- graph: named execution flows and functional clusters. Empty by default — a
-- not-opted-in project writes zero rows here (FR-025/SC-007), exactly as
-- node_vectors sits empty until embeddings run.
--
-- Deliberately NO foreign keys and NO `ON DELETE CASCADE` on ANY of these five
-- tables (FR-022a). A cascade plus the per-file `deleteNodesByFile` of a
-- subsequent index/sync would shred a retained-stale catalog (FR-022) BEFORE its
-- replacement is even computed. Catalog rows reference graph rows BY VALUE
-- (node_id / file_path); the atomic swap deletes + re-inserts every row of a
-- kind inside one transaction (FR-021). Node ids are line-position-dependent, so
-- node-bearing rows also denormalize name/kind to stay displayable when the id
-- no longer resolves (a file path is position-independent, so cluster_members
-- needs no such denormalization). Keep every definition here in lockstep with
-- the v10 migration in migrations.ts.

-- One row per detected execution flow (FR-001/FR-003 — exactly one per entry
-- point). `id` is a deterministic root-derived natural key. The `truncated_*`
-- axis flags are set independently; the contract's `truncated` disjunction is
-- DERIVED at read time, never stored.
CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entry_kind TEXT NOT NULL,
    root_node_id TEXT NOT NULL,
    root_name TEXT NOT NULL,
    root_kind TEXT NOT NULL,
    truncated_depth INTEGER NOT NULL DEFAULT 0,
    truncated_width INTEGER NOT NULL DEFAULT 0,
    truncated_steps INTEGER NOT NULL DEFAULT 0,
    source_version INTEGER NOT NULL
);

-- One row per node in a flow's bounded branching graph (FR-004 — cycle-safe:
-- the (flow_id, node_id) PK makes a symbol reached via multiple parents appear
-- once). `provenance`/`edge_kind`/`parent_node_id` are NULL for the root step
-- (depth 0); every non-root step carries a 3-value provenance (FR-009).
CREATE TABLE IF NOT EXISTS flow_steps (
    flow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_kind TEXT NOT NULL,
    depth INTEGER NOT NULL,
    parent_node_id TEXT,
    edge_kind TEXT,
    provenance TEXT,
    PRIMARY KEY (flow_id, node_id)
);

-- One row per functional cluster (FR-011/FR-014). `id` is an opaque DETERMINISTIC
-- token (content hash of sorted member paths), transferred across re-index per
-- FR-015/016 — never a rowid/positional index (those churn on the swap).
-- `display_label` is the optional presentation-only LLM label (NULL when no LLM
-- configured); it never affects membership/identity/canonical label.
CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    canonical_label TEXT NOT NULL,
    display_label TEXT,
    member_count INTEGER NOT NULL,
    is_singleton INTEGER NOT NULL DEFAULT 0,
    source_version INTEGER NOT NULL
);

-- One row per (cluster, file). Every indexed file appears in exactly one cluster
-- (FR-014/SC-003). file_path is position-independent, so no name/kind
-- denormalization is needed.
CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    PRIMARY KEY (cluster_id, file_path)
);

-- Per-catalog header, present even when a catalog has zero content rows — this
-- is what distinguishes the read-time states (FR-022/FR-023). `first_run_failed`
-- = 1 with a NULL `computed_from_version` is the explicit "unavailable" marker.
-- Staleness is DERIVED (`computed_from_version < graph_write_version`), never
-- stored as a mutable flag.
CREATE TABLE IF NOT EXISTS catalog_meta (
    kind TEXT PRIMARY KEY,
    computed_from_version INTEGER,
    first_run_failed INTEGER NOT NULL DEFAULT 0
);

-- Deterministic-sort indexes for the paged list surfaces.
CREATE INDEX IF NOT EXISTS idx_flows_name ON flows(name, id);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow ON flow_steps(flow_id);
CREATE INDEX IF NOT EXISTS idx_clusters_sort ON clusters(member_count DESC, canonical_label, id);
CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
