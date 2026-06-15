const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const DATA_FILE = path.join(__dirname, 'public', 'data.json');
const DUAS_PROVAS_FILE = path.join(__dirname, 'listas', 'duas_provas.xlsx');

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\s+/g, '') // remove spaces
    .replace(/[^a-z0-9]/g, ''); // remove special chars
}

function updateProvas() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error("data.json não encontrado. Rode o script de build primeiro.");
    return;
  }
  if (!fs.existsSync(DUAS_PROVAS_FILE)) {
    console.error("duas_provas.xlsx não encontrado.");
    return;
  }

  // Load athletes
  const athletes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  
  // Create a map for quick lookup
  const athleteMap = new Map();
  athletes.forEach(a => {
    athleteMap.set(normalizeName(a.nome), a);
  });

  // Read excel
  const workbook = xlsx.readFile(DUAS_PROVAS_FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  const notFound = [];
  let updatedCount = 0;

  data.forEach(row => {
    // Attempt to find name column
    let name = row['Participante'] || row['Nome'] || row['nome'] || row['Nome Completo'] || row['Atleta'];
    // If not found by exact key, just try the first value in the object
    if (!name) {
      const keys = Object.keys(row);
      if (keys.length > 0) {
        name = row[keys[0]];
      }
    }

    if (name && typeof name === 'string') {
      const normName = normalizeName(name);
      if (athleteMap.has(normName)) {
        const athlete = athleteMap.get(normName);
        athlete.prova = "TODAS";
        updatedCount++;
      } else {
        notFound.push(name);
      }
    }
  });

  // Save back to data.json
  fs.writeFileSync(DATA_FILE, JSON.stringify(athletes, null, 2));

  console.log(`\n✅ Sucesso! ${updatedCount} atletas tiveram a prova alterada para 'TODAS'.`);
  if (notFound.length > 0) {
    console.log(`\n⚠️ ATENÇÃO: Os seguintes nomes não foram encontrados na base principal:`);
    notFound.forEach(n => console.log(`- ${n}`));
  } else {
    console.log(`\n🎉 Todos os nomes da planilha foram encontrados!`);
  }
}

updateProvas();
