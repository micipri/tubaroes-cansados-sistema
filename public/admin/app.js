const API_URL = '/api';

// ── Mobile Sidebar (global — chamado via onclick no HTML) ─────
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn     = document.getElementById('hamburger-btn');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active', isOpen);
    if (btn) btn.innerHTML = isOpen
        ? '<i class="ri-close-line"></i>'
        : '<i class="ri-menu-line"></i>';
};

window.closeSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn     = document.getElementById('hamburger-btn');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    if (btn) btn.innerHTML = '<i class="ri-menu-line"></i>';
};

// ── Auth Check on Load ────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    // Close sidebar when a nav link is tapped on mobile
    document.querySelectorAll('.nav-links li').forEach(link => {
        link.addEventListener('click', () => { if (window.innerWidth <= 768) window.closeSidebar(); });
    });
    try {
        const res = await fetch('/auth/me', { credentials: 'include' });
        if (!res.ok) { window.location.href = '/admin/login.html'; return; }
        const me = await res.json();

        document.getElementById('user-info').textContent = `👤 ${me.username}`;

        // Show users section only for master
        if (me.isMaster) {
            document.getElementById('nav-users').style.display = '';
        }

        // Logout button
        document.getElementById('btn-logout').addEventListener('click', async () => {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
            window.location.href = '/admin/login.html';
        });

        // Set today's date in all date inputs
        const today = new Date().toISOString().split('T')[0];
        document.querySelectorAll('input[type="date"]').forEach(el => el.value = today);

        // Load Dashboard on start
        loadDashboard();
    } catch {
        window.location.href = '/admin/login.html';
    }
});

// Utilities
const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDate = (dateString) => {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

// Export Table Data to XLSX (using SheetJS)
function exportTableToXLSX(tbodyId, filename) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody || tbody.rows.length === 0) { alert('Não há dados para exportar.'); return; }

    const table = tbody.closest('table');
    const thead = table.querySelector('thead tr');
    const headers = [];
    if (thead) {
        for (let j = 0; j < thead.cells.length - 1; j++) {
            headers.push(thead.cells[j].innerText.trim());
        }
    }

    const dataRows = [];
    for (let i = 0; i < tbody.rows.length; i++) {
        const row = [];
        const cols = tbody.rows[i].cells;
        for (let j = 0; j < cols.length - 1; j++) {
            const cb = cols[j].querySelector('input[type="checkbox"]');
            if (cb) { row.push(cb.checked ? 'Sim' : 'Não'); }
            else {
                const clone = cols[j].cloneNode(true);
                clone.querySelectorAll('button').forEach(b => b.remove());
                row.push(clone.innerText.trim());
            }
        }
        dataRows.push(row);
    }

    const wsData = [headers, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const headerRange = XLSX.utils.decode_range(ws['!ref']);
    for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[cellAddr]) ws[cellAddr].s = { font: { bold: true } };
    }
    const colWidths = headers.map((h, i) => {
        const maxLen = Math.max(h.length, ...dataRows.map(r => (r[i] ? String(r[i]).length : 0)));
        return { wch: Math.min(maxLen + 2, 50) };
    });
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    XLSX.writeFile(wb, filename);
}

// ── Navigation Logic ──────────────────────────────────────────
document.querySelectorAll('.nav-links li').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        document.getElementById('page-title').textContent = link.textContent.trim();
        document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
        const target = link.getAttribute('data-target');
        document.getElementById(target).classList.remove('hidden');
        loadSectionData(target);
    });
});

// ── Tab Logic ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const parent = e.target.closest('.tabs');
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const tabGroup = parent.nextElementSibling.parentElement;
        tabGroup.querySelectorAll(':scope > .tab-content').forEach(c => c.classList.add('hidden'));
        const targetId = e.target.getAttribute('data-tab');
        document.getElementById(targetId).classList.remove('hidden');
    });
});

// ── Data Loading Dispatcher ───────────────────────────────────
function loadSectionData(section) {
    if (section === 'dashboard') loadDashboard();
    if (section === 'registrations') loadRegistrations();
    if (section === 'registrations-mod2') loadRegistrationsMod2();
    if (section === 'party') loadPartyTickets();
    if (section === 'store') { loadStoreSales(); loadStoreProducts(); }
    if (section === 'costs') { loadCosts('event'); loadCosts('party'); }
    if (section === 'sponsors') loadSponsors();
    if (section === 'users') loadUsers();
}

// ── Fetch Wrappers ────────────────────────────────────────────
async function fetchData(endpoint) {
    const res = await fetch(`${API_URL}/${endpoint}`, { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/admin/login.html'; return []; }
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
async function deleteData(endpoint, id) {
    const res = await fetch(`${API_URL}/${endpoint}/${id}`, { method: 'DELETE', credentials: 'include' });
    return res.json();
}

const deleteHandler = (endpoint, id, reloadFunc) => async (e) => {
    if (e) e.preventDefault();
    if (confirm('Tem certeza que deseja excluir?')) {
        await deleteData(endpoint, id);
        reloadFunc();
        loadDashboard();
    }
};

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
    const data = await fetchData('summary');
    if (!data || !data.income) return;
    document.getElementById('total-income').textContent = formatCurrency(data.total_income || Object.values(data.income).reduce((a, b) => a + b, 0));
    document.getElementById('total-expenses').textContent = formatCurrency(data.total_expenses || Object.values(data.expenses).reduce((a, b) => a + b, 0));
    document.getElementById('total-balance').textContent = formatCurrency(data.total_balance);
    document.getElementById('income-breakdown').innerHTML = `
        <li><span>Inscrições Lote</span> <strong>${formatCurrency(data.income.registrations)}</strong></li>
        <li><span>Inscrições Mod. 2</span> <strong>${formatCurrency(data.income.registrations_mod2 || 0)}</strong></li>
        <li><span>Ingressos Festa</span> <strong>${formatCurrency(data.income.party_tickets)}</strong></li>
        <li><span>Lojinha (Vendas)</span> <strong>${formatCurrency(data.income.store_sales)}</strong></li>
        <li><span>Patrocínios</span> <strong>${formatCurrency(data.income.sponsors)}</strong></li>
    `;
    document.getElementById('expenses-breakdown').innerHTML = `
        <li><span>Custos Evento</span> <strong>${formatCurrency(data.expenses.event_costs)}</strong></li>
        <li><span>Custos Festa</span> <strong>${formatCurrency(data.expenses.party_costs)}</strong></li>
        <li><span>Custo Estoque Loja</span> <strong>${formatCurrency(data.expenses.store_costs)}</strong></li>
    `;
}

// ── Registrations (Batches) ───────────────────────────────────
async function loadRegistrations() {
    const data = await fetchData('registrations');
    const tbody = document.getElementById('table-registrations');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${item.id}</td><td>${item.name}</td><td>${item.quantity} un.</td>
            <td>${formatCurrency(item.unit_amount)}</td><td><strong>${formatCurrency(item.total_amount)}</strong></td>
            <td>${formatDate(item.date)}</td>
            <td><button type="button" class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button></td>
        `;
        tr.querySelector('button').onclick = deleteHandler('registrations', item.id, loadRegistrations);
        tbody.appendChild(tr);
    });
}
document.getElementById('form-registration').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('registrations', {
        name: document.getElementById('reg-name').value,
        quantity: parseInt(document.getElementById('reg-quantity').value),
        unit_amount: parseFloat(document.getElementById('reg-amount').value),
        date: document.getElementById('reg-date').value
    });
    e.target.reset();
    loadRegistrations(); loadDashboard();
});

// ── Registrations Mod 2 ───────────────────────────────────────
async function loadRegistrationsMod2() {
    let data = await fetchData('registrations_mod2');
    const sortSelect = document.getElementById('sort-mod2');
    if (sortSelect) {
        const sortMode = sortSelect.value;
        if (sortMode === 'name_asc') data.sort((a, b) => (a.name || '').trim().toLowerCase().localeCompare((b.name || '').trim().toLowerCase()));
        else if (sortMode === 'cap_asc') data.sort((a, b) => (a.cap_name || '').trim().toLowerCase().localeCompare((b.cap_name || '').trim().toLowerCase()));
        else if (sortMode === 'receipt_ok') data.sort((a, b) => Number(b.has_receipt) - Number(a.has_receipt) || b.id - a.id);
    }
    const tbody = document.getElementById('table-registrations-mod2');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${item.id}</td><td>${item.name}</td><td>${item.email}</td>
            <td>${item.cap_name || ''} <button type="button" class="btn-icon edit-cap-btn" data-id="${item.id}" data-current="${item.cap_name || ''}"><i class="ri-pencil-line"></i></button></td>
            <td><strong>${formatCurrency(item.amount)}</strong></td>
            <td><input type="checkbox" class="toggle-cb" data-id="${item.id}" data-field="has_receipt" ${item.has_receipt ? 'checked' : ''}></td>
            <td><input type="checkbox" class="toggle-cb" data-id="${item.id}" data-field="is_confirmed" ${item.is_confirmed ? 'checked' : ''}></td>
            <td>${formatDate(item.date)}</td>
            <td><button type="button" class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button></td>
        `;
        tr.querySelector('.btn-danger').onclick = deleteHandler('registrations_mod2', item.id, loadRegistrationsMod2);
        tr.querySelectorAll('.toggle-cb').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const id = e.target.getAttribute('data-id');
                const field = e.target.getAttribute('data-field');
                const value = e.target.checked;
                try {
                    await fetch(API_URL + '/registrations_mod2/' + id + '/toggle', {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        credentials: 'include', body: JSON.stringify({ field, value })
                    });
                    loadDashboard();
                } catch { alert('Erro ao atualizar.'); e.target.checked = !value; }
            });
        });
        tr.querySelector('.edit-cap-btn').addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            const id = btn.getAttribute('data-id');
            const currentName = btn.getAttribute('data-current');
            const newName = prompt('Editar Nome na Touca:', currentName);
            if (newName !== null && newName !== currentName) {
                try {
                    const res = await fetch(API_URL + '/registrations_mod2/' + id + '/cap_name', {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        credentials: 'include', body: JSON.stringify({ cap_name: newName })
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const result = await res.json();
                    if (!result.updated) throw new Error('No rows updated.');
                    loadRegistrationsMod2();
                } catch (err) { alert('Erro ao atualizar nome: ' + err.message); }
            }
        });
        tbody.appendChild(tr);
    });
}
document.getElementById('form-reg-mod2').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('registrations_mod2', {
        name: document.getElementById('reg2-name').value,
        email: document.getElementById('reg2-email').value,
        cap_name: document.getElementById('reg2-cap').value,
        amount: parseFloat(document.getElementById('reg2-amount').value),
        has_receipt: document.getElementById('reg2-receipt').checked,
        is_confirmed: document.getElementById('reg2-confirmed').checked,
        date: document.getElementById('reg2-date').value
    });
    e.target.reset(); loadRegistrationsMod2(); loadDashboard();
});

// ── Party Tickets ─────────────────────────────────────────────
async function loadPartyTickets() {
    const data = await fetchData('party_tickets');
    const tbody = document.getElementById('table-party-tickets');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>#${item.id}</td><td>${item.name}</td><td>${formatCurrency(item.amount)}</td><td>${formatDate(item.date)}</td><td><button type="button" class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button></td>`;
        tr.querySelector('button').onclick = deleteHandler('party_tickets', item.id, loadPartyTickets);
        tbody.appendChild(tr);
    });
}
document.getElementById('form-party-ticket').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('party_tickets', {
        name: document.getElementById('ticket-name').value,
        amount: parseFloat(document.getElementById('ticket-amount').value),
        date: document.getElementById('ticket-date').value
    });
    e.target.reset(); loadPartyTickets(); loadDashboard();
});

// ── Store Products ────────────────────────────────────────────
async function loadStoreProducts() {
    const data = await fetchData('store_products');
    const tbody = document.getElementById('table-store-products');
    tbody.innerHTML = '';
    const select = document.getElementById('sale-product-id');
    select.innerHTML = '<option value="" disabled selected>Selecione um Produto</option>';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>#${item.id}</td><td>${item.name}</td><td>${item.stock} un.</td><td>${formatCurrency(item.cost_price)}</td><td>${formatCurrency(item.sell_price)}</td><td><button type="button" class="btn-icon add-stock"><i class="ri-add-line"></i></button><button type="button" class="btn-icon btn-danger delete-prod"><i class="ri-delete-bin-line"></i></button></td>`;
        tr.querySelector('.add-stock').onclick = async () => {
            const qty = prompt(`Quantas unidades adicionar ao produto ${item.name}?`);
            if (qty && !isNaN(qty)) {
                await fetch(`${API_URL}/store_products/${item.id}/stock`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', body: JSON.stringify({ stock: parseInt(qty) })
                });
                loadStoreProducts(); loadDashboard();
            }
        };
        tr.querySelector('.delete-prod').onclick = deleteHandler('store_products', item.id, loadStoreProducts);
        tbody.appendChild(tr);
        if (item.stock > 0) select.innerHTML += `<option value="${item.id}">${item.name} (Estoque: ${item.stock} | ${formatCurrency(item.sell_price)})</option>`;
    });
}
document.getElementById('form-store-product').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('store_products', {
        name: document.getElementById('prod-name').value,
        stock: parseInt(document.getElementById('prod-stock').value),
        cost_price: parseFloat(document.getElementById('prod-cost').value),
        sell_price: parseFloat(document.getElementById('prod-sell').value)
    });
    e.target.reset(); loadStoreProducts(); loadDashboard();
});

// ── Store Sales ───────────────────────────────────────────────
async function loadStoreSales() {
    const data = await fetchData('store_sales');
    const tbody = document.getElementById('table-store-sales');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${item.product_name}</td><td>${item.quantity} un.</td><td>${formatCurrency(item.total_amount)}</td><td>${formatDate(item.date)}</td>`;
        tbody.appendChild(tr);
    });
}
document.getElementById('form-store-sale').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await postData('store_sales', {
        product_id: parseInt(document.getElementById('sale-product-id').value),
        quantity: parseInt(document.getElementById('sale-quantity').value),
        date: document.getElementById('sale-date').value
    });
    if (res.error) alert(res.error);
    else { e.target.reset(); loadStoreSales(); loadStoreProducts(); loadDashboard(); }
});

// ── Costs ─────────────────────────────────────────────────────
async function loadCosts(type) {
    const data = await fetchData(`costs/${type}`);
    const tbody = document.getElementById(`table-${type}-costs`);
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>#${item.id}</td><td>${item.description}</td><td>${formatCurrency(item.amount)}</td><td>${formatDate(item.date)}</td><td><button class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button></td>`;
        tr.querySelector('button').onclick = deleteHandler(`costs/${type}`, item.id, () => loadCosts(type));
        tbody.appendChild(tr);
    });
}
document.getElementById('form-event-cost').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('costs/event', { description: document.getElementById('ecost-desc').value, amount: parseFloat(document.getElementById('ecost-amount').value), date: document.getElementById('ecost-date').value });
    e.target.reset(); loadCosts('event'); loadDashboard();
});
document.getElementById('form-party-cost').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('costs/party', { description: document.getElementById('pcost-desc').value, amount: parseFloat(document.getElementById('pcost-amount').value), date: document.getElementById('pcost-date').value });
    e.target.reset(); loadCosts('party'); loadDashboard();
});

// ── Sponsors ──────────────────────────────────────────────────
async function loadSponsors() {
    const data = await fetchData('sponsors');
    const tbody = document.getElementById('table-sponsors');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>#${item.id}</td><td>${item.name}</td><td>${formatCurrency(item.amount)}</td><td>${formatDate(item.date)}</td><td><button class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button></td>`;
        tr.querySelector('button').onclick = deleteHandler('sponsors', item.id, loadSponsors);
        tbody.appendChild(tr);
    });
}
document.getElementById('form-sponsor').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postData('sponsors', { name: document.getElementById('sponsor-name').value, amount: parseFloat(document.getElementById('sponsor-amount').value), date: document.getElementById('sponsor-date').value });
    e.target.reset(); loadSponsors(); loadDashboard();
});

// ── Users (master only) ───────────────────────────────────────
async function loadUsers() {
    const data = await fetchData('users');
    const tbody = document.getElementById('table-users');
    tbody.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        const isMasterUser = item.is_master === 1;
        tr.innerHTML = `
            <td>#${item.id}</td>
            <td>${item.username}</td>
            <td>${isMasterUser ? '<span style="color:#d4af37; font-weight:700;">👑 Master</span>' : 'Padrão'}</td>
            <td>${item.created_at ? item.created_at.split('T')[0].split('-').reverse().join('/') : '—'}</td>
            <td>${isMasterUser ? '—' : `<button type="button" class="btn-icon btn-danger"><i class="ri-delete-bin-line"></i></button>`}</td>
        `;
        if (!isMasterUser) {
            tr.querySelector('button').onclick = async () => {
                if (confirm(`Excluir o usuário "${item.username}"?`)) {
                    const res = await fetch(`${API_URL}/users/${item.id}`, { method: 'DELETE', credentials: 'include' });
                    const data = await res.json();
                    if (data.error) alert(data.error);
                    else loadUsers();
                }
            };
        }
        tbody.appendChild(tr);
    });
}
document.getElementById('form-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const res = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    alert(`Usuário "${data.username}" cadastrado com sucesso!`);
    e.target.reset();
    loadUsers();
});
