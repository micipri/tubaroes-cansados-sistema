const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const xlsx = require('xlsx');

function normalizeKey(key) {
  if (!key) return '';
  return key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

let allNames = [];
let allCpfs = [];
let duplicates = [];

function checkRow(row, source) {
  const mappedRow = {};
  for (const key in row) {
    mappedRow[normalizeKey(key)] = row[key];
  }
  const nome = (mappedRow.nome || mappedRow.nomecompleto || mappedRow.atleta || row['Nome'] || "").toString().trim().toUpperCase();
  const cpfRaw = (mappedRow.numerododocumento || mappedRow.cpf || mappedRow.documento || row['Nmero do documento'] || row['N˙mero do documento'] || "").toString();
  const cpf = cpfRaw.replace(/\D/g, '');

  if (!nome) return;

  if (allNames.includes(nome) || (cpf && allCpfs.includes(cpf))) {
     duplicates.push({ nome, cpf, source });
  } else {
     allNames.push(nome);
     if (cpf) allCpfs.push(cpf);
  }
}

const dir = path.join(__dirname, 'listas');
const files = fs.readdirSync(dir);
files.forEach(file => {
  const filePath = path.join(dir, file);
  if (file.toLowerCase().endsWith('.csv')) {
    const fileContent = fs.readFileSync(filePath, 'latin1');
    Papa.parse(fileContent, {
      header: true, skipEmptyLines: true, delimiter: ";",
      complete: function(results) {
        results.data.forEach(row => checkRow(row, file));
      }
    });
  } else if (file.toLowerCase().endsWith('.xlsx') || file.toLowerCase().endsWith('.xls')) {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    data.forEach(row => checkRow(row, file));
  }
});

console.log("Duplicates found:", duplicates);
