import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20261014090000_unify_multiple_choice/migration.sql',
);

describe('multiple-choice migration preflight', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('preflights both source tables before any schema mutation', () => {
    const preflight = sql.indexOf('DO $$');
    const firstMutation = sql.indexOf('ALTER TABLE');
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(firstMutation).toBeGreaterThan(preflight);
    expect(sql).toContain('FROM "Question"');
    expect(sql).toContain('FROM "ExamQuestion"');
  });

  it('normalizes scalar answers and derives counts for both legacy question types and tables', () => {
    expect(sql.match(/"type"::text IN \('MULTIPLE_CHOICE', 'MULTIPLE_SELECT'\)/g)).toHaveLength(4);
    expect(sql.match(/jsonb_build_array\("correctAnswer"::jsonb\)/g)).toHaveLength(4);
    expect(sql.match(/jsonb_array_length\("correctAnswer"::jsonb\)/g)).toHaveLength(4);
  });

  it('rejects null, empty, duplicate, non-string, and non-scalar/non-array answer values', () => {
    expect(sql.match(/"correctAnswer" IS NULL/g)).toHaveLength(2);
    expect(sql.match(/jsonb_array_length\("correctAnswer"::jsonb\) = 0/g)).toHaveLength(2);
    expect(sql.match(/jsonb_typeof\(item.value\) <> 'string'/g)).toHaveLength(2);
    expect(sql.match(/count\(DISTINCT item.value\)/g)).toHaveLength(2);
    expect(sql.match(/ELSE true/g)).toHaveLength(4);
  });

  it('rejects correct-answer identifiers that are absent from the stored options', () => {
    expect(sql.match(/jsonb_array_elements\("options"::jsonb\)/g)).toHaveLength(2);
    expect(sql.match(/option_value\.value -> 'id' = selected\.value/g)).toHaveLength(2);
  });

  it('uses one explicit transaction for validation and destructive enum conversion', () => {
    expect(sql).toMatch(/\bBEGIN;/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.indexOf('DROP TYPE "QuestionType_old"')).toBeLessThan(sql.indexOf('COMMIT;'));
  });
});
