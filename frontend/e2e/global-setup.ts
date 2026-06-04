import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Seed the test DB (base data + one paid order) before the suite runs.
export default async function globalSetup() {
  const backendDir = path.resolve(__dirname, '../../backend');
  execSync('node utils/seedE2E.js', {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ||
        'postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public',
    },
  });
}
