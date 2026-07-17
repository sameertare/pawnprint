// Hub landing page entry — only needs the shared stylesheet (base-path-aware via the bundler).
import './style.css';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { initAnalytics } from './analytics';

registerServiceWorker();
initTheme();
void initAnalytics('analytics');
