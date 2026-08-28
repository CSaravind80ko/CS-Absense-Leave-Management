import ExcelJS from 'exceljs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '../src/config';
import { parseCsv, parseXlsx } from '../src/parser';

const config: WorkerConfig = {
  queueUrl: 'queue',
  importBucket: 'imports',
  exportBucket: 'exports',
  concurrency: 1,
  visibilitySeconds: 60,
  maxRows: 2,
  maxColumns: 6,
  maxCellBytes: 64,
  maxArchiveBytes: 10 * 1024 * 1024,
  maxArchiveRatio: 100,
};

describe('attendance import parser', () => {
  const files: string[] = [];
  afterEach(async () => {
    await Promise.all(files.splice(0).map((path) => fs.rm(path, { force: true })));
  });

  it('streams a valid UTF-8 CSV into canonical allowlisted fields', async () => {
    const path = join(tmpdir(), `attendance-${crypto.randomUUID()}.csv`);
    files.push(path);
    await fs.writeFile(
      path,
      'employeeNumber,occurredAt,punchType\nEMP-1,2026-08-01 09:00,IN\n',
    );
    const rows: unknown[] = [];
    await expect(parseCsv(path, config, (row) => {
      rows.push(row);
    })).resolves.toBe(1);
    expect(rows).toEqual([
      {
        rowNumber: 2,
        values: {
          employeeNumber: 'EMP-1',
          occurredAt: '2026-08-01 09:00',
          punchType: 'IN',
        },
        formulaFields: [],
      },
    ]);
  });

  it('enforces the configured row limit', async () => {
    const path = join(tmpdir(), `attendance-${crypto.randomUUID()}.csv`);
    files.push(path);
    await fs.writeFile(
      path,
      'employeeNumber,occurredAt,punchType\nA,2026-08-01 09:00,IN\nB,2026-08-01 09:00,IN\nC,2026-08-01 09:00,IN\n',
    );
    await expect(parseCsv(path, config, () => undefined)).rejects.toMatchObject({
      code: 'TOO_MANY_ROWS',
    });
  });

  it('detects formulas without evaluating them', async () => {
    const path = join(tmpdir(), `attendance-${crypto.randomUUID()}.xlsx`);
    files.push(path);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');
    sheet.addRow(['employeeNumber', 'occurredAt', 'punchType']);
    sheet.addRow([{ formula: '"EMP-1"', result: 'EMP-1' }, '2026-08-01 09:00', 'IN']);
    await workbook.xlsx.writeFile(path);
    const rows: Array<{ formulaFields: string[] }> = [];
    await parseXlsx(path, config, (row) => {
      rows.push(row);
    });
    expect(rows[0].formulaFields).toEqual(['employeeNumber']);
    expect(rows[0]).not.toHaveProperty('values.employeeNumber', 'EMP-1');
  });
});
