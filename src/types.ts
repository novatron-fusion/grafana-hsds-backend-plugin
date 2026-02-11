import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

// ── Query model (matches backend HsdsQuery) ──────────────────────────

export interface MeasurementSelection {
  /** Display name for the measurement */
  name: string;
  /** Absolute HDF5 path to the X (time) dataset */
  xPath: string;
  /** Absolute HDF5 path to the Y (value) dataset */
  yPath: string;
}

export interface HsdsQuery extends DataQuery {
  /** HDF5 domain path, e.g. "/NovaDB/Shots/S-N1-02139.h5" */
  domain: string;
  /** Selected measurements to query */
  measurements: MeasurementSelection[];
}

export const defaultQuery: Partial<HsdsQuery> = {
  domain: '',
  measurements: [],
};

// ── Datasource configuration ──────────────────────────────────────────

/** Stored in Grafana jsonData (visible to frontend) */
export interface HsdsDataSourceOptions extends DataSourceJsonData {
  /** Base URL of the HSDS server, e.g. "http://hsds:5101" */
  hsdsUrl?: string;
  /** Default HDF5 domain to browse */
  domain?: string;
}

/** Stored in Grafana secureJsonData (only sent to backend) */
export interface HsdsSecureJsonData {
  username?: string;
  password?: string;
}

// ── Resource API response types ───────────────────────────────────────

export interface TreeNode {
  name: string;
  path: string;
  nodeType: 'group' | 'dataset';
  id: string;
  hasChildren: boolean;
}

export interface DatasetMetadata {
  name: string;
  path: string;
  id: string;
  dtype: string;
  shape: number[];
}
