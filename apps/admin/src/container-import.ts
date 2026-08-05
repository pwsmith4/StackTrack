export interface ContainerCsvRecord {
  line: number;
  label: string;
  type: string;
}

export interface ContainerCsvError {
  line: number;
  message: string;
}

export interface ParsedContainerCsv {
  rows: ContainerCsvRecord[];
  errors: ContainerCsvError[];
}

export interface ContainerImportValidationError {
  line: number;
  message: string;
}

export const CONTAINER_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,119}$/;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function key(value: string): string {
  return normalize(value).toLocaleLowerCase();
}

function parseRecords(text: string): { records: Array<{ line: number; fields: string[] }>; errors: ContainerCsvError[] } {
  const records: Array<{ line: number; fields: string[] }> = [];
  const errors: ContainerCsvError[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  const finishRecord = () => {
    fields.push(field);
    field = "";
    records.push({ line: recordLine, fields });
    fields = [];
    recordLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        if (character === "\n") line += 1;
        field += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ",") {
        fields.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\r") {
        if (next === "\n") index += 1;
        line += 1;
        afterQuote = false;
        finishRecord();
      } else if (character === "\n") {
        line += 1;
        afterQuote = false;
        finishRecord();
      } else if (character.trim()) {
        errors.push({ line, message: "A quoted value must be followed by a comma or the end of the row." });
        afterQuote = false;
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\r") {
      if (next === "\n") index += 1;
      line += 1;
      finishRecord();
    } else if (character === "\n") {
      line += 1;
      finishRecord();
    } else {
      field += character;
    }
  }
  if (quoted) {
    errors.push({ line: recordLine, message: "A quoted value is not closed." });
  } else if (field.length > 0 || fields.length > 0) {
    finishRecord();
  }
  return { records, errors };
}

export function parseContainerCsv(text: string): ParsedContainerCsv {
  const parsed = parseRecords(text.replace(/^\uFEFF/, ""));
  const errors = [...parsed.errors];
  const nonEmpty = parsed.records.filter((record) => record.fields.some((value) => value.trim() !== ""));
  if (!nonEmpty.length) {
    return { rows: [], errors: [...errors, { line: 1, message: "The CSV is empty. Add the required header and at least one data row." }] };
  }
  const header = nonEmpty[0]!;
  const normalizedHeaders = header.fields.map((value) => key(value).replace(/ /g, "_"));
  if (normalizedHeaders.length !== 2 || normalizedHeaders[0] !== "label" || normalizedHeaders[1] !== "container_type") {
    errors.push({ line: header.line, message: "The header must contain exactly two columns in this order: label,container_type." });
  }
  const lastNonEmptyLine = nonEmpty.at(-1)!.line;
  for (const record of parsed.records) {
    if (record.line > header.line && record.line <= lastNonEmptyLine && !record.fields.some((value) => value.trim() !== "")) {
      errors.push({ line: record.line, message: "Blank rows are not allowed between container records. Remove the blank row and try again." });
    }
  }
  const rows: ContainerCsvRecord[] = [];
  for (const record of nonEmpty.slice(1)) {
    if (record.fields.length !== 2) {
      errors.push({ line: record.line, message: "Each data row must contain exactly two columns: label first, container type second. Remove extra columns." });
      continue;
    }
    rows.push({ line: record.line, label: record.fields[0] ?? "", type: record.fields[1] ?? "" });
  }
  return { rows, errors };
}

export function validateContainerRows(
  rows: readonly ContainerCsvRecord[],
  allowedTypes: readonly string[],
  existingLabels: readonly string[] = []
): ContainerImportValidationError[] {
  const errors: ContainerImportValidationError[] = [];
  const allowed = new Map(allowedTypes.map((value) => [key(value), normalize(value)]));
  const existing = new Set(existingLabels.map(key));
  const seen = new Map<string, number>();
  for (const row of rows) {
    const label = normalize(row.label);
    const type = normalize(row.type);
    if (!label) errors.push({ line: row.line, message: "Column 1 (label) is required." });
    else if (!CONTAINER_LABEL_PATTERN.test(label)) errors.push({ line: row.line, message: "Label must start with a letter or number, use only letters, numbers, spaces, periods, underscores, slashes, or hyphens, and be 120 characters or fewer." });
    const typeKey = key(type);
    if (!type) errors.push({ line: row.line, message: "Column 2 (container type) is required." });
    else if (!allowed.has(typeKey)) errors.push({ line: row.line, message: `Container type “${type}” is not active. Use one of: ${allowedTypes.join(", ") || "no active types are configured"}.` });
    const labelKey = key(label);
    const previousLine = seen.get(labelKey);
    if (previousLine) errors.push({ line: row.line, message: `This label duplicates row ${previousLine}. Labels must be unique, ignoring case and extra spaces.` });
    else if (label) seen.set(labelKey, row.line);
    if (label && existing.has(labelKey)) errors.push({ line: row.line, message: `This label already exists. Imports never overwrite existing containers.` });
  }
  return errors;
}
