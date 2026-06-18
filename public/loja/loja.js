const API_URL = '/api';
let uploadedImagePath = '';
let storeProducts = [];
let selectedItems = {}; // { product_id: quantity }
let confirmedAmount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    // Carregar produtos (público)
    try {
        const res = await fetch(`${API_URL}/public/store_products`);
        if(res.ok) storeProducts = await res.json();
    } catch(err) {
        console.error("Erro ao carregar produtos:", err);
    }
});

// --- Passo 1: Upload ---
const fileInput = document.getElementById('file-input');
const btnProcess = document.getElementById('btn-process');
const textProcess = document.getElementById('text-process');
const loaderProcess = document.getElementById('loader-process');

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        btnProcess.style.display = 'flex';
        // Add visual confirmation
        const uploadArea = document.querySelector('.upload-area');
        uploadArea.innerHTML = `
            <i class="ri-checkbox-circle-fill" style="color: #00ff88; font-size: 3rem;"></i>
            <p style="color: #00ff88; font-weight: 600;">Comprovante selecionado:</p>
            <p style="font-size: 0.9rem;">${fileInput.files[0].name}</p>
        `;
        uploadArea.style.borderColor = '#00ff88';
        uploadArea.style.background = 'rgba(0, 255, 136, 0.05)';
    }
});

btnProcess.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Loading UI
    btnProcess.disabled = true;
    loaderProcess.style.display = 'inline-block';
    textProcess.innerText = 'Lendo Comprovante (Isso pode levar alguns segundos)...';

    const formData = new FormData();
    formData.append('receipt', file);

    try {
        const res = await fetch(`${API_URL}/process-receipt`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        uploadedImagePath = data.imagePath;
        
        // Passa para o Passo 2
        document.getElementById('step-1').classList.remove('active');
        document.getElementById('step-2').classList.add('active');
        
        // Preenche dados extraídos (ou deixa zerado se o robô falhou)
        document.getElementById('receipt-img').src = uploadedImagePath;
        if (data.extractedAmount) {
            document.getElementById('pix-amount').value = data.extractedAmount.toFixed(2);
        }
        
        renderProducts();
        checkMatch();

    } catch (err) {
        alert("Erro ao processar imagem: " + err.message);
        btnProcess.disabled = false;
        loaderProcess.style.display = 'none';
        textProcess.innerText = 'Tentar Novamente';
    }
});

// --- Passo 2: Confirmação ---
function renderProducts() {
    const container = document.getElementById('products-container');
    container.innerHTML = '';
    
    // Filtrar apenas produtos com estoque > 0
    const available = storeProducts.filter(p => p.stock > 0);
    
    if (available.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#888;">Nenhum produto disponível no momento.</p>';
        return;
    }
    
    available.forEach(prod => {
        const div = document.createElement('div');
        div.className = 'product-card';
        div.innerHTML = `
            <div>
                <strong>${prod.name}</strong><br>
                <small style="color:var(--text-muted)">R$ ${prod.sell_price.toFixed(2).replace('.',',')} (Estoque: ${prod.stock})</small>
            </div>
            <div class="qty-controls">
                <button class="qty-btn minus" data-id="${prod.id}">-</button>
                <span class="qty-display" id="qty-${prod.id}">0</span>
                <button class="qty-btn plus" data-id="${prod.id}" data-max="${prod.stock}">+</button>
            </div>
        `;
        container.appendChild(div);
    });
    
    // Listeners
    document.querySelectorAll('.qty-btn.plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const max = parseInt(e.target.getAttribute('data-max'));
            if (!selectedItems[id]) selectedItems[id] = 0;
            if (selectedItems[id] < max) {
                selectedItems[id]++;
                document.getElementById(`qty-${id}`).innerText = selectedItems[id];
                checkMatch();
            }
        });
    });
    
    document.querySelectorAll('.qty-btn.minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            if (selectedItems[id] > 0) {
                selectedItems[id]--;
                document.getElementById(`qty-${id}`).innerText = selectedItems[id];
                if (selectedItems[id] === 0) delete selectedItems[id];
                checkMatch();
            }
        });
    });
}

const inputAmount = document.getElementById('pix-amount');
const inputName = document.getElementById('buyer-name');

inputAmount.addEventListener('input', checkMatch);
inputName.addEventListener('input', checkMatch);

function checkMatch() {
    confirmedAmount = parseFloat(inputAmount.value) || 0;
    
    let totalProducts = 0;
    for (const id in selectedItems) {
        const prod = storeProducts.find(p => p.id == id);
        if (prod) totalProducts += prod.sell_price * selectedItems[id];
    }
    
    document.getElementById('total-display').innerText = `R$ ${totalProducts.toFixed(2).replace('.',',')}`;
    
    const statusMsg = document.getElementById('match-status');
    const btnSubmit = document.getElementById('btn-submit');
    
    if (totalProducts === 0) {
        statusMsg.innerText = '';
        btnSubmit.disabled = true;
    } else if (Math.abs(totalProducts - confirmedAmount) > 0.01) {
        statusMsg.className = 'status-msg error';
        statusMsg.innerText = `Os valores não batem. Soma dos produtos: R$ ${totalProducts.toFixed(2)} | Valor PIX informado: R$ ${confirmedAmount.toFixed(2)}`;
        btnSubmit.disabled = true;
    } else {
        statusMsg.className = 'status-msg success';
        statusMsg.innerText = 'Valores coincidem! Tudo certo.';
        btnSubmit.disabled = (inputName.value.trim() === '');
    }
}

// --- Submit ---
document.getElementById('btn-submit').addEventListener('click', async () => {
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    document.getElementById('loader-submit').style.display = 'inline-block';
    document.getElementById('text-submit').innerText = 'Enviando...';
    
    // Formatar produtos para JSON
    const finalProducts = [];
    for (const id in selectedItems) {
        const prod = storeProducts.find(p => p.id == id);
        finalProducts.push({
            id: prod.id,
            name: prod.name,
            quantity: selectedItems[id],
            sell_price: prod.sell_price
        });
    }
    
    const payload = {
        buyer_name: inputName.value.trim(),
        total_amount: confirmedAmount,
        receipt_image_path: uploadedImagePath,
        selected_products: finalProducts
    };
    
    try {
        const res = await fetch(`${API_URL}/online_orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        
        document.getElementById('step-2').classList.remove('active');
        document.getElementById('step-3').classList.add('active');
        
    } catch (err) {
        alert("Erro ao enviar pedido: " + err.message);
        btn.disabled = false;
        document.getElementById('loader-submit').style.display = 'none';
        document.getElementById('text-submit').innerText = 'Tentar Novamente';
    }
});
