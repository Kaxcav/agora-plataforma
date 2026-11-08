# Frente C — CEIS, CNEP e certidões (F18, PoC-04)

Entrega da consulta ao CEIS e ao CNEP, do checklist de regularidade antes de assinar, prorrogar, atestar e pagar, do
registro das certidões e do controle do registro das sanções aplicadas no CEIS/CNEP (Lei 14.133/2021, art. 91, § 4º;
art. 92, XVI; art. 68, III a V; art. 161).

## 1. O que foi feito (F18 e PoC-04)

| Item do plano | Entrega |
|---|---|
| F18.1 — Consulta real ao CEIS e ao CNEP | Conector no servidor (`apps/api/src/integracoes/transparencia.ts`) para a API de dados do Portal da Transparência: `GET {AGORA_TRANSPARENCIA_URL}/ceis` e `/cnep` com `codigoSancionado` e `pagina`, cabeçalho `chave-api-dados` (conferidos na especificação OpenAPI oficial da API). Tempo limite de 15 s por requisição, 2 novas tentativas com espera exponencial em 429, 5xx e falha de rede, paginação limitada, filtro pela raiz do CNPJ, datas `DD/MM/AAAA` normalizadas e hash SHA-256 do conteúdo recebido. No modo offline (padrão), lê a base simulada da carga sintética. |
| F18.1 — Cache com proveniência e auditoria | Cada consulta fica em `consultas_ceis_cnep` com fonte, modo, instante, hash e quantidade, e gera o evento `regularidade.consultar` (ou `regularidade.consulta_falhou`). As travas reaproveitam a consulta dentro de `AGORA_TRANSPARENCIA_CACHE_MINUTOS` (padrão 60). O checklist só aceita consulta com até 24 h. |
| F18.1 — Resultado na tela, com fonte e data | Aba **Regularidade e certidões** no fornecedor; checklist do vencedor na etapa 7 da jornada; checklist do contratado na prorrogação (aba **Aditivos** do contrato); prévia no atesto e verificação antes do pagamento. Cada item mostra a fonte, a data da consulta ou da validade e o fundamento. |
| F18.2 — Checklist pré-assinatura e pré-prorrogação | `avaliarChecklistRegularidade` (`packages/dominio/src/lei14133/regularidade.ts`) reúne a consulta ao CEIS/CNEP, as sanções impeditivas aplicadas pelo órgão e as certidões fiscal federal (CND), do FGTS (CRF) e trabalhista (CNDT). Sanção vigente, certidão ausente, vencida ou positiva, ou consulta indisponível bloqueiam a assinatura (`POST /processos/:id/contratar`) e a prorrogação (`POST /contratos/:id/prorrogacoes`, nova). A verificação é gravada em `verificacoes_regularidade` e na trilha mesmo quando bloqueia. |
| F18.2 — Registro das certidões | `POST /fornecedores/:id/certidoes`: tipo, número, emissor, emissão, validade e resultado, com a confirmação de que o agente conferiu a certidão no sítio do emissor. O domínio rejeita emissão futura e validade acima do prazo do emissor (180 dias para a CND e a CNDT, 30 dias para o CRF). A Ágora avisa 15 dias antes do vencimento. |
| F18.2 — Integração com a RN-09 | A RN-09 foi reescrita no catálogo. `avaliarRegularidade` (usada na etapa 7, no simulador de aditivo e no detalhe do fornecedor) passou a usar o mesmo checklist. A contratação faz antes a verificação com consulta nova e, dentro da transação, reavalia. |
| F18.3 — Recheque antes do atesto e do pagamento (RN-23) | O atesto (`POST /pagamentos/:id/atestar`) consulta de novo e confere as certidões; o financeiro repete antes do pagamento (`POST /pagamentos/:id/regularidade`). Irregularidade não impede o atesto: registra a ressalva e abre pendência de alta prioridade para o gestor notificar o contratado. |
| F18.4 — Registro da sanção no CEIS/CNEP em 15 dias úteis (RN-24) | Lista das sanções aplicadas com o prazo de `prazoRegistroCeisCnep`, situação (`situacaoRegistroCeisCnep`), alerta a partir de 5 dias úteis e destaque quando vencida; registro do envio com cadastro, protocolo, data e responsável (`POST /sancoes/:id/registro-ceis-cnep`), auditado. |
| PoC-04 (parte do art. 91, § 4º) | e2e `e2e/testes/ceis-cnep.spec.ts`: contratar CNPJ com inidoneidade vigente no CEIS (simulada) é bloqueado, com a fonte e a data da consulta na tela; certidão vencida bloqueia a prorrogação e, depois de registrada a certidão nova, a prorrogação passa. A dosimetria da multa do PoC-04 já existia (RN-12 e RN-19). |
| Comprovante para o processo | `GET /regularidade/verificacoes/:id/comprovante.pdf`: PDF da verificação (itens, fonte, data, hash da consulta), para juntar ao processo SEI. |

## 2. Linhas da conversa atendidas

- **69–70 e 211–213** (Módulo 4, RN): consulta obrigatória e automática de regularidade fiscal, CEIS, CNEP e débitos trabalhistas antes da assinatura ou prorrogação; envio das sanções ao CEIS/CNEP em 15 dias úteis.
- **265** (Módulo 4): checklist automático pré-assinatura (CEIS, CNEP e CNDs).
- **401 e 661**: verificação automática pré-assinatura e pré-prorrogação de regularidade fiscal, trabalhista, CEIS e CNEP.
- **426**: mitigar a falta de consulta prévia ao CEIS/CNEP antes da assinatura (a trava torna a consulta obrigatória).
- **688** (PoC-04): bloqueio da assinatura com CNPJ que tem sanção vigente simulada no CEIS/CNEP.
- **922** (minuta): declaração de conformidade pré-celebração — o comprovante em PDF da verificação reúne a consulta e as certidões para juntar ao processo.
- **1525** (rastreabilidade do Módulo 4 com o PoC-04).
- **1551–1556** (RN-04.1): trava pré-assinatura e pré-prorrogação, consulta via API, certidões juntadas ao processo e bloqueio da assinatura.
- **1558–1560** (RN-04.2, parte do CEIS/CNEP): transmissão das sanções aplicadas em 15 dias úteis — atendida pelo equivalente lícito abaixo. A dosimetria e o limite de aditivos da mesma linha já estavam implantados (RN-10 e RN-12).
- As linhas **1545–1550** (RF-04.3, 3 linhas de defesa e prazo do TCU) não são desta frente.

## 3. Equivalentes lícitos adotados

1. **"Envio automático de sanções ao CEIS/CNEP" (linhas 70, 213 e 1560).** Os cadastros da CGU não têm API pública de escrita: a informação é feita pelo órgão no sistema da CGU, com credencial própria. A Ágora controla a obrigação do art. 161 — cada sanção aplicada vira pendência com prazo de 15 dias úteis, alerta e destaque quando vencida — e registra o envio com cadastro, protocolo, data e responsável, na trilha de auditoria. Quando houver serviço oficial de escrita, basta trocar o registro manual pela chamada no servidor.
2. **"Emitir e juntar ao processo as certidões" (linha 1553).** A CND federal, o CRF e a CNDT não têm API aberta para emissão por terceiros. O agente emite no sítio do emissor, confere a autenticidade e registra os dados; a Ágora valida as datas, controla a validade e avisa o vencimento. O resultado da verificação sai em PDF para juntar ao processo SEI (não há integração de escrita com o SEI).
3. **Atesto e pagamento com irregularidade (RN-23).** A irregularidade fiscal não autoriza, por si só, reter o pagamento do que já foi executado, e a sanção superveniente não extingue sozinha o contrato em curso. Por isso o recheque não bloqueia o atesto: registra a ressalva, abre pendência para notificar o contratado (art. 92, XVI) e indica que extinção (art. 137) ou sanção (art. 156) dependem de decisão da autoridade competente, com contraditório. A assinatura e a prorrogação, essas sim, ficam bloqueadas (art. 91, § 4º).
4. **Abrangência das sanções.** Impedimento ou suspensão aplicados por ente de outra esfera alcançam só o ente que os aplicou (art. 156, § 4º): viram "atenção" para o agente conferir, sem bloqueio. Inidoneidade, proibição de contratar e decisões judiciais bloqueiam. Registros do CNEP sem restrição de contratar (por exemplo, multa) aparecem como atenção. O sistema não decide sanção nem impedimento: aplica a verificação exigida em lei e mostra a fonte.
5. **Sem chave, sem consulta simulada.** Em `AGORA_INTEGRACOES=online` sem `AGORA_TRANSPARENCIA_CHAVE`, a consulta falha e a trava bloqueia; a Ágora nunca troca a fonte oficial pela base simulada. Se a fonte falhar, vale a última consulta bem-sucedida com até 24 h, com o aviso da falha.
6. **LGPD.** Os registros do CEIS/CNEP são guardados normalizados, sem nomes nem documentos de pessoas; o documento do fornecedor aparece mascarado conforme as regras atuais.

## 4. Regras novas e alteradas

| Regra | Título | Implementação |
|---|---|---|
| RN-09 (reescrita) | Verificação de regularidade e sanções antes da assinatura ou prorrogação | `avaliarChecklistRegularidade`; `POST /processos/:id/contratar`; `POST /contratos/:id/prorrogacoes` |
| RN-23 | Recheque da regularidade antes do atesto e do pagamento | `avaliarChecklistRegularidade`, `situacaoCertidao`; `POST /pagamentos/:id/atestar`; `POST /pagamentos/:id/regularidade` |
| RN-24 | Registro da sanção aplicada no CEIS/CNEP em até 15 dias úteis | `situacaoRegistroCeisCnep`, `prazoRegistroCeisCnep`; `GET /sancoes/registro-ceis-cnep`; `POST /sancoes/:id/registro-ceis-cnep` |
| RF-20 | Consulta ao CEIS e ao CNEP e checklist de regularidade | `avaliarChecklistRegularidade`, `classificarRegistroSancaoExterna`, `validarCertidao`; rotas do fornecedor |

Funções novas do domínio (`packages/dominio/src/lei14133/regularidade.ts`): `validarCertidao`, `situacaoCertidao`,
`classificarRegistroSancaoExterna`, `avaliarChecklistRegularidade`, `situacaoRegistroCeisCnep` e a constante
`CERTIDOES_REGULARIDADE`.

Permissões novas (no fim de `TODAS_PERMISSOES` e do tipo `Permissao`): `certidoes:registrar` e
`regularidade:consultar`, dadas ao gestor de contratos, ao fiscal, ao financeiro e ao agente de contratação (o
administrador tem todas).

## 5. Rotas novas

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /fornecedores/:id/regularidade?momento` | `fornecedores:ler` | Checklist com a última consulta em cache (sem chamada externa) |
| `POST /fornecedores/:id/regularidade/consultar` | `regularidade:consultar` | Consulta nova ao CEIS/CNEP, registrada como verificação |
| `GET /fornecedores/:id/certidoes` | `fornecedores:ler` | Certidões registradas, mais recentes primeiro |
| `POST /fornecedores/:id/certidoes` | `certidoes:registrar` | Registro da certidão conferida |
| `GET /contratos/:id/regularidade?momento` | `contratos:ler` | Checklist antes da prorrogação (escopo de UASG) |
| `POST /contratos/:id/prorrogacoes` | `contratos:editar` | Termo aditivo de prazo depois do checklist; 422 com detalhes RN-09 se bloquear |
| `GET /pagamentos/:id/regularidade` | `pagamentos:ler` | Prévia do recheque (atesto ou pagamento) |
| `POST /pagamentos/:id/regularidade` | `regularidade:consultar` | Recheque antes do pagamento; abre pendência se irregular |
| `GET /regularidade/verificacoes/:id/comprovante.pdf` | `fornecedores:ler` | Comprovante em PDF da verificação |
| `GET /sancoes/registro-ceis-cnep?situacao` | `sancoes:ler` | Sanções aplicadas e o registro no CEIS/CNEP |
| `POST /sancoes/:id/registro-ceis-cnep` | `sancoes:instruir` | Registro do envio (cadastro, protocolo, data) |

Rotas alteradas: `POST /processos/:id/contratar` (verificação com consulta nova antes da transação) e
`POST /pagamentos/:id/atestar` (recheque; a resposta passa a ser `RespostaAtesto`, que estende `Pagamento`).

Banco: migração `apps/api/migracoes/013_regularidade_ceis_cnep.sql` (tabelas `ceis_cnep_simulados`,
`consultas_ceis_cnep`, `certidoes_regularidade`, `verificacoes_regularidade` e `sancoes_envios_ceis_cnep`).

Carga sintética (`apps/api/src/seed/regularidade.ts`, PRNG próprio): três certidões por fornecedor; CNDT vencida da
Metropolitana e CRF vencido e CND positiva da Amazônia (coerentes com o snapshot cadastral); CRF a vencer da Lumen;
na base simulada, inidoneidade vigente no CEIS para a Mirante (PoC-04), impedimento estadual para a Ária (atenção),
multa no CNEP para a Metropolitana e suspensão encerrada para a Precisão; a primeira consulta de cada fornecedor; o
protocolo sintético das sanções já registradas; e o impedimento da Nortecom ainda sem registro no CEIS (pendência
vencida, para demonstrar a RN-24). Todos os órgãos e protocolos são fictícios.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_TRANSPARENCIA_URL` | `https://api.portaldatransparencia.gov.br/api-de-dados` | Base da API de dados do Portal da Transparência (validada como URL) |
| `AGORA_TRANSPARENCIA_CHAVE` | vazio | Chave da API (cabeçalho `chave-api-dados`), obrigatória com `AGORA_INTEGRACOES=online` |
| `AGORA_TRANSPARENCIA_CACHE_MINUTOS` | `60` | Tempo em que as travas reaproveitam a última consulta (0 a 1440) |

O modo continua definido por `AGORA_INTEGRACOES` (`offline` por padrão). As três variáveis foram acrescentadas ao
`.env.exemplo`.

## 7. Seção pronta para o manual do usuário

### Regularidade do fornecedor: CEIS, CNEP e certidões

A Ágora confere a regularidade do contratado antes de **assinar** e de **prorrogar** um contrato e repete a conferência
antes do **atesto** e do **pagamento** (Lei 14.133/2021, art. 91, § 4º, e art. 92, XVI). A conferência reúne:

- a consulta ao **CEIS** e ao **CNEP**, feita pelo servidor da Ágora no Portal da Transparência da CGU;
- as sanções de impedimento e de inidoneidade aplicadas pelo próprio órgão;
- as certidões **CND federal**, **CRF do FGTS** e **CNDT**, registradas pelo agente.

Na página do fornecedor, abra a aba **Regularidade e certidões**. Cada item mostra a situação (**Conforme**, **Atenção**,
**Pendente** ou **Impeditivo**), a fonte, a data da consulta ou da validade e o fundamento legal.

#### Consultar o CEIS e o CNEP

Perfis: gestor de contratos, fiscal de contrato, financeiro, agente de contratação e administrador.

1. Na aba **Regularidade e certidões**, clique em **Consultar CEIS e CNEP agora**.
2. Confira o resultado: a fonte, a hora da consulta e as sanções encontradas.
3. Para juntar ao processo, abra **Comprovante da verificação (PDF)**.

A consulta também é feita automaticamente ao contratar, ao prorrogar, ao atestar e antes do pagamento.

#### Registrar uma certidão

Perfis: gestor de contratos, fiscal de contrato, financeiro, agente de contratação e administrador.

1. Emita a certidão no sítio do emissor e confira a autenticidade.
2. Na aba **Regularidade e certidões**, clique em **Registrar certidão**.
3. Escolha a **Certidão** e preencha **Número ou código de controle**, **Emissor**, **Data de emissão**, **Válida até** e
   **Resultado**.
4. Marque **Conferi a autenticidade da certidão no sítio do emissor** e clique em **Registrar certidão**.

A Ágora avisa quando faltam 15 dias para o vencimento. A CRF vale por até 30 dias; a CND federal e a CNDT, por até 180
dias.

> **Atenção:** sanção vigente no CEIS ou no CNEP, certidão ausente, vencida ou positiva, ou consulta indisponível
> **bloqueiam** a assinatura e a prorrogação. A tentativa bloqueada fica registrada, com a fonte e a data da consulta.

#### Contratar (etapa 7 da jornada)

Perfis: agente de contratação e administrador.

A seção **Verificações antes da assinatura (RN-09)** mostra a regularidade do vencedor. Ao clicar em **Contratar**, a
Ágora consulta de novo o CEIS e o CNEP e confere as certidões. Havendo restrição, aparece **A contratação foi
bloqueada**, com cada motivo e a regra RN-09.

#### Prorrogar a vigência de um contrato

Perfis: gestor de contratos e administrador.

1. No contrato, abra a aba **Aditivos** e vá até **Prorrogação da vigência (RN-09)**.
2. Clique em **Registrar prorrogação**.
3. Preencha **Nova data de fim da vigência**, **Valor do aditivo** (zero, se não houver) e **Justificativa**.
4. Clique em **Verificar e prorrogar**. Sem restrição, o termo aditivo de prazo é registrado; com restrição, os motivos
   aparecem no próprio formulário.

#### Atestar e pagar com o recheque

Perfis: fiscal de contrato e administrador (atesto); financeiro, gestor de contratos e administrador (verificação antes do
pagamento).

- Ao **Atestar**, o diálogo mostra a última verificação do contratado. Ao confirmar, a Ágora consulta de novo. Se houver
  restrição, o atesto é registrado com a ressalva e uma pendência é aberta para o gestor notificar o contratado.
- Antes de pagar, na linha da nota atestada, clique em **Verificar regularidade** e depois em **Consultar e
  verificar**.

> **Atenção:** a irregularidade não autoriza, por si só, reter o pagamento do que já foi executado. Extinção do contrato
> ou sanção dependem de decisão da autoridade competente, em processo com contraditório.

#### Registrar o envio de uma sanção ao CEIS/CNEP

Perfis: gestor de contratos e administrador.

Em **Sanções**, a seção **Registro no CEIS/CNEP (art. 161)** lista as sanções aplicadas, o prazo de 15 dias úteis e a
situação. O alerta aparece a partir de 5 dias úteis do vencimento.

1. Informe a sanção no sistema da CGU e anote o protocolo.
2. Na linha da sanção, clique em **Registrar envio**.
3. Escolha o **Cadastro** (CEIS ou CNEP), preencha **Protocolo do envio** e **Data do envio** e clique em
   **Registrar envio**.

## 8. Limitações e dependências externas

- **Chave da API de dados.** A consulta online exige a chave do Portal da Transparência, cadastrada pelo órgão. Sem ela,
  em modo online, as travas bloqueiam. Os testes nunca chamam o serviço real: usam um `fetch` simulado com o formato
  da especificação OpenAPI oficial.
- **Escrita no CEIS/CNEP e no SEI.** Não há API pública de escrita; o envio continua no sistema da CGU e a juntada ao
  processo é feita com o PDF do comprovante.
- **Certidões.** Sem API aberta para emissão por terceiros; o registro depende da conferência do agente. A certidão
  estadual e a municipal (art. 68, III, quando exigidas no edital) e a do FGTS de pessoa física sem empregados não têm
  tratamento próprio: registre a certidão aplicável e use **Observação**.
- **Abrangência.** A classificação por esfera usa o campo de esfera do órgão sancionador informado pela fonte; o caso
  concreto continua sendo conferido pelo agente.
- **Prorrogação.** A rota registra o termo aditivo de prazo com a trava do art. 91, § 4º. Os limites de duração dos
  arts. 105 a 107 continuam sendo conferidos pelo gestor e pela assessoria jurídica.
- **Pagamento.** A situação "liquidado" e "pago" vem do SIAFI (sincronização); a verificação antes do pagamento é um
  passo do financeiro na Ágora, sem bloquear o SIAFI.
- **Coluna legada.** `fornecedores.certidoes_irregulares` (snapshot cadastral) deixou de ser usada na trava: vale o
  registro de certidões. A carga sintética converte as irregularidades do snapshot em certidões vencidas ou positivas.

## 9. Verificações

- `npm run build -w @agora/dominio`, `npm run build -w @agora/contratos`, `npm run typecheck` e `npm run build`: sem erros.
- `npm run test -w @agora/dominio`: 329 testes passando (`test/regularidade.test.ts` novo e casos novos em
  `test/catalogo-regras.test.ts`).
- `npm run test -w @agora/api`: 123 testes passando (15 novos em `test/regularidade-ceis-cnep.test.ts`).
- e2e na porta 3103: `testes/ceis-cnep.spec.ts` com 4 testes passando, com verificação axe; suíte inteira com 59
  testes passando.
- Gates da Fábrica: aprovados. Ficam para revisão as duas asserções existentes alteradas de propósito (a matriz do
  administrador passou de 25 para 27 permissões; a tela `sancoes` passou a listar a RN-24). O achado `db_uri` em
  `apps/api/src/config.ts` é o exemplo de formato na mensagem de validação de `AGORA_BANCO_URL`, anterior a esta frente,
  e foi registrado em `.fabrica-dlp-allow.json` com o motivo.
