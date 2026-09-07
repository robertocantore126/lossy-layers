import './ui/styles.css';
import { App } from './ui/app';

const mount = document.getElementById('root');
if (!mount) throw new Error('#root missing from the page');

const app = new App(mount);

// Handy from the devtools console, and the seam a test harness would use.
(window as unknown as { lossy: unknown }).lossy = app.debug();
