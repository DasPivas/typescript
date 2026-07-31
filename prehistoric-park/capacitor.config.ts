import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Обёртка в нативное приложение. Нативные проекты в репозитории не хранятся —
 * они генерируются локально: `npm run cap:add:ios` / `npm run cap:add:android`,
 * дальше `npm run cap:sync` перед каждой сборкой. Для iOS нужны macOS и Xcode.
 */
const config: CapacitorConfig = {
  appId: 'ru.prehistoricpark.game',
  appName: 'Первобытный парк',
  webDir: 'dist',
  android: {
    backgroundColor: '#1d2a12',
  },
  ios: {
    backgroundColor: '#1d2a12',
    contentInset: 'never',
  },
};

export default config;
