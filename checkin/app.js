// State Management
let athletes = [];
let currentAthlete = null;
let stream = null; // Camera stream

// DOM Elements - Dashboard
const dashboardTbody = document.getElementById('dashboard-tbody');
const statTotal = document.getElementById('stat-total');
const statChecked = document.getElementById('stat-checked');
const stat1km = document.getElementById('stat-1km');
const stat3km = document.getElementById('stat-3km');
const statTodas = document.getElementById('stat-todas');
const btnStartCheckin = document.getElementById('btn-start-checkin');
const dashboardSearch = document.getElementById('dashboard-search');

// DOM Elements - Search Modal
const modalSearch = document.getElementById('modal-search');
const searchInput = document.getElementById('checkin-search-input');
const searchResultsContainer = document.getElementById('search-results-container');

// DOM Elements - Checkout Modal
const btnStartCheckout = document.getElementById('btn-start-checkout');
const modalCheckoutSearch = document.getElementById('modal-checkout-search');
const checkoutSearchInput = document.getElementById('checkout-search-input');
const checkoutResultsContainer = document.getElementById('checkout-results-container');

// DOM Elements - Confirm Modal
const modalConfirm = document.getElementById('modal-confirm');
const confirmName = document.getElementById('confirm-name');
const confirmForm = document.getElementById('confirm-form');
const checkTelefone = document.getElementById('check-telefone');
const checkCamisa = document.getElementById('check-camisa');
const checkProva = document.getElementById('check-prova');
const valTelefone = document.getElementById('val-telefone');
const valCamisa = document.getElementById('val-camisa');
const valProva = document.getElementById('val-prova');
const corrTelefoneContainer = document.getElementById('corr-telefone-container');
const corrCamisaContainer = document.getElementById('corr-camisa-container');
const corrProvaContainer = document.getElementById('corr-prova-container');
const inputCorrTelefone = document.getElementById('corr-telefone');
const inputCorrCamisa = document.getElementById('corr-camisa');
const inputCorrProva = document.getElementById('corr-prova');

// DOM Elements - Camera Modal
const modalPhoto = document.getElementById('modal-photo');
const cameraFeed = document.getElementById('camera-feed');
const cameraCanvas = document.getElementById('camera-canvas');
const photoPreview = document.getElementById('photo-preview');
const btnCapture = document.getElementById('btn-capture');
const btnRetake = document.getElementById('btn-retake');
const btnFinish = document.getElementById('btn-finish');
const photoAthleteInfo = document.getElementById('photo-athlete-info');
const photoName = document.getElementById('photo-name');
const photoCamisa = document.getElementById('photo-camisa');
const photoProva = document.getElementById('photo-prova');
const photoBracelet = document.getElementById('photo-bracelet');
const photoNumber = document.getElementById('photo-number');
const checkKitProprio = document.getElementById('check-kit-proprio');
const corrKitContainer = document.getElementById('corr-kit-container');
const inputCorrKitPor = document.getElementById('corr-kit-por');

// DOM Elements - View Modal
const modalViewCheckin = document.getElementById('modal-view-checkin');
const viewName = document.getElementById('view-name');
const viewPhoto = document.getElementById('view-photo');
const viewNumero = document.getElementById('view-numero');
const viewTelefone = document.getElementById('view-telefone');
const viewCamisa = document.getElementById('view-camisa');
const viewProva = document.getElementById('view-prova');
const viewRetiradoPor = document.getElementById('view-retirado-por');

// Login Logic
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const btnLogin = document.getElementById('btn-login');
const loginUser = document.getElementById('login-user');
const loginPass = document.getElementById('login-pass');
const loginError = document.getElementById('login-error');

function checkAuth() {
  if (sessionStorage.getItem('tutubas_auth') === 'true') {
    loginScreen.style.display = 'none';
    appContainer.style.display = 'block';
    initApp();
  } else {
    loginScreen.style.display = 'flex';
    appContainer.style.display = 'none';
  }
}

btnLogin.addEventListener('click', () => {
  const user = loginUser.value.trim().toLowerCase();
  const pass = loginPass.value.trim();
  
  if (user === 'admin' && pass === 'tubaroes2026') {
    sessionStorage.setItem('tutubas_auth', 'true');
    loginError.style.display = 'none';
    checkAuth();
  } else {
    loginError.style.display = 'block';
  }
});

// Initialize App
async function initApp() {
  await loadData();
  renderDashboard();
  setupEventListeners();
}

// --- IndexedDB Wrapper for Large Data (Photos) ---
const DB_NAME = 'TutubasDB';
const STORE_NAME = 'athletesStore';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getLocalData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get('tutubas_athletes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalData(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(data, 'tutubas_athletes');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Load Data (Local Storage or fetch initial JSON)
async function loadData() {
  let localAthletes = [];
  try {
    const localData = await getLocalData();
    if (localData) {
      localAthletes = JSON.parse(localData);
    }
  } catch (e) {
    console.warn("IndexedDB not ready", e);
  }

  try {
    const response = await fetch('./data.json?t=' + new Date().getTime()); // Prevent cache
    if (response.ok) {
      const jsonAthletes = await response.json();
      
      // Se não tem nada localmente, usa tudo do JSON
      if (localAthletes.length === 0) {
        athletes = jsonAthletes;
        await saveData();
      } else {
        // Se já tem dados, funde os novos e ATUALIZA os existentes (sem perder check-in)
        const localCpfMap = new Map();
        localAthletes.forEach(a => localCpfMap.set(a.cpf, a));
        
        let changed = false;
        
        jsonAthletes.forEach(ja => {
          if (!localCpfMap.has(ja.cpf)) {
            localAthletes.push(ja);
            changed = true;
          } else {
            // Atualiza os dados do atleta existente caso a planilha tenha mudado
            const existing = localCpfMap.get(ja.cpf);
            if (existing.prova !== ja.prova || existing.camisa !== ja.camisa || existing.nome !== ja.nome) {
              existing.prova = ja.prova;
              existing.camisa = ja.camisa;
              existing.nome = ja.nome;
              changed = true;
            }
          }
        });
        
        athletes = localAthletes;
        if (changed) await saveData();
      }
    } else if (localAthletes.length > 0) {
      athletes = localAthletes;
    }
  } catch (error) {
    console.warn('Failed to load data.json', error);
    athletes = localAthletes;
  }
}

async function saveData() {
  await saveLocalData(JSON.stringify(athletes));
  
  // Sincroniza silenciosamente com o servidor principal na nuvem
  try {
    fetch('./data.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(athletes)
    }).catch(err => console.warn('Offline sync mode', err));
  } catch(e) {
    // Ignora erros se estiver offline
  }
}

// Format CPF for display
function formatCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length === 11) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return cpf;
}

// Perform Checkout
async function performCheckout(id) {
  const athlete = athletes.find(a => a.id === id);
  if (!athlete) return;
  
  if (confirm(`Confirmar o check-out (término da prova) para o atleta:\n#${athlete.id} - ${athlete.nome}?`)) {
    athlete.checkoutRealizado = true;
    await saveData();
    renderDashboard(dashboardSearch.value);
    closeModal(modalCheckoutSearch);
    showToast('Check-out realizado com sucesso!', 'success');
  }
}

// Render Dashboard
function renderDashboard(filterText = '') {
  const normalizedFilter = filterText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  
  let filtered = athletes;
  if (normalizedFilter) {
    filtered = athletes.filter(a => {
      const nomeSafe = a.nome ? String(a.nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "") : "";
      const cpfSafe = a.cpf ? String(a.cpf) : "";
      const nomeMatch = nomeSafe.includes(normalizedFilter);
      const cpfSearchTerm = normalizedFilter.replace(/\D/g, '');
      const cpfMatch = cpfSearchTerm !== '' ? cpfSafe.includes(cpfSearchTerm) : false;
      return nomeMatch || cpfMatch;
    });
  }

  dashboardTbody.innerHTML = '';
  
  filtered.forEach(a => {
    const tr = document.createElement('tr');
    let statusClass = 'status-pending';
    let statusText = 'Pendente';
    
    if (a.checkoutRealizado) {
      statusClass = 'checkout';
      statusText = 'Check-out Finalizado';
    } else if (a.checkinRealizado) {
      statusClass = 'status-done';
      statusText = 'Realizado';
    }
    
    tr.innerHTML = `
      <td data-label="ID">#${a.id}</td>
      <td data-label="Nome Completo"><strong>${a.nome}</strong></td>
      <td data-label="CPF">${formatCPF(a.cpf)}</td>
      <td data-label="Prova">${a.prova || '-'}</td>
      <td data-label="Status"><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td data-label="Ações">
        ${a.checkinRealizado 
          ? `<button class="success-btn btn-view-checkin" style="padding: 6px 12px; font-size: 0.8rem; background-color: var(--success-color);" data-id="${a.id}">Ok</button>`
          : `<button class="primary-btn btn-do-checkin" style="padding: 6px 12px; font-size: 0.8rem;" data-id="${a.id}">Check-in</button>`
        }
      </td>
    `;
    dashboardTbody.appendChild(tr);
  });

  // Update Stats
  statTotal.innerText = athletes.length;
  statChecked.innerText = athletes.filter(a => a.checkinRealizado).length;
  stat1km.innerText = athletes.filter(a => a.prova && a.prova.includes('1 km')).length;
  stat3km.innerText = athletes.filter(a => a.prova && a.prova.includes('3 km')).length;
  statTodas.innerText = athletes.filter(a => a.prova && a.prova.toUpperCase() === 'TODAS').length;

  // Add listeners to new buttons
  document.querySelectorAll('.btn-do-checkin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.getAttribute('data-id'));
      startCheckinForAthlete(id);
    });
  });

  document.querySelectorAll('.btn-view-checkin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.getAttribute('data-id'));
      viewCheckin(id);
    });
  });
}

// Setup Listeners
function setupEventListeners() {
  // Search on dashboard
  dashboardSearch.addEventListener('input', (e) => {
    renderDashboard(e.target.value);
  });

  // Open Search Modal
  btnStartCheckin.addEventListener('click', () => {
    openModal(modalSearch);
    searchInput.value = '';
    searchResultsContainer.innerHTML = '';
    setTimeout(() => searchInput.focus(), 100);
  });

  // Open Checkout Modal
  if (btnStartCheckout) {
    btnStartCheckout.addEventListener('click', () => {
      openModal(modalCheckoutSearch);
      checkoutSearchInput.value = '';
      checkoutResultsContainer.innerHTML = '';
      setTimeout(() => checkoutSearchInput.focus(), 100);
    });
  }

  // Search logic for Checkout
  if (checkoutSearchInput) {
    checkoutSearchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length < 1) {
        checkoutResultsContainer.innerHTML = '';
        return;
      }
      
      // Search strictly by ID
      const filtered = athletes.filter(a => String(a.id) === val);
      
      checkoutResultsContainer.innerHTML = '';
      if (filtered.length === 0) {
        checkoutResultsContainer.innerHTML = '<div class="no-results">Nenhum atleta encontrado com este ID.</div>';
        return;
      }
      
      filtered.forEach(a => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        
        let actionBtn = '';
        if (a.checkoutRealizado) {
          actionBtn = `<span class="status-badge checkout">Check-out Finalizado</span>`;
        } else if (!a.checkinRealizado) {
          actionBtn = `<span class="status-badge status-pending">Sem Check-in</span>`;
        } else {
          actionBtn = `<button class="checkout-btn" data-id="${a.id}" style="padding: 6px 12px; font-size: 0.9rem;">Fazer Check-out</button>`;
        }

        div.innerHTML = `
          <div class="result-info">
            <strong>#${a.id} - ${a.nome}</strong>
            <span>${a.prova || ''}</span>
          </div>
          ${actionBtn}
        `;
        checkoutResultsContainer.appendChild(div);
      });

      checkoutResultsContainer.querySelectorAll('.checkout-btn').forEach(btn => {
        btn.addEventListener('click', async (evt) => {
          const id = parseInt(evt.target.getAttribute('data-id'));
          await performCheckout(id);
        });
      });
    });
  }

  // Close Modals
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = e.target.getAttribute('data-close');
      closeModal(document.getElementById(modalId));
    });
  });

  // Live search in modal
  searchInput.addEventListener('input', (e) => {
    renderSearchResults(e.target.value);
  });

  // Checkbox interactions
  setupCheckboxInteraction(checkTelefone, corrTelefoneContainer, inputCorrTelefone, valTelefone);
  setupCheckboxInteraction(checkCamisa, corrCamisaContainer, inputCorrCamisa, valCamisa);
  setupCheckboxInteraction(checkProva, corrProvaContainer, inputCorrProva, valProva);

  // Kit Retrieval Checkbox
  checkKitProprio.addEventListener('change', (e) => {
    if (e.target.checked) {
      corrKitContainer.classList.remove('active');
    } else {
      corrKitContainer.classList.add('active');
      setTimeout(() => inputCorrKitPor.focus(), 100);
    }
  });

  // Confirm Form Submit
  confirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    proceedToCamera();
  });

  // Camera Buttons
  btnCapture.addEventListener('click', takePhoto);
  btnRetake.addEventListener('click', retakePhoto);
  btnFinish.addEventListener('click', finalizeCheckin);
}

function setupCheckboxInteraction(checkbox, container, input, valDisplay) {
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      container.classList.remove('active');
    } else {
      container.classList.add('active');
      input.value = valDisplay.innerText; // Pre-fill with current text
      setTimeout(() => input.focus(), 100);
    }
  });
}

// Modal Helpers
function openModal(modal) {
  modal.classList.add('active');
}

function closeModal(modal) {
  modal.classList.remove('active');
  if (modal.id === 'modal-photo') stopCamera();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Check-in Flow Step 1: Search Modal
function renderSearchResults(filterText) {
  if (!filterText.trim()) {
    searchResultsContainer.innerHTML = '';
    return;
  }

  const normalizedFilter = filterText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  
  const results = athletes.filter(a => {
    if (a.checkinRealizado) return false; // Only show pending
    const nomeSafe = a.nome ? String(a.nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "") : "";
    const cpfSafe = a.cpf ? String(a.cpf) : "";
    const nomeMatch = nomeSafe.includes(normalizedFilter);
    const cpfSearchTerm = normalizedFilter.replace(/\D/g, '');
    const cpfMatch = cpfSearchTerm !== '' ? cpfSafe.includes(cpfSearchTerm) : false;
    return nomeMatch || cpfMatch;
  }).slice(0, 10); // Limit to 10

  searchResultsContainer.innerHTML = '';
  
  if (results.length === 0) {
    searchResultsContainer.innerHTML = '<div style="padding: 10px; color: #888; text-align: center;">Nenhum atleta pendente encontrado.</div>';
    return;
  }

  results.forEach(a => {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.innerHTML = `
      <div class="search-item-info">
        <strong>${a.nome}</strong>
        <span>CPF: ${formatCPF(a.cpf)} | Prova: ${a.prova || '-'}</span>
      </div>
      <button class="primary-btn" style="padding: 8px 16px; font-size: 0.9rem;">Selecionar</button>
    `;
    div.addEventListener('click', () => startCheckinForAthlete(a.id));
    searchResultsContainer.appendChild(div);
  });
}

// Check-in Flow Step 2: Confirm Data
function startCheckinForAthlete(id) {
  currentAthlete = athletes.find(a => a.id === id);
  if (!currentAthlete) return;

  closeModal(modalSearch);
  
  // Reset form
  checkTelefone.checked = true;
  checkCamisa.checked = true;
  checkProva.checked = true;
  corrTelefoneContainer.classList.remove('active');
  corrCamisaContainer.classList.remove('active');
  corrProvaContainer.classList.remove('active');

  // Fill data
  confirmName.innerText = currentAthlete.nome;
  valTelefone.innerText = currentAthlete.telefone || '(Não informado)';
  valCamisa.innerText = currentAthlete.camisa || '-';
  valProva.innerText = currentAthlete.prova || '-';

  openModal(modalConfirm);
}

// Check-in Flow Step 3: Camera
function proceedToCamera() {
  // Update athlete data with corrections if needed
  if (!checkTelefone.checked) currentAthlete.telefone = inputCorrTelefone.value;
  if (!checkCamisa.checked) currentAthlete.camisa = inputCorrCamisa.value;
  if (!checkProva.checked) currentAthlete.prova = inputCorrProva.value;

  // Set Info on Photo Modal
  photoAthleteInfo.style.display = 'block';
  photoName.innerText = currentAthlete.nome;
  photoCamisa.innerText = currentAthlete.camisa || '-';
  photoProva.innerText = currentAthlete.prova || '-';
  
  // Utiliza o ID que está na lista de atletas
  currentAthlete.numeroInscricao = currentAthlete.id;
  photoNumber.innerText = currentAthlete.numeroInscricao;
  
  // Reset Kit Retrieval
  checkKitProprio.checked = true;
  corrKitContainer.classList.remove('active');
  inputCorrKitPor.value = '';
  
  // Bracelet Color Logic
  let braceletColor = '#e5e5ea'; // default / NENHUM
  const prova = String(currentAthlete.prova).toUpperCase();
  if (prova.includes('1 KM')) {
    braceletColor = '#34c759'; // Verde
  } else if (prova.includes('3 KM')) {
    braceletColor = '#007aff'; // Azul
  } else if (prova.includes('TODAS')) {
    braceletColor = '#ff9500'; // Laranja
  }
  photoBracelet.style.backgroundColor = braceletColor;

  closeModal(modalConfirm);
  openModal(modalPhoto);
  startCamera();
}

async function startCamera() {
  cameraFeed.style.display = 'block';
  photoPreview.style.display = 'none';
  btnCapture.style.display = 'inline-flex';
  btnRetake.style.display = 'none';
  btnFinish.style.display = 'none';

  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' }, 
      audio: false 
    });
    cameraFeed.srcObject = stream;
  } catch (err) {
    console.error("Erro ao acessar câmera:", err);
    alert("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
    // Fallback: Finalizar sem foto
    btnCapture.style.display = 'none';
    btnFinish.style.display = 'inline-flex';
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

function takePhoto() {
  cameraCanvas.width = cameraFeed.videoWidth;
  cameraCanvas.height = cameraFeed.videoHeight;
  const ctx = cameraCanvas.getContext('2d');
  ctx.drawImage(cameraFeed, 0, 0, cameraCanvas.width, cameraCanvas.height);
  
  const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.8);
  photoPreview.src = dataUrl;
  
  cameraFeed.style.display = 'none';
  photoPreview.style.display = 'block';
  
  btnCapture.style.display = 'none';
  btnRetake.style.display = 'inline-flex';
  btnFinish.style.display = 'inline-flex';

  // Save to current athlete
  currentAthlete.fotoUrl = dataUrl;
}

function retakePhoto() {
  cameraFeed.style.display = 'block';
  photoPreview.style.display = 'none';
  
  btnCapture.style.display = 'inline-flex';
  btnRetake.style.display = 'none';
  btnFinish.style.display = 'none';
}

async function uploadPhotoToServer(athlete) {
  if (!athlete.fotoUrl) return;
  
  try {
    const payload = {
      id: athlete.numeroInscricao || athlete.id,
      image: athlete.fotoUrl
    };

    const response = await fetch('./upload.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      athlete.fotoSincronizada = true;
      console.log(`Foto do atleta #${athlete.numeroInscricao} sincronizada com sucesso.`);
    } else {
      console.error(`Falha ao sincronizar foto do atleta #${athlete.numeroInscricao}`);
    }
  } catch (err) {
    console.error(`Erro de conexão ao sincronizar foto:`, err);
  }
}

async function finalizeCheckin() {
  currentAthlete.checkinRealizado = true;
  
  // Save Kit retrieval info
  if (!checkKitProprio.checked && inputCorrKitPor.value.trim() !== '') {
    currentAthlete.retiradoPor = inputCorrKitPor.value.trim();
  } else {
    currentAthlete.retiradoPor = "O próprio atleta";
  }

  // Enviar a foto para o servidor silenciosamente (background)
  uploadPhotoToServer(currentAthlete).then(() => {
    // Salva novamente para atualizar o status de 'fotoSincronizada' se mudou
    saveData();
  });

  await saveData();
  renderDashboard(dashboardSearch.value);
  
  closeModal(modalPhoto);
  showToast('✅ Check-in realizado com sucesso!');
  currentAthlete = null;
}

// Check-in Flow Step 4: View Check-in details
function viewCheckin(id) {
  const athlete = athletes.find(a => a.id === id);
  if (!athlete) return;
  
  viewName.innerText = athlete.nome;
  viewNumero.innerText = athlete.numeroInscricao || athlete.id;
  viewTelefone.innerText = athlete.telefone || '-';
  viewCamisa.innerText = athlete.camisa || '-';
  viewProva.innerText = athlete.prova || '-';
  viewRetiradoPor.innerText = athlete.retiradoPor || 'O próprio atleta';
  
  if (athlete.fotoUrl) {
    viewPhoto.src = athlete.fotoUrl;
    viewPhoto.style.display = 'block';
  } else {
    viewPhoto.src = '';
    viewPhoto.style.display = 'none';
  }
  
  openModal(modalViewCheckin);
}

// Start
document.addEventListener('DOMContentLoaded', checkAuth);
