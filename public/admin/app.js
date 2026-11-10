const API_URL = '/api';

// ── Mobile Sidebar ────────────────────────────────────────────
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn     = document.getElementById('hamburger-btn');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active', isOpen);
    if (btn) btn.innerHTML = isOpen ? '<i class="ri-close-line"></i>' : '<i class="ri-menu-line"></i>';
};

window.closeSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn     = document.getElementById('hamburger-btn');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    if (btn) btn.innerHTML = '<i class="ri-menu-line"></i>';
};

// ── Global State ──────────────────────────────────────────────
let currentAthletes = [];
let videoStream = null;

// ── Auth Check on Load ────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.nav-links li').forEach(link => {
        link.addEventListener('click', () => { if (window.innerWidth <= 768) window.closeSidebar(); });
    });

    try {
        const res = await fetch('/auth/me', { credentials: 'include' });
        if (!res.ok) { window.location.href = '/admin/login.html'; return; }
        const me = await res.json();

        document.getElementById('user-info').textContent = `👤 ${me.username}`;

        // Show users tab only for master admin
        if (me.isMaster) {
            document.getElementById('nav-users').style.display = '';
        }

        // Logout button
        document.getElementById('btn-logout').addEventListener('click', async () => {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
            window.location.href = '/admin/login.html';
        });

        // Set default date in date inputs
        const today = new Date().toISOString().split('T')[0];
        document.querySelectorAll('input[type="date"]').forEach(el => el.value = today);

        // Init Dashboard
        loadDashboard();

        // Setup Event Listeners
        setupEventListeners();

    } catch (e) {
        window.location.href = '/admin/login.html';
    }
});

// Formatters
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

const formatCpf = (cpf) => {
    const clean = String(cpf || '').replace(/\D/g, '');
    if (clean.length !== 11) return cpf || '—';
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

const formatPhone = (phone) => {
    const clean = String(phone || '').replace(/\D/g, '');
    if (clean.length === 11) return clean.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return phone || '—';
};

const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
        const [datePart, timePart] = dateStr.split(' ');
        const [y, m, d] = datePart.split('-');
        if (!y || !m || !d) return dateStr;
        return timePart ? `${d}/${m}/${y} ${timePart.slice(0, 5)}` : `${d}/${m}/${y}`;
    } catch {
        return dateStr;
    }
};

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-links li').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        document.getElementById('page-title').textContent = link.textContent.trim();
        document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));

        const target = link.getAttribute('data-target');
        const targetSection = document.getElementById(target);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            loadSectionData(target);
        }
    });
});

function loadSectionData(section) {
    // Stop camera stream if moving away from checkin
    if (section !== 'checkin' && videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    if (section === 'dashboard') loadDashboard();
    else if (section === 'athletes') loadAthletes();
    else if (section === 'checkin') loadCheckinStation();
    else if (section === 'assessorias') { loadAssessorias(); loadCoupons(); }
    else if (section === 'store') loadStoreProducts();
    else if (section === 'costs') loadCosts();
    else if (section === 'sponsors') loadSponsors();
    else if (section === 'users') loadUsers();
}

// ── Fetch Wrappers ────────────────────────────────────────────
async function fetchData(endpoint) {
    const res = await fetch(`${API_URL}/${endpoint}`, { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/admin/login.html'; return null; }
    return res.json();
}

async function postData(endpoint, data) {
    const res = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    });
    return res.json();
}

async function putData(endpoint, data) {
    const res = await fetch(`${API_URL}/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    });
    return res.json();
}

async function deleteData(endpoint, id) {
    const res = await fetch(`${API_URL}/${endpoint}/${id}`, { method: 'DELETE', credentials: 'include' });
    return res.json();
}

// ═══════════════════════════════════════════════════════════════
// 1. DASHBOARD & FINANCEIRO INTEGRADO
// ═══════════════════════════════════════════════════════════════
async function loadDashboard() {
    const data = await fetchData('summary');
    if (!data) return;

    // Top Cards
    document.getElementById('total-income').textContent = formatCurrency(data.total_income);
    document.getElementById('stat-pix-amount').textContent = formatCurrency(data.athletes.pix_amount);
    document.getElementById('stat-pix-count').textContent = `${data.athletes.pix_count} atleta(s) confirmados`;

    document.getElementById('stat-card-amount').textContent = formatCurrency(data.athletes.card_amount);
    document.getElementById('stat-card-count').textContent = `${data.athletes.card_count} atleta(s) confirmados`;

    const totalBalance = data.total_balance;
    const balanceEl = document.getElementById('total-balance');
    balanceEl.textContent = formatCurrency(totalBalance);
    balanceEl.style.color = totalBalance >= 0 ? '#38bdf8' : '#ef4444';

    // Secondary KPIs
    document.getElementById('stat-pending-amount').textContent = formatCurrency(data.athletes.pending_amount);
    document.getElementById('stat-pending-count').textContent = `${data.athletes.pending_count} aguardando pagamento`;

    document.getElementById('stat-checkin-count').textContent = `${data.athletes.checkin_count} atletas`;
    const checkinRatio = data.athletes.confirmed_count > 0 
        ? Math.round((data.athletes.checkin_count / data.athletes.confirmed_count) * 100) 
        : 0;
    document.getElementById('stat-checkin-ratio').textContent = `${checkinRatio}% dos confirmados`;

    document.getElementById('total-expenses').textContent = formatCurrency(data.total_expenses);
    document.getElementById('stat-costs-detail').textContent = `${formatCurrency(data.costs.event_costs)} em despesas`;
    document.getElementById('stat-sponsors-amount').textContent = formatCurrency(data.sponsors.total_amount);

    // Categories breakdown
    const catList = document.getElementById('categories-breakdown');
    catList.innerHTML = '';
    const categories = data.athletes.categories || {};
    const catKeys = Object.keys(categories);

    if (catKeys.length === 0) {
        catList.innerHTML = '<li style="color:var(--text-secondary); text-align:center;">Nenhuma inscrição realizada ainda.</li>';
    } else {
        catKeys.forEach(catName => {
            const item = categories[catName];
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <strong>${catName}</strong><br>
                    <small style="color:var(--text-secondary);">${item.confirmed} confirmados de ${item.total} inscritos</small>
                </div>
                <strong style="color:var(--gold);">${formatCurrency(item.revenue)}</strong>
            `;
            catList.appendChild(li);
        });
    }

    // General Summary
    document.getElementById('fb-confirmed').textContent = formatCurrency(data.athletes.confirmed_amount);
    document.getElementById('fb-pix').textContent = formatCurrency(data.athletes.pix_amount);
    document.getElementById('fb-card').textContent = formatCurrency(data.athletes.card_amount);
    document.getElementById('fb-sponsors').textContent = formatCurrency(data.sponsors.total_amount);
    document.getElementById('fb-expenses').textContent = `- ${formatCurrency(data.total_expenses)}`;
    document.getElementById('fb-balance').textContent = formatCurrency(data.total_balance);
}


// ═══════════════════════════════════════════════════════════════
// 2. GESTÃO DE ATLETAS INSCRITOS
// ═══════════════════════════════════════════════════════════════
async function loadAthletes() {
    const search = document.getElementById('athletes-search').value.trim();
    const status = document.getElementById('filter-athlete-status').value;
    const checkin = document.getElementById('filter-athlete-checkin').value;

    let query = `athletes?search=${encodeURIComponent(search)}&status=${status}&checkin=${checkin}`;
    const athletes = await fetchData(query);
    if (!athletes) return;

    currentAthletes = athletes;
    document.getElementById('athletes-count-total').textContent = athletes.length;

    const tbody = document.getElementById('table-athletes');
    tbody.innerHTML = '';

    if (athletes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum atleta encontrado com os filtros atuais.</td></tr>`;
        return;
    }

    athletes.forEach(a => {
        const tr = document.createElement('tr');
        
        // Status Badge
        const isConfirmed = a.payment_status === 'Confirmado';
        const statusBadge = isConfirmed
            ? `<span class="badge-status confirmed"><i class="ri-checkbox-circle-fill"></i> ${a.payment_method || 'Pago'}</span>`
            : `<span class="badge-status pending"><i class="ri-time-line"></i> Pendente</span>`;

        // Checkin Badge
        const checkinBadge = a.checkin_status === 1
            ? `<span class="badge-checkin-ok"><i class="ri-check-line"></i> Realizado</span>`
            : `<span class="badge-checkin-no">Não</span>`;

        tr.innerHTML = `
            <td>#${a.id}</td>
            <td>
                <button type="button" class="athlete-name-btn" onclick="openAthleteModal(${a.id})" title="Clique para abrir todos os dados e confirmar pagamento">
                    <i class="ri-eye-line"></i> <span>${a.name}</span>
                </button>
            </td>
            <td>${formatCpf(a.cpf)}</td>
            <td>
                <div>${a.category}</div>
                ${a.assessoria_name ? `<small style="color:#38bdf8;">(${a.assessoria_name})</small>` : ''}
            </td>
            <td><strong style="color: #fbbf24;">${a.tshirt_size || '—'}</strong></td>
            <td><strong>${formatCurrency(a.price)}</strong></td>
            <td>${statusBadge}</td>
            <td>${checkinBadge}</td>
            <td>
                <div style="display:flex; gap: 6px;">
                    <button type="button" class="btn btn-primary" onclick="openAthleteModal(${a.id})" style="padding: 4px 8px; font-size: 0.8rem;" title="Ver ficha e opções de pagamento">
                        <i class="ri-folder-user-line"></i> Ficha
                    </button>
                    <button type="button" class="btn-icon btn-danger" onclick="deleteAthleteHandler(${a.id})" title="Excluir atleta">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Open Athlete Full View & Payment Confirmation Modal
async function openAthleteModal(athleteId) {
    const a = await fetchData(`athletes/${athleteId}`);
    if (!a) return;

    const isConfirmed = a.payment_status === 'Confirmado';

    let storeItems = [];
    try {
        if (a.store_items) {
            storeItems = typeof a.store_items === 'string' ? JSON.parse(a.store_items) : a.store_items;
        }
    } catch (e) {
        storeItems = [];
    }

    const totalToPay = (parseFloat(a.total_amount) > 0 ? parseFloat(a.total_amount) : (parseFloat(a.price) || 0));

    const modalHTML = `
        <div class="athlete-modal-container">
            <div class="athlete-modal-header">
                <div>
                    <h2 style="font-size: 1.4rem; color: #fff; margin-bottom: 2px;">${a.name}</h2>
                    <span style="font-size: 0.85rem; color: var(--text-secondary);">ID #${a.id} • Inscrito em ${formatDate(a.created_at)}</span>
                </div>
                <div>
                    ${isConfirmed 
                        ? `<span class="badge-status confirmed" style="font-size:0.9rem; padding: 6px 14px;"><i class="ri-checkbox-circle-fill"></i> PAGO VIA ${a.payment_method ? a.payment_method.toUpperCase() : 'CONFIRMADO'}</span>`
                        : `<span class="badge-status pending" style="font-size:0.9rem; padding: 6px 14px;"><i class="ri-time-line"></i> PAGAMENTO PENDENTE</span>`
                    }
                </div>
            </div>

            <div class="athlete-info-grid">
                <div class="info-field">
                    <label>CPF</label>
                    <div class="val">${formatCpf(a.cpf)}</div>
                </div>
                <div class="info-field">
                    <label>WhatsApp / Celular</label>
                    <div class="val">
                        <a href="https://wa.me/55${String(a.phone).replace(/\D/g, '')}" target="_blank" style="color: #34d399; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                            <i class="ri-whatsapp-line"></i> ${formatPhone(a.phone)}
                        </a>
                    </div>
                </div>
                <div class="info-field">
                    <label>E-mail</label>
                    <div class="val">${a.email}</div>
                </div>
                <div class="info-field">
                    <label>Nascimento / Gênero</label>
                    <div class="val">${formatDate(a.birth_date)} (${a.gender || 'Não informado'})</div>
                </div>
                <div class="info-field">
                    <label>Modalidade de Prova</label>
                    <div class="val" style="color: #38bdf8;">${a.category}</div>
                </div>
                <div class="info-field">
                    <label>Tamanho da Camisa</label>
                    <div class="val" style="color: var(--gold); font-size: 1.05rem;">${a.tshirt_size || '—'}</div>
                </div>
                ${a.assessoria_name ? `
                <div class="info-field">
                    <label>Assessoria Esportiva</label>
                    <div class="val">${a.assessoria_name} ${a.coupon_code ? `(Cupom: <strong>${a.coupon_code}</strong>)` : ''}</div>
                </div>` : ''}
                <div class="info-field">
                    <label>Valor Inscrição / Total</label>
                    <div class="val" style="color: var(--gold); font-size: 1.25rem; font-weight: 800;">${formatCurrency(totalToPay)}</div>
                    ${parseFloat(a.store_amount) > 0 ? `<small style="color: var(--text-secondary); font-size: 0.78rem;">(Inscrição: ${formatCurrency(a.price)} + Loja: ${formatCurrency(a.store_amount)})</small>` : ''}
                </div>
                <div class="info-field">
                    <label>Contato de Emergência</label>
                    <div class="val">${a.emergency_contact_name || '—'} ${a.emergency_contact_phone ? `(${formatPhone(a.emergency_contact_phone)})` : ''}</div>
                </div>
                <div class="info-field">
                    <label>Check-in da Prova</label>
                    <div class="val">${a.checkin_status === 1 ? `<span style="color:#38bdf8;">✓ Realizado (${formatDate(a.checkin_date)})</span>` : 'Pendente (kit ainda não retirado)'}</div>
                </div>
                ${storeItems && storeItems.length > 0 ? `
                <div class="info-field" style="grid-column: 1 / -1; background: rgba(2, 132, 199, 0.08); padding: 12px; border-radius: 8px; border: 1px solid rgba(2, 132, 199, 0.25);">
                    <label style="color: #38bdf8;"><i class="ri-shopping-bag-3-fill"></i> Produtos Extras Comprados na Loja (${storeItems.length})</label>
                    <div class="val" style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                        ${storeItems.map(it => `
                            <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                                <span>• <strong>${it.quantity}x</strong> ${it.name}</span>
                                <span style="color: var(--gold);">${formatCurrency(it.subtotal || (it.unit_price * it.quantity))}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
                ${a.medical_notes ? `
                <div class="info-field" style="grid-column: 1 / -1;">
                    <label>Observações Médicas / Alergias</label>
                    <div class="val" style="color: #fca5a5; font-size: 0.9rem;">${a.medical_notes}</div>
                </div>` : ''}
            </div>

            <!-- PAYMENT CONFIRMATION SECTION -->
            <div style="margin-top: 5px;">
                ${!isConfirmed ? `
                    <div class="payment-action-box">
                        <h4 style="color: #fbbf24; font-size: 1.1rem; margin-bottom: 6px;">
                            <i class="ri-secure-payment-line"></i> Confirmar Pagamento do Atleta
                        </h4>
                        <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 1rem;">
                            Ao confirmar o pagamento, a inscrição será validada e o valor total de <strong>${formatCurrency(totalToPay)}</strong> será contabilizado imediatamente no financeiro do evento.
                        </p>
                        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                            <button type="button" class="btn btn-pix" onclick="confirmPaymentHandler(${a.id}, 'Pix', ${totalToPay})" style="padding: 12px 24px; font-size: 1rem;">
                                <i class="ri-qr-code-line"></i> Confirmar via PIX (${formatCurrency(totalToPay)})
                            </button>
                            <button type="button" class="btn btn-card" onclick="confirmPaymentHandler(${a.id}, 'Cartão', ${totalToPay})" style="padding: 12px 24px; font-size: 1rem;">
                                <i class="ri-bank-card-line"></i> Confirmar via CARTÃO (${formatCurrency(totalToPay)})
                            </button>
                        </div>
                    </div>
                ` : `
                    <div class="payment-confirmed-box">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #34d399; font-weight: 800; font-size: 1.1rem; margin-bottom: 4px;">
                            <i class="ri-checkbox-circle-fill" style="font-size: 1.4rem;"></i> Pagamento Confirmado via ${a.payment_method ? a.payment_method.toUpperCase() : 'SISTEMA'}
                        </div>
                        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 12px;">
                            Confirmado em ${formatDate(a.payment_date)} ${a.confirmed_by ? `por <strong>${a.confirmed_by}</strong>` : ''} • Total: <strong>${formatCurrency(totalToPay)}</strong>.
                        </p>
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button type="button" class="btn" onclick="cancelPaymentHandler(${a.id})" style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem;">
                                <i class="ri-close-circle-line"></i> Reverter para Pendente
                            </button>
                            <button type="button" class="btn btn-primary" onclick="goToAthleteCheckin(${a.id})" style="padding: 8px 18px; font-size: 0.85rem;">
                                <i class="ri-qr-scan-line"></i> Fazer Check-in Agora
                            </button>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;

    createModal(`Ficha da Inscrição #${a.id}`, modalHTML, null, false);
}

// Confirm Payment Action
window.confirmPaymentHandler = async function(athleteId, method, price) {
    if (!confirm(`Confirma o recebimento de ${formatCurrency(price)} via ${method} para este atleta?`)) return;

    try {
        const res = await putData(`athletes/${athleteId}/confirm-payment`, {
            payment_method: method,
            price: price
        });

        if (res.error) {
            alert(`Erro: ${res.error}`);
            return;
        }

        // Close modal
        closeActiveModal();

        // Refresh views
        loadAthletes();
        loadDashboard();

        alert(`✓ Pagamento via ${method} confirmado com sucesso! Valor contabilizado no Financeiro.`);
    } catch (err) {
        alert('Erro ao confirmar pagamento: ' + err.message);
    }
};

// Cancel Payment Action
window.cancelPaymentHandler = async function(athleteId) {
    if (!confirm('Deseja realmente reverter este pagamento para Pendente? O valor será removido do total financeiro arrecadado.')) return;

    try {
        await putData(`athletes/${athleteId}/cancel-payment`, {});
        closeActiveModal();
        loadAthletes();
        loadDashboard();
    } catch (err) {
        alert('Erro ao cancelar pagamento: ' + err.message);
    }
};

// Delete Athlete Action
window.deleteAthleteHandler = async function(athleteId) {
    if (!confirm('Tem certeza de que deseja excluir permanentemente a inscrição deste atleta?')) return;

    try {
        await deleteData('athletes', athleteId);
        loadAthletes();
        loadDashboard();
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
};

// Go to check-in
window.goToAthleteCheckin = function(athleteId) {
    closeActiveModal();
    // Switch to check-in tab
    const tabCheckin = document.querySelector('.nav-links li[data-target="checkin"]');
    if (tabCheckin) tabCheckin.click();

    setTimeout(() => {
        selectAthleteForCheckin(athleteId);
    }, 200);
};


// ═══════════════════════════════════════════════════════════════
// 3. CHECK-IN INTEGRADO DOS ATLETAS
// ═══════════════════════════════════════════════════════════════
async function loadCheckinStation() {
    const summary = await fetchData('summary');
    if (summary && summary.athletes) {
        document.getElementById('ci-total').textContent = summary.athletes.total_count;
        document.getElementById('ci-confirmed').textContent = summary.athletes.confirmed_count;
        document.getElementById('ci-done').textContent = summary.athletes.checkin_count;
        document.getElementById('ci-pending').textContent = Math.max(0, summary.athletes.confirmed_count - summary.athletes.checkin_count);
    }

    loadCheckinTable();
}

async function loadCheckinTable() {
    const checkedAthletes = await fetchData('athletes?checkin=1');
    if (!checkedAthletes) return;

    document.getElementById('count-checkedin-table').textContent = checkedAthletes.length;
    const tbody = document.getElementById('table-checkins-history');
    tbody.innerHTML = '';

    if (checkedAthletes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum check-in realizado ainda hoje.</td></tr>`;
        return;
    }

    checkedAthletes.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${a.id}</td>
            <td><strong>${a.name}</strong></td>
            <td>${formatCpf(a.cpf)}</td>
            <td>${a.category}</td>
            <td><span class="badge-status" style="background: rgba(2, 132, 199, 0.2); color:#38bdf8;">${a.tshirt_size || 'M'}</span></td>
            <td><strong style="color:var(--gold);">${a.cap_number || '—'}</strong></td>
            <td>${a.kit_retrieved_by || 'Próprio atleta'}</td>
            <td>${formatDate(a.checkin_date)}</td>
            <td>
                ${a.checkin_photo ? `
                    <button type="button" class="btn" onclick="viewPhotoModal('${a.checkin_photo}', '${a.name}')" style="padding: 4px 8px; font-size: 0.8rem; background: rgba(255,255,255,0.08);">
                        <i class="ri-image-line"></i> Ver Foto
                    </button>
                ` : '<span style="color:var(--text-secondary); font-size:0.8rem;">Sem foto</span>'}
            </td>
            <td>
                <button type="button" class="btn" onclick="undoCheckinHandler(${a.id})" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3);">
                    Desfazer
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Live Search for Checkin
const checkinInput = document.getElementById('checkin-quick-search');
const suggestionsBox = document.getElementById('checkin-suggestions');

checkinInput.addEventListener('input', async (e) => {
    const term = e.target.value.trim();
    if (term.length < 2) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const athletes = await fetchData(`athletes?search=${encodeURIComponent(term)}`);
    if (!athletes || athletes.length === 0) {
        suggestionsBox.innerHTML = '<div style="padding: 12px; color: var(--text-secondary); text-align: center;">Nenhum atleta encontrado</div>';
        suggestionsBox.style.display = 'block';
        return;
    }

    suggestionsBox.innerHTML = '';
    athletes.slice(0, 8).forEach(a => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
        item.innerHTML = `
            <div>
                <strong style="color: #fff;">${a.name}</strong> <span style="font-size:0.85rem; color:var(--text-secondary);">(${formatCpf(a.cpf)})</span>
                <div style="font-size: 0.8rem; color: #38bdf8;">${a.category} • Camisa: ${a.tshirt_size || 'M'}</div>
            </div>
            <div>
                ${a.payment_status === 'Confirmado' 
                    ? `<span class="badge-status confirmed" style="font-size:0.75rem;">Pago (${a.payment_method})</span>`
                    : `<span class="badge-status pending" style="font-size:0.75rem;">Pendente</span>`
                }
                ${a.checkin_status === 1 ? `<span class="badge-checkin-ok" style="margin-left: 5px;">Check-in OK</span>` : ''}
            </div>
        `;
        item.onmouseenter = () => item.style.background = 'rgba(2, 132, 199, 0.15)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => {
            suggestionsBox.style.display = 'none';
            checkinInput.value = '';
            selectAthleteForCheckin(a.id);
        };
        suggestionsBox.appendChild(item);
    });
    suggestionsBox.style.display = 'block';
});

// Select Athlete into the Checkin Workspace
async function selectAthleteForCheckin(athleteId) {
    const a = await fetchData(`athletes/${athleteId}`);
    if (!a) return;

    const workspace = document.getElementById('checkin-workspace');
    workspace.style.display = 'block';

    const isConfirmed = a.payment_status === 'Confirmado';
    const isChecked = a.checkin_status === 1;

    workspace.innerHTML = `
        <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--border-glass);">
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 1.25rem;">
                <div>
                    <h2 style="font-size: 1.4rem; color: #fff; margin-bottom: 4px;">${a.name}</h2>
                    <span style="font-size: 0.9rem; color: var(--text-secondary);">CPF: ${formatCpf(a.cpf)} • Tel: ${formatPhone(a.phone)}</span>
                    <div style="margin-top: 6px; font-weight: 700; color: #38bdf8;">${a.category}</div>
                </div>
                <div style="text-align: right;">
                    ${isConfirmed
                        ? `<span class="badge-status confirmed" style="font-size:0.95rem; padding: 6px 14px;"><i class="ri-checkbox-circle-fill"></i> PAGO VIA ${a.payment_method || 'PIX/CARTÃO'}</span>`
                        : `<span class="badge-status pending" style="font-size:0.95rem; padding: 6px 14px;"><i class="ri-alert-line"></i> PAGAMENTO PENDENTE</span>`
                    }
                </div>
            </div>

            ${!isConfirmed ? `
                <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 10px; padding: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <strong style="color: #fca5a5;"><i class="ri-alert-fill"></i> Atenção: Inscrição com pagamento pendente!</strong>
                        <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 2px;">Confirme o pagamento de ${formatCurrency(a.price)} agora para liberar a entrega do kit:</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn btn-pix" onclick="confirmPaymentHandler(${a.id}, 'Pix', ${a.price})" style="padding: 8px 14px; font-size: 0.85rem;">
                            Confirmar PIX
                        </button>
                        <button type="button" class="btn btn-card" onclick="confirmPaymentHandler(${a.id}, 'Cartão', ${a.price})" style="padding: 8px 14px; font-size: 0.85rem;">
                            Confirmar Cartão
                        </button>
                    </div>
                </div>
            ` : ''}

            <!-- Check-in Form Form Inputs -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 1.5rem;">
                
                <div>
                    <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 6px;">Tamanho da Camisa do Kit</label>
                    <select id="ci-tshirt" style="width: 100%; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                        <option value="Tradicional P" ${a.tshirt_size === 'Tradicional P' ? 'selected' : ''}>Tradicional P</option>
                        <option value="Tradicional M" ${a.tshirt_size === 'Tradicional M' ? 'selected' : ''}>Tradicional M</option>
                        <option value="Tradicional G" ${a.tshirt_size === 'Tradicional G' ? 'selected' : ''}>Tradicional G</option>
                        <option value="Tradicional GG" ${a.tshirt_size === 'Tradicional GG' ? 'selected' : ''}>Tradicional GG</option>
                        <option value="Tradicional XGG" ${a.tshirt_size === 'Tradicional XGG' ? 'selected' : ''}>Tradicional XGG</option>
                        <option value="Babylook P" ${a.tshirt_size === 'Babylook P' ? 'selected' : ''}>Babylook P</option>
                        <option value="Babylook M" ${a.tshirt_size === 'Babylook M' ? 'selected' : ''}>Babylook M</option>
                        <option value="Babylook G" ${a.tshirt_size === 'Babylook G' ? 'selected' : ''}>Babylook G</option>
                    </select>
                </div>

                <div>
                    <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 6px;">Número da Touca / Numeral</label>
                    <input type="text" id="ci-cap-number" value="${a.cap_number || ''}" placeholder="Ex: 042" style="width: 100%; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                </div>

                <div>
                    <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 6px;">Kit Retirado Por</label>
                    <input type="text" id="ci-retrieved-by" value="${a.kit_retrieved_by || 'Próprio atleta'}" placeholder="Nome de quem está retirando" style="width: 100%; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                </div>

            </div>

            <!-- Optional Camera Section -->
            <div style="background: rgba(255,255,255,0.03); border-radius: 10px; padding: 1rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <span style="font-size: 0.9rem; font-weight: 700; color: #fff;"><i class="ri-camera-lens-line"></i> Foto de Confirmação do Kit (Opcional)</span>
                    <button type="button" class="btn" id="btn-toggle-camera" onclick="startCamera()" style="padding: 6px 12px; font-size: 0.8rem; background: rgba(255,255,255,0.1);">
                        <i class="ri-camera-fill"></i> Ativar Câmera
                    </button>
                </div>
                <div id="camera-container" style="display: none; text-align: center;">
                    <video id="camera-feed" class="camera-feed" autoplay playsinline></video>
                    <canvas id="camera-canvas" style="display: none;"></canvas>
                    <div style="margin-top: 10px;">
                        <button type="button" class="btn btn-primary" onclick="capturePhoto()" style="padding: 8px 16px;">Tirar Foto</button>
                    </div>
                </div>
                <div id="photo-preview-container" style="display: ${a.checkin_photo ? 'block' : 'none'}; text-align: center; margin-top: 10px;">
                    <img id="photo-preview-img" src="${a.checkin_photo || ''}" style="max-height: 160px; border-radius: 8px; border: 2px solid var(--border-glass);">
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Foto atual do check-in</div>
                </div>
            </div>

            <!-- Complete Checkin Button -->
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button type="button" class="btn" onclick="document.getElementById('checkin-workspace').style.display='none'" style="background: rgba(255,255,255,0.08); color: #fff; padding: 12px 20px;">
                    Cancelar
                </button>
                <button type="button" class="btn btn-primary" id="btn-save-checkin" onclick="submitCheckin(${a.id})" style="padding: 12px 28px; font-size: 1rem; font-weight: 800; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);">
                    <i class="ri-checkbox-circle-fill"></i> ${isChecked ? 'Atualizar Check-in' : 'Concluir Check-in & Entregar Kit'}
                </button>
            </div>

        </div>
    `;

    workspace.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Camera control
let capturedPhotoBase64 = null;

window.startCamera = async function() {
    const container = document.getElementById('camera-container');
    const video = document.getElementById('camera-feed');
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = videoStream;
            container.style.display = 'block';
        } else {
            alert('Câmera não suportada neste navegador.');
        }
    } catch (e) {
        alert('Não foi possível acessar a câmera: ' + e.message);
    }
};

window.capturePhoto = function() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('camera-canvas');
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

    document.getElementById('photo-preview-img').src = capturedPhotoBase64;
    document.getElementById('photo-preview-container').style.display = 'block';

    // Stop video
    if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
    }
    document.getElementById('camera-container').style.display = 'none';
};

window.submitCheckin = async function(athleteId) {
    const tshirt = document.getElementById('ci-tshirt').value;
    const capNumber = document.getElementById('ci-cap-number').value.trim();
    const retrievedBy = document.getElementById('ci-retrieved-by').value.trim();

    const btn = document.getElementById('btn-save-checkin');
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Salvando Check-in...`;

    try {
        let photoUrl = null;
        if (capturedPhotoBase64) {
            const photoRes = await postData(`athletes/${athleteId}/photo`, { photo: capturedPhotoBase64 });
            if (photoRes && photoRes.photoUrl) {
                photoUrl = photoRes.photoUrl;
            }
        }

        const res = await putData(`athletes/${athleteId}/checkin`, {
            tshirt_size: tshirt,
            cap_number: capNumber,
            kit_retrieved_by: retrievedBy,
            checkin_photo: photoUrl
        });

        if (res.error) {
            alert(`Erro: ${res.error}`);
            return;
        }

        document.getElementById('checkin-workspace').style.display = 'none';
        capturedPhotoBase64 = null;

        alert('✓ Check-in e entrega de kit registrados com sucesso!');
        loadCheckinStation();
        loadDashboard();

    } catch (e) {
        alert('Erro ao registrar check-in: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-checkbox-circle-fill"></i> Concluir Check-in`;
    }
};

window.undoCheckinHandler = async function(athleteId) {
    if (!confirm('Deseja realmente desfazer o check-in deste atleta?')) return;
    try {
        await putData(`athletes/${athleteId}/undo-checkin`, {});
        loadCheckinStation();
        loadDashboard();
    } catch (e) {
        alert('Erro: ' + e.message);
    }
};

window.viewPhotoModal = function(url, athleteName) {
    const html = `
        <div style="text-align: center;">
            <img src="${url}" style="max-width: 100%; border-radius: 12px; border: 2px solid rgba(255,255,255,0.15);">
            <div style="margin-top: 10px; color: var(--text-secondary); font-size: 0.9rem;">Foto de comprovação: ${athleteName}</div>
        </div>
    `;
    createModal(`Comprovante de Check-in`, html, null, false);
};


// ═══════════════════════════════════════════════════════════════
// 4. CUSTOS DO EVENTO
// ═══════════════════════════════════════════════════════════════
async function loadCosts() {
    const data = await fetchData('costs/event');
    const tbody = document.getElementById('table-event-costs');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color:var(--text-secondary);">Nenhuma despesa cadastrada ainda.</td></tr>`;
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${item.id}</td>
            <td><strong>${item.description}</strong></td>
            <td style="color: #f87171;">${formatCurrency(item.amount)}</td>
            <td>${formatDate(item.date)}</td>
            <td>
                <button type="button" class="btn-icon btn-danger" onclick="deleteCostHandler(${item.id})">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('form-event-cost').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('costs/event', {
        description: document.getElementById('ecost-desc').value.trim(),
        amount: parseFloat(document.getElementById('ecost-amount').value),
        date: document.getElementById('ecost-date').value
    });
    e.target.reset();
    document.getElementById('ecost-date').value = new Date().toISOString().split('T')[0];
    loadCosts();
    loadDashboard();
});

window.deleteCostHandler = async function(id) {
    if (!confirm('Deseja excluir esta despesa?')) return;
    await deleteData('costs/event', id);
    loadCosts();
    loadDashboard();
};


// ═══════════════════════════════════════════════════════════════
// 5. PATROCÍNIOS
// ═══════════════════════════════════════════════════════════════
async function loadSponsors() {
    const data = await fetchData('sponsors');
    const tbody = document.getElementById('table-sponsors');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color:var(--text-secondary);">Nenhum patrocínio cadastrado.</td></tr>`;
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${item.id}</td>
            <td><strong>${item.name}</strong></td>
            <td style="color: #38bdf8;">${formatCurrency(item.amount)}</td>
            <td>${formatDate(item.date)}</td>
            <td>
                <button type="button" class="btn-icon btn-danger" onclick="deleteSponsorHandler(${item.id})">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('form-sponsor').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('sponsors', {
        name: document.getElementById('sponsor-name').value.trim(),
        amount: parseFloat(document.getElementById('sponsor-amount').value),
        date: document.getElementById('sponsor-date').value
    });
    e.target.reset();
    document.getElementById('sponsor-date').value = new Date().toISOString().split('T')[0];
    loadSponsors();
    loadDashboard();
});

window.deleteSponsorHandler = async function(id) {
    if (!confirm('Deseja excluir este patrocínio?')) return;
    await deleteData('sponsors', id);
    loadSponsors();
    loadDashboard();
};


// ═══════════════════════════════════════════════════════════════
// 6. USUÁRIOS (Master Only)
// ═══════════════════════════════════════════════════════════════
async function loadUsers() {
    const data = await fetchData('users');
    const tbody = document.getElementById('table-users');
    tbody.innerHTML = '';

    if (!data) return;

    data.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${u.id}</td>
            <td><strong>${u.username}</strong></td>
            <td>${u.is_master ? '<span class="badge-status confirmed">Master</span>' : '<span class="badge-status">Organizador</span>'}</td>
            <td>${formatDate(u.created_at)}</td>
            <td>
                ${!u.is_master ? `
                    <button type="button" class="btn-icon btn-danger" onclick="deleteUserHandler(${u.id})">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                ` : '<span style="color:var(--text-secondary); font-size:0.8rem;">Protegido</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('form-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value.trim();

    const res = await postData('users', { username, password });
    if (res.error) {
        alert(res.error);
        return;
    }
    e.target.reset();
    loadUsers();
});

window.deleteUserHandler = async function(id) {
    if (!confirm('Deseja excluir este usuário organizador?')) return;
    await deleteData('users', id);
    loadUsers();
};


// ═══════════════════════════════════════════════════════════════
// MODAL SYSTEM & UTILITIES
// ═══════════════════════════════════════════════════════════════
function createModal(title, bodyHTML, onConfirm, showSaveBtn = true) {
    closeActiveModal();

    const overlay = document.createElement('div');
    overlay.id = 'active-modal-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center; padding: 1rem;
    `;

    overlay.innerHTML = `
        <div style="
            background: #0f172a; border: 1px solid rgba(255,255,255,0.15);
            border-radius: 16px; padding: 2rem; width: 100%; max-width: 680px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.7); max-height: 90vh; overflow-y: auto;
            position: relative; animation: modalIn .2s ease;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 1rem;">
                <h3 style="margin: 0; color: #fff; font-size: 1.25rem;">${title}</h3>
                <button id="modal-close-x" style="background: none; border: none; color: rgba(255,255,255,0.5); font-size: 1.6rem; cursor: pointer; line-height: 1;">×</button>
            </div>
            <div class="modal-body-content">
                ${bodyHTML}
            </div>
            <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 1rem;">
                <button id="modal-btn-cancel" class="btn" style="background: rgba(255,255,255,0.08); color: #fff; padding: 8px 18px; border-radius: 8px;">Fechar</button>
                ${showSaveBtn ? `<button id="modal-btn-confirm" class="btn btn-primary" style="padding: 8px 22px;">Salvar</button>` : ''}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => closeActiveModal();
    document.getElementById('modal-close-x').onclick = close;
    document.getElementById('modal-btn-cancel').onclick = close;

    if (showSaveBtn && onConfirm) {
        document.getElementById('modal-btn-confirm').onclick = async () => {
            await onConfirm();
            close();
        };
    }
}

function closeActiveModal() {
    const existing = document.getElementById('active-modal-overlay');
    if (existing) existing.remove();
}

// Export Athletes to XLSX
function exportAthletesXLSX() {
    if (!currentAthletes || currentAthletes.length === 0) {
        alert('Não há atletas para exportar.');
        return;
    }

    const headers = [
        'ID', 'Nome Completo', 'CPF', 'E-mail', 'Telefone',
        'Data Nascimento', 'Gênero', 'Modalidade', 'Distância',
        'Valor (R$)', 'Status Pagamento', 'Forma Pagamento', 'Data Pagamento',
        'Confirmado Por', 'Tamanho Camisa', 'Assessoria', 'Cupom',
        'Contato Emergência Nome', 'Contato Emergência Tel',
        'Check-in Realizado', 'Data Check-in', 'Nº Touca', 'Retirado Por'
    ];

    const dataRows = currentAthletes.map(a => [
        a.id,
        a.name,
        formatCpf(a.cpf),
        a.email,
        formatPhone(a.phone),
        a.birth_date || '',
        a.gender || '',
        a.category,
        a.distance || '2 km',
        a.price,
        a.payment_status,
        a.payment_method || '',
        a.payment_date || '',
        a.confirmed_by || '',
        a.tshirt_size || '',
        a.assessoria_name || '',
        a.coupon_code || '',
        a.emergency_contact_name || '',
        a.emergency_contact_phone || '',
        a.checkin_status === 1 ? 'Sim' : 'Não',
        a.checkin_date || '',
        a.cap_number || '',
        a.kit_retrieved_by || ''
    ]);

    const wsData = [headers, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inscritos');
    XLSX.writeFile(wb, `Inscritos_Tubaroes_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Setup Event Listeners
function setupEventListeners() {
    document.getElementById('athletes-search').addEventListener('input', () => loadAthletes());
    document.getElementById('filter-athlete-status').addEventListener('change', () => loadAthletes());
    document.getElementById('filter-athlete-checkin').addEventListener('change', () => loadAthletes());
    document.getElementById('btn-export-athletes').addEventListener('click', exportAthletesXLSX);

    document.getElementById('btn-new-athlete-manual').addEventListener('click', () => {
        openManualAthleteModal();
    });

    // Assessorias & Cupons Listeners
    setupAssessoriasListeners();

    // Loja Listeners
    setupStoreListeners();
}

// Manual Athlete Registration (Admin action)
function openManualAthleteModal() {
    const html = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <div>
                <label style="font-size: 0.8rem; color: var(--text-secondary);">Nome Completo *</label>
                <input type="text" id="man-name" placeholder="Nome do Atleta" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">CPF *</label>
                    <input type="text" id="man-cpf" placeholder="000.000.000-00" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                </div>
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Telefone / WhatsApp *</label>
                    <input type="text" id="man-phone" placeholder="(00) 00000-0000" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                </div>
            </div>
            <div>
                <label style="font-size: 0.8rem; color: var(--text-secondary);">E-mail *</label>
                <input type="email" id="man-email" placeholder="atleta@email.com" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Modalidade *</label>
                    <select id="man-category" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                        <optgroup label="Percurso 2 km">
                            <option value="adulto_2k">Travessia Adultos (2 km) - R$ 149</option>
                            <option value="adulto_assessoria_2k">Travessia Assessorias (2 km, com cupom) - R$ 119</option>
                            <option value="promocional_2k">Promocional de Largada (2 km) - R$ 99</option>
                            <option value="pcd_2k">Travessia PCD (2 km) - R$ 79</option>
                        </optgroup>
                        <optgroup label="Percurso 1 km">
                            <option value="adulto_1k">Travessia Adultos (1 km) - R$ 149</option>
                            <option value="adulto_assessoria_1k">Travessia Assessorias (1 km, com cupom) - R$ 119</option>
                            <option value="pcd_1k">Travessia PCD (1 km) - R$ 79</option>
                        </optgroup>
                        <optgroup label="Infantil">
                            <option value="kids">Travessia Kids - R$ 79</option>
                        </optgroup>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Camisa (M, G ou XG) *</label>
                    <select id="man-tshirt" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15);">
                        <option value="M" selected>M</option>
                        <option value="G">G</option>
                        <option value="XG">XG</option>
                    </select>
                </div>
            </div>
        </div>
    `;

    createModal('Cadastrar Atleta Manualmente', html, async () => {
        const name = document.getElementById('man-name').value.trim();
        const cpf = document.getElementById('man-cpf').value.replace(/\D/g, '');
        const phone = document.getElementById('man-phone').value.trim();
        const email = document.getElementById('man-email').value.trim();
        const category_id = document.getElementById('man-category').value;
        const tshirt_size = document.getElementById('man-tshirt').value;

        if (!name || !cpf || !phone || !email) {
            alert('Preencha os campos obrigatórios');
            return;
        }

        const res = await postData('public/register-athlete', {
            name, cpf, phone, email, category_id, tshirt_size,
            emergency_contact_name: 'Organizador',
            emergency_contact_phone: phone
        });

        if (res.error) {
            alert('Erro: ' + res.error);
            return;
        }

        loadAthletes();
        loadDashboard();
        alert('Atleta cadastrado com sucesso!');
    });
}


// ═══════════════════════════════════════════════════════════════
// 7. ASSESSORIAS & CUPONS DE DESCONTO
// ═══════════════════════════════════════════════════════════════

// Carregar Assessorias
async function loadAssessorias() {
    const data = await fetchData('assessorias');
    const tbody = document.getElementById('table-assessorias');
    const select = document.getElementById('coupon-assessoria-select');
    const countEl = document.getElementById('ass-count-total');

    if (!data || !tbody) return;

    if (countEl) countEl.textContent = data.length;

    // Atualiza Select no formulário de criação de cupom
    if (select) {
        const prevVal = select.value;
        select.innerHTML = '<option value="" disabled selected>Selecione a Assessoria *</option>';
        data.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name;
            if (String(a.id) === String(prevVal)) opt.selected = true;
            select.appendChild(opt);
        });
    }

    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma assessoria cadastrada até o momento.</td></tr>`;
        return;
    }

    data.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${a.id}</td>
            <td><strong>${a.name}</strong></td>
            <td>${a.responsible_name || '—'}</td>
            <td>${formatPhone(a.phone)}</td>
            <td><span class="badge" style="background: rgba(2, 132, 199, 0.15); color: #38bdf8; font-weight: 700; padding: 4px 10px; border-radius: 99px;">${a.coupons_count || 0} cupom(ns)</span></td>
            <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700; padding: 4px 10px; border-radius: 99px;">${a.athletes_count || 0} atleta(s)</span></td>
            <td>
                <button type="button" class="btn-icon btn-danger" onclick="deleteAssessoriaHandler(${a.id}, '${escapeHtml(a.name)}')" title="Excluir assessoria">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Carregar Cupons
async function loadCoupons() {
    const data = await fetchData('coupons');
    const tbody = document.getElementById('table-coupons');
    const countEl = document.getElementById('coupons-count-total');

    if (!data || !tbody) return;

    if (countEl) countEl.textContent = data.length;

    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum cupom ativo no momento.</td></tr>`;
        return;
    }

    data.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <code style="font-size:1.05rem; font-weight:800; color:var(--gold); background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); padding:4px 10px; border-radius:6px; letter-spacing:0.06em; font-family:monospace;">
                    ${c.code}
                </code>
            </td>
            <td><strong>${c.assessoria_name}</strong></td>
            <td><span style="color: #34d399; font-weight: 700;">R$ 119,00</span></td>
            <td><span class="badge-status" style="background: rgba(255, 255, 255, 0.08); font-size:0.85rem;">${c.uses_count || 0} atleta(s)</span></td>
            <td>${formatDate(c.created_at)}</td>
            <td>
                <button type="button" class="btn-icon btn-danger" onclick="deleteCouponHandler(${c.id}, '${c.code}')" title="Excluir cupom">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Excluir Assessoria
window.deleteAssessoriaHandler = async function(id, name) {
    if (!confirm(`Tem certeza de que deseja excluir a assessoria "${name}"? Todos os cupons vinculados a ela também serão removidos.`)) return;

    try {
        await deleteData('assessorias', id);
        loadAssessorias();
        loadCoupons();
    } catch (err) {
        alert('Erro ao excluir assessoria: ' + err.message);
    }
};

// Excluir Cupom
window.deleteCouponHandler = async function(id, code) {
    if (!confirm(`Deseja realmente desativar e excluir o cupom "${code}"?`)) return;

    try {
        await deleteData('coupons', id);
        loadCoupons();
        loadAssessorias();
    } catch (err) {
        alert('Erro ao excluir cupom: ' + err.message);
    }
};

function setupAssessoriasListeners() {
    const formAssessoria = document.getElementById('form-assessoria');
    if (formAssessoria) {
        formAssessoria.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('ass-name').value.trim();
            const responsible_name = document.getElementById('ass-resp').value.trim();
            const phone = document.getElementById('ass-phone').value.trim();
            const email = document.getElementById('ass-email').value.trim();

            if (!name) {
                alert('Informe o nome da assessoria.');
                return;
            }

            const res = await postData('assessorias', { name, responsible_name, phone, email });
            if (res.error) {
                alert('Erro: ' + res.error);
                return;
            }

            formAssessoria.reset();
            loadAssessorias();
            alert('Assessoria cadastrada com sucesso!');
        });
    }

    const formCoupon = document.getElementById('form-coupon');
    const inputCouponCode = document.getElementById('coupon-code-input');

    if (inputCouponCode) {
        inputCouponCode.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
        });
    }

    // Botão Gerar Código de Cupom com 5 letras e 2 números
    const btnGenCode = document.getElementById('btn-generate-code');
    if (btnGenCode) {
        btnGenCode.addEventListener('click', () => {
            const select = document.getElementById('coupon-assessoria-select');
            let base = 'TUBAS';

            if (select && select.value) {
                const optText = select.options[select.selectedIndex].text;
                const clean = optText
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^A-Za-z]/g, '')
                    .toUpperCase();

                if (clean.length >= 5) {
                    base = clean.slice(0, 5);
                } else if (clean.length > 0) {
                    base = (clean + 'TUBAS').slice(0, 5);
                }
            }

            // Garante 5 letras maiúsculas
            base = (base.replace(/[^A-Z]/g, '') + 'TUBAS').slice(0, 5);
            // 2 números de 01 a 99
            const num = String(Math.floor(Math.random() * 90) + 10);
            const generated = base + num;

            if (inputCouponCode) {
                inputCouponCode.value = generated;
            }
        });
    }

    if (formCoupon) {
        formCoupon.addEventListener('submit', async (e) => {
            e.preventDefault();
            const assessoria_id = document.getElementById('coupon-assessoria-select').value;
            const code = inputCouponCode ? inputCouponCode.value.trim().toUpperCase() : '';

            if (!assessoria_id) {
                alert('Selecione uma assessoria para vincular o cupom.');
                return;
            }

            if (!/^[A-Z]{5}[0-9]{2}$/.test(code)) {
                alert('Formato inválido! O cupom deve conter exatamente 5 letras seguidas de 2 números (Exemplo: TUBAS01).');
                return;
            }

            const res = await postData('coupons', { assessoria_id, code });
            if (res.error) {
                alert('Erro: ' + res.error);
                return;
            }

            if (inputCouponCode) inputCouponCode.value = '';
            loadCoupons();
            loadAssessorias();
            alert(`Cupom ${code} criado com sucesso para o valor de R$ 119,00!`);
        });
    }
}


// ═══════════════════════════════════════════════════════════════
// 8. LOJA & ESTOQUE INTEGRADO
// ═══════════════════════════════════════════════════════════════

// Carregar Produtos da Loja
async function loadStoreProducts() {
    const data = await fetchData('store_products');
    const tbody = document.getElementById('table-store-products');
    const countEl = document.getElementById('prod-count-total');

    if (!data || !tbody) return;

    if (countEl) countEl.textContent = data.length;

    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum produto cadastrado na loja.</td></tr>`;
        return;
    }

    data.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${p.id}</td>
            <td><strong>${p.name}</strong></td>
            <td>
                <div style="display:inline-flex; align-items:center; gap:8px;">
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.85rem;" onclick="quickAdjustStock(${p.id}, -1)" title="Diminuir 1">-</button>
                    <span style="font-weight:800; font-size:1.05rem; min-width:32px; text-align:center; color:${p.stock > 0 ? '#38bdf8' : '#f87171'}">${p.stock}</span>
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.85rem;" onclick="quickAdjustStock(${p.id}, 1)" title="Aumentar 1">+</button>
                </div>
            </td>
            <td><strong style="color:var(--gold); font-size:1.05rem;">${formatCurrency(p.sell_price)}</strong></td>
            <td>
                <button type="button" class="btn-icon btn-danger" onclick="deleteProductHandler(${p.id}, '${escapeHtml(p.name)}')" title="Excluir produto">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Ajuste rápido de estoque (+1 / -1)
window.quickAdjustStock = async function(id, delta) {
    try {
        await putData(`store_products/${id}/stock`, { stock: delta });
        loadStoreProducts();
    } catch (err) {
        alert('Erro ao ajustar estoque: ' + err.message);
    }
};

// Excluir Produto
window.deleteProductHandler = async function(id, name) {
    if (!confirm(`Deseja realmente excluir o produto "${name}" da loja?`)) return;

    try {
        await deleteData('store_products', id);
        loadStoreProducts();
    } catch (err) {
        alert('Erro ao excluir produto: ' + err.message);
    }
};

function setupStoreListeners() {
    const formProduct = document.getElementById('form-product');
    if (formProduct) {
        formProduct.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('prod-name').value.trim();
            const stock = parseInt(document.getElementById('prod-stock').value, 10);
            const sell_price = parseFloat(document.getElementById('prod-price').value);

            if (!name || isNaN(stock) || isNaN(sell_price)) {
                alert('Preencha todos os campos do produto corretamente.');
                return;
            }

            const res = await postData('store_products', {
                name,
                stock: Math.max(0, stock),
                cost_price: 0,
                sell_price: Math.max(0, sell_price)
            });

            if (res.error) {
                alert('Erro: ' + res.error);
                return;
            }

            formProduct.reset();
            loadStoreProducts();
            alert('Produto cadastrado com sucesso!');
        });
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

