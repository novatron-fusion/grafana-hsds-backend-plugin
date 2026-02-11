import { DataSourceInstanceSettings } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import { HsdsDataSourceOptions, HsdsQuery, TreeNode, DatasetMetadata } from './types';

export class DataSource extends DataSourceWithBackend<HsdsQuery, HsdsDataSourceOptions> {
  /** Base URL of the HSDS server (from config jsonData) */
  hsdsUrl?: string;
  /** Default domain from config */
  defaultDomain?: string;

  constructor(instanceSettings: DataSourceInstanceSettings<HsdsDataSourceOptions>) {
    super(instanceSettings);
    this.hsdsUrl = instanceSettings.jsonData.hsdsUrl;
    this.defaultDomain = instanceSettings.jsonData.domain;
  }

  /** Fetch root-level children of a domain's HDF5 tree */
  async getTreeRoot(domain: string): Promise<TreeNode[]> {
    return this.getResource<TreeNode[]>('tree-root', { domain });
  }

  /** Expand a group node and return its children */
  async expandTree(domain: string, path: string): Promise<TreeNode[]> {
    return this.getResource<TreeNode[]>('tree-expand', { domain, path });
  }

  /** Get metadata for a dataset (dtype, shape) */
  async getDatasetMeta(domain: string, path: string): Promise<DatasetMetadata> {
    return this.getResource<DatasetMetadata>('dataset-meta', { domain, path });
  }
}
