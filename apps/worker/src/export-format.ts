import ExcelJS from 'exceljs';

export interface PayrollExportRow {
  employeeNumber: string;
  employeeName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  unpaidMinutes: number;
}

export function safeSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const safe = typeof value === 'string' ? safeSpreadsheetCell(value) : String(value);
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createPayrollCsv(rows: PayrollExportRow[]): Buffer {
  const lines = [
    ['employeeNumber', 'employeeName', 'regularMinutes', 'overtimeMinutes', 'unpaidMinutes']
      .map(csvCell)
      .join(','),
    ...rows.map((row) =>
      [
        row.employeeNumber,
        row.employeeName,
        row.regularMinutes,
        row.overtimeMinutes,
        row.unpaidMinutes,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function createPayrollXlsx(rows: PayrollExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Attendance Payroll Worker';
  workbook.calcProperties.fullCalcOnLoad = false;
  const sheet = workbook.addWorksheet('Payroll');
  sheet.columns = [
    { header: 'Employee number', key: 'employeeNumber', width: 20 },
    { header: 'Employee name', key: 'employeeName', width: 32 },
    { header: 'Regular minutes', key: 'regularMinutes', width: 18 },
    { header: 'Overtime minutes', key: 'overtimeMinutes', width: 18 },
    { header: 'Unpaid minutes', key: 'unpaidMinutes', width: 18 },
  ];
  for (const row of rows) {
    sheet.addRow({
      ...row,
      employeeNumber: safeSpreadsheetCell(row.employeeNumber),
      employeeName: safeSpreadsheetCell(row.employeeName),
    });
  }
  sheet.getRow(1).font = { bold: true };
  const value = await workbook.xlsx.writeBuffer();
  return Buffer.from(value);
}
