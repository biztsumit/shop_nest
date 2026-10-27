import { csvCell } from './admin-reports.service.js';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['Riya Sharma', 'Riya Sharma'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    // Spreadsheets run cells that start with = + - @ as formulas: made plain text
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+91 98765', "'+91 98765"],
    ['-5', "'-5"],
    ['@cmd', "'@cmd"],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
  ])('%j → %j', (input, output) => {
    expect(csvCell(input)).toBe(output);
  });
});
