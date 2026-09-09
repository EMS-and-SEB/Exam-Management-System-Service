import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

export interface CsvMemberRow {
  studentId: string;
  name: string;
  row: number;
}

@Injectable()
export class CsvImportService {
  parseMembers(buffer: Buffer): CsvMemberRow[] {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(
        'CSV file is empty',
      );
    }

    const content = buffer
      .toString('utf-8')
      .replace(/^\uFEFF/, '');

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV must contain a header and at least one data row',
      );
    }

    const headers = this
      .parseLine(lines[0])
      .map((value) => value.trim().toLowerCase());

    const studentIdIndex = headers.indexOf(
      'studentid',
    );

    const nameIndex = headers.indexOf(
      'name',
    );

    if (
      studentIdIndex === -1 ||
      nameIndex === -1
    ) {
      throw new BadRequestException(
        'CSV must contain studentId and name columns',
      );
    }

    const rows: CsvMemberRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseLine(lines[i]);

      const studentId =
        values[studentIdIndex]?.trim();

      const name =
        values[nameIndex]?.trim();

      if (!studentId) {
        continue;
      }

      if (!name) {
        throw new BadRequestException(
          `Row ${i + 1}: name is required`,
        );
      }

      rows.push({
        studentId,
        name,
        row: i + 1,
      });
    }

    return rows;
  }

  async parseStudents(
    buffer: Buffer,
  ): Promise<CsvMemberRow[]> {
    return this.parseMembers(buffer);
  }

  private parseLine(
    line: string,
  ): string[] {
    const values: string[] = [];

    let current = '';
    let insideQuotes = false;

    for (
      let i = 0;
      i < line.length;
      i++
    ) {
      const char = line[i];

      if (char === '"') {
        if (
          insideQuotes &&
          line[i + 1] === '"'
        ) {
          current += '"';
          i++;
        } else {
          insideQuotes =
            !insideQuotes;
        }

        continue;
      }

      if (
        char === ',' &&
        !insideQuotes
      ) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);

    return values;
  }
}
