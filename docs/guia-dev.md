# Guia de desenvolvimento — linux-meta

Documento de entrada para quem vai continuar o desenvolvimento. Explica o que o
projeto é, como está organizado, como os dados fluem e onde mexer para as
tarefas mais comuns. Para subir o ambiente, veja [`setup.md`](setup.md).

---

## 1. O que é o linux-meta

É um **catálogo curado de descrições de software Linux** com metadados de
segurança. Para cada pacote (de Manjaro, Flathub, AUR, Debian) o sistema guarda:

- **descrição em linguagem simples** (não o jargão do upstream), traduzida;
- **idade recomendada** + classificação de conteúdo (OARS);
- **perfil**: é app/biblioteca/serviço/tema/jogo? GUI/CLI/TUI? como se inicia?
- **proveniência** de cada dado: importado do upstream, sugerido por IA, ou
  revisado por humano;
- sinais extras: permissões, CVEs, saúde do projeto upstream, popularidade.

O site tem duas faces:

- **Pública** — ajuda alguém a descobrir e entender um software antes de
  instalar (famílias, escolas, curiosos). Também publica o dataset aberto.
- **Admin/curadoria** — onde humanos revisam e aprovam o conteúdo que a IA
  rascunhou. A fila de revisão (217k rascunhos) é o trabalho central.

Escala atual: ~27,5k softwares (deduplicados), ~80k linhas de `package`,
~393k traduções em 243 locales, busca semântica com pgvector.

---

## 2. Arquitetura geral

Monorepo pnpm. Peças:

```
apps/web/          Site Astro (SSR) + área admin + endpoints de API
packages/db/       Schema Drizzle + migrações (fonte da verdade do banco)
workers/           Pipeline de dados (ingest, classify, translate, embed, …)
infra/docker/      Postgres+pgvector e Ollama via docker compose
tools/             Scripts utilitários (review workbench, sync de metadados)
docs/              Documentação (este guia, setup, admin, schema…)
backups/           Dumps do banco (gitignored)
```

O **banco PostgreSQL (com pgvector)** é o centro de tudo. O site lê/escreve
direto nele via Drizzle; os workers populam e enriquecem.

---

## 3. Stack

- **Astro 6** em modo **SSR** (`output: 'server'`, adapter `@astrojs/node`
  standalone). Páginas renderizam no servidor a cada request.
- **Preact** para as "islands" (componentes interativos: editor de tradução,
  formulários de auth). A maior parte da UI é HTML server-rendered sem JS.
- **CSS puro com design tokens** (`apps/web/src/styles/tokens.css`) — sem
  Tailwind. Estética editorial, dark mode, tokens de marca no espectro de idade.
- **PostgreSQL + pgvector** (busca semântica), **pg_trgm** (busca fuzzy),
  **citext** (emails). Acesso via **Drizzle ORM** (driver `postgres`/porsager).
- **Better Auth** — sessão e papéis.
- **Ollama** (local, `nomic-embed-text` 768-dim) — embeddings/busca semântica.
- **DeepSeek** (API compatível com OpenAI, via `fetch`) — tradução assistida.
- i18n nativo do Astro: **`pt`** (default) e **`en`**, URLs `/pt/...` `/en/...`.

> ⚠️ O dev server roda em **`http://localhost:4400`** (não no 4321 padrão do
> Astro). O `BETTER_AUTH_URL` precisa bater com a origem acessada, senão o login
> dá "Invalid origin".

---

## 4. Estrutura de `apps/web/src`

```
pages/[locale]/            Rotas (o prefixo [locale] é pt|en)
  index.astro                Home (storytelling)
  browse.astro               Catálogo facetado
  p/[slug].astro             Página de um pacote
  why.astro                  Contexto regulatório (detalhe)
  lists.astro                Listas curadas
  c/[category].astro         Vanity: redireciona p/ browse?category=
  age/[n].astro              Vanity: redireciona p/ browse?maxAge=n
  revisar/queue/index.astro  Fila de revisão priorizada
  traduzir/index.astro       Editor de tradução (translator)
  admin/                     Cockpit, quality, workers, users, ratings…
pages/api/v1/              Endpoints JSON (search, translate/suggest, admin/…)
components/                EspecimenCard, RatingBadge, ProvenanceChip, FacetBar,
  pkg/FactChips, pkg/ScreenshotGallery, home/*, admin/TranslationEditor…
lib/                       Lógica de dados (ver abaixo)
styles/                    tokens.css, global.css, fonts.css
i18n/                      config + dicionários pt.json/en.json
middleware.ts              Locale negotiation + sessão + adminGate
```

### Libs principais (`apps/web/src/lib`)

| Arquivo | Papel |
|---|---|
| `db.ts` | Conexão Drizzle + `schema` (re-exporta `@linux-meta/db`) |
| `packages.ts` | `searchPackages` (texto/trgm), `searchPackagesSemantic` (pgvector), `getPackageDetail` |
| `categories.ts` | Taxonomia (11 categorias), `getCategoryCounts`, **`queryCatalog`** (browse facetado) |
| `stats.ts` | `getSiteStats`, `getProvenanceBreakdown`, **`getCurationStats`** (cockpit) |
| `quality.ts` | Radar de qualidade: rollup + listas por sinal |
| `review-queue.ts` | Ordenação priorizada da fila de revisão |
| `review-validation.ts` | Regras de qualidade (filler/comprimento) — fonte única, usada na UI e no harness |
| `deepseek.ts` | Cliente DeepSeek (fetch, retry 429, custo) |
| `translate-harness.ts` | Tradução com validação + 1 passo de refino |
| `embeddings.ts` | Geração de embeddings via Ollama |
| `roles.ts` | `getUserRole`, `hasRole`, `landingFor` |

---

## 5. Modelo de dados (tabelas-chave)

Schema em `packages/db/src/schema/*.ts`. Principais:

- **`package`** — identidade do pacote por fonte. `slug`, `canonical_slug`
  (agrupa o "mesmo app" entre distros), `source`, `raw_metadata` (jsonb do
  upstream), `popularity`, `cat_path` (categoria computada), `icon_url`,
  `moderation_status`.
- **`package_translation`** — (package_id, locale) → `summary`, `description`,
  `plain_explanation`, **`status`** (`draft`/`reviewed`/`official`),
  **`translated_by`** (`upstream`/`ai_*`/`human`), `*_source`.
- **`package_official_metadata`** — fatos oficiais do upstream (nunca
  sobrescritos pela revisão).
- **`package_profile`** — `component_type`, `interface_kinds` (jsonb),
  `audience_tags`, `launchable`, `launch_*`, `provided_binaries`,
  `is_dependency_only`, … (indexado, mas o público só passou a usar no redesign).
- **`rating` / `rating_current`** — OARS + `age_min`; `rating_current` é a visão
  efetiva por pacote com `dominant_source`.
- **`package_embedding`** — `vector(768)` por (package_id, locale, model).
- **`permission_analysis`, `cve_link`, `project_health`** — enriquecimento.
- **`audit_log`** — append-only; toda mutação privilegiada grava aqui
  (`actor`, `action`, `before`, `after`).
- **`worker_run`** — telemetria dos workers.
- **`dispute`, `volunteer_application`, `package_submission`** — contribuição.
- **`user`, `session`, `account`** — Better Auth.

### Proveniência (conceito central)

Todo dado tem origem rotulada, e o site mostra isso:

- **importado** — redistribuído do upstream (`translated_by='upstream'`,
  `dominant_source='oars_official'`).
- **IA** — rascunhado pelos workers (`translated_by LIKE 'ai_%'`).
- **humano** — revisado por colaborador (`status` reviewed/official + edição).

Os componentes `ProvenanceChip` e as métricas em `stats.ts` dependem disso.

---

## 6. Ciclo de vida de uma descrição

```
ingest        → cria package + raw_metadata + official_metadata
classify (IA) → rating (OARS, age_min), status implícito
translate(IA) → package_translation status='draft', translated_by='ai_*'
profile       → package_profile (tipo, interface, launch…)
embed         → package_embedding (pgvector) p/ busca semântica
revisão       → humano edita+aprova → status='reviewed', translated_by='human'
publicação    → status='official' → entra no catálogo público
```

Os workers ficam em `workers/` (ingest, classify, translate, embed, enrich,
export). Cada execução grava em `worker_run`.

A **fila de revisão** (`/revisar/queue`) é onde o humano transforma rascunho IA
em conteúdo revisado. Ordena por impacto (disputa > popularidade > ainda-IA).

---

## 7. Site público

- **Home** (`index.astro`) — storytelling liderado por descoberta:
  hero busca-primeiro → spotlight de um pacote real → portas (listas/categorias)
  → confiança/proveniência → como o dado é construído → banda de leis (compacta,
  detalhe em `/why`) → participação → FAQ.
- **Browse** (`browse.astro`) — catálogo facetado via `queryCatalog`. Facetas:
  idade apropriada, tipo, interface (GUI/CLI/TUI), fonte, só-apps. Resultados em
  grid de `EspecimenCard`. As facetas vêm por querystring (GET, compartilhável).
- **Página de pacote** (`p/[slug].astro`) — ícone, FactChips (perfil), callout
  "Em palavras simples" (`plain_explanation`), screenshots, descrição, segurança
  (idade/OARS/permissões/CVE), técnico/launch, saúde, proveniência.
- **Busca** — `searchPackages` (trgm+FTS) e `searchPackagesSemantic` (pgvector,
  cai pra trgm se Ollama off). Endpoint `/api/v1/packages/search`.
- **Rotas vanity** — `/c/[category]` e `/age/[n]` redirecionam pro browse com
  facetas pré-setadas (URLs limpas/SEO).
- **i18n** — `pt`/`en` na URL. **Atenção:** o banco usa `pt-br` (não `pt`); as
  queries mapeiam `pt → pt-br`, com fallback `en`.

---

## 8. Área admin / curadoria

Papéis (hierarquia): **visitor → contributor → translator → reviewer → admin**
(`lib/roles.ts`). Checagem **server-side** em toda página/endpoint admin. O
middleware `adminGate` manda não-admins que tentam `/admin/*` para o workspace
deles (reviewer→fila, translator→traduzir).

- **Cockpit** (`admin/index.astro`) — `getCurationStats`: backlog + burn-down,
  saúde dos workers, avisos de qualidade, cobertura por idioma, disputas,
  revisores. Ação primária: "Começar a revisar".
- **Fila de revisão** (`revisar/queue`) — reusa `TranslationEditor` (en↔alvo
  lado-a-lado, copiar, auto-avança). **Gate inline**: texto filler/curto bloqueia
  "Marcar como revisado" (regras de `review-validation.ts`). Cursor de skip.
- **Radar de qualidade** (`admin/quality`) — `quality.ts`: sinais (sem revisão
  humana, rating IA, sem perfil, sem embedding, CVE aberta) com contagens e
  triagem por popularidade. Botão de gerar embeddings.
- **Workers** (`admin/workers`) — KPIs, sparkline, detecção de "travado"
  (running > 2× p95, ou > 24h sem baseline), alerta de última falha.
- **Auditoria** (`admin/audit`) — histórico imutável.

---

## 9. Tradução com IA (DeepSeek) + harness

Objetivo: rascunhar tradução de boa qualidade dentro do editor.

- `lib/deepseek.ts` — cliente HTTP (sem SDK, sem dependência nova). Gated em
  `DEEPSEEK_API_KEY`; sem a chave o endpoint retorna 503 (degrada limpo).
- `lib/translate-harness.ts` — o "harness": prompt de domínio (regras do
  catálogo) → resposta JSON → **valida** (`review-validation` + plausibilidade:
  não-eco do inglês, razão de tamanho, nome sobrevive) → se falhar, **1 passo de
  refino** realimentando a crítica.
- Endpoint `POST /api/v1/translate/suggest` (translator/reviewer/admin) — retorna
  sugestão (não grava no banco). O botão "Traduzir com IA" no `TranslationEditor`
  preenche os campos; o humano edita e salva via PATCH.

Ideia herdada do projeto **LangForge**: prompt forte + validar + refinar.

---

## 10. Embeddings / busca semântica

Tudo **local** via Ollama (`nomic-embed-text`, 768-dim) — sem API externa.

- `lib/embeddings.ts` — `embedText` (Ollama), `generateMissingEmbeddings`
  (mais populares primeiro, upsert idempotente).
- Gerar pela UI: radar de qualidade → sinal "sem embedding" → botão.
- Backfill em massa: `pnpm --filter @linux-meta/web exec tsx src/_backfill-embeddings.ts`.
- Busca: `searchPackagesSemantic` usa `embedding <=> $vec::vector` (distância
  cosseno do pgvector).

---

## 11. Convenções importantes

- **`pt` vs `pt-br`**: locale da URL é `pt`; locale do banco é `pt-br`. Ao
  consultar traduções, prefira `pt-br` e caia pra `en`.
- **Proveniência sempre rotulada** (importado/IA/humano). Ao gravar revisão
  humana com edição, promova `translated_by='human'` (já feito no PATCH).
- **Validação de qualidade é fonte única** (`review-validation.ts`): mesma regra
  na UI de revisão, no harness de IA e nos sinais de qualidade.
- **i18n**: textos da UI nos dicionários `i18n/*.json` ou inline `isPt ? … : …`.
  Conteúdo do catálogo vive no banco (traduções), não nos dicionários.
- **Auditoria**: toda mutação admin passa por `logAdminAction`/grava `audit_log`.
- **Componentes reutilizáveis primeiro**: `EspecimenCard`, `RatingBadge`,
  `ProvenanceChip`, `FactChips`, `EditorialGrid` antes de criar novos.

---

## 12. Armadilhas conhecidas (gotchas)

- **Porta 4400**, não 4321. `BETTER_AUTH_URL` precisa bater com a origem.
- **`astro check` e `return Astro.redirect(...)` no frontmatter**: símbolos
  usados só dentro de um *segundo* `return` de topo às vezes são marcados como
  "declared but never read" (falso positivo). Solução usada: pôr a lógica de
  redirecionamento por papel no `middleware.ts` em vez do frontmatter.
- **`cat_path`** existe no banco mas **não** está no schema Drizzle — acesse por
  SQL cru (`sql\`...\``), não por `schema.packageTable.catPath`.
- **`pt-br`**: ver convenção acima — esquecer disso faz a UI cair pro inglês.
- **Dump grande**: `backups/` é gitignored. Não comite dumps.
- **dev server (vite) e dependências**: depois de muitas edições, o vite pode
  servir um chunk "Outdated Optimize Dep" (504) e quebrar a hidratação das
  islands. Reinicie o dev server. Em produção (build) não acontece.

---

## 13. Onde mexer para tarefas comuns

| Quero… | Mexer em |
|---|---|
| Adicionar uma faceta no browse | `CatalogFacets` + SQL em `lib/categories.ts` (`queryCatalog`) + `components/FacetBar.astro` + parsing em `browse.astro` |
| Adicionar campo na página de pacote | `getPackageDetail` (`lib/packages.ts`) + `p/[slug].astro` |
| Novo idioma de UI | `i18n/config.ts` + `i18n/<lang>.json` |
| Nova categoria/subcategoria | `taxonomy` em `lib/categories.ts` (e re-backfill de `cat_path`) |
| Novo sinal de qualidade | `signalParts` + rollup em `lib/quality.ts` + chip em `admin/quality` |
| Mudar regras de qualidade da tradução | `lib/review-validation.ts` (afeta UI + IA + radar) |
| Novo painel no cockpit | `getCurationStats` (`lib/stats.ts`) + `admin/index.astro` |
| Novo provedor de tradução IA | espelhar `lib/deepseek.ts` e ligar no `translate-harness.ts` |
| Novo worker | `workers/<nome>/` + gravar em `worker_run` via helper |

---

## 14. Qualidade / verificação

Antes de dar como pronto:

```bash
pnpm --filter @linux-meta/web run check   # astro check (autoridade p/ .astro)
pnpm --filter @linux-meta/web run build   # build SSR
```

Gate completo do projeto (opcional, mais amplo):
`node ~/.agents/scripts/quality-gate.mjs apps/web`.

Para validar mudança visual/admin de verdade: rode em produção
(`node apps/web/dist/server/entry.mjs` com env) e teste logado — o login exige
origem `http://localhost:4400` (= `BETTER_AUTH_URL`).

---

## 15. Onde continuar

Ver `docs/setup.md` (ambiente), `docs/admin.md` (papéis e contratos de API do
admin), `docs/db-schema.md` (referência de tabelas), `docs/package-profile.md`
(regras de escrita das descrições). O histórico recente do git resume o redesign
por fases (home, descoberta, cockpit, fila de revisão, IA, qualidade, embeddings,
portabilidade do banco).
