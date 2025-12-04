import { test, expect } from '@grafana/plugin-e2e';

test.describe('Sample Backend Plugin', () => {
  test('should display config editor and allow configuration', async ({
    createDataSourceConfigPage,
    readProvisionedDataSource,
    page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    const configPage = await createDataSourceConfigPage({ type: ds.type });
    await expect(configPage.saveAndTest()).toBeOK();
  });

  test('should load query editor in explore', async ({
    explorePage,
    readProvisionedDataSource,
    page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await explorePage.datasource.set(ds.name);
    await expect(explorePage.getByGrafanaSelector('data-testid QueryEditor')).toBeVisible();
  });

  test('should execute query successfully', async ({
    explorePage,
    readProvisionedDataSource,
    page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await explorePage.datasource.set(ds.name);

    // Wait for query editor to be ready
    await page.waitForTimeout(1000);

    // Run query
    await explorePage.runQuery();

    // Check that we get some response (adjust based on your plugin's behavior)
    await expect(page.getByText(/Error/i)).not.toBeVisible();
  });

  test('should display data in panel', async ({
    panelEditPage,
    readProvisionedDataSource,
    page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await panelEditPage.datasource.set(ds.name);
    await panelEditPage.setVisualization('Table');

    // Wait for query to execute
    await page.waitForTimeout(2000);

    // Verify panel displays without errors
    await expect(panelEditPage.refreshPanel()).toBeOK();
  });
});
