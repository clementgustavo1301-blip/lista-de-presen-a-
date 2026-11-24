# EcoSafety & EcoClinic — Plataforma Integrada (Presença + Triagem)

Plataforma full-stack unificada para **Controle de Presença & Massoterapia (EcoSafety)** e **Triagem Clínica de Enfermagem & Medicina Ocupacional (EcoClinic)**, integrando recepção de eventos, procedimentos de bem-estar, aferição de sinais vitais (DBHA 2025 / OMS / NR-7), QR Code de ficha clínica e painel epidemiológico com proteção LGPD.

---

## Estrutura Organizada do Projeto

```text
presenca-ecosafety/
├── public/                        # Interfaces Web integradas
│   ├── index.html                 # Portal Central (visão geral ao vivo + jornada integrada)
│   ├── presenca/                  # Módulo 1: Controle de Presença & Massoterapia
│   │   ├── index.html             # Interface responsiva (mobile + desktop + impressão)
│   │   ├── styles.css             # Estilos utilitários e badges de integração
│   │   └── app.js                 # Lógica conectada à API unificada + fallback offline
│   └── triagem/                   # Módulo 2: Triagem Clínica & Medicina do Trabalho
│       └── index.html             # Sinais vitais, QR Code, fila médica e painel LGPD
├── server/                        # Backend Node.js + Express unificado
│   ├── app.js                     # Servidor Express, rotas REST e roteamento de módulos
│   ├── db/
│   │   └── index.js               # Conexão híbrida: SQLite local (zero config) ou PostgreSQL/Supabase
│   ├── routes/
│   │   ├── auth.js                # Autenticação JWT + PBKDF2 da equipe de saúde
│   │   ├── config.js              # Configurações unificadas da clínica, evento e QR Code
│   │   ├── presencas.js           # API da Lista de Presença, procedimentos e /api/state
│   │   ├── triagens.js            # API de Triagem Clínica com vínculo automático à Presença
│   │   ├── integracao.js          # Resumo em tempo real, empresas compartilhadas e jornada
│   │   ├── painel.js              # Estatísticas epidemiológicas com corte LGPD (< 5 pessoas)
│   │   └── exportar.js            # Exportação CSV (completa e anonimizada)
│   └── services/
│       ├── authService.js         # Criptografia PBKDF2-SHA512 e controle de acesso RBAC
│       └── clinicaService.js      # Classificações DBHA 2025, OMS, FC e token de QR Code
├── api/
│   └── index.js                   # Entrypoint Serverless para deploy na Vercel
├── data/
│   └── triagem.db                 # Banco SQLite local unificado (criado/migrado automaticamente)
├── supabase.sql                   # Script SQL COMPLETO e UNIFICADO para PostgreSQL / Supabase
├── server.js                      # Inicializador HTTP local e na rede Wi-Fi
├── iniciar.bat                    # Inicializador rápido para Windows (duplo clique)
├── vercel.json                    # Configuração de rotas para Vercel
├── .env.example                   # Modelo de variáveis de ambiente
└── package.json                   # Dependências e scripts
```

---

## Como Iniciar

### Opção 1: Windows (Duplo Clique)
Execute `iniciar.bat`.

### Opção 2: Terminal
```bash
npm start
# ou em modo desenvolvimento:
npm run dev
```

Endereços disponíveis ao iniciar:
- **Portal Integrado:** `http://localhost:3000/`
- **Controle de Presença & Massoterapia:** `http://localhost:3000/presenca/`
- **Triagem Clínica & Medicina Ocupacional:** `http://localhost:3000/triagem/`

---

## Como Funciona a Integração (Presença ⇄ Triagem)

1. **Da Lista de Presença para a Triagem (`🩺 Triar`)**:
   - Na Lista de Presença (`/presenca/`), cada participante possui o botão **`🩺 Triar`**.
   - Ao clicar, abre-se a Nova Triagem (`/triagem/`) já com **Nome** e **Empresa** preenchidos e vinculados, além de exibir uma barra com todos os colaboradores aguardando triagem.
   - Assim que a enfermagem salva os sinais vitais, o registro na Lista de Presença muda automaticamente para **`✓ Cód. XXXXX`**.

2. **Da Triagem para a Lista de Presença (`Enviar p/ Presença`)**:
   - Após salvar uma triagem (no modal do QR Code ou na aba **Atendimentos**), clique em **`Enviar p/ Presença`** para encaminhar o paciente aos procedimentos de bem-estar/massoterapia já com seus dados preenchidos.

3. **Vínculo Automático Inteligente**:
   - Mesmo que o colaborador seja registrado separadamente nos dois módulos no mesmo dia, o banco de dados (SQLite e Triggers do PostgreSQL/Supabase) reconhece e vincula os dois atendimentos automaticamente, compartilhando também o catálogo de **Empresas**.

---

## Contas de Acesso Inicial (Módulo de Triagem)

| Perfil | E-mail | Senha |
| :--- | :--- | :--- |
| **Enfermagem** | `enfermeiro@ecoclinic.com.br` | `enf123` |
| **Médico do Trabalho** | `medico@ecoclinic.com.br` | `medico123` |
| **Administrador** | `admin@ecoclinic.com.br` | `admin123` |

---

## Banco de Dados PostgreSQL / Supabase

1. Execute o arquivo `supabase.sql` completo no **SQL Editor** do seu projeto Supabase.
2. Configure a variável `DATABASE_URL` no arquivo `.env` e reinicie o servidor.
