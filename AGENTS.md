# Regras do projeto — Ágora (redesign ComprasSUSP)

Estas regras valem para qualquer modelo (Claude, Kimi, Gemini) que trabalhe neste repositório.
`AGENTS.md` tem o mesmo conteúdo para agentes que leem esse arquivo.

## Regra 1 — Leitura de código: SEMPRE Kaxcav Vortex (`kvx`) primeiro

Antes de abrir arquivo com cat/grep/read, use o MCP `kaxcav-vortex` (ou o kvx exposto pela `fabrica-kaxcav`):

| Objetivo | Ferramenta kvx |
|---|---|
| Entender uma tarefa | `context` (pacote L0–L3 com orçamento de tokens; reaproveite o `etag` com `delta_from`) |
| Localizar código | `search`, `search_symbols` |
| Ver a estrutura de um arquivo | `file_outline` |
| Ler só uma função | `read_symbol` |
| Mapear dependências | `call_graph` |
| Antes de commitar | `blast_radius`, `affected`, `diff_impact` |
| Documentos (.xlsx/.docx/.pdf) | `nexus_ingest_vault`, `nexus_query_sheet`, `nexus_audit_dlp` |

Leia arquivo cru apenas quando o kvx não cobrir o caso (ex.: bundles minificados em `reference/assets/`).

## Regra 2 — Orquestração e qualidade: SEMPRE Fábrica Kaxcav

A Fábrica (`C:\FABRICA-KAXCAV`, MCP `fabrica-kaxcav`) coordena os modelos e as travas de qualidade. Não improvise outra orquestração.

- Planejar a partir de uma ideia → `fabrica_brainstorm`
- Ver agentes/CLIs disponíveis → `fabrica_probe_agents`
- Ponto de restauração antes de mudança grande → `fabrica_checkpoint_create` (desfazer: `fabrica_checkpoint_rollback`)
- Proteger código estável → `fabrica_lock_symbols`
- Antes de entregar → `fabrica_run_gates` (zero-slop, ciclos, camadas, DLP), `fabrica_slop_scan`, `fabrica_arch_check`, `fabrica_semantic_diff`
- Delegar trabalho pesado → Fábrica, `kimi -p "..."` ou, quando o Kimi estiver sem cota, `agy -p "..." --model gemini-3.8-flash-high --mode accept-edits --sandbox`. O modelo coordenador revisa e verifica.
  - O agy roda sem supervisão com as permissões de `~/.gemini/antigravity-cli/settings.json` (`permissions.allow`): lê `plataforma/`, `docs/` e estas regras, escreve só em `plataforma/`, e `reference/` é negado. Rode o agy a partir de `plataforma/`.
  - Comandos npm/node só passam na forma **exata** listada lá (ex.: `npm run test -w @agora/dominio`). No prompt, peça um comando por vez, sem `;`, `&&` ou pipes. Precisa de outro comando? Acrescente a linha exata ao arquivo antes de delegar.

CLI equivalente: `node --experimental-strip-types C:\FABRICA-KAXCAV\src\cli\main.ts <brainstorm|gates|semantic-diff|slop-scan|arch-check|checkpoint|rollback|context|agents> --repo .`

Nunca usar, sugerir ou reinstalar o gortex.

## Regra 3 — Dados

- `reference/` contém dados operacionais REAIS coletados do portal original. Nunca copie esses dados para o código, seeds, testes, capturas de demonstração ou commits. Use apenas dados sintéticos gerados pelo seed.
- `reference/` nunca entra no repositório git da plataforma (`plataforma/`).
- Não reutilize código-fonte do portal original. A Ágora é implementação própria.

## Regra 4 — Soberania e segurança (requisitos não negociáveis)

- Nada de CDN ou serviço de terceiros em tempo de execução no navegador (fontes, ícones e scripts são servidos pela própria aplicação).
- O navegador fala só com a API da Ágora. Integrações (PNCP, Compras.gov.br, Contratos.gov.br, SEI, CEIS/CNEP) rodam no servidor, com proveniência e trilha de auditoria.
- Autorização (RBAC + escopo por UASG) é decidida no servidor. O cliente só esconde o que o servidor já negou.
- Toda escrita gera evento na trilha de auditoria encadeada por hash.
- Dados pessoais (CPF, e-mail, telefone) mascarados por padrão; o acesso ao dado completo é registrado (LGPD art. 37).
- Sem segredos no bundle do front-end. Configuração por variáveis de ambiente.

## Regra 5 — IA

- IA gera rascunhos e sinais, nunca decisões. Sanção, habilitação, fraude, multa e impedimento são sempre decisão humana.
- Todo texto gerado indica fontes, premissas, data e "requer revisão humana".
- Provedor padrão: nenhum (modelos determinísticos). LLM só auto-hospedado (endpoint compatível com OpenAI em infraestrutura do órgão), configurado por ambiente.

## Regra 6 — Interface

- Padrão Digital de Governo (gov.br DS 3.7): Rawline (fallback Raleway), tokens oficiais, contraste AA, teclado, zoom 200%.
- Textos da interface em pt-BR.
