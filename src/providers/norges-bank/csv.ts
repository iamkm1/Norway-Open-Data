/** @internal */
export function parseCsvRecords(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) throw new Error("Unexpected quote in CSV field.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("Unterminated quoted CSV field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  const header = rows.shift();
  if (header === undefined || header.length === 0 || header.some((value) => value.length === 0)) {
    throw new Error("CSV response omitted its header.");
  }
  if (new Set(header).size !== header.length) throw new Error("CSV header contains duplicates.");

  return rows.map((values) => {
    if (values.length !== header.length) throw new Error("CSV row has an unexpected column count.");
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""]));
  });
}
