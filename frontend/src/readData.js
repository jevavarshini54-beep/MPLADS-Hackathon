import * as XLSX from "xlsx";

const BASE_URL = import.meta.env.BASE_URL;

export async function loadWorksSanctioned() {
  const response = await fetch(
    `${BASE_URL}data/Lok Sabha Data/Works Sanctioned_Lok.xlsx`
  );

  if (!response.ok) {
    throw new Error(`Could not load sanctioned data: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(worksheet);
}

export async function loadExpenditure() {
  const response = await fetch(
    `${BASE_URL}data/Lok Sabha Data/Expenditure on Completed and On-going Works as on Date_Lok.xlsx`
  );

  if (!response.ok) {
    throw new Error(`Could not load expenditure data: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(worksheet);
}

export async function loadWorksCompleted() {
  const response = await fetch(
    `${BASE_URL}data/Lok Sabha Data/Works Completed_Lok.xlsx`
  );

  if (!response.ok) {
    throw new Error(`Could not load completed data: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(worksheet);
}

// LOAD AI RESULTS
export async function loadRiskResults() {
  const response = await fetch(`${BASE_URL}risk_results.csv`);

  if (!response.ok) {
    throw new Error(`Could not load risk_results.csv: ${response.status}`);
  }

  const text = await response.text();
  const workbook = XLSX.read(text, {
    type: "string",
    raw: true,
  });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(worksheet);
}