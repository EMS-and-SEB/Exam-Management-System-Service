import { parse } from 'csv-parse/sync';

export interface CsvRosterRow {
  studentId: string;
  name: string;
}

export interface CsvParseResult {
  rows: CsvRosterRow[];
  errors: { row: number; reason: string }[];
}

export function parseRosterCsv(buffer: Buffer): CsvParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return { rows: [], errors: [{ row: 0, reason: 'Malformed CSV file.' }] };
  }

  const rows: CsvRosterRow[] = [];
  const errors: CsvParseResult['errors'] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2; // header row + 1-based index
    const studentId = record.studentId?.trim();
    const name = record.name?.trim();

    if (!studentId || !name) {
      errors.push({ row: rowNumber, reason: 'Missing studentId or name.' });
      return;
    }
    rows.push({ studentId, name });
  });

  return { rows, errors };
}