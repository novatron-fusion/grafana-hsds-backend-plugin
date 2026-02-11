import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './ConfigEditor';
import { QueryEditor } from './QueryEditor';
import { HsdsQuery, HsdsDataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, HsdsQuery, HsdsDataSourceOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
