import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.expenseflow.app',
  appName: 'ExpenseFlow',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
