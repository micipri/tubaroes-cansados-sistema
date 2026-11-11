-- ================================================================
-- TUBARÕES CANSADOS - 10 ANOS
-- Script de Criação do Banco de Dados PostgreSQL / Supabase
-- ================================================================

-- Funções auxiliares de compatibilidade
CREATE OR REPLACE FUNCTION public.datetime(arg1 text DEFAULT 'now', arg2 text DEFAULT 'localtime') 
RETURNS text AS $$
BEGIN
    RETURN TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.max(a integer, b integer) 
RETURNS integer AS $$
BEGIN
    RETURN GREATEST(a, b);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.max(a numeric, b numeric) 
RETURNS numeric AS $$
BEGIN
    RETURN GREATEST(a, b);
END;
$$ LANGUAGE plpgsql;

-- 1. Atletas (Inscrições do Evento)
CREATE TABLE IF NOT EXISTS public.athletes (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    cpf TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    birth_date TEXT,
    gender TEXT,
    category TEXT NOT NULL,
    distance TEXT NOT NULL DEFAULT '2 km',
    price NUMERIC(10, 2) NOT NULL,
    coupon_code TEXT,
    assessoria_name TEXT,
    tshirt_size TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    medical_notes TEXT,
    payment_status TEXT NOT NULL DEFAULT 'Pendente',
    payment_method TEXT,
    payment_date TEXT,
    confirmed_by TEXT,
    checkin_status INTEGER NOT NULL DEFAULT 0,
    checkin_date TEXT,
    checkin_photo TEXT,
    kit_retrieved_by TEXT,
    cap_number TEXT,
    notes TEXT,
    store_items TEXT DEFAULT '[]',
    store_amount NUMERIC(10, 2) DEFAULT 0,
    total_amount NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_athletes_cpf ON public.athletes(cpf);
CREATE INDEX IF NOT EXISTS idx_athletes_status ON public.athletes(payment_status);
CREATE INDEX IF NOT EXISTS idx_athletes_category ON public.athletes(category);
CREATE INDEX IF NOT EXISTS idx_athletes_distance ON public.athletes(distance);

-- 2. Assessorias Esportivas
CREATE TABLE IF NOT EXISTS public.assessorias (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    responsible_name TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Cupons de Desconto de Assessorias (Formato 5 letras + 2 números)
CREATE TABLE IF NOT EXISTS public.coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    assessoria_id BIGINT NOT NULL REFERENCES public.assessorias(id) ON DELETE CASCADE,
    discount_price NUMERIC(10, 2) NOT NULL DEFAULT 119.00,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);

-- 4. Produtos da Loja (incluindo as camisas oficiais do kit atleta)
CREATE TABLE IF NOT EXISTS public.store_products (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    sell_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tshirt_size TEXT DEFAULT NULL,
    is_system INTEGER DEFAULT 0,
    show_in_checkout INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS show_in_checkout INTEGER NOT NULL DEFAULT 0;

-- Inserir camisas oficiais com 30 unidades iniciais (se não existirem)
INSERT INTO public.store_products (name, stock, cost_price, sell_price, tshirt_size, is_system)
SELECT 'Camisa Oficial do Evento (Tamanho M)', 30, 0, 0, 'M', 1
WHERE NOT EXISTS (SELECT 1 FROM public.store_products WHERE tshirt_size = 'M' OR name = 'Camisa Oficial do Evento (Tamanho M)');

INSERT INTO public.store_products (name, stock, cost_price, sell_price, tshirt_size, is_system)
SELECT 'Camisa Oficial do Evento (Tamanho G)', 30, 0, 0, 'G', 1
WHERE NOT EXISTS (SELECT 1 FROM public.store_products WHERE tshirt_size = 'G' OR name = 'Camisa Oficial do Evento (Tamanho G)');

INSERT INTO public.store_products (name, stock, cost_price, sell_price, tshirt_size, is_system)
SELECT 'Camisa Oficial do Evento (Tamanho XG)', 30, 0, 0, 'XG', 1
WHERE NOT EXISTS (SELECT 1 FROM public.store_products WHERE tshirt_size = 'XG' OR name = 'Camisa Oficial do Evento (Tamanho XG)');

-- 5. Vendas da Loja
CREATE TABLE IF NOT EXISTS public.store_sales (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES public.store_products(id),
    buyer_name TEXT DEFAULT 'Anônimo',
    quantity INTEGER NOT NULL,
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'Não informado',
    total_amount NUMERIC(10, 2) NOT NULL,
    package_id BIGINT DEFAULT NULL,
    date TEXT NOT NULL
);

-- 6. Pacotes de Produtos da Loja
CREATE TABLE IF NOT EXISTS public.store_packages (
    id BIGSERIAL PRIMARY KEY,
    recipient_name TEXT NOT NULL,
    status TEXT DEFAULT 'Pendente',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Pedidos Online da Loja
CREATE TABLE IF NOT EXISTS public.online_orders (
    id BIGSERIAL PRIMARY KEY,
    buyer_name TEXT NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    receipt_image_path TEXT NOT NULL,
    selected_products TEXT NOT NULL,
    status TEXT DEFAULT 'Pendente',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Usuários do Painel Administrativo
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_master INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inserir usuário mestre 'michel' (senha: tubaroes2026) se não existir
INSERT INTO public.users (username, password_hash, is_master)
SELECT 'michel', '$2b$10$hQ7awMDxC8qNgq3hdz1HtOC1sTMNfXESdXW62K2Oq/cyXZIWT1CPO', 1
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE username = 'michel');

-- 9. Tabelas Históricas e Módulos Auxiliares
CREATE TABLE IF NOT EXISTS public.registrations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_amount NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.registrations_mod2 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    cap_name TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    has_receipt BOOLEAN NOT NULL DEFAULT FALSE,
    is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.party_tickets (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    has_store_coupon BOOLEAN NOT NULL DEFAULT FALSE,
    has_beer_voucher BOOLEAN NOT NULL DEFAULT FALSE,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.party_costs (
    id BIGSERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_costs (
    id BIGSERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.secret_survey (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    will_go BOOLEAN NOT NULL,
    companions INTEGER NOT NULL DEFAULT 0,
    suggestion TEXT,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sponsors (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    date TEXT NOT NULL
);
