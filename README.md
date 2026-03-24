# 🦈 Tubarões Cansados — Sistema de Gestão

Sistema completo do grupo **Tubarões Cansados**: site público e painel de gestão financeira do evento de 10 anos.

## Funcionalidades

- **Site público** — história do grupo, treinos semanais, evento Grande Travessia 10 Anos
- **Painel administrativo** protegido por login (usuário + senha)
- Gestão de inscrições (Lotes e Modalidade Individual)
- Gestão de ingressos da festa
- Lojinha (estoque + vendas)
- Controle de custos e patrocínios
- Dashboard financeiro (receitas, despesas, saldo)
- Exportação de listas em **XLSX** (Excel)
- Gerenciamento de usuários (master pode cadastrar/excluir usuários)

---

## Instalação e uso local

### Pré-requisito
Node.js 18+ instalado.

### 1. Instalar dependências
```bash
npm install
```

### 2. (Opcional) Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite .env com suas configurações
```

### 3. Iniciar o servidor
```bash
npm start
```

O sistema estará disponível em `http://localhost:3000`.

---

## Acessos

| URL | Descrição |
|-----|-----------|
| `http://localhost:3000/` | Site público |
| `http://localhost:3000/admin` | Painel administrativo (requer login) |
| `http://localhost:3000/admin/login.html` | Tela de login |

### Usuário master padrão
| Campo | Valor |
|-------|-------|
| Usuário | `michel` |
| Senha | `tubaroes2026` |

> ⚠️ Altere a senha após o primeiro login em produção.

---

## Estrutura do projeto

```
sistema/
├── server.js          # Servidor Express + rotas da API + autenticação
├── database.js        # Configuração do SQLite + criação das tabelas
├── migrate.js         # Script de migração manual
├── package.json
├── .env.example       # Variáveis de ambiente (template)
└── public/
    ├── landing.html   # Site público (rota /)
    ├── landing.css    # Estilos do site público
    ├── logodourada.jpg
    └── admin/
        ├── index.html # Painel administrativo
        ├── app.js     # Lógica do painel
        ├── style.css  # Estilos do painel
        └── login.html # Tela de login
```

---

## Deploy (Recomendado: Railway ou Render)

1. Faça push para o GitHub
2. Crie um novo projeto no [Railway](https://railway.app) ou [Render](https://render.com)
3. Conecte o repositório
4. Defina a variável de ambiente `SESSION_SECRET` com um valor aleatório seguro
5. O servidor inicia automaticamente com `npm start`

> **Nota:** O banco SQLite (`database.sqlite`) é persistido localmente no servidor. Para produção, considere usar um volume persistente ou migrar para PostgreSQL.

---

## Tecnologias

- **Backend:** Node.js, Express, SQLite3, express-session, bcryptjs
- **Frontend:** HTML, CSS, JavaScript puro, SheetJS (XLSX)
