const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const xlsx = require('xlsx'); // still used for excel if any

const LISTAS_DIR = path.join(__dirname, 'listas');
const DATA_DIR = path.join(__dirname, 'data'); // fallback
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'data.json');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);

function normalizeKey(key) {
  if (!key) return '';
  return key.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\s+/g, '') // remove spaces
    .replace(/[^a-z0-9]/g, ''); // remove special chars
}


function processAthlete(row, allAthletes, idCounter) {
  // Map common column names variations using normalized keys
  const mappedRow = {};
  for (const key in row) {
    mappedRow[normalizeKey(key)] = row[key];
  }
  
  // Extract info per user instructions
  // 1. Nome
  const nome = mappedRow.nome || mappedRow.nomecompleto || mappedRow.atleta || row['Nome'] || "";
  
  // 2. CPF (N˙mero do documento)
  const cpf = mappedRow.numerododocumento || mappedRow.cpf || mappedRow.documento || row['Nmero do documento'] || row['N˙mero do documento'] || "";
  
  // 3. Tamanho da camisa
  let camisa = mappedRow.tamanhodacamisa || mappedRow.camisa || mappedRow.tamanho || row['Tamanho da camisa'] || "";
  camisa = String(camisa).trim().toUpperCase();
  if (!camisa || camisa === "") {
    camisa = "NÃO";
  }

  // 4. Prova (Percurso)
  let provaRaw = mappedRow.percurso || mappedRow.prova || mappedRow.distancia || row['Percurso'] || "";
  provaRaw = String(provaRaw).trim().toLowerCase();
  let prova = "";
  
  if (provaRaw.includes("3km") || provaRaw.includes("3 km")) {
    prova = "3 km";
  } else if (provaRaw.includes("1km") || provaRaw.includes("1 km")) {
    prova = "1 km";
  } else if (provaRaw.includes("3k+1k") || provaRaw.includes("3k + 1k") || provaRaw.includes("todas")) {
    prova = "TODAS";
  } else if (provaRaw.includes("250m") || provaRaw.includes("kids") || provaRaw === "") {
    prova = "NENHUM";
  } else {
    // fallback if it's something else
    prova = String(provaRaw).toUpperCase();
  }

  // Telefone (not strictly requested to modify but we need it)
  const telefone = mappedRow.celular || mappedRow.telefone || mappedRow.whatsapp || row['Celular'] || "";

  if (nome && nome.trim() !== "") {
    const cpfLimpo = String(cpf).replace(/\D/g, '');
    allAthletes.push({
      id: null, // será atribuído após ordenação por CPF
      nome: String(nome).trim(),
      cpf: cpfLimpo,
      telefone: String(telefone).trim(),
      camisa: camisa,
      prova: prova,
      checkinRealizado: false,
      fotoUrl: null
    });
  }
  return idCounter;
}

function compileData() {
  let allAthletes = [];
  let idCounter = 1; // mantido por compatibilidade mas não é mais usado como ID
  
  // Folders to check
  const dirs = [LISTAS_DIR, DATA_DIR];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      console.log(`\nLendo arquivo: ${file}`);
      
      try {
        if (file.toLowerCase().endsWith('.csv')) {
          // Parse CSV with PapaParse which is better for ; separated and multiline
          const fileContent = fs.readFileSync(filePath, 'latin1'); // Use latin1 for ISO-8859-1 chars
          
          Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            delimiter: ";", // Force semicolon since it's common in BR Excel CSVs
            complete: function(results) {
              results.data.forEach(row => {
                idCounter = processAthlete(row, allAthletes, idCounter);
              });
            }
          });
        } else if (file.toLowerCase().endsWith('.xlsx') || file.toLowerCase().endsWith('.xls')) {
          // Use xlsx library for excel files
          const workbook = xlsx.readFile(filePath);
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const data = xlsx.utils.sheet_to_json(sheet);
          
          data.forEach(row => {
            idCounter = processAthlete(row, allAthletes, idCounter);
          });
        }
      } catch (e) {
        console.error(`Erro ao ler arquivo ${file}:`, e);
      }
    });
  });

  if (allAthletes.length === 0) {
    console.log("Nenhum atleta encontrado. Usando dados vazios.");
  } else {
    // Ordena por CPF (critério estável): garante que o mesmo atleta sempre
    // recebe o mesmo número, independente da ordem dos arquivos fonte.
    // Atletas sem CPF ficam no final, ordenados por nome.
    allAthletes.sort((a, b) => {
      const aCpf = a.cpf && a.cpf.length >= 6 ? a.cpf : 'z' + a.nome.toLowerCase();
      const bCpf = b.cpf && b.cpf.length >= 6 ? b.cpf : 'z' + b.nome.toLowerCase();
      return aCpf.localeCompare(bCpf);
    });

    // Atribui IDs sequenciais de 3 dígitos (1, 2, 3 ... até 999)
    allAthletes.forEach((a, i) => { a.id = i + 1; });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allAthletes, null, 2));
    console.log(`\n✅ Sucesso! ${allAthletes.length} atletas compilados em 'public/data.json'`);
    console.log(`   IDs de 1 a ${allAthletes.length} (máximo 3 dígitos).`);
  }
}

compileData();
