export interface WorkerConfig {
  queueUrl: string;
  importBucket: string;
  exportBucket: string;
  concurrency: number;
  visibilitySeconds: number;
  maxRows: number;
  maxColumns: number;
  maxCellBytes: number;
  maxArchiveBytes: number;
  maxArchiveRatio: number;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): WorkerConfig {
  return {
    queueUrl: required('PROCESSING_QUEUE_URL'),
    importBucket: required('IMPORT_BUCKET'),
    exportBucket: required('EXPORT_BUCKET'),
    concurrency: integer('WORKER_CONCURRENCY', 2, 1, 10),
    visibilitySeconds: integer('WORKER_VISIBILITY_SECONDS', 900, 60, 43200),
    maxRows: integer('ATTENDANCE_IMPORT_MAX_ROWS', 50_000, 1, 500_000),
    maxColumns: integer('ATTENDANCE_IMPORT_MAX_COLUMNS', 20, 3, 200),
    maxCellBytes: integer('ATTENDANCE_IMPORT_MAX_CELL_BYTES', 1024, 16, 65536),
    maxArchiveBytes: integer(
      'ATTENDANCE_XLSX_MAX_UNCOMPRESSED_BYTES',
      200 * 1024 * 1024,
      1024,
      2_000_000_000,
    ),
    maxArchiveRatio: integer('ATTENDANCE_XLSX_MAX_COMPRESSION_RATIO', 100, 1, 1000),
  };
}
