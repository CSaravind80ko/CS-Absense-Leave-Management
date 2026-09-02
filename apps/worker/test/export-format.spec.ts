import {
  createPayrollCsv,
  safeSpreadsheetCell,
} from '../src/export-format';

describe('payroll export safety', () => {
  it.each(['=SUM(1,1)', '+cmd', '-1+2', '@payload', '\tvalue', '\rvalue'])(
    'neutralizes spreadsheet formula prefix %s',
    (value) => {
      expect(safeSpreadsheetCell(value)).toBe(`'${value}`);
    },
  );

  it('escapes CSV formula injection and quotes', () => {
    const csv = createPayrollCsv([
      {
        employeeNumber: '=1+1',
        employeeName: 'Jane "JJ" Doe',
        regularMinutes: 480,
        overtimeMinutes: 0,
        unpaidMinutes: 0,
      },
    ]).toString('utf8');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"Jane ""JJ"" Doe"');
  });
});
