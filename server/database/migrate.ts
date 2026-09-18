import { openDatabase, persistNow } from './db.js';
import { seedDatabase } from './seed.js';

async function main() {
  await openDatabase();
  await seedDatabase();
  persistNow();
  console.log('Orbit database migrated + seeded.');
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('migrate.ts')) {
  void main();
}
export { main as migrate };
