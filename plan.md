# Grafana HSDS Backend Plugin — Implementation Plan

## TL;DR

Build a Grafana backend plugin connecting to a remote HSDS server via `hsds-client-rs`. The QueryEditor uses an **h5web-style tree view with checkboxes** for measurement selection within a shot's `/OutputDeck/` hierarchy. Each query targets one shot; multi-shot comparison uses Grafana's built-in multi-query (A, B, C…). The backend provides browse endpoints for tree population and a `DataService` that returns 1D time-series frames using binary reads from HSDS. Measurements from different subsystems (with different sampling rates) are returned as separate frames — Grafana overlays them correctly since T=0 is synchronized.

---

## Data Schema

Each HDF5 file (domain in HSDS) represents a **shot**. The structure:

```
/OutputDeck/
  <Subsystem>/                         ← Group (e.g., MachineN1_1, RFDiagnostics_1)
    Timestamp                          ← Dataset (N,) f64 — time axis for this subsystem
    <Measurement>/                     ← Group (e.g., M1_Current, ForwardPower)
      x_data                           ← Hardlink → ../Timestamp
      y_data                           ← Dataset (N,) f64 — actual measurement values
    <Measurement>/
      x_data                           ← Hardlink → ../Timestamp
      y_data                           ← Dataset (N,) f64
    ...
  <Subsystem>/
    Timestamp                          ← Different sampling rate
    <Measurement>/
      x_data
      y_data
    ...
```

### Key facts

- **3-level hierarchy**: OutputDeck → Subsystem (group) → Measurement (group) → x_data/y_data (datasets)
- **x_data** is always hardlinked to the parent subsystem's `Timestamp` dataset
- **Sampling rates vary** per subsystem: 50 (cameras) to 1M (VacuumDiagnostics, XRay)
- **T=0 is synchronized** across all subsystems — traces from different subsystems align visually
- **Dataset attributes**: `Unit` and `long_name` provide display metadata
- **Subsystem group attributes**: `T0_Timestamp`, `Trigger Channel`, `Trigger_T0`
- `/InputDeck/` contains experiment configuration — not relevant for visualization

### Reference file: `S-N1-02139.h5`

| Subsystem | Samples | Purpose |
|-----------|---------|---------|
| Camera_2, Camera_3, Camera_4 | 50 | Camera frames |
| Interferometer_1 | 120,000 | Plasma density |
| MachineN1_1 | 270 | Machine diagnostics (currents, voltages, gauges) |
| MagnetDiagnostics_1 | 13,000 | Magnetic field |
| PhotoDiode_1 | 120,000 | Photodiode signals |
| RFDiagnostics_1–6 | 120,000 | RF power signals |
| RFPowerMeasurement_1 | 5,000 | RF power measurement |
| Spectrometer_1 | 100 | Spectral data |
| VaccumDiagnostics_1 | 1,000,000 | Vacuum pressure |
| XRay-Diagnostic_1 | 1,000,000 | X-ray signals |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Grafana Panel                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Time-series visualization (overlaid frames)        │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Query Editor (edit mode only)                      │  │
│  │  Shot: [S-N1-02139.h5 ▾]                          │  │
│  │  ▾ MachineN1_1                                     │  │
│  │      ☑ M1_Current         (270 pts)                │  │
│  │      ☐ M1_Voltage         (270 pts)                │  │
│  │  ▾ RFDiagnostics_1                                 │  │
│  │      ☑ ForwardPower       (120K pts)               │  │
│  │      ☐ ReflectedPower     (120K pts)               │  │
│  │  ▸ VaccumDiagnostics_1                             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │                          │
         │ ResourceService          │ DataService
         │ (browse endpoints)       │ (query execution)
         ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│ Rust Backend (grafana-plugin-sdk)                        │
│  - Config: HSDS URL + BasicAuth credentials              │
│  - Browse: list domains, tree-root, tree-expand          │
│  - Query: resolve measurements → fetch x_data/y_data    │
│           → group by subsystem → return frames           │
└──────────────────────────────────────────────────────────┘
         │
         │ HTTP REST (binary reads)
         ▼
┌──────────────────────────────────────────────────────────┐
│ HSDS Server (remote)                                     │
│  - GET /domains, /groups/{id}, /groups/{id}/links        │
│  - GET /datasets/{id}, /datasets/{id}/value              │
│  - Accept: application/octet-stream → raw LE bytes       │
└──────────────────────────────────────────────────────────┘
```

### Multi-query for multi-shot comparison

Each Grafana panel supports multiple queries (A, B, C…). Each query targets one shot:

- **Query A**: Shot `S-N1-02139.h5` → `MachineN1_1/M1_Current` (270 pts)
- **Query B**: Shot `S-N1-02140.h5` → `MachineN1_1/M1_Current` (270 pts)
- Grafana overlays both traces with legend labels like `S-N1-02139/M1_Current`, `S-N1-02140/M1_Current`

---

## Implementation Steps

### Phase 1 — Extend `hsds-client-rs`

#### 1. Fix binary reads — add Accept header

The current `read_dataset_values()` does not set `Accept: application/octet-stream`, so HSDS returns JSON as raw bytes instead of true binary. One-line fix: add the header to the request builder.

#### 2. Add `resolve_path` helper

A method on `HsdsClient` that takes a domain and an HDF5 path (e.g., `/OutputDeck/MachineN1_1`) and traverses from root using `get_domain()` → `list_links()` → `get_group()`/`get_dataset()` per path segment. Returns the resolved entity ID and collection type.

Needed because HSDS only supports ID-based access, not path-based.

#### 3. Add `list_children` convenience

Given a domain and group ID, calls `list_links()` and returns a structured list of children with name, ID, and collection type (group vs dataset). Powers the tree view browse endpoints.

#### 4. Add typed binary deserialization helper

Helper that takes `Bytes` + HSDS type info and returns typed Rust arrays:
- Know dtype from `get_dataset()` metadata
- Use `bytemuck::cast_slice()` for zero-copy conversion to `&[f64]`, `&[f32]`, `&[i32]`, etc.
- Convert to `Vec<f64>` for Grafana frame fields

#### 5. Tests

Unit tests in `src/tests.rs` for: path resolution, list_children, binary deserialization.

---

### Phase 2 — Backend Plugin (Rust)

#### 6. Add `hsds-client-rs` dependency

In `backend/Cargo.toml`:
```toml
hsds_client = { path = "../../hsds-client-rs" }
bytemuck = { version = "1", features = ["derive"] }
```

#### 7. Config model

Extract from Grafana plugin context:
- `jsonData.url` → HSDS server URL
- `jsonData.defaultFolder` → default domain folder (e.g., `/home/shots/`)
- `secureJsonData.username` + `secureJsonData.password` → BasicAuth credentials

Construct an `HsdsClient` per datasource instance.

#### 8. ResourceService browse endpoints

| Endpoint | Purpose | HSDS Calls |
|----------|---------|-----------|
| `GET /domains?folder=X` | Populate shot dropdown | `list_domains(folder)` |
| `GET /tree-root?domain=X` | Get OutputDeck's children (subsystems) | `resolve_path(/OutputDeck)` → `list_children()`, return only groups |
| `GET /tree-expand?domain=X&groupId=Y` | Expand a subsystem node | `list_children(Y)`, return child groups (measurements) with y_data shape/type info |
| `GET /dataset-meta?domain=X&datasetId=Y` | Fetch Unit, long_name attributes | `get_dataset()` + `list_attributes()` |

For `tree-expand`: when listing a subsystem's children, exclude the `Timestamp` dataset and only return measurement groups. For each measurement group, peek at its `y_data` child to report shape/type for the tree UI.

#### 9. DataService::query_data

Core query handler:

1. Receive query: `domain`, `channels: [{ measurementId, measurementName, subsystemName }]`
2. Group selected measurements by subsystem
3. For each subsystem group:
   a. Pick any measurement → resolve `x_data` → get dataset ID → fetch binary values (this is the shared Timestamp via hardlink)
   b. For each measurement in this group → resolve `y_data` → fetch binary values in parallel
   c. Build one Grafana `Frame` with:
      - Time field from x_data values (f64 epoch seconds)
      - One value field per measurement (named `{shotName}/{subsystemName}/{measurementName}`)
      - Include `Unit` attribute as field config
4. Return all frames

**Optimization**: Since `x_data` is hardlinked to the same `Timestamp` within a subsystem, the backend only fetches x_data once per subsystem (same HSDS object ID).

#### 10. Remove StreamService

Not needed for v1. Remove or leave as empty stub.

#### 11. Error handling

Map `HsdsError` variants:
- `Auth` / `PermissionDenied` → 401/403 with message
- `DomainNotFound` / `ObjectNotFound` → descriptive "not found" error
- `Http` / `InvalidResponse` → connection error message

---

### Phase 3 — Frontend

#### 12. Update types (`src/types.ts`)

```typescript
interface MyDataSourceOptions extends DataSourceJsonData {
  url: string;
  defaultFolder?: string;
}

interface MySecureJsonData {
  username: string;
  password: string;
}

interface MeasurementChannel {
  measurementId: string;    // HSDS group ID of the measurement
  measurementName: string;  // Display name (e.g., "M1_Current")
  subsystemName: string;    // Parent subsystem name (e.g., "MachineN1_1")
}

interface MyQuery extends DataQuery {
  domain: string;              // Shot domain path in HSDS
  domainLabel: string;         // Display name (e.g., "S-N1-02139")
  channels: MeasurementChannel[];
}
```

#### 13. Rewrite ConfigEditor (`src/ConfigEditor.tsx`)

Fields:
- HSDS server URL (text input)
- Default domain folder path (text input, e.g., `/home/shots/`)
- Username (secure text input)
- Password (secure text input)

#### 14. Build tree view component (`src/TreeView.tsx`)

h5web-style lazy-loading recursive tree:
- **Top-level nodes** = subsystem groups (fetched from `GET /tree-root`)
- **Expand a subsystem** → fetch measurement groups via `GET /tree-expand`
- **Leaf nodes** = measurement groups with checkboxes for multi-select
- `Timestamp` datasets and `x_data`/`y_data` internals are hidden from the user
- Measurement nodes show shape info (e.g., `270 pts, f64`) and `Unit` attribute
- Checked state derived from `query.channels[]` array
- Checking/unchecking calls `onChange({ ...query, channels: updatedList })` + `onRunQuery()`
- Cross-subsystem selection supported (measurements from different subsystems can be checked simultaneously)
- Scrollable container with ~300px max height

#### 15. Rewrite QueryEditor (`src/QueryEditor.tsx`)

Layout:
- **Shot selector** (dropdown, full width) — populated by `GET /domains` on mount
- **Tree view** below — renders `TreeView` for the selected shot's `/OutputDeck/`
- Selecting a shot loads the tree; checking measurements triggers queries

#### 16. Update datasource (`src/datasource.ts`)

Add `getResource()` wrapper methods:
- `listDomains(folder: string)` → `GET /domains?folder=...`
- `getTreeRoot(domain: string)` → `GET /tree-root?domain=...`
- `expandNode(domain: string, groupId: string)` → `GET /tree-expand?domain=...&groupId=...`
- `getDatasetMeta(domain: string, datasetId: string)` → `GET /dataset-meta?domain=...&datasetId=...`

#### 17. Update plugin.json (`src/plugin.json`)

- ID: `novatron-hsds-datasource`
- Name: "HSDS" or "Novatron HSDS"
- Description: updated to reflect HSDS purpose
- Executable: update name to match

---

### Phase 4 — Integration & Polish

#### 18. Update docker-compose

- Ensure backend container can reach remote HSDS server
- Add environment variables for test HSDS URL
- No HSDS service needed (remote server already available)

#### 19. Upload example data

Use `hsload-rs` to upload `S-N1-02139.h5` to the remote HSDS server for testing.

#### 20. Playwright test

Update `tests/example.spec.ts`:
- Configure datasource with HSDS URL + credentials
- Select shot `S-N1-02139.h5`
- Expand `MachineN1_1` in tree
- Check `M1_Current` + `M2_Current`
- Verify time-series panel renders

---

## Verification

| Level | Test | Expected |
|-------|------|----------|
| `hsds-client-rs` unit | `cargo test` | Path resolution, list_children, binary deserialization pass |
| Backend unit | `cargo test` in `backend/` | Config parsing, query handling (mock or integration) pass |
| E2E | `docker compose up` → Grafana | Configure datasource → select shot → expand subsystem → check measurements → time-series renders |
| Performance | Test VaccumDiagnostics_1 (1M pts) | Full dataset fetch completes in reasonable time (~8MB binary transfer) |
| Multi-shot | Add Query B with different shot | Overlaid traces with distinct legend labels |
| Cross-subsystem | Check measurements from MachineN1_1 + RFDiagnostics_1 | Two frames with different sample counts, aligned at T=0 |

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Binary reads (not JSON)** | Simpler deserialization (`bytemuck::cast_slice`), 3-4× less bandwidth, better performance for 1M-sample datasets |
| **No downsampling in v1** | Simplifies backend. Most datasets ≤120K samples. 1M-sample datasets = ~8MB binary, acceptable. Hyperslab stride downsampling deferred to v2 |
| **One query = one shot** | Leverages Grafana's native multi-query for shot comparison. Each query row has its own shot selector + tree |
| **Tree with checkboxes** | h5web-style lazy tree in QueryEditor. Subsystems expandable, measurements checkable. Cross-subsystem selection supported |
| **One frame per subsystem** | Different subsystems have different sampling rates. Grafana overlays frames correctly. T=0 synchronized across all |
| **x_data/y_data convention** | Backend reads `x_data` + `y_data` from each measurement group. No need to search for Timestamp by name. Hardlink deduplication for efficiency |
| **Only OutputDeck exposed** | InputDeck is configuration, not plottable. Skip in tree. Could add as metadata panel later |
| **BasicAuth** | User confirmed HSDS uses basic auth (username/password) |
| **Remote HSDS** | No HSDS in docker-compose. Remote server already available |

---

## Future (v2+)

- **Hyperslab downsampling**: configurable max-points with server-side stride for large datasets
- **2D/3D/Image visualization**: heatmap panels for 2D data, image panels for camera data
- **InputDeck metadata panel**: show experiment configuration as a table
- **Domain search/filter**: search shots by date, name pattern, or attributes
- **Attribute-based labels**: use `long_name` and `Unit` for richer axis labels and tooltips
- **Caching**: cache tree structure and metadata in backend to reduce HSDS round-trips
- **Variable-length string datasets**: JSON fallback for string-typed attributes/datasets
