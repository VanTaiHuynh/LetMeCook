import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: {
  environment: 'jsdom', setupFiles: ['./tests/components/setup.js'],
  include: ['tests/components/**/*.test.jsx'], clearMocks: true, restoreMocks: true,
  maxWorkers: 4, minWorkers: 1,
} });
