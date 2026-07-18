import 'dotenv/config';
import { runManagerCheck } from '../agents/managerAgent.js';

async function main() {
  const result = await runManagerCheck();
  console.log(`Manager Agent: ${result.decision}`);
  if (result.problems) {
    for (const p of result.problems) console.log(`  - [${p.type}] ${p.agent}: ${p.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
