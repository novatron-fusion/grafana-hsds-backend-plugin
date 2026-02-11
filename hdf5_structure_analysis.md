# HDF5 File Structure Description

**File**: `S-N1-02139.h5`
**File Size**: 339.26 MB
**Analysis Date**: 2026-02-10

---

## Overview

This HDF5 file contains experimental data from a plasma physics or fusion experiment. The file is organized into two main sections: **InputDeck** (experiment configuration) and **OutputDeck** (measurement data from various diagnostics and subsystems).

---

## Root Level Structure

The file has a simple two-part structure at the root level:

```
/
├── InputDeck/          # Experiment configuration and recipe
└── OutputDeck/         # All measurement data and diagnostics
```

---

## InputDeck Structure

**Path**: `/InputDeck/`

The InputDeck group contains configuration and recipe information for the experiment.

**Attributes**: *(No attributes at this level)*

**Contents**:
- `Recipe/`: Group containing experimental parameters and configuration

**Purpose**: Stores input parameters, setpoints, and configuration used to run the experiment.

---

## OutputDeck Structure

**Path**: `/OutputDeck/`

The OutputDeck group is the main data container, holding all diagnostic and subsystem measurement data.

**Attributes**:
- `APP_VERSION`: Application version that generated the file
- `GIT_VERSION`: Git commit hash of the software version
- `START_TIME`: Experiment start time/date

**Contains 19 diagnostic/subsystem groups**:
- `Camera_2/`
- `Camera_3/`
- `Camera_4/`
- `Interferometer_1/`
- `MachineN1_1/`
- `MagnetDiagnostics_1/`
- `N1-ECRH_1/`
- `PhotoDiode_1/`
- `RFDiagnostics_1/`
- `RFDiagnostics_2/`
- `RFDiagnostics_3/`
- `RFDiagnostics_4/`
- `RFDiagnostics_5/`
- `RFDiagnostics_6/`
- `RFPowerMeasurement_1/`
- `Spectrometer_1/`
- `Trigger/`
- `VaccumDiagnostics_1/`
- `XRay-Diagnostic_1/`

---

## Subsystems/Diagnostics Group Pattern

Each subsystem or diagnostic under `/OutputDeck/` follows a similar organizational pattern. All contain time-series measurement data with associated timestamps.

### Example: `MachineN1_1`

**Full Path**: `/OutputDeck/MachineN1_1/`

This subsystem represents machine-level diagnostics and contains measurements from various sensors.

**Attributes**:
- `T0_Timestamp`: Reference time for the experiment
- `Trigger Channel`: Trigger channel identifier
- `Trigger_T0`: Trigger timestamp

**Contents**:
- `CH_Gauge`: Dataset (270,) float64
- `FastVaccumGauge1_Pressue`: Dataset (270,) float64
- `FastVaccumGauge2_Pressue`: Dataset (270,) float64
- `FastVaccumGauge3_Pressue`: Dataset (270,) float64
- `LangmuirProbe1_Position`: Dataset (270,) float64
- `M1_Current`: Dataset (270,) float64
- `M1_Voltage`: Dataset (270,) float64
- `M2_Current`: Dataset (270,) float64
- `M2_Voltage`: Dataset (270,) float64
- `M3_Current`: Dataset (270,) float64
- `M3_Voltage`: Dataset (270,) float64
- `M3b_Current`: Dataset (270,) float64
- `M3b_Voltage`: Dataset (270,) float64
- `M4_Current`: Dataset (270,) float64
- `M4_Voltage`: Dataset (270,) float64
- `Timestamp`: Dataset (270,) float64
  - Attributes: `Unit`, `long_name`

**Pattern**: Multiple measurement channels (gauges, probes, magnets) with synchronized `Timestamp` array.

### Other Subsystems Follow Similar Patterns

Each diagnostic/subsystem group contains:
1. **Multiple measurement datasets** (sensor readings, signals, images, etc.)
2. **A `Timestamp` dataset** providing time axis for the measurements
3. **Attributes** with metadata (trigger info, reference times, units, descriptions)
4. **Consistent array shapes** within each subsystem (all measurements synchronized)

---

## Measurement Groups

This file does not have explicit "Measurement" subgroups. Instead, each subsystem under `/OutputDeck/` acts as a measurement collection, with individual datasets representing different measured quantities.

**Example Measurement Pattern**:
- Path: `/OutputDeck/[Subsystem_Name]/[Measurement_Name]`
- Each dataset has attributes like `Unit` and `long_name` describing the measurement

---

## Timestamp Datasets

Every subsystem contains a `Timestamp` dataset that provides the time axis for all measurements in that subsystem.

**Timestamp Datasets Found**:
- `/OutputDeck/Camera_2/Timestamp` - (50,) float64
- `/OutputDeck/Camera_3/Timestamp` - (50,) float64
- `/OutputDeck/Camera_4/Timestamp` - (50,) float64
- `/OutputDeck/Interferometer_1/Timestamp` - (120,000,) float64
- `/OutputDeck/MachineN1_1/Timestamp` - (270,) float64
- `/OutputDeck/MagnetDiagnostics_1/Timestamp` - (13,000,) float64
- `/OutputDeck/PhotoDiode_1/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_1/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_2/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_3/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_4/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_5/Timestamp` - (120,000,) float64
- `/OutputDeck/RFDiagnostics_6/Timestamp` - (120,000,) float64
- `/OutputDeck/RFPowerMeasurement_1/Timestamp` - (5,000,) float64
- `/OutputDeck/Spectrometer_1/Timestamp` - (100,) float64
- `/OutputDeck/VaccumDiagnostics_1/Timestamp` - (1,000,000,) float64
- `/OutputDeck/XRay-Diagnostic_1/Timestamp` - (1,000,000,) float64

**Key Observations**:
- Different subsystems have different sampling rates (shown by array sizes)
- RF diagnostics share the same sampling rate (120,000 samples)
- High-speed diagnostics (Vaccum, XRay) sample at 1M points
- Cameras have low sample counts (50-100 frames)

---

## Links and References

### x_data Pattern

**No explicit `x_data` datasets were found** in this file. Instead, the file uses **`Timestamp` datasets** as the x-axis (independent variable) for all measurements.

**Typical Usage Pattern**:
- To plot any measurement: use `/OutputDeck/[Subsystem]/Timestamp` as x-axis
- The corresponding measurement dataset (e.g., `M1_Current`) as y-axis
- Both arrays have matching shapes within each subsystem

### Hard Links

**No hard links detected** in this file structure. Each `Timestamp` dataset is independent and specific to its subsystem's sampling rate.

**Note**: While different RF diagnostics have the same array size (120,000), they are separate datasets, not hardlinked. This allows for potential timing differences between diagnostics if needed.

---

## Attributes Distribution Summary

- **Groups with attributes**: 94%
- **Datasets with attributes**: 62%

**Typical Attribute Locations**:

1. **OutputDeck Group Attributes**:
   - File-level metadata: `APP_VERSION`, `GIT_VERSION`, `START_TIME`
   - Provides context about when/how the file was created

2. **Subsystem Group Attributes**:
   - Timing references: `T0_Timestamp`, `Trigger_T0`
   - Configuration: `Trigger Channel`
   - Diagnostic-specific parameters and settings

3. **Dataset Attributes**:
   - **`Unit`**: Physical units of the measurement (e.g., "V", "A", "Pa", "s")
   - **`long_name`**: Descriptive name of the measurement
   - Additional metadata specific to the measurement type

---

## Data Access Patterns

### To Read a Time Series:

```python
import h5py

with h5py.File('S-N1-02139.h5', 'r') as f:
    # Access a specific measurement
    subsystem = f['OutputDeck/MachineN1_1']
    
    # Get time axis
    time = subsystem['Timestamp'][:]
    
    # Get measurement data
    current = subsystem['M1_Current'][:]
    
    # Get metadata
    unit = subsystem['M1_Current'].attrs['Unit']
    name = subsystem['M1_Current'].attrs['long_name']
```

### To List All Available Measurements:

```python
import h5py

with h5py.File('S-N1-02139.h5', 'r') as f:
    for subsystem_name in f['OutputDeck'].keys():
        print(f"\n{subsystem_name}:")
        subsystem = f[f'OutputDeck/{subsystem_name}']
        for dataset_name in subsystem.keys():
            if dataset_name != 'Timestamp':
                print(f"  - {dataset_name}")
```

---

## Summary

This HDF5 file follows a clear organizational structure:

1. **Two main sections**: InputDeck (configuration) and OutputDeck (data)
2. **Subsystem-based organization**: Each diagnostic is a separate group under OutputDeck
3. **Timestamps are local**: Each subsystem has its own Timestamp array matching its sampling rate
4. **Rich metadata**: Attributes provide units, descriptions, and experimental context
5. **No hard links**: Each dataset is independent
6. **Synchronized measurements**: Within each subsystem, all measurements share the same time axis

This structure makes it easy to:
- Access specific measurements by path
- Understand measurement context through attributes
- Plot time-series data using subsystem-specific timestamps
- Navigate diagnostics independently