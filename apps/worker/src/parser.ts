import { createReadStream, promises as fs } from 'node:fs';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import type { WorkerConfig } from './config';
import { PermanentJobError } from './errors';

export interface ParsedImportRow {
  rowNumber: number;
  values: Record<string, string>;
  formulaFields: string[];
}

export type ParsedRowConsumer = (row: ParsedImportRow) => Promise<void> | void;

const REQUIRED_HEADERS = ['employeeNumber', 'occurredAt', 'punchType'] as const;
const ALLOWED_HEADERS = new Set([
  ...REQUIRED_HEADERS,
  'externalId',
  'locationCode',
  'source',
]);

function validateHeaders(headers: string[], config: WorkerConfig): void {
  if (headers.length > config.maxColumns) {
    throw new PermanentJobError('TOO_MANY_COLUMNS', 'Import exceeds the column limit');
  }
  if (new Set(headers).size !== headers.length) {
    throw new PermanentJobError('DUPLICATE_HEADER', 'Import contains duplicate headers');
  }
  for (const header of headers) {
    if (!ALLOWED_HEADERS.has(header)) {
      throw new PermanentJobError('UNKNOWN_HEADER', `Unsupported header: ${header}`);
    }
  }
  for (const header of REQUIRED_HEADERS) {
    if (!headers.includes(header)) {
      throw new PermanentJobError('MISSING_HEADER', `Missing required header: ${header}`);
    }
  }
}

function cellText(value: unknown): { text: string; formula: boolean } {
  if (value === null || value === undefined) return { text: '', formula: false };
  if (value instanceof Date) return { text: value.toISOString(), formula: false };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      return { text: '', formula: true };
    }
    if ('text' in value && typeof value.text === 'string') {
      return { text: value.text, formula: false };
    }
    if ('result' in value) return { text: String(value.result ?? ''), formula: false };
  }
  return { text: String(value), formula: false };
}

function validateCell(text: string, config: WorkerConfig): void {
  if (Buffer.byteLength(text, 'utf8') > config.maxCellBytes) {
    throw new PermanentJobError('CELL_TOO_LARGE', 'Import cell exceeds the size limit');
  }
  if (text.includes('\uFFFD') || text.includes('\0')) {
    throw new PermanentJobError('INVALID_ENCODING', 'Import must use valid UTF-8 text');
  }
}

export async function parseCsv(
  path: string,
  config: WorkerConfig,
  consume: ParsedRowConsumer,
): Promise<number> {
  const prefix = await fs.readFile(path).then((value) => value.subarray(0, 4));
  if (
    (prefix[0] === 0xff && prefix[1] === 0xfe) ||
    (prefix[0] === 0xfe && prefix[1] === 0xff)
  ) {
    throw new PermanentJobError('INVALID_ENCODING', 'CSV must be UTF-8 encoded');
  }
  const parser = createReadStream(path).pipe(
    parse({
      bom: true,
      columns: false,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
      max_record_size: config.maxColumns * config.maxCellBytes,
    }),
  );
  let headers: string[] | undefined;
  let rowNumber = 0;
  for await (const record of parser) {
    const cells = (record as unknown[]).map((value) => String(value));
    if (!headers) {
      headers = cells;
      validateHeaders(headers, config);
      continue;
    }
    rowNumber += 1;
    if (rowNumber > config.maxRows) {
      throw new PermanentJobError('TOO_MANY_ROWS', 'Import exceeds the row limit');
    }
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      const text = cells[index] ?? '';
      validateCell(text, config);
      values[header] = text;
    });
    await consume({ rowNumber: rowNumber + 1, values, formulaFields: [] });
  }
  if (!headers) throw new PermanentJobError('EMPTY_FILE', 'Import file is empty');
  return rowNumber;
}

async function inspectArchive(path: string, config: WorkerConfig): Promise<void> {
  const compressedBytes = (await fs.stat(path)).size;
  await new Promise<void>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(
        new PermanentJobError('INVALID_XLSX', 'XLSX archive cannot be opened'),
      );
      let total = 0;
      let entries = 0;
      const fail = (error: Error) => {
        zipFile.close();
        reject(error);
      };
      zipFile.on('entry', (entry) => {
        entries += 1;
        total += entry.uncompressedSize;
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          return fail(new PermanentJobError('ENCRYPTED_XLSX', 'Encrypted XLSX files are not supported'));
        }
        if (
          entries > 2048 ||
          total > config.maxArchiveBytes ||
          total > compressedBytes * config.maxArchiveRatio
        ) {
          return fail(
            new PermanentJobError(
              'XLSX_ARCHIVE_LIMIT',
              'XLSX archive exceeds decompression safety limits',
            ),
          );
        }
        zipFile.readEntry();
      });
      zipFile.on('end', resolve);
      zipFile.on('error', () =>
        fail(new PermanentJobError('INVALID_XLSX', 'XLSX archive is malformed')),
      );
      zipFile.readEntry();
    });
  });
}

export async function parseXlsx(
  path: string,
  config: WorkerConfig,
  consume: ParsedRowConsumer,
): Promise<number> {
  await inspectArchive(path, config);
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });
  let worksheetCount = 0;
  let rowCount = 0;
  for await (const worksheet of workbook) {
    worksheetCount += 1;
    if (worksheetCount > 1) {
      throw new PermanentJobError('TOO_MANY_SHEETS', 'Import workbook must contain one sheet');
    }
    let headers: string[] | undefined;
    for await (const row of worksheet) {
      const cells = Array.from({ length: row.cellCount }, (_, index) =>
        cellText(row.getCell(index + 1).value),
      );
      if (!headers) {
        headers = cells.map((cell) => cell.text.trim());
        if (cells.some((cell) => cell.formula)) {
          throw new PermanentJobError('FORMULA_NOT_ALLOWED', 'Formula headers are not allowed');
        }
        validateHeaders(headers, config);
        continue;
      }
      rowCount += 1;
      if (rowCount > config.maxRows) {
        throw new PermanentJobError('TOO_MANY_ROWS', 'Import exceeds the row limit');
      }
      const values: Record<string, string> = {};
      const formulaFields: string[] = [];
      headers.forEach((header, index) => {
        const cell = cells[index] ?? { text: '', formula: false };
        validateCell(cell.text, config);
        values[header] = cell.text.trim();
        if (cell.formula) formulaFields.push(header);
      });
      await consume({ rowNumber: row.number, values, formulaFields });
    }
    if (!headers) throw new PermanentJobError('EMPTY_FILE', 'Import workbook is empty');
  }
  if (worksheetCount === 0) {
    throw new PermanentJobError('EMPTY_FILE', 'Import workbook has no worksheets');
  }
  return rowCount;
}

export async function parseImportFile(
  path: string,
  contentType: string,
  config: WorkerConfig,
  consume: ParsedRowConsumer,
): Promise<number> {
  if (contentType === 'text/csv') return parseCsv(path, config, consume);
  if (
    contentType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) return parseXlsx(path, config, consume);
  throw new PermanentJobError('UNSUPPORTED_CONTENT_TYPE', 'Unsupported import content type');
}
