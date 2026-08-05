import { describe, expect, it } from "vitest";
import { parseContainerCsv, validateContainerRows } from "../src/container-import.js";

describe("container CSV import rules", () => {
  it("requires the exact two-column header and preserves row numbers", () => {
    const parsed = parseContainerCsv("label,container_type\nB4001,bin\nC4001,cart\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { line: 2, label: "B4001", type: "bin" },
      { line: 3, label: "C4001", type: "cart" }
    ]);
  });

  it("explains structural errors instead of silently dropping bad rows", () => {
    const parsed = parseContainerCsv("label,type\nB4001,bin,extra\n\nC4001,cart\n");
    expect(parsed.errors.map((item) => item.message)).toEqual(expect.arrayContaining([
      "The header must contain exactly two columns in this order: label,container_type.",
      "Each data row must contain exactly two columns: label first, container type second. Remove extra columns.",
      "Blank rows are not allowed between container records. Remove the blank row and try again."
    ]));
  });

  it("rejects duplicates, existing labels, invalid labels, and inactive types", () => {
    const parsed = parseContainerCsv("label,container_type\nB4001,bin\n b4001 ,bin\nC,unknown\n");
    const errors = validateContainerRows(parsed.rows, ["bin", "cart"], ["C"]);
    expect(errors.map((item) => item.message)).toEqual(expect.arrayContaining([
      "This label duplicates row 2. Labels must be unique, ignoring case and extra spaces.",
      "Container type “unknown” is not active. Use one of: bin, cart.",
      "This label already exists. Imports never overwrite existing containers."
    ]));
  });
});
