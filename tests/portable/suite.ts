import './retry.test';
import './rate-limit.test';
import './circuit-breaker.test';
import './compose.test';
import './persistence.test';
import './telemetry.test';
import { cases } from './harness';

export async function runSuite() {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  for (const item of cases) {
    try {
      await item.run();
      results.push({ name: item.name, passed: true });
    } catch (error) {
      results.push({
        name: item.name,
        passed: false,
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      });
    }
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    results,
  };
}
