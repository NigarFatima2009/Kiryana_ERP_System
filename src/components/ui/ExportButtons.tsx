import { FileText, Sheet } from 'lucide-react';
import { generatePDF, generateCSV, generateInvoicePDF, exportAsTable } from '../../lib/export';

interface ExportButtonsProps {
  data?: Record<string, any>;
  sections?: Array<{
    title: string;
    rows: Array<[string, any]>;
  }>;
  filename: string;
  title: string;
  invoiceData?: {
    invoiceNumber: string;
    date: string;
    customer: string;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
    subtotal: number;
    tax: number;
    total: number;
    payments?: Array<{ method: string; amount: number }>;
    notes?: string;
  };
  tableData?: {
    headers: string[];
    rows: any[][];
    totals?: Record<string, any>;
  };
  variant?: 'primary' | 'secondary' | 'compact';
}

/**
 * Reusable export buttons component
 * Shows PDF and CSV export options in modals and detail views
 * Supports: generic data objects, invoice-formatted data, and table data
 */
export function ExportButtons({
  data,
  sections,
  filename,
  title,
  invoiceData,
  tableData,
  variant = 'primary',
}: ExportButtonsProps) {
  const handleExportPDF = () => {
    try {
      if (invoiceData) {
        generateInvoicePDF(filename, invoiceData);
      } else if (data || sections) {
        generatePDF(filename, title, data || {}, sections);
      }
    } catch (error) {
      console.error('Export PDF failed:', error);
    }
  };

  const handleExportCSV = () => {
    try {
      if (tableData) {
        exportAsTable(filename, title, tableData.headers, tableData.rows, tableData.totals);
      } else if (data) {
        generateCSV(filename, [data]);
      } else if (sections) {
        const flatData = sections.flatMap(s => s.rows.map(([k, v]) => ({ [k]: v })));
        generateCSV(filename, flatData);
      }
    } catch (error) {
      console.error('Export CSV failed:', error);
    }
  };

  if (variant === 'compact') {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={handleExportPDF}
          title="Export as PDF"
          className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded text-xs font-medium transition"
        >
          <FileText size={14} />
          PDF
        </button>
        <button
          onClick={handleExportCSV}
          title="Export as CSV"
          className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded text-xs font-medium transition"
        >
          <Sheet size={14} />
          CSV
        </button>
      </div>
    );
  }

  if (variant === 'secondary') {
    return (
      <div className="flex gap-2">
        <button
          onClick={handleExportPDF}
          title="Export as PDF"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-semibold transition"
        >
          <FileText size={16} />
          PDF
        </button>
        <button
          onClick={handleExportCSV}
          title="Export as CSV"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-semibold transition"
        >
          <Sheet size={16} />
          CSV
        </button>
      </div>
    );
  }

  // Primary (default)
  return (
    <div className="flex gap-2">
      <button
        onClick={handleExportPDF}
        title="Export as PDF"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 border border-red-700 rounded-lg text-xs font-semibold transition"
      >
        <FileText size={16} />
        Download PDF
      </button>
      <button
        onClick={handleExportCSV}
        title="Export as CSV"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-700 rounded-lg text-xs font-semibold transition"
      >
        <Sheet size={16} />
        Export CSV
      </button>
    </div>
  );
}
