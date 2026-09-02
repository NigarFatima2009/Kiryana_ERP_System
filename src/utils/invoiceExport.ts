import { formatCurrency, formatDateTime } from './helpers';

export interface InvoiceExportData {
  id: string;
  invoice_number: string;
  sale_date: string;
  status: string;
  customer_name?: string;
  customer_phone?: string;
  cashier_name?: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cogs?: number;
  items: Array<{
    id: string;
    product_name: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    cogs?: number;
  }>;
  payments: Array<{
    method: string;
    amount: number;
    reference?: string | null;
  }>;
  returns?: Array<{
    return_number: string;
    reason: string;
    total: number;
  }>;
}

/**
 * Export invoice as CSV spreadsheet and trigger browser download
 */
export function exportInvoiceCSV(invoice: InvoiceExportData) {
  const lines: string[] = [];

  // Header summary
  lines.push(`"INVOICE REPORT"`);
  lines.push(`"Invoice Number","${invoice.invoice_number}"`);
  lines.push(`"Date","${formatDateTime(invoice.sale_date)}"`);
  lines.push(`"Customer","${invoice.customer_name || 'Walk-in'}"`);
  lines.push(`"Cashier","${invoice.cashier_name || 'Cashier'}"`);
  lines.push(`"Status","${invoice.status}"`);
  lines.push('');

  // Items table
  lines.push('"ITEM DETAILS"');
  lines.push('"#","Product Name","SKU","Quantity","Unit Price (PKR)","Line Total (PKR)"');
  
  invoice.items.forEach((item, index) => {
    lines.push(
      `"${index + 1}","${(item.product_name || 'Product').replace(/"/g, '""')}","${item.sku || '—'}","${item.quantity}","${item.unit_price.toFixed(2)}","${item.line_total.toFixed(2)}"`
    );
  });
  lines.push('');

  // Financials
  lines.push('"SUMMARY"');
  lines.push(`"Subtotal (PKR)","${invoice.subtotal.toFixed(2)}"`);
  lines.push(`"Discount (PKR)","-${invoice.discount.toFixed(2)}"`);
  lines.push(`"Tax (PKR)","${invoice.tax.toFixed(2)}"`);
  lines.push(`"Total Amount (PKR)","${invoice.total.toFixed(2)}"`);
  lines.push('');

  // Payments
  if (invoice.payments && invoice.payments.length > 0) {
    lines.push('"PAYMENTS"');
    lines.push('"Payment Method","Amount (PKR)","Reference"');
    invoice.payments.forEach((p) => {
      lines.push(`"${p.method}","${p.amount.toFixed(2)}","${(p.reference || '—').replace(/"/g, '""')}"`);
    });
    lines.push('');
  }

  // Returns if any
  if (invoice.returns && invoice.returns.length > 0) {
    lines.push('"RETURNS"');
    lines.push('"Return #","Reason","Refund Total (PKR)"');
    invoice.returns.forEach((r) => {
      lines.push(`"${r.return_number}","${r.reason.replace(/"/g, '""')}","-${r.total.toFixed(2)}"`);
    });
  }

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Invoice_${invoice.invoice_number}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open a clean, printable PDF invoice view and trigger window print
 */
export function exportInvoicePDF(invoice: InvoiceExportData) {
  const printWindow = window.open('', '_blank', 'width=800,height=900');
  if (!printWindow) {
    alert('Please allow popups to download or print the PDF invoice.');
    return;
  }

  const returnedTotal = (invoice.returns || []).reduce((sum, r) => sum + r.total, 0);
  const netTotal = Math.max(0, invoice.total - returnedTotal);

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 20px;
      font-size: 13px;
      line-height: 1.5;
    }
    .invoice-card {
      max-width: 720px;
      margin: 0 auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .store-name {
      font-size: 22px;
      font-weight: 800;
      color: #1e3a8a;
      letter-spacing: -0.5px;
    }
    .store-tagline {
      font-size: 12px;
      color: #64748b;
      margin-top: 2px;
    }
    .invoice-title {
      text-align: right;
    }
    .invoice-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      background-color: #dbeafe;
      color: #1d4ed8;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .invoice-num {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
      background-color: #f8fafc;
      padding: 16px;
      border-radius: 6px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
    }
    .meta-value {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    th {
      background-color: #f1f5f9;
      color: #475569;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
    }
    .text-right {
      text-align: right;
    }
    .text-center {
      text-align: center;
    }
    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 24px;
    }
    .totals-table {
      width: 280px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 13px;
      color: #475569;
    }
    .totals-row.grand-total {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      border-top: 2px solid #e2e8f0;
      padding-top: 8px;
      margin-top: 6px;
    }
    .payments-section {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 24px;
    }
    .payments-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .payment-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      padding: 2px 0;
    }
    .footer {
      text-align: center;
      color: #94a3b8;
      font-size: 11px;
      border-top: 1px dashed #cbd5e1;
      padding-top: 16px;
      margin-top: 30px;
    }
    @media print {
      body {
        padding: 0;
      }
      .invoice-card {
        border: none;
        box-shadow: none;
        padding: 0;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="store-name">KIRYANA STORE ERP</div>
        <div class="store-tagline">Retail & Wholesale Superstore • Point of Sale</div>
      </div>
      <div class="invoice-title">
        <div class="invoice-badge">${invoice.status}</div>
        <div class="invoice-num">${invoice.invoice_number}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Customer</span>
        <span class="meta-value">${invoice.customer_name || 'Walk-in Customer'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Date & Time</span>
        <span class="meta-value">${formatDateTime(invoice.sale_date)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Cashier</span>
        <span class="meta-value">${invoice.cashier_name || 'Cashier'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Invoice ID</span>
        <span class="meta-value">${invoice.id.slice(0, 12)}...</span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th class="text-center">Qty</th>
          <th class="text-right">Price</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.items
          .map(
            (item, index) => `
          <tr>
            <td style="color: #94a3b8; width: 30px;">${index + 1}</td>
            <td>
              <div style="font-weight: 600; color: #0f172a;">${item.product_name}</div>
              ${item.sku ? `<div style="font-size: 10px; color: #94a3b8;">SKU: ${item.sku}</div>` : ''}
            </td>
            <td class="text-center" style="font-weight: 600;">${item.quantity}</td>
            <td class="text-right">${formatCurrency(item.unit_price)}</td>
            <td class="text-right" style="font-weight: 700; color: #0f172a;">${formatCurrency(item.line_total)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <div class="totals-wrapper">
      <div class="totals-table">
        <div class="totals-row">
          <span>Subtotal:</span>
          <span>${formatCurrency(invoice.subtotal)}</span>
        </div>
        ${
          invoice.discount > 0
            ? `
        <div class="totals-row" style="color: #dc2626;">
          <span>Discount:</span>
          <span>-${formatCurrency(invoice.discount)}</span>
        </div>`
            : ''
        }
        ${
          invoice.tax > 0
            ? `
        <div class="totals-row">
          <span>Tax:</span>
          <span>${formatCurrency(invoice.tax)}</span>
        </div>`
            : ''
        }
        <div class="totals-row grand-total">
          <span>Total:</span>
          <span>${formatCurrency(invoice.total)}</span>
        </div>
        ${
          returnedTotal > 0
            ? `
        <div class="totals-row" style="color: #ea580c; font-weight: 600; margin-top: 4px;">
          <span>Returned:</span>
          <span>-${formatCurrency(returnedTotal)}</span>
        </div>
        <div class="totals-row grand-total" style="color: #15803d; border-color: #bbf7d0;">
          <span>Net Total:</span>
          <span>${formatCurrency(netTotal)}</span>
        </div>`
            : ''
        }
      </div>
    </div>

    ${
      invoice.payments && invoice.payments.length > 0
        ? `
    <div class="payments-section">
      <div class="payments-title">Payment Method Breakdown</div>
      ${invoice.payments
        .map(
          (p) => `
        <div class="payment-row">
          <span style="font-weight: 600;">${p.method.replace('CUSTOMER_CREDIT', 'Khata / Credit')}</span>
          <span style="font-weight: 700;">${formatCurrency(p.amount)}</span>
        </div>
      `
        )
        .join('')}
    </div>`
        : ''
    }

    <div class="footer">
      <p style="margin: 0; font-weight: 600; color: #64748b;">Thank you for your business!</p>
      <p style="margin: 4px 0 0 0;">This is a computer-generated tax invoice valid under sales tax rules.</p>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
