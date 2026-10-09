import { parse } from 'csv-parse/sync';

export interface CsvRosterRow {
  studentId: string;
  name: string;
  row: number;
}

export interface CsvNameMismatch {
  row: number;
  studentId: string;
  existingName: string;
  importedName: string;
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
    const studentId = record.studentId?.trim().toUpperCase();
    const name = record.name?.trim();

    if (!studentId || !name) {
      errors.push({ row: rowNumber, reason: 'Missing studentId or name.' });
      return;
    }
    rows.push({ studentId, name, row: rowNumber });
  });

  return { rows, errors };
}

export function findNameMismatches(
  rows: CsvRosterRow[],
  existingStudents: Array<{ studentId: string; name: string }>,
): CsvNameMismatch[] {
  const existingByStudentId = new Map(existingStudents.map((student) => [student.studentId, student.name]));

  return rows.flatMap((row) => {
    const existingName = existingByStudentId.get(row.studentId);
    return existingName && existingName !== row.name
      ? [{ row: row.row, studentId: row.studentId, existingName, importedName: row.name }]
      : [];
  });
}