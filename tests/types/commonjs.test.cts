import toolkit = require('@1a8jkf/universal-resilience-toolkit');
import retries = require('@1a8jkf/universal-resilience-toolkit/retry');
const result: Promise<number> = toolkit.withResilience(
  (value: number) => value + 1,
)(2);
const retried: Promise<string> = retries.retry(() => 'ok');
void result;
void retried;
// @ts-expect-error CJS types preserve argument checking.
toolkit.withResilience((value: number) => value)('wrong');
