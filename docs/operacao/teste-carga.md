# Teste de carga da Ágora (RNF-10)

Relatório gerado por `npm run carga -w @agora/api` em 2026-11-08T18:00:58.999Z. Volumes de referência: `deploy/carga/carga.json`.

> Os volumes deste arquivo são sintéticos. Para o laudo do órgão, informe os volumes do ETP na configuração e rode contra a homologação (`--url`), com PostgreSQL e o trabalhador separado. Medição para apoio à decisão; requer revisão humana.

## Ambiente da execução

- Alvo: Ágora em processo (PGlite em memória, trabalhador embutido, integrações offline)
- Node v26.13.0; win32 10.0.26300; 22 CPU(s) (Intel(R) Core(TM) Ultra 7 165H); 31,4 GiB de memória
- Concorrência: 8 trabalhadores simultâneos

## Volumes de referência e vazão exigida no pico

- Processos por ano: 5000; documentos por ano: 15000; usuários simultâneos no pico: 150
- Expediente: 248 dias úteis × 8 h; pico de 10× a média; 40 escritas por processo; 2 consultas por usuário por minuto

- Listagens (processos, contratos, fornecedores, atas e painel): 5,0000 operação(ões)/s — 150 usuários simultâneos × 2 consultas por minuto ÷ 60 s
- Jornada (autuação, DFD e consulta do processo): 0,2800 operação(ões)/s — 5000 processos/ano × 40 escritas por processo; 248 dias úteis × 8 h, pico 10× a média
- Publicação no PNCP pela fila (até a primeira execução do trabalhador): 0,0070 operação(ões)/s — 5000 publicações/ano (uma por processo); 248 dias úteis × 8 h, pico 10× a média
- Envio de documentos do processo (PDF): 0,0210 operação(ões)/s — 15000 documentos/ano; 248 dias úteis × 8 h, pico 10× a média

## Resultados

| Cenário | Operações | Erros | Vazão medida (op/s) | Vazão exigida (op/s) | p50 (ms) | p95 (ms) | p99 (ms) | Limite p95 (ms) | Situação |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Listagens (processos, contratos, fornecedores, atas e painel) | 400 | 0 | 38,52 | 5,0000 | 199,7 | 285,7 | 288,9 | 1.000 | Atende |
| Jornada (autuação, DFD e consulta do processo) | 150 | 0 | 45,68 | 0,2800 | 168,3 | 238,4 | 241,0 | 1.500 | Atende |
| Publicação no PNCP pela fila (até a primeira execução do trabalhador) | 12 | 0 | 10,71 | 0,0070 | 780,1 | 784,2 | 784,2 | 5.000 | Atende |
| Envio de documentos do processo (PDF) | 60 | 0 | 64,64 | 0,0210 | 114,0 | 160,6 | 162,1 | 2.500 | Atende |

Atende = sem erros, vazão medida maior ou igual à exigida e p95 dentro do limite configurado.

## Observações

- Listagens (processos, contratos, fornecedores, atas e painel): 5 telas de consulta em rodízio, 25 itens por página.
- Jornada (autuação, DFD e consulta do processo): Rodízio de autuação (POST), DFD (PUT) e consulta (GET) de processos sintéticos; 55 processos criados.
- Publicação no PNCP pela fila (até a primeira execução do trabalhador): 12 cópias sintéticas do processo da etapa 5, cada uma publicada uma vez pela fila.
- Envio de documentos do processo (PDF): PDF sintético de uma página por envio, conferido (assinatura, integridade e conteúdo ativo) e gravado pelo SHA-256.
- No modo em processo, banco e aplicação dividem a mesma máquina e o banco é o PGlite em memória (um processo só): o resultado serve para comparar versões, não como capacidade da produção.
- A publicação pela fila mede a resposta da API até a primeira execução do trabalhador embutido, com o PNCP simulado (modo offline); nenhuma chamada sai para o PNCP real.
