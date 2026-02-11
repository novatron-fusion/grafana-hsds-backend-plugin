import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { Button, InlineField, InlineFieldRow, Input, IconButton, useStyles2, Alert } from '@grafana/ui';
import { GrafanaTheme2, QueryEditorProps } from '@grafana/data';
import { DataSource } from './datasource';
import { HsdsDataSourceOptions, HsdsQuery, MeasurementSelection, TreeNode } from './types';

type Props = QueryEditorProps<DataSource, HsdsQuery, HsdsDataSourceOptions>;

// ── Main QueryEditor ──────────────────────────────────────────────────

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
  const styles = useStyles2(getStyles);
  const domain = query.domain || datasource.defaultDomain || '';
  const measurements = query.measurements || [];

  const onDomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, domain: e.target.value });
  };

  const addMeasurement = (m: MeasurementSelection) => {
    // Don't add duplicates
    if (measurements.some((x) => x.yPath === m.yPath)) {
      return;
    }
    const updated = [...measurements, m];
    onChange({ ...query, measurements: updated });
    onRunQuery();
  };

  const removeMeasurement = (index: number) => {
    const updated = measurements.filter((_, i) => i !== index);
    onChange({ ...query, measurements: updated });
    onRunQuery();
  };

  return (
    <div className={styles.wrapper}>
      {/* Domain selector */}
      <InlineFieldRow>
        <InlineField label="Domain" labelWidth={16} tooltip="HDF5 domain path on HSDS" grow>
          <Input value={domain} onChange={onDomainChange} placeholder="/NovaDB/Shots/S-N1-02139.h5" />
        </InlineField>
      </InlineFieldRow>

      {/* Two-column layout: tree + selection */}
      <div className={styles.columns}>
        {/* Tree browser */}
        <div className={styles.treePanel}>
          <div className={styles.panelHeader}>Browse HDF5 Tree</div>
          {domain ? (
            <TreeBrowser datasource={datasource} domain={domain} onSelect={addMeasurement} />
          ) : (
            <div className={styles.placeholder}>Enter a domain to browse</div>
          )}
        </div>

        {/* Selected measurements */}
        <div className={styles.selectionPanel}>
          <div className={styles.panelHeader}>Selected Measurements ({measurements.length})</div>
          {measurements.length === 0 ? (
            <div className={styles.placeholder}>
              Browse the tree and click a measurement group to add it
            </div>
          ) : (
            <div className={styles.measurementList}>
              {measurements.map((m, i) => (
                <div key={m.yPath} className={styles.measurementItem}>
                  <span className={styles.measurementName}>{m.name}</span>
                  <span className={styles.measurementPath}>{m.yPath}</span>
                  <IconButton name="trash-alt" tooltip="Remove" onClick={() => removeMeasurement(i)} size="sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tree Browser ──────────────────────────────────────────────────────

interface TreeBrowserProps {
  datasource: DataSource;
  domain: string;
  onSelect: (m: MeasurementSelection) => void;
}

function TreeBrowser({ datasource, domain, onSelect }: TreeBrowserProps) {
  const styles = useStyles2(getStyles);
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    datasource
      .getTreeRoot(domain)
      .then((nodes) => {
        if (!cancelled) {
          setRootNodes(nodes);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load tree');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource, domain]);

  if (loading) {
    return <div className={styles.placeholder}>Loading...</div>;
  }
  if (error) {
    return <Alert severity="error" title="Tree load failed">{error}</Alert>;
  }
  if (rootNodes.length === 0) {
    return <div className={styles.placeholder}>No items found</div>;
  }

  return (
    <div className={styles.treeContainer}>
      {rootNodes.map((node) => (
        <TreeNodeRow key={node.path} node={node} datasource={datasource} domain={domain} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}

// ── Single tree node row (recursive) ─────────────────────────────────

interface TreeNodeRowProps {
  node: TreeNode;
  datasource: DataSource;
  domain: string;
  onSelect: (m: MeasurementSelection) => void;
  depth: number;
}

function TreeNodeRow({ node, datasource, domain, onSelect, depth }: TreeNodeRowProps) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!node.hasChildren) {
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    // Load children on first expand
    if (children === null) {
      setLoading(true);
      try {
        const nodes = await datasource.expandTree(domain, node.path);
        setChildren(nodes);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }, [node, expanded, children, datasource, domain]);

  /** Check if this group looks like a measurement (has x_data + y_data children) */
  const isMeasurementGroup =
    node.hasChildren &&
    children !== null &&
    children.some((c) => c.name === 'x_data') &&
    children.some((c) => c.name === 'y_data');

  const handleAddMeasurement = () => {
    if (!children) {
      return;
    }
    const xNode = children.find((c) => c.name === 'x_data');
    const yNode = children.find((c) => c.name === 'y_data');
    if (xNode && yNode) {
      onSelect({
        name: node.name,
        xPath: xNode.path,
        yPath: yNode.path,
      });
    }
  };

  const icon = node.nodeType === 'dataset' ? '📊' : expanded ? '📂' : '📁';

  return (
    <div>
      <div
        className={styles.treeRow}
        style={{ paddingLeft: depth * 20 + 4 }}
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && toggle()}
      >
        <span className={styles.treeIcon}>{icon}</span>
        <span className={styles.treeName}>{node.name}</span>
        {loading && <span className={styles.treeLoading}>…</span>}
        {isMeasurementGroup && (
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            tooltip="Add this measurement"
            onClick={(e) => {
              e.stopPropagation();
              handleAddMeasurement();
            }}
          >
            Add
          </Button>
        )}
      </div>
      {expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              datasource={datasource}
              domain={domain}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  columns: css({
    display: 'flex',
    gap: theme.spacing(2),
    minHeight: 300,
  }),
  treePanel: css({
    flex: 1,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'auto',
    maxHeight: 400,
  }),
  selectionPanel: css({
    flex: 1,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'auto',
    maxHeight: 400,
  }),
  panelHeader: css({
    padding: theme.spacing(1),
    fontWeight: theme.typography.fontWeightMedium,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  placeholder: css({
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  treeContainer: css({
    padding: theme.spacing(0.5),
  }),
  treeRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  treeIcon: css({
    fontSize: 14,
    flexShrink: 0,
  }),
  treeName: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  treeLoading: css({
    color: theme.colors.text.secondary,
  }),
  measurementList: css({
    padding: theme.spacing(0.5),
  }),
  measurementItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  measurementName: css({
    fontWeight: theme.typography.fontWeightMedium,
    minWidth: 120,
  }),
  measurementPath: css({
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
});
