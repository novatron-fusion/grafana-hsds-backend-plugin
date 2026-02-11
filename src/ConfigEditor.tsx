import React, { ChangeEvent } from 'react';
import { InlineField, Input, SecretInput, FieldSet } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { HsdsDataSourceOptions, HsdsSecureJsonData } from './types';

interface Props extends DataSourcePluginOptionsEditorProps<HsdsDataSourceOptions, HsdsSecureJsonData> {}

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const onJsonDataChange = (key: keyof HsdsDataSourceOptions) => (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...jsonData, [key]: event.target.value },
    });
  };

  const onSecureChange = (key: keyof HsdsSecureJsonData) => (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: { ...secureJsonData, [key]: event.target.value },
    });
  };

  const onSecureReset = (key: keyof HsdsSecureJsonData) => () => {
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, [key]: false },
      secureJsonData: { ...secureJsonData, [key]: '' },
    });
  };

  return (
    <>
      <FieldSet label="Connection">
        <InlineField label="HSDS URL" labelWidth={20} tooltip="Base URL of the HSDS server">
          <Input
            width={40}
            value={jsonData.hsdsUrl || ''}
            onChange={onJsonDataChange('hsdsUrl')}
            placeholder="http://hsds-server:5101"
          />
        </InlineField>

        <InlineField label="Default Domain" labelWidth={20} tooltip="Default HDF5 domain path to browse">
          <Input
            width={40}
            value={jsonData.domain || ''}
            onChange={onJsonDataChange('domain')}
            placeholder="/NovaDB/Shots/S-N1-02139.h5"
          />
        </InlineField>
      </FieldSet>

      <FieldSet label="Authentication">
        <InlineField label="Username" labelWidth={20}>
          <SecretInput
            width={40}
            isConfigured={!!secureJsonFields?.username}
            value={secureJsonData?.username || ''}
            onChange={onSecureChange('username')}
            onReset={onSecureReset('username')}
            placeholder="HSDS username"
          />
        </InlineField>

        <InlineField label="Password" labelWidth={20}>
          <SecretInput
            width={40}
            isConfigured={!!secureJsonFields?.password}
            value={secureJsonData?.password || ''}
            onChange={onSecureChange('password')}
            onReset={onSecureReset('password')}
            placeholder="HSDS password"
          />
        </InlineField>
      </FieldSet>
    </>
  );
}
