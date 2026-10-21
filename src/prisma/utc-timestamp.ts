/** Parse PostgreSQL TIMESTAMP values as UTC instants.
 *
 * Exam schedule/session timestamps are stored as UTC wall time in PostgreSQL
 * TIMESTAMP columns. The default node-postgres parser interprets these as the
 * host's local timezone, which can shift expiry comparisons by the host's UTC
 * offset.
 */
export function parsePostgresTimestampAsUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}
