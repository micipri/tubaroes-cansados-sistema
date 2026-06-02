document.addEventListener('DOMContentLoaded', () => {
    const formAuth = document.getElementById('form-auth');
    const formSurvey = document.getElementById('form-survey');
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    
    let userName = "";

    // Passo 1 -> Passo 2
    formAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('user-name').value.trim();
        if (nameInput.length < 3) {
            alert('Por favor, informe um nome válido para prosseguir.');
            return;
        }
        userName = nameInput;
        
        // Esconde Passo 1, Mostra Passo 2
        step1.classList.remove('active');
        step1.classList.add('hidden');
        
        step2.classList.remove('hidden');
        step2.classList.add('active');
    });

    // Lógica para esconder/mostrar "Quantidade de acompanhantes" dependendo da resposta
    const radioYes = document.querySelector('input[name="will_go"][value="yes"]');
    const radioNo = document.querySelector('input[name="will_go"][value="no"]');
    const companionsContainer = document.getElementById('companions-q');
    const companionsInput = document.getElementById('companions');

    function toggleCompanions() {
        if (radioNo.checked) {
            companionsContainer.style.opacity = '0.5';
            companionsContainer.style.pointerEvents = 'none';
            companionsInput.value = '';
        } else {
            companionsContainer.style.opacity = '1';
            companionsContainer.style.pointerEvents = 'auto';
        }
    }

    radioYes.addEventListener('change', toggleCompanions);
    radioNo.addEventListener('change', toggleCompanions);

    // Passo 2 -> Submissão
    formSurvey.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const willGo = radioYes.checked;
        const companions = parseInt(companionsInput.value) || 0;
        const suggestion = document.getElementById('suggestion').value.trim();
        
        const submitBtn = formSurvey.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span>Enviando...</span>';
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/survey', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: userName,
                    will_go: willGo,
                    companions: companions,
                    suggestion: suggestion
                })
            });

            if (!res.ok) {
                throw new Error('Falha ao comunicar com o servidor secreto.');
            }

            // Sucesso! Vai para Passo 3
            step2.classList.remove('active');
            step2.classList.add('hidden');
            
            step3.classList.remove('hidden');
            step3.classList.add('active');

        } catch (error) {
            alert('Erro: ' + error.message);
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
    });
});
