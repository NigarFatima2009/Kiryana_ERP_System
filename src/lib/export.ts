/**
 * Export utilities for PDF and CSV generation
 * Used across all detail/view modals
 */

export function formatPDFValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function downloadFile(content: string | Blob, filename: string, mimeType?: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateCSV(filename: string, data: Record<string, any>[], columns?: string[]): void {
  if (!data || data.length === 0) return;
  const keys = columns || Object.keys(data[0]);
  const header = keys.join(',');
  const rows = data.map(row =>
    keys.map(key => {
      const val = row[key];
      if (typeof val === 'string' && val.includes(',')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val ?? '';
    }).join(',')
  );
  const csv = '\uFEFF' + [header, ...rows].join('\r\n');
  downloadFile(csv, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function generatePDF(
  filename: string,
  title: string,
  data: Record<string, any>,
  sections?: Array<{ title: string; rows: Array<[string, any]> }>
): void {
  const printWindow = window.open('', '_blank', 'width=750,height=850');
  if (!printWindow) return;

  let contentHtml = '';
  if (sections && sections.length > 0) {
    contentHtml = sections.map(sec => `
      <div style="margin-top:16px;">
        <h3 style="margin:0 0 8px;color:#1e3a8a;font-size:14px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;">${sec.title}</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${sec.rows.map(([k, v]) => `<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;">${k}</th><td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px;">${formatPDFValue(v)}</td></tr>`).join('')}
        </table>
      </div>
    `).join('');
  } else {
    contentHtml = `<table style="width:100%;border-collapse:collapse;margin-top:16px;">
      ${Object.entries(data).map(([k, v]) => `<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;">${k}</th><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:600;">${formatPDFValue(v)}</td></tr>`).join('')}
    </table>`;
  }

  printWindow.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;color:#1e293b;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}</style></head>
  <body><div style="max-width:650px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
    <h2 style="margin:0 0 4px;color:#1e3a8a;">${title}</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:12px;">Generated on ${new Date().toLocaleString()}</p>
    ${contentHtml}
  </div><script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`);
  printWindow.document.close();
}

export function generateInvoicePDF(
  filename: string,
  invoice: {
    invoiceNumber: string;
    date: string;
    customer: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
    subtotal: number;
    tax: number;
    total: number;
    payments?: Array<{ method: string; amount: number; reference?: string | null }>;
    notes?: string;
  }
): void {
  const printWindow = window.open('', '_blank', 'width=750,height=850');
  if (!printWindow) return;

  const itemRows = invoice.items.map((item, idx) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${idx + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:600;">${item.description}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rs. ${item.unitPrice.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">Rs. ${item.amount.toFixed(2)}</td>
    </tr>
  `).join('');

  const paymentRows = (invoice.payments && invoice.payments.length > 0)
    ? `
      <div style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;">
        <h4 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#475569;font-weight:700;">Payment Details</h4>
        ${invoice.payments.map((p) => `
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px dashed #e2e8f0;">
            <span>
              <strong>${p.method.replace('CUSTOMER_CREDIT', 'Khata / Credit')}</strong>
              ${p.reference ? `<span style="color:#64748b;font-size:11px;margin-left:6px;">(${p.reference})</span>` : ''}
            </span>
            <span style="font-weight:700;">Rs. ${p.amount.toFixed(2)}</span>
          </div>
        `).join('')}
      </div>
    `
    : '';

  const notesHtml = invoice.notes
    ? `<div style="margin-top:12px;font-size:12px;color:#64748b;font-style:italic;">📝 ${invoice.notes}</div>`
    : '';

  printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${invoice.invoiceNumber}</title>
  <style>body{font-family:system-ui,sans-serif;color:#1e293b;padding:24px}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f8fafc;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b}</style></head>
  <body><div style="max-width:700px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #2563eb;padding-bottom:12px;margin-bottom:16px;">
      <div><h2 style="margin:0;color:#1e3a8a;">INVOICE</h2><p style="margin:2px 0 0;color:#64748b;font-size:12px;">${invoice.invoiceNumber}</p></div>
      <div style="text-align:right;"><p style="margin:0;font-size:12px;color:#64748b;">Date: ${invoice.date}</p><p style="margin:2px 0 0;font-size:12px;color:#64748b;">Customer: <strong>${invoice.customer}</strong></p></div>
    </div>
    <table><thead><tr><th>#</th><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div style="margin-top:16px;text-align:right;font-size:14px;line-height:1.6;">
      <p style="margin:0;">Subtotal: Rs. ${invoice.subtotal.toFixed(2)}</p>
      ${invoice.tax > 0 ? `<p style="margin:0;">Tax: Rs. ${invoice.tax.toFixed(2)}</p>` : ''}
      <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#2563eb;">Total: Rs. ${invoice.total.toFixed(2)}</p>
    </div>
    ${paymentRows}
    ${notesHtml}
  </div><script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`);
  printWindow.document.close();
}

export function exportAsTable(
  filename: string,
  title: string,
  headers: string[],
  rows: any[][],
  totals?: Record<string, any>
): void {
  const csvRows = [
    `"${title}"`,
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  if (totals) {
    csvRows.push(Object.entries(totals).map(([k, v]) => `"${k}: ${v}"`).join(','));
  }
  const csv = '\uFEFF' + csvRows.join('\r\n');
  downloadFile(csv, filename.endsWith('.csv') ? filename : `${filename}.csv`, 'text/csv;charset=utf-8;');
}
