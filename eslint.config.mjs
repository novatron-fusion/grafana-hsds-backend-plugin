import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  {
    ignores: [
      '.yarn/**',
      '.config/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'backend/**',
      'grafana/**',
    ],
  },
  ...baseConfig,
]);
