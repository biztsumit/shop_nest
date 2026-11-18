import type { Invoice } from '@shop/shared';
import PDFDocument from 'pdfkit';

// Draws an issued invoice as an A4 PDF. Pure: the same invoice always gives the same page.
//
// It uses the PDF's built-in Helvetica, so no font file ships with the app. That font has no ₹
// sign, so amounts are written "Rs. 1,047.00" (the usual way on printed Indian invoices).

const IST = 5.5 * 60 * 60 * 1000;
// 49950 → "499.50" (Indian digit grouping: 1,04,750.00)
const money = (paise: number): string => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "17 Nov 2026", in Indian time
const date = (iso: string): string =>
  new Date(Date.parse(iso) + IST).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const INK = '#111111';
const MUTED = '#666666';
const LINE = '#cccccc';

export const renderInvoicePdf = (invoice: Invoice): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Tax invoice ${invoice.number}`, Author: invoice.seller.legalName } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const width = doc.page.width - 80;
    const right = left + width;

    // ---------- Heading: seller on the left, invoice details on the right ----------
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', left, 40, { width, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(12).text(invoice.seller.legalName, left, 40, { width: width / 2 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(invoice.seller.address, { width: width / 2 })
      .text(`GSTIN: ${invoice.seller.gstin}`)
      .text(`State: ${invoice.seller.state} (${invoice.seller.stateCode})`);

    const details: Array<[string, string]> = [
      ['Invoice number', invoice.number],
      ['Invoice date', date(invoice.issuedAt)],
      ['Order', `${invoice.orderNumber} of ${date(invoice.orderDate)}`],
      ['Place of supply', `${invoice.buyer.state} (${invoice.buyer.stateCode})`],
      ['Payment', invoice.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid online'],
      ['Reverse charge', 'No'],
    ];
    let y = 64;
    for (const [label, value] of details) {
      doc.fontSize(9).fillColor(MUTED).text(label, left + width / 2, y, { width: width / 4 });
      doc.fillColor(INK).text(value, left + (width * 3) / 4, y, { width: width / 4, align: 'right' });
      y += 13;
    }

    // ---------- Buyer ----------
    y = Math.max(y, doc.y) + 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('BILL TO / SHIP TO', left, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(invoice.buyer.name, left, y + 13);
    doc.font('Helvetica').fontSize(9).text([...invoice.buyer.address, `${invoice.buyer.state} (state code ${invoice.buyer.stateCode})`].join('\n'));
    y = doc.y + 16;

    // ---------- The lines ----------
    // Within the state: CGST and SGST columns; to another state: one IGST column
    type Column = { title: string; width: number; align: 'left' | 'right'; value: (l: Invoice['lines'][number], i: number) => string };
    const taxColumns: Column[] = invoice.interState
      ? [{ title: 'IGST', width: 100, align: 'right', value: (l) => money(l.igst) }]
      : [
          { title: 'CGST', width: 50, align: 'right', value: (l) => money(l.cgst) },
          { title: 'SGST', width: 50, align: 'right', value: (l) => money(l.sgst) },
        ];
    const columns: Column[] = [
      { title: '#', width: 18, align: 'left', value: (_, i) => String(i + 1) },
      { title: 'Description', width: 157, align: 'left', value: (l) => l.description },
      { title: 'HSN/SAC', width: 48, align: 'left', value: (l) => l.hsn || '-' },
      { title: 'Qty', width: 28, align: 'right', value: (l) => String(l.quantity) },
      { title: 'Taxable', width: 66, align: 'right', value: (l) => money(l.taxable) },
      { title: 'GST %', width: 36, align: 'right', value: (l) => `${l.rate}%` },
      ...taxColumns,
      { title: 'Amount', width: 0, align: 'right', value: (l) => money(l.total) },
    ];
    columns.at(-1)!.width = width - columns.reduce((sum, c) => sum + c.width, 0);

    const row = (cells: string[], top: number, bold = false): number => {
      let x = left;
      let bottom = top;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(INK);
      cells.forEach((cell, i) => {
        const c = columns[i]!;
        doc.text(cell, x + 2, top, { width: c.width - 4, align: c.align });
        bottom = Math.max(bottom, doc.y);
        x += c.width;
      });
      return bottom;
    };

    doc.rect(left, y - 4, width, 18).fill('#f2f2f2');
    y = row(columns.map((c) => c.title), y, true) + 8;
    invoice.lines.forEach((line, i) => {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }
      const bottom = row(columns.map((c) => c.value(line, i)), y);
      // Under the description: the price per piece (GST included) and the coupon's share
      const note = [`${line.quantity} x Rs. ${money(line.unitPrice)} incl. GST`, line.discount > 0 ? `coupon -Rs. ${money(line.discount)}` : ''].filter(Boolean).join(', ');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(note, left + columns[0]!.width + 2, bottom + 1, { width: columns[1]!.width - 4 });
      y = doc.y + 6;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor(LINE).stroke();
    });

    // ---------- Totals ----------
    const totals: Array<[string, string]> = [
      ['Taxable value', money(invoice.totals.taxable)],
      ...(invoice.interState
        ? [['IGST', money(invoice.totals.igst)] as [string, string]]
        : [['CGST', money(invoice.totals.cgst)], ['SGST', money(invoice.totals.sgst)]] as Array<[string, string]>),
    ];
    y += 6;
    for (const [label, value] of totals) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, right - 220, y, { width: 120 });
      doc.fillColor(INK).text(`Rs. ${value}`, right - 100, y, { width: 100, align: 'right' });
      y += 14;
    }
    doc.moveTo(right - 220, y).lineTo(right, y).strokeColor(INK).stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total', right - 220, y, { width: 120 });
    doc.text(`Rs. ${money(invoice.totals.total)}`, right - 120, y, { width: 120, align: 'right' });
    y += 20;
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(invoice.amountInWords, left, y, { width, align: 'right' });

    // ---------- Notes ----------
    y = doc.y + 24;
    doc.fontSize(8).fillColor(MUTED).text(
      [
        'Prices include GST. Delivery and cash-on-delivery charges are taxed at the highest rate of the goods supplied.',
        invoice.totals.discount > 0 ? `The coupon discount of Rs. ${money(invoice.totals.discount)} is shared between the items in proportion to their prices.` : '',
        'This is a computer-generated invoice and needs no signature.',
      ].filter(Boolean).join('\n'),
      left,
      y,
      { width },
    );

    doc.end();
  });
