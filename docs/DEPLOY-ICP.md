# Deploy — VPS ICP Core (6 GB / 4 vCPU EPYC)

Migração do linux-meta da Oracle Micro (1 GB, CPU steal) para o VPS pago ICP Core.

| | |
|---|---|
| **IP** | `184.107.178.66` |
| **Specs** | 4 vCPU AMD EPYC x86_64, 6 GB RAM, 100 GB NVMe |
| **SO** | Ubuntu (acesso root) |
| **Domínio** | `linux-meta.duckdns.org` (mesmo de antes; só reaponta o A record) |
| **Busca semântica** | **DESLIGADA** — Ollama removido (host compartilhado); busca por texto (trigram). Ver "Busca semântica" abaixo. |
| **Painel** | iContainer (1Panel-like), dashboard em `https://184.107.178.66:2090` |
| **Front / TLS** | **OpenResty do painel** faz TLS + reverse-proxy → `127.0.0.1:4400` |

> A instância Oracle antiga (`163.176.62.227`) continua no ar até esta migração
> ser validada. Só desligar depois de confirmar o site novo.

> **Arquitetura de rede:** o painel iContainer já ocupa as portas 80/443 com o
> OpenResty dele. Em vez de brigar por elas, o OpenResty do painel é o front
> door: termina o TLS (SSL incluso do painel) e faz reverse-proxy para o
> container web publicado em `127.0.0.1:4400`. Por isso o compose **não** tem
> Caddy — só postgres + web.

> **Busca semântica (Ollama) removida.** O VPS é compartilhado com outros
> projetos, então o Ollama foi retirado do compose para poupar recursos. O app
> detecta a ausência de `OLLAMA_URL` e usa busca por texto (trigram) — sem
> chamadas falhas nem logs de erro. Os embeddings continuam guardados no
> Postgres (`package_embedding`), então dá pra reativar: adicionar de volta um
> serviço `ollama`, definir `OLLAMA_URL=http://ollama:11434` no `.env.prod` e
> (se preciso) rodar `workers/embed-backfill.mjs`. Os passos de Ollama/backfill
> abaixo só valem se você optar por reativar.

---

## 1. Provisionar a máquina (root)

```bash
ssh root@184.107.178.66
apt-get update && apt-get -y upgrade

# Docker Engine + Compose plugin (se o painel ICP não trouxe pronto)
curl -fsSL https://get.docker.com | sh
docker compose version   # confirma o plugin

# Swap de segurança (2 GB — a RAM é folgada, mas evita OOM em pico)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
```

> **Firewall:** o painel iContainer já gerencia o firewall (e o plano tem
> anti-DDoS). **Não** habilite `ufw` do zero sem antes liberar as portas 22
> (SSH), 2090 (painel) e 80/443 — senão você se tranca pra fora. O mais
> seguro é gerenciar as regras pela UI do painel. As portas 80/443/2090 já
> estão abertas por padrão; a 4400 fica só em loopback (não precisa abrir).

## 2. Enviar o código (da máquina local)

`rsync` NÃO respeita `.dockerignore`, então excluímos os pesos manualmente
(`infra/docker/data` tem ~262 MB de modelos Ollama antigos; `backups/` tem o dump
de 341 MB — o dump vai separado no passo 4).

```bash
cd /home/elton/Downloads/linux-meta
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '**/.astro' \
  --exclude 'infra/docker/data' \
  --exclude 'backups' \
  --exclude '.env' --exclude '.env.prod' \
  ./ root@184.107.178.66:/root/linux-meta/
```

## 3. Configurar `.env.prod` na máquina (chmod 600)

```bash
ssh root@184.107.178.66
cd /root/linux-meta
cat > .env.prod <<'EOF'
DATABASE_URL=postgres://linuxmeta:TROQUE_A_SENHA@postgres:5432/linuxmeta
BETTER_AUTH_SECRET=<gerar: openssl rand -base64 48>
BETTER_AUTH_URL=https://linux-meta.duckdns.org
PUBLIC_SITE_URL=https://linux-meta.duckdns.org
PUBLIC_DEFAULT_LOCALE=pt
OLLAMA_URL=http://ollama:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
# Opcionais:
# RESEND_API_KEY=
# DEEPSEEK_API_KEY=
EOF
chmod 600 .env.prod
```

Se definir uma senha nova de Postgres, exporte-a também para o compose:
`echo 'POSTGRES_PASSWORD=TROQUE_A_SENHA' >> .env.prod` **não** basta (o compose lê
`POSTGRES_PASSWORD` do ambiente do shell, não do env_file do web). Rode o `up` com
`POSTGRES_PASSWORD=... docker compose ...` ou coloque num `.env` ao lado do compose.

## 4. Subir os serviços

```bash
cd /root/linux-meta/infra/docker
docker compose -f compose.prod.yml up -d --build
# ollama-pull baixa o nomic-embed-text sozinho; acompanhe:
docker compose -f compose.prod.yml logs -f ollama-pull
```

## 5. Importar os dados

Copie o dump da máquina local (fica fora do rsync por tamanho):

```bash
# local:
rsync -az backups/latest.dump root@184.107.178.66:/root/linux-meta/backups/
```

Restaure para dentro do container Postgres:

```bash
ssh root@184.107.178.66
cd /root/linux-meta
# pg_restore via container (não precisa de client no host):
docker exec -i linuxmeta-postgres sh -c \
  'psql -U linuxmeta -d linuxmeta -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS vector;"'
docker exec -i linuxmeta-postgres pg_restore --clean --if-exists --no-owner --no-privileges \
  -U linuxmeta -d linuxmeta < backups/latest.dump || true
# verifica:
docker exec linuxmeta-postgres psql -U linuxmeta -d linuxmeta -c 'SELECT count(*) FROM package;'
```

Esperado: ~80.458 pacotes, ~393.295 traduções.

## 6. Backfill dos embeddings (busca semântica)

Os dados importados não trazem embeddings — gere-os agora que o Ollama roda:

```bash
docker exec linuxmeta-ollama ollama list   # confirma nomic-embed-text presente

# roda o backfill de dentro do container web (tem node + o repo em /repo):
docker exec -e OLLAMA_URL=http://ollama:11434 -e EMBED_RPS=8 \
  linuxmeta-web node /repo/workers/embed-backfill.mjs
```

Com 4 vCPU e ~80k pacotes isso leva um tempo; é resumível (reinicia de onde parou).
Verificar:

```sql
SELECT count(*) FROM package_embedding WHERE model = 'nomic-embed-text';
```

Até o backfill terminar, a busca continua funcionando em modo texto (fallback trigram).

## 7. Reapontar o DNS

No painel DuckDNS, troque o IP de `linux-meta.duckdns.org` → `184.107.178.66`.
(Faça isto antes do passo 8 para o painel conseguir emitir o cert Let's Encrypt
— o desafio HTTP-01 precisa do domínio já apontando pro VPS.)

## 8. Criar o reverse-proxy + SSL no painel iContainer

O front é o OpenResty do painel (dashboard em `https://184.107.178.66:2090`).
Na UI do painel, criar um **Website do tipo Reverse Proxy** (às vezes "Proxy
reverso" / "Sites"):

- **Domínio:** `linux-meta.duckdns.org`
- **Destino / upstream:** `http://127.0.0.1:4400`
- Garantir que o proxy encaminhe os headers: `Host $host`,
  `X-Forwarded-Proto $scheme`, `X-Forwarded-For` (o template padrão do painel
  já faz isso — confira se o app receber "Invalid origin" no login).
- **SSL:** emitir certificado **Let's Encrypt** para o domínio (botão "HTTPS" /
  "SSL" do site) e ativar "forçar HTTPS".

> Alternativa por CLI (se preferir não usar a UI): criar um server block do
> OpenResty apontando `proxy_pass http://127.0.0.1:4400;` e emitir o cert com
> o próprio painel ou certbot. A UI é o caminho suportado ("SSL incluso").

## 9. Validar

```bash
# no VPS — app respondendo local:
curl -I http://127.0.0.1:4400
docker compose -f compose.prod.yml logs -f web
# de fora — via OpenResty + TLS:
curl -I https://linux-meta.duckdns.org
```

Teste login/admin e uma busca (confirme resultado semântico vs. trigram).

## 10. Desligar a Oracle antiga

Só depois de tudo validado por algumas horas: pare os containers da Micro e/ou
termine a instância Oracle. Guarde o último dump antes.

---

## Orçamento de memória (6 GB)

| Serviço | `mem_limit` | Notas |
|---|---|---|
| postgres | 1.5 g | shared_buffers 512 MB |
| web (Node) | 1.0 g | heap cap 768 MB |
| **soma** | **~2.5 g** | tetos, não reservas; host é compartilhado com outros projetos |

> TLS/proxy ficam no OpenResty do painel (fora do compose), e o Ollama foi
> removido — então nem Caddy nem Ollama consomem RAM aqui.

## Armadilhas do painel iContainer (SSL)

Ao emitir o SSL, o painel regenera o vhost e o proxy. Dois problemas conhecidos:

1. **`www` no server_name.** O painel adiciona `www.linux-meta.duckdns.org`
   automaticamente. O DuckDNS **não** tem registro `www`, então incluir esse
   nome no certificado faz a validação HTTP-01 falhar. Emita o cert **só para o
   apex** `linux-meta.duckdns.org` (desmarque o www na tela de SSL, ou remova o
   alias antes de solicitar).

2. **`proxy_pass` vira `https://` → 502.** O painel reescreve o upstream do
   proxy de `http://127.0.0.1:4400` para `https://127.0.0.1:4400`. O app Node
   fala HTTP puro, então o OpenResty falha o handshake TLS e devolve **502 Bad
   Gateway** (o cert externo está OK; quebra só a perna interna). Corrigir:

   ```bash
   F=/etc/icontainer/apps/openresty/openresty/www/sites/linux-meta.duckdns.org/proxy/root.conf
   sed -i 's#proxy_pass https://127.0.0.1:4400;#proxy_pass http://127.0.0.1:4400;#' "$F"
   OR=$(docker ps --format '{{.Names}}' | grep -i openresty | head -1)
   docker exec "$OR" openresty -t && docker exec "$OR" openresty -s reload
   ```

   > O OpenResty do painel roda como **container** (`icontainer/openresty`),
   > não no host — por isso o reload é via `docker exec`. **Reaplicar o SSL ou
   > editar o site na UI reverte o proxy_pass pra `https` e traz o 502 de
   > volta** — refaça o sed + reload.

## Ops rápido

```bash
cd /root/linux-meta/infra/docker
docker compose -f compose.prod.yml logs -f web        # logs
docker compose -f compose.prod.yml restart web        # restart
docker compose -f compose.prod.yml up -d --build web  # deploy de código novo (após rsync)
docker stats --no-stream                              # uso de memória real
```
