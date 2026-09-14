import { ConfigurationError, StorageError } from '../errors';
import { positiveInteger, systemClock } from '../time';
import type { JsonValue, StateStore, Update } from '../types';

/** Map your TCP or HTTP Redis client's EVAL call to this portable contract. */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}
export interface RedisStoreOptions {
  prefix?: string;
  maxContentionRetries?: number;
}

const compareAndSwap = `
local current = redis.call('GET', KEYS[1])
if (ARGV[1] == 'missing' and current ~= false) or
   (ARGV[1] == 'present' and current ~= ARGV[2]) then
  return 0
end
if ARGV[3] == 'delete' then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[4])
end
return 1
`;

export class RedisStore implements StateStore {
  readonly kind = 'redis' as const;
  private readonly retries: number;
  private readonly prefix: string;
  constructor(
    private readonly client: RedisClient,
    options: RedisStoreOptions = {},
  ) {
    this.retries = positiveInteger(
      options.maxContentionRetries ?? 256,
      'maxContentionRetries',
    );
    this.prefix = options.prefix ?? 'resilience:';
  }
  async update<T extends JsonValue, R>(
    key: string,
    reducer: (state: T | undefined) => Update<T, R>,
  ): Promise<R> {
    const redisKey = this.prefix + key;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const encoded = await this.client.get(redisKey);
        const result = reducer(
          encoded === null ? undefined : (JSON.parse(encoded) as T),
        );
        const committed = await this.client.eval(
          compareAndSwap,
          [redisKey],
          [
            encoded === null ? 'missing' : 'present',
            encoded ?? '',
            result.state === undefined ? 'delete' : 'write',
            result.state === undefined ? '' : JSON.stringify(result.state),
          ],
        );
        if (committed === 1 || committed === '1') return result.value;
        if (committed !== 0 && committed !== '0')
          throw new StorageError(
            'Redis returned an invalid compare-and-swap result.',
          );
      } catch (error) {
        if (
          error instanceof ConfigurationError ||
          error instanceof StorageError
        )
          throw error;
        throw new StorageError(`Redis state update failed for key "${key}".`, {
          cause: error,
        });
      }
      // Yield under contention; do not hold a distributed lock while executing JS.
      await systemClock.sleep(Math.min(25, attempt + 1) * Math.random());
    }
    throw new StorageError(
      `Redis contention budget exhausted for key "${key}".`,
    );
  }
}
