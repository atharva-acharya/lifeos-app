import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImportPreview } from "../api";
import { invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { MoneyImport } from "./MoneyImport";

const CSV = "Date,Description,Paid out,Paid in\n31/10/2026,Shop,12.50,\n";

const PREVIEW: ImportPreview = {
  headers: ["Date", "Description", "Paid out", "Paid in"],
  mapping: {
    date: "Date",
    dateFormat: "dmy",
    description: "Description",
    amount: null,
    moneyOut: "Paid out",
    moneyIn: "Paid in",
    category: null,
    flipSign: false,
  },
  saved: false,
  rows: [
    {
      line: 2,
      date: "2026-10-31",
      description: "Shop",
      category: null,
      amount: -1250,
      status: "new",
      error: null,
    },
    {
      line: 3,
      date: "2026-10-30",
      description: "Coffee",
      category: null,
      amount: -320,
      status: "duplicate",
      error: null,
    },
    {
      line: 4,
      date: null,
      description: "Bad",
      category: null,
      amount: null,
      status: "error",
      error: "Date not recognised",
    },
  ],
  new: 1,
  duplicates: 1,
  errors: 1,
};

function pickFile(text = CSV, size?: number) {
  const file = new File([text], "statement.csv", { type: "text/csv" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
}

describe("MoneyImport", () => {
  it("asks for a bank name before reading the file", async () => {
    mockCommands({ get_banks: [] });
    render(<MoneyImport onImported={vi.fn()} />);
    pickFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Name the bank first");
    expect(invoke).not.toHaveBeenCalledWith("preview_import", expect.anything());
  });

  it("refuses files over 2 MB without reading them", async () => {
    mockCommands({ get_banks: [] });
    render(<MoneyImport onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "Example Bank" } });
    pickFile(CSV, 3 * 1024 * 1024);
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 2 MB");
  });

  it("previews, lets the columns change, and imports the new rows", async () => {
    const onImported = vi.fn();
    mockCommands({
      get_banks: ["Example Bank"],
      preview_import: PREVIEW,
      import_csv: { imported: 1, duplicates: 1, errors: 1, files: ["Money/Ledger/2026-10.md"] },
    });
    render(<MoneyImport onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "Example Bank" } });
    pickFile();

    const summary = await screen.findByRole("list", { name: "Import summary" });
    expect(summary).toHaveTextContent("1 new");
    expect(summary).toHaveTextContent("1 already in ledger");
    expect(screen.getByText("Already in ledger")).toHaveClass("pill--read");
    expect(screen.getByText("Date not recognised")).toHaveClass("pill--danger");
    expect(screen.getByText("-£12.50")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("preview_import", {
      csv: CSV,
      bank: "Example Bank",
      mapping: null,
      account: null,
    });

    fireEvent.change(screen.getByLabelText("Date format"), { target: { value: "mdy" } });
    expect(invoke).toHaveBeenCalledWith("preview_import", {
      csv: CSV,
      bank: "Example Bank",
      mapping: { ...PREVIEW.mapping, dateFormat: "mdy" },
      account: null,
    });

    const importButton = await screen.findByRole("button", { name: "Import 1 new row" });
    fireEvent.click(importButton);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 1 row; skipped 1 already in the ledger and 1 unreadable.",
    );
    expect(invoke).toHaveBeenCalledWith("import_csv", {
      csv: CSV,
      bank: "Example Bank",
      mapping: PREVIEW.mapping,
      account: null,
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("cannot import when nothing is new, and shows core errors", async () => {
    mockCommands({
      get_banks: [],
      preview_import: { ...PREVIEW, new: 0, rows: PREVIEW.rows.slice(1) },
    });
    render(<MoneyImport onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "Example Bank" } });
    pickFile();
    expect(await screen.findByRole("button", { name: "Import 0 new rows" })).toBeDisabled();

    mockCommands({ get_banks: [], preview_import: rejected("A quoted field is never closed.") });
    pickFile('a,"b');
    expect(await screen.findByRole("alert")).toHaveTextContent("A quoted field is never closed.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(document.body).queryByRole("list", { name: "Import summary" })).toBeNull();
  });
});
