import { parsePostgresTimestampAsUtc } from './utc-timestamp.js';

describe('parsePostgresTimestampAsUtc', () => {
  it('treats a PostgreSQL timestamp without timezone as UTC, independent of host timezone', () => {
    expect(parsePostgresTimestampAsUtc('2026-10-15 04:32:00.000').toISOString())
      .toBe('2026-10-15T04:32:00.000Z');
  });
});
