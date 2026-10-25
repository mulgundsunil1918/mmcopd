/**
 * The bill Excel as a file: build the downloadable template (empty, or filled with a sample bill) and read an uploaded file into plain cells.
 * The spreadsheet library is handed in (not imported here), so the app's main process and the website demo can each bring their own copy and the
 * screen's code never has to carry it.
 */
import { BILL_FIELDS, ITEM_COLUMNS, SHEET_BILL, SHEET_ITEMS, billFieldFor, itemColumnFor, sampleBill } from './template';

type Xlsx = typeof import('xlsx');

/** The empty template (the headers and field names only), or the same with a sample bill filled in to try the screen. */
export function buildTemplateWorkbook(XLSX: Xlsx, withSample: boolean, today: string = new Date().toLocaleDateString('en-CA')): Uint8Array {
  const wb = XLSX.utils.book_new();
  const sample = withSample ? sampleBill(today) : null;
  const billAoa: (string | number)[][] = [['Field', 'Value'], ...BILL_FIELDS.map((f) => [f.label, sample ? (sample.bill[f.label] ?? '') : ''])];
  const bill = XLSX.utils.aoa_to_sheet(billAoa);
  bill['!cols'] = [{ wch: 34 }, { wch: 60 }];
  const headers = ITEM_COLUMNS.map((c) => c.header);
  const itemsAoa: (string | number)[][] = [headers, ...(sample ? sample.items.map((r) => headers.map((h) => r[h] ?? '')) : [])];
  const items = XLSX.utils.aoa_to_sheet(itemsAoa);
  items['!cols'] = headers.map((h) => ({ wch: Math.max(10, Math.min(30, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, bill, SHEET_BILL);
  XLSX.utils.book_append_sheet(wb, items, SHEET_ITEMS);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** An .xlsx is a zip file ("PK"), an old .xls a compound file (D0 CF 11 E0). A photo, a PDF or a text file is not the Excel ChatGPT made. */
export function looksLikeExcel(data: ArrayBuffer | Uint8Array | null | undefined): boolean {
  if (!data) return false;
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  return b.length > 4 && ((b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0));
}

export const NOT_EXCEL_MESSAGE = 'That is not an Excel file (.xlsx). In step 3 upload the Excel that ChatGPT gave you — the photo or PDF of the bill goes in the separate “bill photo” box.';

export interface WorkbookRows { billRows: unknown[][] | null; itemRows: unknown[][] | null; sheetNames: string[] }

/** Read the Bill and Items sheets as rows of cells. A sheet is found by its name, else by what is in it. */
export function readWorkbook(XLSX: Xlsx, data: ArrayBuffer | Uint8Array): WorkbookRows {
  const wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', cellDates: true });
  const rowsOf = (name: string): unknown[][] => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
  const names = wb.SheetNames;
  const byName = (n: string) => names.find((x) => x.trim().toLowerCase() === n.toLowerCase());
  let billName = byName(SHEET_BILL);
  let itemsName = byName(SHEET_ITEMS);
  if (!billName) billName = names.find((n) => n !== itemsName && rowsOf(n).filter((r) => billFieldFor(r?.[0])).length >= 3);
  if (!itemsName) itemsName = names.find((n) => n !== billName && rowsOf(n).slice(0, 15).some((r) => (r ?? []).filter((c) => itemColumnFor(c)).length >= 3));
  return { billRows: billName ? rowsOf(billName) : null, itemRows: itemsName ? rowsOf(itemsName) : null, sheetNames: names };
}
