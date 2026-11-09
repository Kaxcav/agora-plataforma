/**
 * Catálogo de regras da Ágora — base do Modo Especificação Técnica e do Caderno de Regras.
 * RF: requisito funcional (um por tela de operação); RN: regra de negócio; RIA: regra de inteligência
 * assistiva (gera sinais e rascunhos, nunca decisões); RNF: requisito não funcional.
 * `etapa` refere-se às 7 etapas da jornada da contratação; `telas` usa os ids de tela da interface;
 * `implementacao` aponta o símbolo deste pacote ou o módulo da API que aplica a regra.
 */
import { ErroDominio } from './erros.ts';

export type TipoRegra = 'RF' | 'RN' | 'RIA' | 'RNF';

export interface RegraCatalogo {
  id: string;
  tipo: TipoRegra;
  titulo: string;
  descricao: string;
  fundamento: string;
  etapa: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  telas: string[];
  /** Símbolo do domínio ou módulo da API. */
  implementacao: string;
}

export const CATALOGO_REGRAS: readonly RegraCatalogo[] = Object.freeze([
  // ───────────────────────── Regras de negócio ─────────────────────────
  {
    id: 'RN-01',
    tipo: 'RN',
    titulo: 'Vedação à aquisição de artigos de luxo',
    descricao:
      'Os itens de consumo devem ser de qualidade comum, não superior à necessária para a finalidade a que se destinam. Ao descrever cada item do Documento de Formalização da Demanda (DFD), a Ágora compara a descrição com uma lista de termos indicativos de artigo de luxo (por palavra ou expressão inteira, sem distinção de acentos e de maiúsculas). Havendo indício, o processo só avança da etapa 1 com justificativa de que o bem é de qualidade comum ou de que se enquadra em exceção prevista no Decreto 10.818/2021. O sistema apenas sinaliza; a classificação final é do agente responsável. Enquanto houver indício sem justificativa aceita, o servidor também recusa a geração de qualquer minuta, inclusive com a redação por IA ligada.',
    fundamento: 'Lei 14.133/2021, art. 20; Decreto 10.818/2021',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe'],
    implementacao: 'sinalizarArtigoLuxo, avaliarBloqueioLuxoMinutas; api: POST /processos/:id/documentos/gerar',
  },
  {
    id: 'RN-02',
    tipo: 'RN',
    titulo: 'Justificativa para não utilizar o catálogo de padronização',
    descricao:
      'Quando o DFD indicar que a contratação não utilizará o catálogo eletrônico de padronização de compras, serviços e obras (ou os modelos de minuta padronizados), a justificativa por escrito é obrigatória, com no mínimo 30 caracteres, e passa a integrar o processo. Sem ela, o processo não avança da etapa 1.',
    fundamento: 'Lei 14.133/2021, art. 19, § 2º',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe'],
    implementacao: 'api: PUT /processos/:id/dfd; bloqueio da etapa 1 em POST /processos/:id/avancar',
  },
  {
    id: 'RN-03',
    tipo: 'RN',
    titulo: 'Segregação de funções na equipe do processo',
    descricao:
      'Na designação da equipe, é vedado atribuir ao mesmo agente público funções simultâneas mais suscetíveis a riscos, para reduzir a possibilidade de ocultação de erros e de fraudes. A Ágora bloqueia pares conflitantes, como planejar a contratação e conduzir a seleção, conduzir o certame e fiscalizar o contrato, conduzir o certame e homologá-lo, gerir e fiscalizar tecnicamente o contrato, ou atuar como parecerista jurídico e em qualquer outra função do processo. Também sinaliza, para análise, o CPF de designado que conste do quadro societário de fornecedor (art. 9º, § 1º, e art. 14, IV), sem caracterizar acusação.',
    fundamento: 'Lei 14.133/2021, art. 7º, § 1º, e art. 9º',
    etapa: 2,
    telas: ['jornada.equipe', 'jornada.detalhe'],
    implementacao: 'verificarSegregacao',
  },
  {
    id: 'RN-04',
    tipo: 'RN',
    titulo: 'Elementos mínimos do Estudo Técnico Preliminar',
    descricao:
      'O ETP deve conter obrigatoriamente os elementos dos incisos I (descrição da necessidade), IV (estimativas das quantidades e memórias de cálculo), VI (estimativa do valor), VIII (justificativas para o parcelamento ou não) e XIII (posicionamento conclusivo sobre a adequação da contratação). Os demais incisos do § 1º do art. 18 devem ser preenchidos ou ter a ausência justificada. A Ágora mostra o percentual atendido e cada pendência; com pendências, o processo não avança da etapa 3.',
    fundamento: 'Lei 14.133/2021, art. 18, §§ 1º e 2º',
    etapa: 3,
    telas: ['jornada.detalhe'],
    implementacao: 'validarEtp',
  },
  {
    id: 'RN-05',
    tipo: 'RN',
    titulo: 'Parâmetros da pesquisa de preços',
    descricao:
      'O valor estimado é obtido a partir dos parâmetros do art. 23, § 1º: painel de preços e bancos de preços oficiais; contratações similares da Administração no período de 1 ano anterior; mídia especializada, tabelas de referência e sítios eletrônicos; pesquisa direta com no mínimo 3 fornecedores, mediante solicitação formal, com justificativa da escolha e orçamentos de até 6 meses; e notas fiscais. A Ágora alerta quando a cesta tem menos de 3 preços válidos (IN SEGES/ME 65/2021, art. 6º, § 5º), quando a pesquisa direta tem menos de 3 fornecedores ou não justifica a escolha e quando as fontes estão desatualizadas. Pendências de pesquisa direta bloqueiam o avanço da etapa 3.',
    fundamento: 'Lei 14.133/2021, art. 23, § 1º; IN SEGES/ME 65/2021',
    etapa: 3,
    telas: ['jornada.detalhe'],
    implementacao: 'analisarCestaPrecos',
  },
  {
    id: 'RN-06',
    tipo: 'RN',
    titulo: 'Habilitação econômico-financeira sem faturamento mínimo',
    descricao:
      'Os parâmetros de habilitação econômico-financeira do edital não podem exigir valores mínimos de faturamento anterior nem índices de rentabilidade ou lucratividade. Capital mínimo ou patrimônio líquido mínimo, quando exigidos nas compras para entrega futura e na execução de obras e serviços, ficam limitados a 10% do valor estimado da contratação. A Ágora bloqueia o avanço da etapa 4 se os parâmetros violarem esses limites.',
    fundamento: 'Lei 14.133/2021, art. 69, §§ 2º e 4º',
    etapa: 4,
    telas: ['jornada.detalhe'],
    implementacao: 'api: bloqueio da etapa 4 em POST /processos/:id/avancar',
  },
  {
    id: 'RN-07',
    tipo: 'RN',
    titulo: 'Acesso ao edital sem cadastro',
    descricao:
      'O edital e todos os seus elementos (minuta de contrato, termo de referência, anteprojeto, projetos e demais anexos) são divulgados em sítio eletrônico oficial na mesma data de divulgação do edital, sem exigir registro ou identificação de quem acessa. As páginas públicas da Ágora não pedem login.',
    fundamento: 'Lei 14.133/2021, art. 25, § 3º',
    etapa: 5,
    telas: ['jornada.detalhe', 'transparencia'],
    implementacao: 'api: POST /processos/:id/publicar; rotas públicas GET /publico/*',
  },
  {
    id: 'RN-08',
    tipo: 'RN',
    titulo: 'Critérios de desempate',
    descricao:
      'Em caso de empate entre propostas, os critérios são aplicados nesta ordem, apenas entre os empatados: disputa final com novo lance (art. 60, I); avaliação do desempenho contratual prévio (II); ações de equidade entre homens e mulheres no ambiente de trabalho (III); programa de integridade (IV). Persistindo o empate, há preferência sucessiva a empresas brasileiras, a empresas que invistam em pesquisa e desenvolvimento de tecnologia no País e a empresas que comprovem prática de mitigação climática (§ 1º, II a IV); a preferência territorial do § 1º, I, não se aplica a órgão federal. Persistindo ainda o empate, é indicado sorteio. O empate ficto de ME/EPP (LC 123/2006, arts. 44 e 45) é registrado como passo informativo. Cada passo é exibido com seu resultado.',
    fundamento: 'Lei 14.133/2021, art. 60; LC 123/2006, arts. 44 e 45',
    etapa: 6,
    telas: ['jornada.detalhe'],
    implementacao: 'aplicarDesempate',
  },
  {
    id: 'RN-09',
    tipo: 'RN',
    titulo: 'Verificação de regularidade e sanções antes da assinatura ou prorrogação',
    descricao:
      'Antes de formalizar ou prorrogar o contrato, a Administração verifica a regularidade fiscal do contratado, consulta o Cadastro Nacional de Empresas Inidôneas e Suspensas (CEIS) e o Cadastro Nacional de Empresas Punidas (CNEP) e junta ao processo as certidões. Ao contratar (etapa 7) e ao registrar a prorrogação no contrato, o servidor da Ágora executa o checklist de regularidade (RF-20): consulta o CEIS e o CNEP pela API de dados do Portal da Transparência (ou pela base simulada no modo offline), confere as sanções impeditivas aplicadas pelo órgão e as certidões fiscal federal, do FGTS e trabalhista (CNDT) registradas pelo agente. Sanção impeditiva vigente, certidão ausente, vencida ou positiva, ou consulta indisponível bloqueiam a assinatura e a prorrogação. Cada verificação, inclusive a bloqueada, fica registrada com fonte, data e hash da consulta e entra na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 91, § 4º',
    etapa: 7,
    telas: ['jornada.detalhe', 'contratos.detalhe', 'fornecedores'],
    implementacao: 'avaliarChecklistRegularidade; api: POST /processos/:id/contratar; POST /contratos/:id/prorrogacoes',
  },
  {
    id: 'RN-10',
    tipo: 'RN',
    titulo: 'Limites de acréscimos e supressões',
    descricao:
      'Nas alterações unilaterais, o contratado é obrigado a aceitar acréscimos ou supressões de até 25% do valor inicial atualizado do contrato; em reforma de edifício ou de equipamento, o limite para acréscimos é de 50%. Acréscimos e supressões são somados separadamente, sem compensação entre si. O simulador de aditivos mostra o percentual acumulado, o limite aplicável e a margem restante.',
    fundamento: 'Lei 14.133/2021, art. 125',
    etapa: 7,
    telas: ['contratos.detalhe'],
    implementacao: 'avaliarAditivo',
  },
  {
    id: 'RN-11',
    tipo: 'RN',
    titulo: 'Prazo de divulgação do contrato no PNCP',
    descricao:
      'A divulgação no Portal Nacional de Contratações Públicas é condição indispensável para a eficácia do contrato e de seus aditamentos e deve ocorrer em até 20 dias úteis da assinatura, no caso de licitação, ou em até 10 dias úteis, no caso de contratação direta. A Ágora classifica cada contrato como divulgado no prazo, divulgado fora do prazo, pendente no prazo ou pendente com prazo vencido, e destaca os pendentes no painel.',
    fundamento: 'Lei 14.133/2021, art. 94',
    etapa: 7,
    telas: ['contratos.detalhe', 'painel'],
    implementacao: 'situacaoDivulgacaoPncp',
  },
  {
    id: 'RN-12',
    tipo: 'RN',
    titulo: 'Dosimetria da multa entre 0,5% e 30%',
    descricao:
      'A multa não pode ser inferior a 0,5% nem superior a 30% do valor do contrato licitado ou celebrado com contratação direta. O simulador propõe um percentual a partir da gravidade, das agravantes e atenuantes, do dano à Administração e do programa de integridade (art. 156, § 1º), limita o resultado à faixa legal e apresenta a memória de cálculo. Os parâmetros são definidos pelo órgão em ato normativo próprio. É proposta para apoio à decisão: a sanção é aplicada pela autoridade competente após processo com contraditório e ampla defesa.',
    fundamento: 'Lei 14.133/2021, art. 156, §§ 1º e 3º',
    etapa: 7,
    telas: ['sancoes'],
    implementacao: 'calcularDosimetriaMulta',
  },
  {
    id: 'RN-13',
    tipo: 'RN',
    titulo: 'Prazos de defesa e de registro no CEIS/CNEP',
    descricao:
      'No processo de responsabilização, o licitante ou contratado é intimado para apresentar defesa escrita no prazo de 15 dias úteis contados da intimação. Aplicada a sanção, o órgão tem até 15 dias úteis, contados da aplicação, para informar e manter atualizados os dados no CEIS e no CNEP. A Ágora calcula os vencimentos conforme o calendário de dias úteis do órgão.',
    fundamento: 'Lei 14.133/2021, arts. 157, 158 e 161',
    etapa: null,
    telas: ['sancoes'],
    implementacao: 'prazoDefesa, prazoRegistroCeisCnep',
  },
  {
    id: 'RN-14',
    tipo: 'RN',
    titulo: 'Dispensa por valor e fracionamento de despesa',
    descricao:
      'A dispensa de licitação por valor respeita os limites do art. 75, I (obras e serviços de engenharia ou manutenção de veículos automotores) e II (demais compras e serviços), atualizados anualmente por decreto (art. 182). Para aferir os limites, soma-se o despendido no exercício financeiro pela unidade gestora com objetos de mesma natureza, isto é, do mesmo ramo de atividade. A Ágora emite sinal de atenção a partir de 80% do limite e de risco quando a soma o ultrapassa.',
    fundamento: 'Lei 14.133/2021, art. 75, I e II, e § 1º; art. 182',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe'],
    implementacao: 'avaliarFracionamento, limiteDispensaVigente',
  },
  {
    id: 'RN-15',
    tipo: 'RN',
    titulo: 'Prazos mínimos para apresentação de propostas',
    descricao:
      'Os prazos mínimos, contados da divulgação do edital, são: para bens, 8 dias úteis (menor preço ou maior desconto) ou 15 dias úteis (demais casos); para serviços e obras, 10 dias úteis (menor preço ou maior desconto em serviços comuns e obras e serviços comuns de engenharia), 25 dias úteis (menor preço ou maior desconto em serviços especiais e obras e serviços especiais de engenharia), 60 dias úteis (contratação integrada) ou 35 dias úteis (contratação semi-integrada e demais casos); 15 dias úteis para maior lance; e 35 dias úteis para técnica e preço ou melhor técnica. O processo só avança para a seleção a partir da data mínima de abertura.',
    fundamento: 'Lei 14.133/2021, art. 55',
    etapa: 5,
    telas: ['jornada.detalhe'],
    implementacao: 'prazoMinimoPropostas, dataMinimaAberturaPropostas',
  },
  {
    id: 'RN-16',
    tipo: 'RN',
    titulo: 'Contagem de prazos',
    descricao:
      'Os prazos são contados excluindo o dia do começo e incluindo o do vencimento. Dias úteis são os dias com expediente: excluem sábados, domingos, feriados nacionais, os pontos facultativos de Carnaval e Corpus Christi e os feriados locais cadastrados pelo órgão. Se o vencimento cair em dia sem expediente, o prazo é prorrogado para o primeiro dia útil seguinte.',
    fundamento: 'Lei 14.133/2021, art. 183',
    etapa: null,
    telas: ['ajustes'],
    implementacao: 'contarPrazo, adicionarDiasUteis, feriadosNacionais',
  },
  {
    id: 'RN-17',
    tipo: 'RN',
    titulo: 'Vigência e semáforo de vencimentos',
    descricao:
      'Contratos e atas de registro de preços são classificados pelo número de dias até o fim da vigência: vencido (prazo encerrado), crítico (até 30 dias), atenção (31 a 60 dias), alerta (61 a 90 dias), planejamento (91 a 120 dias, RN-31) e regular (mais de 120 dias). O semáforo orienta a antecedência das providências de prorrogação ou de nova contratação.',
    fundamento: 'Lei 14.133/2021, art. 84 (vigência da ata) e arts. 105 a 107 (duração dos contratos)',
    etapa: null,
    telas: ['painel', 'contratos', 'atas', 'contratos.detalhe', 'atas.detalhe'],
    implementacao: 'classificarVigencia',
  },
  {
    id: 'RN-18',
    tipo: 'RN',
    titulo: 'Ordem cronológica de pagamentos',
    descricao:
      'Os pagamentos observam a ordem cronológica de exigibilidade, para cada fonte diferenciada de recursos, subdividida nas categorias de contratos de fornecimento de bens, locações, prestação de serviços e realização de obras. A ordem só pode ser alterada nas situações do art. 141, § 1º, mediante prévia justificativa da autoridade competente e posterior comunicação ao órgão de controle interno e ao tribunal de contas; a alteração fica registrada na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 141',
    etapa: null,
    telas: ['pagamentos'],
    implementacao: 'api: GET /pagamentos; POST /pagamentos/:id/atestar',
  },
  {
    id: 'RN-19',
    tipo: 'RN',
    titulo: 'Multa moratória por atraso injustificado',
    descricao:
      'O atraso injustificado na execução sujeita o contratado à multa de mora na forma prevista no edital ou no contrato. O simulador aplica o percentual diário definido no contrato sobre o valor da parcela em atraso, limitado ao número máximo de dias previsto na cláusula, e apresenta a memória de cálculo. A multa de mora não impede a conversão em multa compensatória nem a extinção do contrato com outras sanções. É proposta para apoio à decisão: a aplicação cabe à autoridade competente, após o prazo de defesa.',
    fundamento: 'Lei 14.133/2021, art. 162',
    etapa: 7,
    telas: ['sancoes'],
    implementacao: 'calcularMultaMoratoria',
  },

  // ───────────────────────── Inteligência assistiva ─────────────────────────
  {
    id: 'RIA-01',
    tipo: 'RIA',
    titulo: 'Consolidação de demandas e sinal antifracionamento',
    descricao:
      'Ao registrar uma demanda, a Ágora identifica outras demandas e dispensas por valor de mesma natureza da mesma unidade gestora no exercício, sugere a consolidação em uma única contratação e sinaliza risco de fracionamento de despesa. É sinal para análise: a decisão de consolidar ou de contratar é do agente responsável.',
    fundamento: 'Lei 14.133/2021, art. 12, VII, e art. 75, § 1º',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe'],
    implementacao: 'avaliarFracionamento, consolidarDemandas, sugerirRegistroPrecosCompartilhado',
  },
  {
    id: 'RIA-02',
    tipo: 'RIA',
    titulo: 'Robô de instrução do processo no SEI',
    descricao:
      'Requisito (integração planejada): automatizar a instrução do processo no SEI — abertura do processo, inclusão dos documentos aprovados na ordem da árvore, solicitação de assinaturas e conferência de completude — com registro de proveniência e trilha de auditoria de cada ação. Nenhuma ação é executada no SEI sem confirmação humana. Nesta versão, a árvore do processo é simulada na Ágora, com numeração sequencial de documentos e registro de assinatura.',
    fundamento: 'Lei 14.133/2021, art. 12, VI',
    etapa: 2,
    telas: ['jornada.equipe', 'jornada.detalhe'],
    implementacao: 'api: POST /processos/:id/sei/assinar (simulação); integração SEI planejada',
  },
  {
    id: 'RIA-03',
    tipo: 'RIA',
    titulo: 'Saneamento estatístico da cesta de preços',
    descricao:
      'Sugere o expurgo de preços inexequíveis ou excessivamente elevados com critério explícito — Tukey (fora de Q1 − 1,5·IQR e Q3 + 1,5·IQR) com quatro ou mais preços, ou faixa percentual em torno da mediana com menos de quatro —, recomenda a média quando o coeficiente de variação do conjunto saneado é de até 25% e a mediana nos demais casos, e calcula o valor estimado. Os expurgos são sugestões: o agente aceita ou rejeita cada um com justificativa registrada no processo.',
    fundamento: 'IN SEGES/ME 65/2021, art. 6º',
    etapa: 3,
    telas: ['jornada.detalhe'],
    implementacao: 'analisarCestaPrecos; api: POST /processos/:id/cesta-precos/expurgos',
  },
  {
    id: 'RIA-04',
    tipo: 'RIA',
    titulo: 'Redação assistida de termo de referência, edital e minuta',
    descricao:
      'Gera rascunhos de termo de referência, edital e minuta de contrato a partir dos dados do processo, por modelos determinísticos (sem IA por padrão; modelo de linguagem apenas auto-hospedado no órgão, se configurado). Todo texto gerado indica fontes, premissas e data e traz a marcação "requer revisão humana"; o documento só segue no processo após aprovação expressa de um agente.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, e art. 25',
    etapa: 4,
    telas: ['jornada.detalhe'],
    implementacao: 'api: POST /processos/:id/documentos/gerar; POST /processos/:id/documentos/:docId/aprovar',
  },
  {
    id: 'RIA-05',
    tipo: 'RIA',
    titulo: 'Tarjamento de dados pessoais e de informações sigilosas',
    descricao:
      'Os atos do processo são públicos, ressalvadas as informações cujo sigilo seja imprescindível à segurança da sociedade e do Estado; a publicidade é diferida quanto ao conteúdo das propostas, até a abertura, e quanto ao orçamento sigiloso (art. 24). Dados pessoais aparecem mascarados nas telas e na transparência, e o inteiro teor publicado do edital e dos anexos sai com CPF, e-mail e telefone tarjados automaticamente. A sugestão de tarjas para informações sigilosas por segurança (art. 13), com revisão por um agente antes da divulgação, ainda não está implementada.',
    fundamento: 'Lei 14.133/2021, art. 13; Lei 13.709/2018 (LGPD)',
    etapa: 5,
    telas: ['jornada.detalhe', 'transparencia'],
    implementacao: 'mascararCpf, mascararEmail, mascararTelefone, mascararNome; api: GET /publico/editais/:id/documentos/:tipo',
  },
  {
    id: 'RIA-06',
    tipo: 'RIA',
    titulo: 'Sinais de conluio e de vínculos societários',
    descricao:
      'Cruza o quadro societário dos licitantes entre si (sócio em comum) e com os agentes públicos designados no processo (CPF de sócio igual ao de servidor). Os resultados são sinais para análise do agente de contratação ou da comissão; nenhum sinal constitui acusação, desclassificação ou impedimento, e a apuração é sempre humana, com contraditório.',
    fundamento: 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV',
    etapa: 6,
    telas: ['jornada.detalhe'],
    implementacao: 'verificarSegregacao; api: PUT /processos/:id/disputa',
  },
  {
    id: 'RIA-07',
    tipo: 'RIA',
    titulo: 'Projeção de queima de saldo',
    descricao:
      'Compara o percentual executado do valor do contrato com o percentual da vigência decorrida e projeta a data de esgotamento do saldo mantido o ritmo médio diário. Sinaliza execução acelerada (executado mais de 15 pontos percentuais acima do tempo decorrido) ou lenta (mais de 30 pontos abaixo) para apoiar o gestor; não constitui decisão.',
    fundamento: 'Lei 14.133/2021, art. 117',
    etapa: 7,
    telas: ['contratos.detalhe', 'painel'],
    implementacao: 'projetarQueimaSaldo',
  },

  // ───────────────────────── Requisitos não funcionais ─────────────────────────
  {
    id: 'RNF-01',
    tipo: 'RNF',
    titulo: 'Soberania e implantação na infraestrutura do órgão',
    descricao:
      'A Ágora é implantada na infraestrutura do próprio órgão, sem dependência de nuvem ou de serviço estrangeiro em tempo de execução. Fontes, ícones e scripts são servidos pela própria aplicação, sem CDN; o navegador fala apenas com a API da Ágora, e as integrações (PNCP, Compras.gov.br, Contratos.gov.br, SEI, CEIS/CNEP) rodam no servidor, com proveniência registrada.',
    fundamento: 'Diretriz de soberania digital da Ágora',
    etapa: null,
    telas: [],
    implementacao: 'arquitetura: implantação auto-hospedada (deploy/Dockerfile, deploy/docker-compose.yml, deploy/k8s/agora.yaml)',
  },
  {
    id: 'RNF-02',
    tipo: 'RNF',
    titulo: 'Proteção de dados pessoais (LGPD)',
    descricao:
      'CPF, e-mail, telefone e nomes de pessoas físicas são exibidos mascarados por padrão; o acesso ao dado completo exige permissão, é registrado (quem, quando, qual dado e finalidade) e consultável na auditoria. Coleta-se apenas o necessário à finalidade (minimização), e a plataforma adota medidas de segurança contra acessos não autorizados.',
    fundamento: 'Lei 13.709/2018 (LGPD), arts. 6º, 37 e 46',
    etapa: null,
    telas: ['fornecedores', 'auditoria'],
    implementacao: 'mascararDocumento, mascararCpf, mascararEmail, mascararTelefone, mascararNome; api: POST /lgpd/revelar, GET /lgpd/acessos',
  },
  {
    id: 'RNF-03',
    tipo: 'RNF',
    titulo: 'Trilha de auditoria encadeada por hash',
    descricao:
      'Toda escrita gera um evento na trilha de auditoria (autor, data e hora, ação, entidade e dados alterados). Cada evento inclui o hash do evento anterior, de modo que qualquer adulteração quebra a cadeia; a verificação de integridade pode ser executada a qualquer momento. A trilha apoia o controle das contratações pelas linhas de defesa e pelos órgãos de controle.',
    fundamento: 'Lei 14.133/2021, arts. 169 a 171',
    etapa: null,
    telas: ['auditoria'],
    implementacao: 'api: GET /auditoria; GET /auditoria/verificacao',
  },
  {
    id: 'RNF-04',
    tipo: 'RNF',
    titulo: 'Acessibilidade',
    descricao:
      'A interface segue o Padrão Digital de Governo (gov.br DS), o eMAG e as WCAG 2.1 nível AA: contraste adequado, navegação completa por teclado, foco visível, link de salto para o conteúdo, rótulos sempre visíveis, alternativas textuais (inclusive tabela equivalente para gráficos) e funcionamento com zoom de 200%.',
    fundamento: 'gov.br DS; eMAG; WCAG 2.1 nível AA',
    etapa: null,
    telas: [],
    implementacao: 'web: componentes próprios acessíveis e testes automatizados com axe (e2e/testes/apoio.ts)',
  },
  {
    id: 'RNF-05',
    tipo: 'RNF',
    titulo: 'Autorização no servidor por perfil e UASG',
    descricao:
      'Toda autorização é decidida no servidor, combinando o perfil do usuário (controle de acesso baseado em papéis) e o escopo das UASGs a que ele tem acesso. A interface apenas oculta o que o servidor já negou; nenhuma regra de acesso depende do cliente.',
    fundamento: 'Lei 13.709/2018 (LGPD), art. 46',
    etapa: null,
    telas: ['admin'],
    implementacao: 'api: matriz de perfis e permissões (GET /perfis) e filtro por UASG em todas as consultas',
  },
  {
    id: 'RNF-06',
    tipo: 'RNF',
    titulo: 'IA não decide: revisão humana obrigatória',
    descricao:
      'Recursos de inteligência assistiva produzem apenas rascunhos e sinais, com fontes, premissas, data e a indicação "requer revisão humana". Sanção, habilitação, fraude, multa e impedimento são sempre decisão humana, tomada pela autoridade competente em processo próprio. O provedor padrão é determinístico; modelo de linguagem só é usado se auto-hospedado no órgão.',
    fundamento: 'Lei 14.133/2021, arts. 155 a 163 (sanção pela autoridade competente); Lei 13.709/2018, art. 20',
    etapa: null,
    telas: [],
    implementacao: 'todas as funções de sinal do domínio retornam sinal e explicação, nunca decisão; provedor de IA em apps/api/src/ia/provedor.ts',
  },

  // ───────────────────────── Requisitos funcionais (um por tela de operação) ─────────────────────────
  {
    id: 'RF-01',
    tipo: 'RF',
    titulo: 'Painel de gestão',
    descricao:
      'Apresenta indicadores da carteira (sem números provisórios durante o carregamento), vencimentos de contratos e atas em 30, 60 e 90 dias, contratos com divulgação no PNCP pendente, contratos com queima de saldo acelerada, próximos vencimentos e a fila de pendências com busca, filtros (tipo, prioridade, situação, UASG e "minhas"), ordenação e paginação. Resolver uma pendência exige observação e pode ser desfeito. Cada conjunto de dados exibe sua proveniência.',
    fundamento: 'Lei 14.133/2021, arts. 94 e 117',
    etapa: null,
    telas: ['painel'],
    implementacao: 'api: GET /painel; GET /pendencias; POST /pendencias/:id/resolver; POST /pendencias/:id/reabrir',
  },
  {
    id: 'RF-02',
    tipo: 'RF',
    titulo: 'Atas de registro de preços',
    descricao:
      'Lista as atas registradas e as atas a montar, com filtros por situação, criticidade, UASG e "sob minha gestão", semáforo de vigência e barra de consumo do saldo. O detalhe da ata mostra dados, link para o PNCP, linha do tempo, saldo contratável, itens em risco, plano de gestão, itens, contratos vinculados, reajuste e histórico.',
    fundamento: 'Lei 14.133/2021, arts. 82 a 86',
    etapa: null,
    telas: ['atas', 'atas.detalhe'],
    implementacao: 'api: GET /atas; GET /atas/a-montar; GET /atas/:id e sub-recursos',
  },
  {
    id: 'RF-03',
    tipo: 'RF',
    titulo: 'Carteira de contratos',
    descricao:
      'Lista os contratos com filtros por situação, UASG, gestor e "sem ata". O detalhe do contrato reúne resumo, situação da divulgação no PNCP, projeção de queima de saldo, garantia, plano de gestão, itens, empenhos, pagamentos, aditivos (com simulador dos limites do art. 125 e regularidade do fornecedor) e histórico.',
    fundamento: 'Lei 14.133/2021, arts. 92, 94, 117 e 125',
    etapa: null,
    telas: ['contratos', 'contratos.detalhe'],
    implementacao: 'api: GET /contratos; GET /contratos/:id e sub-recursos; POST /contratos/:id/aditivos/simular',
  },
  {
    id: 'RF-04',
    tipo: 'RF',
    titulo: 'Carteira de itens',
    descricao:
      'Consolida os itens de atas e contratos com quantidades, valores e saldos, com filtros e exportação em CSV dos mesmos resultados filtrados.',
    fundamento: 'Lei 14.133/2021, art. 117',
    etapa: null,
    telas: ['itens'],
    implementacao: 'api: GET /itens; GET /itens/exportar.csv',
  },
  {
    id: 'RF-05',
    tipo: 'RF',
    titulo: 'Empenhos',
    descricao:
      'Lista as notas de empenho com totais (empenhado, liquidado, pago e saldo), filtros por saldo, restos a pagar, ano e UASG, e a proveniência dos dados do SIAFI.',
    fundamento: 'Lei 4.320/1964, arts. 58 a 61',
    etapa: null,
    telas: ['empenhos'],
    implementacao: 'api: GET /empenhos',
  },
  {
    id: 'RF-06',
    tipo: 'RF',
    titulo: 'Pagamentos',
    descricao:
      'Lista os pagamentos na ordem cronológica de exigibilidade, por fonte de recursos e categoria de contrato, com filtro por situação e ação de atestar com confirmação; o atesto gera evento na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 141; Lei 4.320/1964, arts. 62 e 63',
    etapa: null,
    telas: ['pagamentos'],
    implementacao: 'api: GET /pagamentos; POST /pagamentos/:id/atestar',
  },
  {
    id: 'RF-07',
    tipo: 'RF',
    titulo: 'Vínculos entre contratos, atas, empenhos e itens',
    descricao:
      'Apresenta contratos sem ata, empenhos sem contrato e empenhos sem item, com sugestões de vínculo. Vincular exige confirmação e pode ser desfeito; cada operação gera evento na trilha de auditoria.',
    fundamento: 'Lei 4.320/1964, art. 60',
    etapa: null,
    telas: ['vinculos'],
    implementacao: 'api: GET /vinculos/*; POST e DELETE /vinculos/contrato-ata e /vinculos/empenho-contrato; POST /vinculos/empenho-item',
  },
  {
    id: 'RF-08',
    tipo: 'RF',
    titulo: 'Ajustes e cadastros de apoio',
    descricao:
      'Mantém modelos de plano de gestão, unidades internas, grupos de UASG e o calendário de feriados locais usado na contagem de prazos em dias úteis, com formulários acessíveis.',
    fundamento: 'Lei 14.133/2021, art. 183',
    etapa: null,
    telas: ['ajustes'],
    implementacao: 'api: GET /modelos-gestao; GET /unidades-internas; GET /grupos-uasg; GET /feriados',
  },
  {
    id: 'RF-09',
    tipo: 'RF',
    titulo: 'Administração de usuários, perfis e integrações',
    descricao:
      'Permite criar e editar usuários, atribuir perfis e UASGs, ativar e desativar acessos, consultar a matriz de permissões e acompanhar e executar as sincronizações com as fontes externas.',
    fundamento: 'Lei 13.709/2018 (LGPD), art. 46',
    etapa: null,
    telas: ['admin'],
    implementacao: 'api: /usuarios; GET /perfis; GET /sincronizacoes; POST /sincronizacoes/:fonte/executar',
  },
  {
    id: 'RF-10',
    tipo: 'RF',
    titulo: 'Auditoria',
    descricao:
      'Consulta a trilha de auditoria com filtros, executa a verificação de integridade da cadeia de hashes e lista os registros de acesso a dados pessoais.',
    fundamento: 'Lei 14.133/2021, arts. 169 a 171; Lei 13.709/2018 (LGPD), art. 37',
    etapa: null,
    telas: ['auditoria'],
    implementacao: 'api: GET /auditoria; GET /auditoria/verificacao; GET /lgpd/acessos',
  },
  {
    id: 'RF-11',
    tipo: 'RF',
    titulo: 'Transparência',
    descricao:
      'Área pública, sem login, com a consulta de contratos e seus detalhes e o Caderno de Regras imprimível. Dados pessoais são exibidos mascarados.',
    fundamento: 'Lei 14.133/2021, arts. 13 e 25, § 3º; Lei 12.527/2011',
    etapa: null,
    telas: ['transparencia'],
    implementacao: 'api: GET /publico/contratos; GET /publico/contratos/:id; GET /publico/catalogo-regras',
  },
  {
    id: 'RF-12',
    tipo: 'RF',
    titulo: 'Previsão financeira',
    descricao:
      'Compara, mês a mês, os pagamentos previstos e realizados, em gráfico de barras com tabela equivalente acessível, e detalha a previsão por contrato.',
    fundamento: 'Lei 14.133/2021, art. 150',
    etapa: null,
    telas: ['previsao'],
    implementacao: 'api: GET /pagamentos/previsao',
  },
  {
    id: 'RF-13',
    tipo: 'RF',
    titulo: 'Fornecedores e índice de desempenho',
    descricao:
      'Lista os fornecedores com ranking ordenável pelo Índice de Desempenho Contratual (IDC, de 0 a 100) e os selos Diamante (≥ 90), Ouro (≥ 75), Prata (≥ 60), Em observação (≥ 50), Crítico (< 50) e Sem histórico (sem penalizar a falta de dados). O selo Impedido decorre exclusivamente de sanção vigente de impedimento de licitar ou declaração de inidoneidade (arts. 156 e 158 da Lei 14.133/2021) e aparece ao lado do selo do IDC mantendo a nota visível. O detalhe exibe componentes, metodologia auditável, sanções, contratos e regularidade com mascaramento LGPD.',
    fundamento: 'Lei 14.133/2021, art. 88, §§ 3º e 4º, e arts. 156 e 158',
    etapa: null,
    telas: ['fornecedores'],
    implementacao: 'calcularIdc; api: GET /fornecedores; GET /fornecedores/:id',
  },
  {
    id: 'RF-14',
    tipo: 'RF',
    titulo: 'Processos sancionatórios',
    descricao:
      'Lista os processos sancionatórios, permite instaurar processo indicando a infração do art. 155 e as sanções cabíveis, e oferece o simulador de dosimetria da multa com memória de cálculo, prazos de defesa e de registro no CEIS/CNEP e o aviso de que a decisão é da autoridade competente.',
    fundamento: 'Lei 14.133/2021, arts. 155 a 163',
    etapa: null,
    telas: ['sancoes'],
    implementacao: 'sancoesCabiveis, calcularDosimetriaMulta; api: GET /sancoes; POST /sancoes; POST /sancoes/dosimetria/simular',
  },
  {
    id: 'RF-15',
    tipo: 'RF',
    titulo: 'Jornada da contratação',
    descricao:
      'Lista os processos por órgão requisitante e etapa e conduz cada processo pelas 7 etapas (demanda e PCA; instrução no SEI e equipe; ETP, riscos e preços; TR, edital e minuta; controle jurídico e publicação; seleção do fornecedor; contrato e gestão), mostrando os bloqueios que impedem o avanço, os sinais de atenção, a árvore do processo e a exportação do dossiê.',
    fundamento: 'Lei 14.133/2021, arts. 17 e 18',
    etapa: null,
    telas: ['jornada', 'jornada.detalhe'],
    implementacao: 'api: GET /processos; GET /processos/:id; POST /processos/:id/avancar',
  },
  {
    id: 'RF-16',
    tipo: 'RF',
    titulo: 'Importação da cesta de preços por planilha',
    descricao:
      'Importa as cotações da pesquisa de preços a partir de uma planilha (CSV ou linhas coladas), com o parâmetro do art. 23, § 1º, a identificação da fonte, o valor unitário, a data e a justificativa da pesquisa direta. O servidor valida cada linha e mostra a prévia, com os erros apontados por linha, antes de gravar; as cotações podem ser acrescentadas às existentes ou substituí-las, e a importação fica na trilha de auditoria. Depois da importação, a análise estatística sugere os expurgos, que continuam dependendo de aceite humano com justificativa.',
    fundamento: 'Lei 14.133/2021, art. 23, § 1º; IN SEGES/ME 65/2021',
    etapa: 3,
    telas: [],
    implementacao: 'api: POST /processos/:id/cesta-precos/importacao/previa; POST /processos/:id/cesta-precos/importacao; analisarCestaPrecos',
  },
  {
    id: 'RF-17',
    tipo: 'RF',
    titulo: 'Editais publicados com inteiro teor sem login',
    descricao:
      'Lista os editais publicados e oferece o inteiro teor do edital, do termo de referência e da minuta do contrato em PDF, gerado no servidor a partir da última versão aprovada, sem cadastro nem login. CPF, e-mail e telefone escritos nos documentos saem tarjados. Quando a publicação for feita no PNCP pela integração do órgão, a página aponta também para o registro oficial no portal.',
    fundamento: 'Lei 14.133/2021, art. 25, § 3º, e art. 54; Lei 13.709/2018 (LGPD), art. 6º, III',
    etapa: 5,
    telas: [],
    implementacao: 'api: GET /publico/editais; GET /publico/editais/:id; GET /publico/editais/:id/documentos/:tipo; mascararCpf',
  },
  {
    id: 'RF-25',
    tipo: 'RF',
    titulo: 'Consulta automática e combinada de preços',
    descricao:
      'Consulta, pelo servidor, as fontes oficiais de preços para o item de referência da cesta: o painel de preços e as contratações similares do último ano pelas APIs de dados abertos de compras do governo federal e do PNCP, as notas fiscais eletrônicas acessíveis ao órgão e as tabelas do Sinapi e do Sicro importadas no servidor, em obras e serviços de engenharia. Cada amostra é enquadrada no inciso do art. 23, descartada com motivo quando não serve e apresentada com fonte, data e proveniência da consulta. As sugestões só entram na cesta por escolha do agente, e a consulta e a inclusão ficam na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 23, §§ 1º e 2º; IN SEGES/ME 65/2021, art. 5º',
    etapa: 3,
    telas: ['jornada.detalhe'],
    implementacao:
      'selecionarSugestoesPrecos, enquadrarAmostraArt23; api: POST /processos/:id/pesquisa-precos/consultas; POST /processos/:id/pesquisa-precos/consultas/:consultaId/incluir',
  },
  {
    id: 'RIA-11',
    tipo: 'RIA',
    titulo: 'Projeção de variação cambial e inflacionária do valor estimado',
    descricao:
      'Projeta o valor estimado da contratação até a data prevista com índices oficiais obtidos pelo servidor: a variação mensal do IPCA, do IBGE, e a cotação média mensal do dólar, do Banco Central, aplicada só à parcela do valor que o agente indica como sujeita ao câmbio. Mostra o valor projetado, a faixa de variação, as premissas, as fontes e a data do cálculo, com a marcação "requer revisão humana". É sinal: não altera o valor estimado nem a cesta de preços.',
    fundamento: 'Lei 14.133/2021, art. 23 e art. 25, § 7º; IN SEGES/ME 65/2021, art. 5º, I e II',
    etapa: 3,
    telas: ['jornada.detalhe'],
    implementacao: 'projetarValorEstimado; api: POST /processos/:id/pesquisa-precos/projecao',
  },
  {
    id: 'RN-31',
    tipo: 'RN',
    titulo: 'Semáforo de vencimentos de 30, 60, 90 e 120 dias com avisos automáticos',
    descricao:
      'Contratos e atas de registro de preços entram em faixas de aviso conforme os dias que faltam para o fim da vigência: 120 dias (avaliar a prorrogação ou iniciar o planejamento de nova contratação), 90, 60 e 30 dias. A varredura diária do servidor gera um único aviso por instrumento, faixa e data de fim de vigência, dirigido ao gestor e ao fiscal; a prorrogação muda a data de fim e reinicia o ciclo. O aviso da faixa de 30 dias é obrigatório e não pode ser desativado nas preferências. O painel mostra a linha do tempo dos vencimentos dos próximos 120 dias.',
    fundamento: 'Lei 14.133/2021, art. 84 (vigência da ata), arts. 105 a 107 (duração e prorrogação dos contratos) e art. 117 (fiscalização)',
    etapa: null,
    telas: ['painel', 'contratos', 'atas', 'contratos.detalhe', 'atas.detalhe', 'notificacoes'],
    implementacao: 'classificarVigencia, faixaVencimento, avaliarAvisoVencimento, avisoObrigatorio; api: POST /notificacoes/varredura; GET /vencimentos',
  },
  {
    id: 'RF-26',
    tipo: 'RF',
    titulo: 'Central de notificações automatizadas',
    descricao:
      'Reúne os avisos a gestores, fiscais e contratadas sobre vencimentos, reajustes, garantias, pendências e ocorrências. Os avisos automáticos saem da varredura diária do servidor e o disparo manual é feito em um clique a partir do contrato ou da ata, por e-mail institucional (servidor SMTP do órgão), por registro no processo SEI ou pelo gov.br. Cada envio passa por uma fila durável no banco, com novas tentativas, situação visível e reenvio, e fica na trilha de auditoria com a base legal do tratamento. O e-mail do destinatário aparece mascarado. Cada usuário escolhe os avisos que quer receber, exceto os avisos legais obrigatórios.',
    fundamento: 'Lei 14.133/2021, arts. 91, 92, 106, 117 e 141; Lei 13.709/2018 (LGPD), arts. 7º, 23 e 37',
    etapa: 7,
    telas: ['notificacoes'],
    implementacao:
      'montarMensagemNotificacao, decidirEntregaNotificacao, baseLegalEnvio, proximaTentativa, avaliarAvisoReajuste, avaliarAvisoGarantia; api: GET /notificacoes; GET /notificacoes/:id; POST /notificacoes; POST /notificacoes/envios/:id/reenviar; GET /notificacoes/preferencias; PUT /notificacoes/preferencias; GET /notificacoes/canais',
  },
  {
    id: 'RN-26',
    tipo: 'RN',
    titulo: 'Rito da sessão de disputa: modos, lances, prorrogação, encerramento e julgamento',
    descricao:
      'A sessão segue o modo de disputa do edital: aberto, aberto e fechado ou fechado e aberto no menor preço e no maior desconto, e só o fechado na técnica e preço (art. 56, §§ 1º e 2º). Cada lance precisa ser melhor que o último do próprio licitante e respeitar o intervalo mínimo do edital, tanto ao cobrir a melhor oferta quanto nos lances intermediários (art. 57). No modo aberto, a etapa dura 10 minutos e o lance nos 2 minutos finais prorroga a etapa por mais 2, sucessivamente; no aberto e fechado, a etapa aberta dura 15 minutos, segue-se o aviso de fechamento iminente com encerramento sorteado em até 10 minutos e o lance final e fechado, sigiloso, em até 5 minutos, para a faixa de 10% ou as 3 melhores ofertas; no fechado e aberto, só a faixa de 10% (ou as 3 melhores) vai à etapa aberta (IN SEGES/ME 73/2022, arts. 23 a 25, parâmetros configuráveis). Valores iguais alcançados por lance valem pela ordem de registro; empate sem lance segue o art. 60. Com diferença de ao menos 5% entre a primeira e a segunda colocadas, o agente pode admitir o reinício da disputa aberta, só com lances intermediários (art. 56, § 4º). Depois dos lances, o agente pode negociar com o primeiro colocado, e o resultado entra na ata (art. 61). Na técnica e preço, a proposta técnica pesa até 70% (art. 36, § 2º). Oferta acima do valor estimado vira sinal para o agente decidir (art. 59, III).',
    fundamento: 'Lei 14.133/2021, arts. 33, 34, 36, § 2º, 56, 57, 59, 60 e 61; IN SEGES/ME 73/2022, arts. 5º e 19 a 30',
    etapa: 6,
    telas: ['jornada.disputa'],
    implementacao:
      'validarModoDisputa, parametrosPadraoDisputa, validarLance, calcularEstadoSessao, classificarSessaoDisputa, avaliarReinicioDisputa, pontuarTecnicaEPreco, aplicarDesempate; api: POST /sessoes-disputa/:id/lances',
  },
  {
    id: 'RIA-09',
    tipo: 'RIA',
    titulo: 'Sinal de padrão de lances na sessão de disputa',
    descricao:
      'Analisa a sequência de lances da sessão e aponta, com as evidências, quatro padrões: lances do mesmo licitante em intervalos regulares, reduções seguidas exatamente iguais, alternância da melhor oferta só entre dois licitantes e lances de mesmo valor de licitantes diferentes. Quando o padrão envolve licitantes com sócio em comum (RIA-06), o sinal aparece reforçado. Durante a etapa de lances, os licitantes aparecem com rótulos anônimos. Todo sinal traz o fundamento e a marcação "requer revisão humana": não desclassifica, não impede e não constitui acusação, e o lance automático parametrizado no próprio sistema é permitido. A apuração cabe ao agente de contratação, com contraditório.',
    fundamento: 'Lei 14.133/2021, art. 5º e art. 155, IX e XI; Lei 12.846/2013, art. 5º, IV, "a"; IN SEGES/ME 73/2022, art. 19',
    etapa: 6,
    telas: ['jornada.disputa'],
    implementacao: 'detectarPadroesLances, cruzarPadroesComVinculos; api: GET /sessoes-disputa/:id',
  },
  {
    id: 'RF-22',
    tipo: 'RF',
    titulo: 'Sala de disputa: simulação e acompanhamento da sessão oficial',
    descricao:
      'A sala de disputa abre a partir da etapa de seleção do processo e tem dois usos. Na simulação, para treino e para a prova de conceito, o agente de contratação cria a sessão com os participantes do cadastro, o critério, o modo e os parâmetros do edital; licitantes sintéticos dão lances determinísticos, o relógio da simulação pode ser adiantado e a sala mostra ao vivo o quadro de lances, o cronômetro, a situação e os sinais. No acompanhamento, a sessão oficial acontece no Compras.gov.br: o servidor da Ágora consulta os dados abertos da compra e do resultado, com proveniência, e o agente pode transcrever os lances para os sinais. Ao encerrar, a Ágora gera a ata da sessão para revisão humana e o resultado alimenta o registro da disputa do processo, com trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, arts. 17, 28, 33, 56, 59, 60 e 61; IN SEGES/ME 73/2022',
    etapa: 6,
    telas: ['jornada.disputa'],
    implementacao:
      'calcularEstadoSessaoSimulada, proximoLanceSimulado, redigirAtaSessaoDisputa; api: GET /processos/:id/sessoes-disputa; POST /processos/:id/sessoes-disputa; GET /sessoes-disputa/:id; POST /sessoes-disputa/:id/abertura; POST /sessoes-disputa/:id/relogio; POST /sessoes-disputa/:id/sincronizacao; POST /sessoes-disputa/:id/encerramento',
  },
  {
    id: 'RF-23',
    tipo: 'RF',
    titulo: 'Painel das três linhas de defesa',
    descricao:
      'Painéis separados para cada linha de defesa, com perfil e escopo de UASG decididos no servidor. A 1ª linha (servidores, fiscais e agentes de contratação) vê pendências vencidas, tarefas e atestos atrasados, processos bloqueados e revisões da matriz de riscos. A 2ª linha (assessoria jurídica e controle interno) vê pareceres pendentes, a matriz de achados preventivos (aditivos perto do limite, contrato sem fiscal, divulgação no PNCP vencida, pagamento preterido na ordem cronológica) e as exceções justificadas nos processos. A 3ª linha (CGU e TCU) tem leitura ampla: medidas de controle com prazo, integridade da trilha de auditoria, acessos a dados pessoais e o relatório executivo de auditoria em PDF, com fontes, data e período.',
    fundamento: 'Lei 14.133/2021, art. 169, I a III e § 2º',
    etapa: null,
    telas: ['controle'],
    implementacao: 'avaliarLimiteAditivos, pagamentosPreteridos; api: GET /controle/primeira-linha; GET /controle/segunda-linha; GET /controle/terceira-linha; GET /controle/relatorio.pdf',
  },
  {
    id: 'RF-24',
    tipo: 'RF',
    titulo: 'Controle externo: medidas de controle e cautelares',
    descricao:
      'Registro das medidas do tribunal de contas e do órgão central de controle interno no processo ou no contrato: órgão, número da decisão, datas da decisão e da ciência, objeto e efeito suspensivo. A Ágora calcula o prazo de resposta do órgão em dias úteis, mostra o semáforo do prazo, aceita a prorrogação concedida e registra a resposta e a revogação. Para a suspensão cautelar, informa também o prazo do tribunal para decidir o mérito. Toda escrita fica na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 171, §§ 1º, 2º e 4º',
    etapa: null,
    telas: ['controle.externo'],
    implementacao:
      'prazoRespostaMedida, prazoDecisaoMerito, situacaoMedidaControle; api: GET /medidas-controle; POST /medidas-controle; POST /medidas-controle/:id/prorrogacao; POST /medidas-controle/:id/resposta; POST /medidas-controle/:id/revogacao',
  },
  {
    id: 'RN-29',
    tipo: 'RN',
    titulo: 'Revisão trimestral da matriz de riscos do contrato',
    descricao:
      'A matriz de riscos de cada contrato é revisada a cada três meses pela equipe de gestão e fiscalização (1ª linha de defesa) e pela unidade de controle interno (2ª linha). A próxima revisão vence três meses após a última, ou após o início da vigência quando ainda não houve revisão; o alerta aparece 15 dias antes e a revisão vencida fica destacada no contrato e nos painéis das linhas de defesa. O registro da revisão traz a matriz atualizada e a observação de quem revisou, e entra na trilha de auditoria. Contrato com vigência encerrada não exige revisão.',
    fundamento: 'Lei 14.133/2021, arts. 22 e 169; matriz de riscos do contrato',
    etapa: 7,
    telas: ['contratos.detalhe', 'controle'],
    implementacao: 'situacaoRevisaoRiscos; api: GET /contratos/:id/riscos; POST /contratos/:id/riscos/revisoes',
  },
  {
    id: 'RN-30',
    tipo: 'RN',
    titulo: 'Cautelar suspensiva do controle externo impede avançar e contratar',
    descricao:
      'Enquanto houver medida cautelar com efeito suspensivo não revogada, o processo não avança de etapa e não gera o contrato; o aviso cita o órgão de controle, o número da decisão e a data da ciência. Ao ser intimado da suspensão, o órgão tem 10 dias úteis, admitida a prorrogação, para informar as medidas adotadas e prestar as informações; a resposta e a revogação são registradas e auditadas. Medidas sem efeito suspensivo não bloqueiam, mas têm prazo de resposta acompanhado.',
    fundamento: 'Lei 14.133/2021, art. 171, §§ 1º e 2º',
    etapa: null,
    telas: ['controle.externo', 'jornada.detalhe'],
    implementacao: 'bloqueioControleExterno, prazoRespostaCautelar; api: POST /processos/:id/avancar; POST /processos/:id/contratar',
  },
  {
    id: 'RN-20',
    tipo: 'RN',
    titulo: 'Prova de conceito ou amostra do licitante provisoriamente vencedor',
    descricao:
      'Quando o edital exigir prova de conceito ou amostra, com a necessidade justificada, o roteiro de testes e o prazo em dias úteis contados da convocação, o licitante provisoriamente vencedor é convocado e a prova ocorre em sessão pública gravada, cujo link fica no processo. O resultado é registrado por servidor, aprovado ou reprovado, sempre com motivação. Reprovado o licitante, o próximo colocado é convocado automaticamente. Sem resultado aprovado, o processo não segue para a habilitação, a fase recursal e a adjudicação.',
    fundamento: 'Lei 14.133/2021, art. 17, § 3º, e art. 41, II',
    etapa: 6,
    telas: ['jornada.detalhe'],
    implementacao:
      'validarProvaConceito, prazoProvaConceito, avaliarSelecao; api: PUT /processos/:id/parametros-edital; POST /processos/:id/selecao/prova-conceito/convocacao; POST /processos/:id/selecao/prova-conceito/resultado',
  },
  {
    id: 'RN-21',
    tipo: 'RN',
    titulo: 'Critérios de sustentabilidade e logística reversa obrigatórios',
    descricao:
      'Com a política de sustentabilidade do órgão ligada (padrão), o Estudo Técnico Preliminar e o termo de referência só se concluem com os critérios de sustentabilidade ambiental e a logística reversa de bens e refugos preenchidos: sem eles, o processo não avança das etapas 3 e 4 e os documentos não podem ser aprovados. O TR gerado traz a seção correspondente. Só o administrador altera a política, com justificativa registrada na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII',
    etapa: 3,
    telas: ['jornada.detalhe', 'ajustes'],
    implementacao: 'verificarSustentabilidade; api: PUT /processos/:id/sustentabilidade; GET e PUT /politicas-orgao/sustentabilidade',
  },
  {
    id: 'RN-22',
    tipo: 'RN',
    titulo: 'Fase recursal única e prazos dos atos da seleção',
    descricao:
      'Depois do julgamento e da habilitação do vencedor, abre-se uma fase recursal única (com inversão de fases, ela segue o julgamento). A intenção de recorrer é registrada logo após o ato, sob pena de preclusão. As razões têm 3 dias úteis, e as contrarrazões, o mesmo prazo. Quem praticou o ato pode reconsiderá-lo em 3 dias úteis; mantido o ato, a autoridade superior decide em até 10 dias úteis. Os prazos seguem o calendário de dias úteis do órgão, e as decisões são sempre humanas e motivadas.',
    fundamento: 'Lei 14.133/2021, art. 165, I, §§ 1º, 2º e 4º, e art. 17, § 1º',
    etapa: 6,
    telas: ['jornada.detalhe'],
    implementacao:
      'prazosRecursoSelecao, avaliarSelecao, validarAtoSelecao, validarInversaoFases; api: POST /processos/:id/selecao/habilitacao; POST /processos/:id/selecao/recurso/*',
  },
  {
    id: 'RF-18',
    tipo: 'RF',
    titulo: 'Adjudicação, homologação e divulgação dos documentos preparatórios',
    descricao:
      'Exauridos os recursos, a autoridade competente designada no processo adjudica o objeto ao vencedor e homologa a licitação, em atos registrados na trilha de auditoria. Com a homologação, os documentos da fase preparatória que não integraram o edital (DFD, ETP, matriz de riscos, nota técnica de preços e checklist jurídico) passam a aparecer na página pública do edital, em PDF e sem login. A nota técnica de orçamento sigiloso não é divulgada.',
    fundamento: 'Lei 14.133/2021, art. 71, IV, e art. 54, § 3º',
    etapa: 6,
    telas: ['jornada.detalhe'],
    implementacao:
      'avaliarSelecao; api: POST /processos/:id/selecao/adjudicacao; POST /processos/:id/selecao/homologacao; GET /publico/editais/:id/preparatorios/:tipo',
  },
  {
    id: 'RN-23',
    tipo: 'RN',
    titulo: 'Recheque da regularidade antes do atesto e do pagamento',
    descricao:
      'O contratado deve manter, durante toda a execução, as condições exigidas na habilitação. Antes de cada atesto de nota fiscal, a Ágora consulta de novo o CEIS e o CNEP e confere as certidões fiscal federal, do FGTS e trabalhista; antes do pagamento, o financeiro repete a verificação. O resultado fica registrado com fonte e data. Havendo irregularidade, o atesto é registrado com a ressalva e a Ágora abre uma pendência para notificar o contratado; a irregularidade não autoriza, por si só, reter o pagamento do que já foi executado, e extinção do contrato ou sanção dependem de decisão da autoridade competente.',
    fundamento: 'Lei 14.133/2021, art. 92, XVI, e art. 91, § 4º',
    etapa: null,
    telas: ['pagamentos', 'contratos.detalhe'],
    implementacao: 'avaliarChecklistRegularidade, situacaoCertidao; api: POST /pagamentos/:id/atestar; POST /pagamentos/:id/regularidade',
  },
  {
    id: 'RN-24',
    tipo: 'RN',
    titulo: 'Registro da sanção aplicada no CEIS/CNEP em até 15 dias úteis',
    descricao:
      'Aplicada a sanção, o órgão tem até 15 dias úteis, contados da aplicação, para informar e manter atualizados os dados no CEIS e no CNEP. Como não há API pública de escrita nesses cadastros, a Ágora controla a obrigação: cada sanção aplicada vira uma pendência de registro com prazo calculado em dias úteis, com alerta a partir de 5 dias úteis do vencimento e destaque quando vencida. O responsável informa o cadastro, o protocolo e a data do envio feito no sistema da CGU, e a Ágora registra quem informou e quando, na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 161',
    etapa: null,
    telas: ['sancoes'],
    implementacao: 'situacaoRegistroCeisCnep, prazoRegistroCeisCnep; api: GET /sancoes/registro-ceis-cnep; POST /sancoes/:id/registro-ceis-cnep',
  },
  {
    id: 'RF-20',
    tipo: 'RF',
    titulo: 'Consulta ao CEIS e ao CNEP e checklist de regularidade',
    descricao:
      'Consulta o CEIS e o CNEP no servidor, pela API de dados do Portal da Transparência (chave configurada pelo órgão), com tempo limite, novas tentativas e cache com proveniência (hora da consulta, fonte e hash do conteúdo); no modo offline, usa sanções simuladas da carga sintética. O checklist reúne a consulta, as sanções aplicadas pelo órgão e o registro das certidões fiscal federal, do FGTS e trabalhista (tipo, número, emissor, emissão, validade e resultado, conferidos pelo agente), avisa os vencimentos próximos e aparece no fornecedor, na contratação, na prorrogação e no atesto. Cada consulta e cada registro entram na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 91, § 4º, e art. 68, III a V',
    etapa: 7,
    telas: ['fornecedores', 'jornada.detalhe', 'contratos.detalhe'],
    implementacao: 'avaliarChecklistRegularidade, classificarRegistroSancaoExterna, validarCertidao; api: GET /fornecedores/:id/regularidade; POST /fornecedores/:id/regularidade/consultar; POST /fornecedores/:id/certidoes',
  },
  {
    id: 'RF-21',
    tipo: 'RF',
    titulo: 'Documentos do processo e de habilitação',
    descricao:
      'Recebe os documentos do processo e os de habilitação dos licitantes (atestados, balanços, certidões e propostas) em PDF, PNG ou JPEG. O servidor confere o tipo pelo conteúdo do arquivo, e não pela extensão, recusa PDF com código ativo, aplica o limite de tamanho, calcula o SHA-256, passa o arquivo pelo antivírus do órgão quando configurado e o guarda fora do banco, no armazenamento da própria Ágora. O download só acontece pela API, com permissão e escopo da UASG do processo. Baixar documento marcado com dado pessoal exige finalidade e fica registrado (LGPD, art. 37). Envio, leitura e download ficam na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, arts. 12, VI, 62 e 67; Lei 13.709/2018 (LGPD), arts. 6º, 37 e 46',
    etapa: null,
    telas: ['jornada.documentos'],
    implementacao: 'api: GET /processos/:id/arquivos; POST /processos/:id/arquivos; POST /processos/:id/arquivos/:arquivoId/baixar',
  },
  {
    id: 'RIA-08',
    tipo: 'RIA',
    titulo: 'Leitura assistida de atestados de capacidade técnica',
    descricao:
      'Lê o atestado em PDF pela camada de texto ou, se o PDF for digitalizado, pelo serviço de reconhecimento óptico (OCR) hospedado pelo órgão. Localiza os quantitativos executados por parcela, com a unidade e o trecho-fonte (página e linha), confere o valor escrito por extenso, soma os atestados do mesmo licitante e compara o resultado com os mínimos exigidos no edital. O resultado é um sinal com evidências, premissas e data, que requer revisão humana: a habilitação técnica é decisão do agente de contratação.',
    fundamento: 'Lei 14.133/2021, art. 67, II, e §§ 1º e 2º; art. 18, IX',
    etapa: 6,
    telas: ['jornada.documentos'],
    implementacao: 'extrairQuantitativosAtestado, somarQuantitativosAtestados; api: POST /processos/:id/arquivos/:arquivoId/leitura; GET /processos/:id/qualificacao-tecnica',
  },
  {
    id: 'RN-25',
    tipo: 'RN',
    titulo: 'Parcelas de maior relevância, quantitativos mínimos e exercícios do balanço',
    descricao:
      'O edital só pode exigir atestado das parcelas de maior relevância ou valor significativo, que são as de valor individual igual ou superior a 4% do valor total estimado da contratação, e o quantitativo mínimo exigido nos atestados não pode passar de 50% da parcela, vedadas limitações de tempo e de local. A Ágora recusa exigência que descumpra esses limites. Na habilitação econômico-financeira, exige-se o balanço dos 2 últimos exercícios sociais, ou só do último quando a empresa foi constituída há menos de 2 anos.',
    fundamento: 'Lei 14.133/2021, art. 18, IX; art. 67, §§ 1º e 2º; art. 69, I e § 6º',
    etapa: 4,
    telas: ['jornada.documentos'],
    implementacao:
      'classificarParcelaRelevancia, limiteQuantitativoMinimo, avaliarExigenciasQualificacaoTecnica, exerciciosBalancoExigiveis, avaliarBalancosApresentados; api: PUT /processos/:id/qualificacao-tecnica',
  },
  {
    id: 'RIA-10',
    tipo: 'RIA',
    titulo: 'Sinal de vínculo impeditivo e de possível sucessão de empresa sancionada',
    descricao:
      'Junta ao cruzamento do quadro societário (RIA-06) os vínculos de fonte lícita: endereço ou contato de cadastro em comum entre licitantes, vínculos declarados pelos licitantes ou pelos agentes e vínculos informados por agente público com fonte e evidência, inclusive casamento, união estável e parentesco até o 3º grau. Vínculo de licitante com agente público que atua no processo é sinal de possível impedimento (art. 14, IV). Também aponta empresa com sócio, administrador ou endereço em comum com fornecedor impedido ou inidôneo, sobretudo se aberta perto ou depois da sanção (art. 14, § 1º). O quadro societário vem dos dados abertos do CNPJ, por conector no servidor, com CPF mascarado; parentesco nunca é deduzido por cruzamento de dados pessoais nem por endereço IP. Cada sinal traz as evidências e a marca "requer revisão humana": nenhum sinal desclassifica, impede ou acusa.',
    fundamento: 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, III, IV, V e § 1º',
    etapa: 6,
    telas: ['impedimentos', 'impedimentos.processo', 'impedimentos.fornecedor', 'jornada.detalhe'],
    implementacao: 'sinalizarVinculosLicitantes, detectarPossivelSucessao; api: POST /impedimentos/analise; GET /impedimentos/processos/:id; GET /impedimentos/fornecedores/:id',
  },
  {
    id: 'RN-27',
    tipo: 'RN',
    titulo: 'Extensão dos efeitos da sanção (desconsideração da personalidade jurídica)',
    descricao:
      'Quando a personalidade jurídica é usada com abuso do direito para encobrir ilícitos ou provocar confusão patrimonial, os efeitos da sanção aplicada à pessoa jurídica podem ser estendidos aos administradores e sócios com poderes de administração, à pessoa jurídica sucessora ou à empresa do mesmo ramo coligada ou controlada. A Ágora conduz o procedimento a partir de um sinal: proposta fundamentada, intimação com prazo de defesa de 15 dias úteis, análise jurídica prévia por quem não propôs e decisão da autoridade competente, que não pode ser quem propôs nem quem deu o parecer. Só com a decisão a sanção é registrada para o alcançado no módulo de sanções, com a mesma vigência restante da sanção de origem.',
    fundamento: 'Lei 14.133/2021, art. 160',
    etapa: null,
    telas: ['impedimentos', 'impedimentos.extensao'],
    implementacao: 'proporExtensaoSancao, avancarExtensaoSancao, efeitosExtensaoSancao; api: POST /impedimentos/extensoes e /impedimentos/extensoes/:id/defesa, /parecer, /decisao',
  },
  {
    id: 'RN-28',
    tipo: 'RN',
    titulo: 'Declaração de inexistência de impedimento dos agentes designados',
    descricao:
      'O agente só atua no processo depois de assinar a declaração de que não é cônjuge, companheiro ou parente até o 3º grau de licitantes ou contratados habituais, nem tem com eles vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil, e de que não está em conflito de interesses. A declaração registra também o vínculo funcional e a capacitação. Na designação da equipe, junto com a segregação de funções, a Ágora recusa quem não tem declaração válida, quem não declarou a inexistência de impedimento, quem não tem a capacitação exigida nas funções essenciais e, para agente de contratação e pregoeiro, quem não é servidor efetivo ou empregado público permanente. Os vínculos declarados alimentam o sinal de vínculo impeditivo.',
    fundamento: 'Lei 14.133/2021, art. 7º, I a III e § 2º, art. 8º, caput e § 5º, e art. 9º, § 1º',
    etapa: 2,
    telas: ['jornada.equipe', 'impedimentos.declaracao', 'impedimentos.processo'],
    implementacao: 'verificarDeclaracaoAgente, verificarDeclaracoesEquipe; api: POST /impedimentos/declaracoes; PUT /processos/:id/equipe',
  },
  {
    id: 'RNF-07',
    tipo: 'RNF',
    titulo: 'Fila de integrações com novas tentativas e fila de erro',
    descricao:
      'As integrações com sistemas externos (publicação no PNCP e sincronizações) passam por uma fila durável, em RabbitMQ ou no próprio PostgreSQL, consumida por um serviço trabalhador separado da API. Cada tarefa tem chave de idempotência, para que a mesma operação nunca seja feita duas vezes. Falhas transitórias (indisponibilidade, manutenção programada, limite de requisições) geram novas tentativas automáticas com espera exponencial e limite; falhas definitivas e tarefas que esgotam as tentativas vão para a fila de erro, visível na tela de integrações, onde podem ser reprocessadas com registro na trilha de auditoria. Assim a janela de manutenção do PNCP não faz perder transações.',
    fundamento: 'Caderno do cliente, RNF-04 e matriz de riscos (R04); Lei 14.133/2021, art. 174, § 2º',
    etapa: null,
    telas: ['admin'],
    implementacao:
      'esperaNovaTentativa, decidirDestinoFalha, classificarRespostaHttp, chaveIdempotencia; api: GET /fila/resumo; GET /fila/tarefas; POST /fila/tarefas/:id/reprocessar; trabalhador (apps/api/src/trabalhador.ts)',
  },
  {
    id: 'RF-19',
    tipo: 'RF',
    titulo: 'Publicação no PNCP pela fila de integrações',
    descricao:
      'Publica no PNCP a contratação com o edital, depois os anexos aprovados (termo de referência e minuta do contrato) e, na etapa do contrato, o próprio contrato, sempre pela fila de integrações e com o login do sistema credenciado no PNCP. O servidor grava o protocolo devolvido pelo PNCP, o número de controle, o hash de cada arquivo enviado e o modo (real ou simulado), e a situação de cada envio aparece na etapa de publicação da jornada, com o link público do edital. Recusas do PNCP não são repetidas automaticamente e ficam na fila de erro para correção; indisponibilidades são reenviadas sozinhas.',
    fundamento: 'Lei 14.133/2021, art. 54, art. 94 e art. 174, § 2º; Manual de Integração PNCP 2.2.x',
    etapa: 5,
    telas: ['jornada.detalhe'],
    implementacao:
      'interpretarLocalizacaoPncp, numeroControlePncp, codigosContratacaoPncp, tituloDocumentoPncp, prazoDivulgacaoContratoPncp; api: POST /processos/:id/publicar; GET /processos/:id/publicacao-pncp; POST /processos/:id/contrato/publicar-pncp',
  },
  {
    id: 'RN-34',
    tipo: 'RN',
    titulo: 'Recebimento provisório e definitivo, liquidação e prazo de pagamento',
    descricao:
      'Cada entrega da contratada é recebida em dois termos gerados em PDF, nos prazos em dias úteis definidos no contrato. O provisório é lavrado pelo fiscal ou pelo gestor designado, por termo detalhado nas obras e serviços e sumário nas compras; o definitivo, pelo gestor ou por membro da comissão de recebimento, nunca por quem lavrou o provisório da mesma entrega. Ressalva ou rejeição exigem a descrição do que está em desacordo, abrem prazo de correção ou substituição às custas da contratada e notificam a contratada pela central de notificações; depois da correção, o mesmo exame é refeito. Só o definitivo aceito libera a liquidação: a nota fiscal ligada à entrega é atestada no mesmo ato, com o recheque de regularidade do contratado, e o atesto direto da nota fica bloqueado enquanto a entrega não for recebida. O prazo de pagamento conta do recebimento definitivo ou da liquidação, conforme o contrato; vencido por atraso imputável à Administração, a Ágora calcula a atualização monetária pelo índice e pelos juros do contrato, pro rata die, como apoio à decisão.',
    fundamento: 'Lei 14.133/2021, art. 92, V, VI e VII, e § 7º; art. 117; art. 119; art. 140; art. 141',
    etapa: 7,
    telas: ['contratos.detalhe', 'pagamentos.prazos'],
    implementacao:
      'prazoRecebimentoProvisorio, avaliarTermoRecebimento, calcularGarantiaObjeto, calcularPrazoPagamento, calcularAtualizacaoMonetaria, corrigirPorIndice; api: POST /contratos/:id/recebimentos; POST /recebimentos/:id/termos; GET /recebimentos/termos/:id/termo.pdf; POST /pagamentos/:id/atestar; GET /pagamentos/prazos',
  },
  {
    id: 'RN-35',
    tipo: 'RN',
    titulo: 'Garantias contratuais: exigência, validade, liberação, execução e desconto de multa',
    descricao:
      'A garantia de execução é exigida em até 5% do valor inicial do contrato (ou do valor anual, nos contínuos com mais de um ano), em até 10% com justificativa da complexidade técnica e dos riscos e em até 30% só nas obras e serviços de engenharia de grande vulto, em seguro-garantia com cláusula de retomada; a garantia adicional de pagamento antecipado vai até 100% do valor antecipado. A contratada escolhe a modalidade: caução em dinheiro ou em títulos da dívida pública, seguro-garantia, fiança bancária ou título de capitalização. A Ágora controla o prazo de apresentação, a validade e a renovação, e avisa o vencimento pela central de notificações com 30 dias de antecedência. A prorrogação da vigência exige ou abre a renovação da garantia com pendência e prazo. A extinção do contrato (art. 139) desconta a multa aplicada na ordem acima e libera a garantia quando não há débito, entrega pendente nem ocorrência aberta; havendo pendência, ou prejuízo a ressarcir, a garantia fica retida até a execução decidida pela autoridade competente, com valor e motivo, e o emitente da garantia é notificado pela central de notificações. A liberação também ocorre depois da fiel execução, sem entrega pendente nem multa por descontar, com a caução em dinheiro atualizada. A multa aplicada é descontada primeiro dos pagamentos devidos, depois da garantia, e o restante segue para cobrança judicial, com a contratada notificada para recompor a garantia.',
    fundamento: 'Lei 14.133/2021, arts. 96 a 102; art. 139, III; art. 145, § 2º; art. 156, § 8º',
    etapa: 7,
    telas: ['contratos.detalhe'],
    implementacao:
      'baseCalculoGarantia, avaliarPercentualGarantia, validarApresentacaoGarantia, situacaoGarantia, avaliarLiberacaoGarantia, atualizarCaucaoDinheiro, avaliarExecucaoGarantia, planejarDescontoMulta, validarDecisaoAutoridade; api: POST /contratos/:id/garantias; POST /garantias/:id/apresentacao; POST /garantias/:id/renovacao; POST /garantias/:id/liberacao; POST /garantias/:id/execucao; POST /sancoes/:id/descontos',
  },
  {
    id: 'RF-28',
    tipo: 'RF',
    titulo: 'Execução do contrato: fiscalização, recebimentos, garantias e prazos de pagamento',
    descricao:
      'No contrato, a aba Fiscalização registra a designação do gestor e dos fiscais técnico, administrativo e requisitante e da comissão de recebimento, com o ato e a data, e o livro de ocorrências, que notifica a contratada quando há prazo de regularização. A aba Recebimentos define os prazos do contrato e registra as entregas e os termos provisório e definitivo, com o PDF de cada termo. A aba Garantias registra a exigência, a apresentação, a renovação, a liberação, a execução e o desconto de multa. No financeiro, a tela Prazos de pagamento mostra o limite de cada parcela, a atualização estimada das atrasadas e o registro da alteração justificada da ordem cronológica, com a autoridade, o ato e as comunicações ao controle interno e ao tribunal de contas, que aparece como exceção justificada no painel da 2ª linha de defesa. A aba Recebimentos registra também as ordens de serviço, com o período antecedente previsto no contrato, e a aba Fiscalização, a verificação mensal das reservas legais de cargos exigidas no edital, que, com pendência, entra no livro de ocorrências.',
    fundamento: 'Lei 14.133/2021, arts. 92 (inclusive XVII e § 2º), 96 a 102, 117, 119, 140, 141 e 156, § 8º; Decretos 11.430/2023 e 9.450/2018',
    etapa: 7,
    telas: ['contratos.detalhe', 'pagamentos.prazos'],
    implementacao:
      'verificarDesignacoesContrato, validarOcorrencia, validarAlteracaoOrdemCronologica, classificarPreteridosComAlteracoes, avaliarOrdemServico, avaliarReservasCargos; api: GET /contratos/:id/execucao; POST /contratos/:id/ordens-servico; POST /contratos/:id/reservas-cargos; GET /contratos/:id/designaveis; POST /contratos/:id/designacoes; POST /designacoes/:id/encerrar; POST /contratos/:id/ocorrencias; POST /ocorrencias/:id/regularizar; PUT /contratos/:id/parametros-execucao; GET /alteracoes-ordem; POST /pagamentos/:id/alteracoes-ordem; POST /alteracoes-ordem/:id/comunicacoes',
  },
  {
    id: 'RN-38',
    tipo: 'RN',
    titulo: 'Intenção de registro de preços aberta por pelo menos 8 dias úteis',
    descricao:
      'Na fase preparatória do registro de preços, o órgão gerenciador realiza a intenção de registro de preços (IRP) para que outras unidades e órgãos manifestem interesse e informem as quantidades. A IRP fica aberta por pelo menos 8 dias úteis, contados com exclusão do dia da abertura, que não pode ser anterior a hoje; o servidor recusa período menor e informa a data mínima de encerramento. As adesões só são aceitas enquanto a IRP está aberta, e depois do encerramento o gerenciador consolida as quantidades. A IRP é dispensável quando o gerenciador é o único contratante.',
    fundamento: 'Lei 14.133/2021, art. 86, caput e § 1º; Decreto 11.462/2023, art. 9º; Lei 14.133/2021, art. 183',
    etapa: null,
    telas: ['planejamento.irp', 'jornada.dfd'],
    implementacao: 'verificarPrazoIrp, prazoMinimoIrp, situacaoIrp, consolidarQuantidadesIrp; api: POST /irps; POST /irps/:id/adesoes; POST /irps/:id/consolidar',
  },
  {
    id: 'RF-31',
    tipo: 'RF',
    titulo: 'Plano de contratações anual, conferência do DFD e intenções de registro de preços',
    descricao:
      'A tela Plano de contratações reúne as demandas das unidades de cada UASG (item, código do catálogo, quantidade, valor estimado, data desejada e grau de prioridade), consolida as de mesma natureza, leva o plano à aprovação da autoridade competente e o publica no PNCP pela fila de integrações. No DFD, o agente aponta o item do PCA publicado em que a demanda está prevista e o código do catálogo de cada item; quando a UASG tem PCA publicado no exercício, o DFD sem item do plano só avança com a justificativa da contratação não planejada. A tela Intenções de registro de preços abre a IRP, recebe as adesões das unidades e consolida as quantidades.',
    fundamento: 'Lei 14.133/2021, art. 12, VII e § 1º, art. 18, § 1º, II, e art. 86; Decreto 10.947/2022; Decreto 11.462/2023',
    etapa: 1,
    telas: ['planejamento.pca', 'planejamento.irp', 'jornada.dfd'],
    implementacao:
      'consolidarPca, validarDemandaPca, validarTransicaoPca, itemPlanoContratacoesPncp, conferirDfdComPca, identificadorItemPca; api: GET /pca; POST /pca/:id/consolidar; POST /pca/:id/aprovar; PUT /processos/:id/pca; GET /irps',
  },
  {
    id: 'RIA-13',
    tipo: 'RIA',
    titulo: 'Sugestão do código do catálogo CATMAT/CATSER',
    descricao:
      'Para cada item do DFD, a Ágora compara a descrição com os itens ativos do catálogo de materiais e serviços do governo federal, consultado no servidor pela API de dados abertos de compras (com cache e registro da consulta), e sugere os códigos mais semelhantes, com a pontuação e os termos em comum. A semelhança é determinística, por termos do texto, sem modelo de linguagem. É sinal: o agente confere a descrição do item no catálogo e escolhe o código, e a escolha fica na trilha de auditoria; deixar de usar o catálogo continua exigindo justificativa escrita (RN-02).',
    fundamento: 'Lei 14.133/2021, art. 19, II e § 2º',
    etapa: 1,
    telas: ['jornada.dfd'],
    implementacao: 'sugerirItensCatalogo, termosCatalogo; api: GET /catalogo/itens; GET /catalogo/sugestoes; PUT /processos/:id/dfd/itens/:indice/catalogo',
  },
  {
    id: 'RNF-10',
    tipo: 'RNF',
    titulo: 'Operação sustentável e medição de disponibilidade (IMR-01)',
    descricao:
      'A plataforma ajusta sozinha o número de réplicas da API, do trabalhador e do OCR conforme a carga e desliga o ambiente de homologação fora do expediente, em horário configurável, para reduzir o consumo de energia (TI verde). Um teste de carga reproduzível, feito com ferramenta própria e com os volumes de referência configurados pelo órgão, mede listagens, jornada, publicação pela fila e envio de documentos. Uma sonda no servidor registra, a cada minuto, se a API, o banco, a fila e a última sincronização com o PNCP estão disponíveis; o relatório mensal calcula a disponibilidade (minutos considerados menos minutos indisponíveis, sobre os minutos considerados) e lista as janelas de manutenção do PNCP absorvidas pela fila. A meta é configurada pelo órgão, e a glosa, se houver, é decisão do fiscal do contrato.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "g", e art. 11, IV; caderno do cliente: ETP (TI verde), IMR-01 e RNF-04',
    etapa: null,
    telas: ['operacao'],
    implementacao:
      'calcularDisponibilidade, detectarJanelasPncp, dimensionarCarga, estatisticasLatencia; api: GET /operacao/situacao; POST /operacao/sondar; GET /operacao/disponibilidade; GET /operacao/disponibilidade.csv; POST /operacao/janelas; deploy/k8s/autoescalonamento.yaml; deploy/k8s/homologacao-expediente.yaml; npm run carga -w @agora/api',
  },
  {
    id: 'RF-39',
    tipo: 'RF',
    titulo: 'Painel das metas do ETP (resultados pretendidos)',
    descricao:
      'Mede, na UASG e no período escolhidos, os três resultados pretendidos do ETP contra as metas configuradas pelo órgão: o tempo de instrução da fase preparatória por etapa, calculado pelos avanços registrados na trilha de auditoria, com a linha de base e o atual; os erros formais barrados pelas travas (ETP incompleto, artigo de luxo, consulta ao CEIS e ao CNEP antes da assinatura e as demais travas de avanço), com cada bloqueio registrado como evento na trilha; e a economia, diferença entre o valor estimado e o contratado ou homologado, com o efeito dos expurgos da cesta à parte (média com e sem as cotações descartadas). O painel diz o que mede e o que não mede, não atribui a economia à IA e exporta os dados em CSV.',
    fundamento: 'Lei 14.133/2021, art. 18, § 1º, IX (demonstrativo dos resultados pretendidos), e art. 11',
    etapa: null,
    telas: ['metas'],
    implementacao:
      'medirTempoInstrucao, avaliarMitigacaoTravas, medirEconomia, efeitoExpurgosCesta, validarMetasEtp, situacaoMeta; api: GET /metas-etp; GET /metas-etp/exportar.csv; GET /metas-etp/configuracao; PUT /metas-etp/configuracao; trilha: trava.bloqueio',
  },
  {
    id: 'RN-36',
    tipo: 'RN',
    titulo: 'Conferência da nota fiscal com o valor devido e o ajuste do IMR',
    descricao:
      'O valor devido de cada nota fiscal é o preço unitário contratado multiplicado pela quantidade recebida no período (aferida no termo de recebimento definitivo da entrega), menos a glosa do instrumento de medição de resultado (IMR) calculada sobre as medições da competência. A Ágora confere a nota registrada (número, valor e itens) e aponta preço acima do contratado, quantidade cobrada maior que a recebida, quantidade acima do saldo do item, soma dos itens diferente do total, medição pendente e diferença entre o valor da nota e o valor devido. Havendo divergência, o atesto fica bloqueado até a correção da nota ou a justificativa registrada pelo agente responsável; em contrato com IMR, o atesto exige a conferência. A glosa ajusta o pagamento ao resultado medido e não é sanção: a faixa que prevê processo sancionatório só encaminha o caso para a decisão da autoridade competente.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A',
    etapa: null,
    telas: ['pagamentos', 'pagamentos.conferencia', 'contratos.detalhe'],
    implementacao:
      'conferirNotaFiscal, calcularAjustePagamento; api: GET /pagamentos/:id/conferencia; POST /pagamentos/:id/conferencia; POST /pagamentos/:id/conferencia/justificativa; POST /pagamentos/:id/atestar',
  },
  {
    id: 'RF-29',
    tipo: 'RF',
    titulo: 'Instrumento de medição de resultado (IMR) do contrato e medições periódicas',
    descricao:
      'Na aba "IMR e medições" do contrato, o gestor configura os indicadores do instrumento de medição de resultado: nome, meta, forma de cálculo, periodicidade, fonte da medição, itens alcançados e faixas de ajuste do pagamento (glosa), com teto opcional. O fiscal registra a medição de cada competência com a evidência, e a Ágora calcula o resultado e o percentual de glosa de forma determinística, com memória de cálculo, e conclui a tarefa de medição do plano de gestão. A medição que cai na faixa com previsão de processo sancionatório abre pendência para o gestor avaliar o encaminhamento, que é decisão humana. Na conferência da nota fiscal, a fiscalização e o financeiro registram a nota e veem o valor cobrado ao lado do valor devido.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117 e 140; IN SEGES/MP 5/2017, anexo VIII-A',
    etapa: null,
    telas: ['contratos.detalhe', 'pagamentos.conferencia'],
    implementacao:
      'validarIndicadorImr, calcularResultadoImr, calcularAjustePagamento, medicaoImrDevida; api: GET /contratos/:id/imr; POST /contratos/:id/imr/indicadores; PUT /contratos/:id/imr/indicadores/:indicadorId; POST /contratos/:id/imr/indicadores/:indicadorId/encerrar; POST /contratos/:id/imr/medicoes',
  },
  {
    id: 'RN-39',
    tipo: 'RN',
    titulo: 'Dotação orçamentária declarada antes do edital',
    descricao:
      'A área responsável informa a dotação orçamentária do processo em campos estruturados: unidade gestora, programa de trabalho, natureza da despesa, fonte de recursos, exercício, valor e, quando houver, o pré-empenho. A Ágora confere o formato de cada campo, a coerência da natureza da despesa e a existência de crédito do exercício em que a contratação é feita; créditos menores que o valor estimado viram sinal. A declaração de adequação orçamentária é aprovada pela autoridade competente designada no processo, e o termo de referência e a minuta do contrato passam a trazer a dotação. O processo só avança da etapa 4 para a 5 com a dotação declarada e com o TR e a minuta gerados com ela; mudar a dotação depois da declaração exige nova declaração.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "j", art. 18, caput, e art. 150',
    etapa: 4,
    telas: ['jornada.detalhe'],
    implementacao: 'validarDotacaoOrcamentaria, chaveDotacao, verificarDotacaoParaEdital; api: GET e PUT /processos/:id/dotacao; POST /processos/:id/avancar',
  },
  {
    id: 'RF-32',
    tipo: 'RF',
    titulo: 'Documentos complementares da fase preparatória e checklist do processo',
    descricao:
      'Gera, com os dados do processo e por modelos de texto determinísticos, as peças que completam a instrução: portaria de designação da equipe e dos agentes, declaração de adequação orçamentária, despacho de autorização da contratação, nota técnica de encaminhamento à assessoria jurídica com quesitos objetivos, modelos de proposta comercial, de ordem de serviço, de termo de compromisso e de sigilo e de termos de recebimento provisório e definitivo, e o caderno de casos de teste da prova de conceito com a planilha de julgamento da comissão. Cada peça tem versões, aprovação humana registrada na trilha de auditoria, entrada na árvore do SEI e PDF gerado no servidor. A portaria, a declaração e o despacho só são aprovados pela autoridade competente designada. O checklist mostra, por etapa, as peças prontas, em rascunho, desatualizadas e as que faltam.',
    fundamento: 'Lei 14.133/2021, arts. 7º, 8º, 17, § 3º, 18, 53, 72, VIII, e 140',
    etapa: 4,
    telas: ['jornada.detalhe'],
    implementacao:
      'gerarQuesitosControleLegalidade, montarCasosTesteProvaConceito, montarChecklistPecas; api: POST /processos/:id/documentos/gerar; GET /processos/:id/checklist-documentos; GET /processos/:id/documentos/:docId/pdf',
  },
  {
    id: 'RF-37',
    tipo: 'RF',
    titulo: 'Gestão compartilhada com a sociedade',
    descricao:
      'O cidadão identificado pelo Login Único gov.br, num perfil sem acesso interno, envia mensagem de texto ou imagem sobre um contrato. Nada vai a público sem a decisão de um moderador, sempre com motivo, e o autor aparece só com o primeiro nome e as iniciais. A imagem tem o tipo conferido pelo conteúdo e perde os metadados de localização antes de ser guardada. O fiscal publica fotos e vídeos do acompanhamento da obra ou do serviço, e o registro marcado como sigiloso fica guardado sem publicação. Administração e contratado respondem de forma identificada, com prazo de 30 dias prorrogável uma vez. A decisão da moderação e a resposta geram aviso ao cidadão pela central de notificações, por e-mail, com o e-mail mascarado na tela e a base legal de tratamento registrada. Ao fim da vigência, o gestor publica o relatório final sobre a consecução dos objetivos da contratação. Cada passo fica na trilha de auditoria.',
    fundamento: 'Lei 14.133/2021, art. 174, § 3º, VI, alíneas "a" a "d", e art. 19, III; Lei 13.460/2017, art. 16; Lei 13.709/2018 (LGPD)',
    etapa: 7,
    telas: ['sociedade', 'sociedade.contrato', 'sociedade.minhas'],
    implementacao:
      'validarManifestacao, validarDecisaoModeracao, validarResposta, prazoRespostaManifestacao, situacaoPrazoResposta, avaliarPublicacaoRegistroExecucao, validarRelatorioFinal, nomePublicoCidadao, tarjarDadosPessoaisLivres; api: POST /sociedade/contratos/:id/manifestacoes; POST /sociedade/manifestacoes/:id/moderacao; POST /sociedade/manifestacoes/:id/respostas; POST /sociedade/contratos/:id/registros; POST /sociedade/contratos/:id/relatorio-final; GET /publico/contratos/:id/gestao-compartilhada',
  },
  {
    id: 'RF-38',
    tipo: 'RF',
    titulo: 'Catálogo de dados abertos',
    descricao:
      'A página pública Dados abertos lista, sem login, os conjuntos de editais publicados, contratos, atas de registro de preços, termos aditivos, pagamentos na ordem cronológica por fonte de recursos e sanções aplicadas, em CSV e JSON. Cada conjunto traz dicionário de dados, licença aberta, data da última atualização, periodicidade e o SHA-256 de cada arquivo. Nenhum dado pessoal sai no catálogo: o CPF de fornecedor pessoa física fica de fora, o nome sai mascarado e toda célula de texto passa pela tarja de CPF, e-mail e telefone. As rotas têm limite de requisições por endereço.',
    fundamento: 'Decreto 8.777/2016; Lei 12.527/2011, art. 8º, § 1º, IV, e § 3º; Lei 14.133/2021, art. 174, § 4º, e art. 141, § 3º; Lei 13.709/2018 (LGPD)',
    etapa: null,
    telas: ['dados-abertos'],
    implementacao:
      'gerarCsvDadosAbertos, prepararLinhasDadosAbertos, centavosParaDecimal, contemDadoPessoal; api: GET /publico/dados-abertos; GET /publico/dados-abertos/:conjunto; GET /publico/dados-abertos/:conjunto/csv; GET /publico/dados-abertos/:conjunto/json',
  },
  {
    id: 'RN-32',
    tipo: 'RN',
    titulo: 'Termo aditivo como ato, com a trava do art. 125',
    descricao:
      'O termo aditivo (acréscimo ou supressão quantitativa, alteração qualitativa, prazo ou reequilíbrio) é um ato registrado: proposta com justificativa, parecer jurídico prévio, assinatura pela autoridade competente depois do checklist de regularidade do contratado e divulgação no PNCP pela fila de integrações, no prazo do art. 94. Acréscimos e supressões, inclusive o reflexo de alteração qualitativa, somam-se separadamente sobre o valor inicial atualizado; acima de 25% (ou de 50% para acréscimos em reforma de edifício ou de equipamento) a API recusa a alteração, na proposta e de novo na assinatura. O termo assinado gera PDF para juntar ao processo.',
    fundamento: 'Lei 14.133/2021, arts. 53, § 4º, 91, § 4º, 94, 124 e 125',
    etapa: 7,
    telas: ['contratos.detalhe'],
    implementacao:
      'avaliarTermoAditivo, avaliarAditivo, numeroTermoContratual, situacaoDivulgacaoTermoPncp, tipoTermoContratoPncp; api: POST /contratos/:id/alteracoes; POST /contratos/:id/alteracoes/:alteracaoId/parecer; POST /contratos/:id/alteracoes/:alteracaoId/assinar; GET /contratos/:id/alteracoes/:alteracaoId/termo.pdf',
  },
  {
    id: 'RN-33',
    tipo: 'RN',
    titulo: 'Prorrogação com os limites dos arts. 105 a 114',
    descricao:
      'A prorrogação da vigência só é registrada dentro da vigência máxima da natureza do contrato: serviços e fornecimentos contínuos até 10 anos, com previsão no edital, vantajosidade atestada pela autoridade e preço compatível com o mercado; sistemas estruturantes de TI até 15 anos; contratos que geram receita até 10 ou 35 anos. No contrato por escopo, a vigência se prorroga automaticamente quando o objeto não é concluído sem culpa do contratado; com culpa, só depois de constituída a mora. Exige crédito orçamentário e o checklist de regularidade (RN-09). A prorrogação assinada exige e abre a renovação da garantia contratual para cobrir a nova vigência, com prazo, pendência e notificação. A partir de 120 dias do fim da vigência, os avisos da central de notificações dizem se cabe prorrogar, até quando, ou se é preciso nova licitação.',
    fundamento: 'Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114',
    etapa: 7,
    telas: ['contratos.detalhe', 'notificacoes'],
    implementacao:
      'avaliarProrrogacao, avaliarAlertaProrrogacao, situacaoProrrogacao, vigenciaMaximaAnos; api: POST /contratos/:id/prorrogacoes; POST /contratos/:id/alteracoes (tipo prazo); varredura diária de notificações',
  },
  {
    id: 'RF-27',
    tipo: 'RF',
    titulo: 'Alterações do contrato: aditivos, apostilas, reajustes e extinção',
    descricao:
      'A aba Alterações do contrato reúne o histórico de termos aditivos, apostilamentos (reajuste e repactuação), reequilíbrios e extinção, com a situação de cada ato, o parecer, a assinatura, a divulgação no PNCP e o termo em PDF, e mostra o percentual acumulado de acréscimos e supressões frente ao limite do art. 125. O reajuste é apostilado só depois de 12 meses da data do orçamento estimado, pelo índice do contrato; a repactuação exige demonstração analítica por componente; o reequilíbrio passa por instrução e decisão, respeitada a matriz de riscos; e a extinção é motivada, com contraditório quando unilateral e os efeitos do art. 139 decididos pela autoridade.',
    fundamento: 'Lei 14.133/2021, arts. 25, § 7º, 92, § 3º, 124, II, "d", 135, 136 e 137 a 139',
    etapa: 7,
    telas: ['contratos.detalhe'],
    implementacao:
      'avaliarReajuste, avaliarRepactuacao, avaliarReequilibrio, avaliarInstauracaoExtincao, avaliarDecisaoExtincao, avaliarLimiteAditivos; api: GET /contratos/:id/alteracoes; POST /contratos/:id/reajustes; POST /contratos/:id/repactuacoes; POST /contratos/:id/extincao; POST /contratos/:id/alteracoes/:alteracaoId/defesa; POST /contratos/:id/alteracoes/:alteracaoId/decidir-extincao',
  },
  {
    id: 'RNF-08',
    tipo: 'RNF',
    titulo: 'Base normativa soberana e busca na lei',
    descricao:
      'O texto compilado da Lei 14.133/2021 fica no repositório da Ágora, estruturado por artigo, parágrafo, inciso e alínea, com a fonte oficial, a data de obtenção e o hash do arquivo e do texto. A busca roda no próprio servidor, por recuperação BM25 com peso para as divisões da lei e para o caput, sem serviço externo nem embeddings de terceiros. A mesma base ancora a redação dos rascunhos (RAG), confere as citações dos documentos e mostra o artigo na consulta à lei. Os modelos padronizados entram como estrutura de seções obrigatórias, sem copiar texto de terceiros.',
    fundamento: 'Lei 14.133/2021, art. 19, IV; Lei 9.610/1998, art. 8º, IV; matriz de riscos do cliente (R02)',
    etapa: null,
    telas: ['normas.base'],
    implementacao: 'estruturarTextoLei, indexarBaseNormativa, buscarNaBaseNormativa, localizarDispositivo; api: GET /normas; GET /normas/busca; GET /normas/artigos/:numero; GET /normas/modelos',
  },
  {
    id: 'RIA-14',
    tipo: 'RIA',
    titulo: 'Conferência das citações legais e precisão normativa (IMR-02)',
    descricao:
      'Em todo rascunho gerado, encontra as referências à lei (artigo, parágrafo, inciso e alínea, também em lista, em faixa e na forma invertida) e confere na base normativa se o dispositivo existe, se não foi vetado ou revogado e se o assunto do trecho corresponde ao dispositivo citado. A citação inexistente, sem efeito ou suspeita é apontada com o trecho e a sugestão do artigo que parece tratar do assunto. O rascunho com citação inexistente ou sem efeito só é aprovado depois de revisão humana registrada, com justificativa. O painel de qualidade normativa mede o IMR-02, percentual de minutas com citações fiéis, com meta de 100%. A conferência é um sinal e requer revisão humana.',
    fundamento: 'Lei 14.133/2021, art. 19, IV, e art. 53; IMR-02 do termo de referência do cliente',
    etapa: 4,
    telas: ['normas.qualidade', 'jornada.detalhe', 'jornada.conferencia'],
    implementacao:
      'extrairCitacoesLegais, conferirCitacoesLegais, conferirEstruturaModelo; api: GET /qualidade-normativa; GET /processos/:id/citacoes; POST /processos/:id/documentos/:docId/citacoes/revisao; POST /normas/conferir',
  },
  {
    id: 'RIA-15',
    tipo: 'RIA',
    titulo: 'Conferência cruzada dos documentos e auditor contínuo',
    descricao:
      'Compara os documentos do processo (DFD, ETP, matriz de riscos, nota técnica de preços, termo de referência, edital e minuta do contrato) e aponta divergência de objeto, quantidades, valor estimado, prazos, dotação, modalidade e critério de julgamento, com o trecho de cada documento. Para a 2ª linha de defesa, o auditor contínuo varre notas fiscais, medições e termos aditivos dos contratos e sinaliza nota duplicada ou atípica, notas acima do valor do contrato, pagamento antes do atesto, reajuste antes de 1 ano, recebimento acima do contratado e valor contratado acima da estimativa. Cada sinal traz o fundamento e as evidências e requer revisão humana: não acusa, não glosa e não sanciona.',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, LVI e LVII, arts. 18, 25 e 92, art. 145 e art. 169',
    etapa: 4,
    telas: ['jornada.conferencia', 'controle'],
    implementacao: 'extrairFatosDocumento, conferirDocumentosCruzados, sinaisAuditorContinuo; api: GET /processos/:id/conferencia-cruzada; GET /controle/auditor-ia',
  },
  {
    id: 'RF-35',
    tipo: 'RF',
    titulo: 'Integração com o SEI e assinatura refletida',
    descricao:
      'Envia o processo da jornada ao SEI do órgão pelo web service oficial (SeiWS), sempre pela fila de integrações: gera o processo no SEI, inclui os documentos aprovados na Ágora como PDF, monta o bloco de assinatura e, quando configurado, envia o processo à unidade de destino. Cada documento guarda o número SEI e cada processo o número do processo SEI. A assinatura com certificado ICP-Brasil acontece no próprio SEI; a Ágora consulta as assinaturas e marca o documento como assinado, com quem assinou e quando, sem assinar nada por conta própria. Documento com dado pessoal ou orçamento sigiloso entra como restrito.',
    fundamento: 'Lei 14.133/2021, art. 12, VI, e art. 174; Lei 12.527/2011, art. 31; Portaria Interministerial nº 11/2019 (NUP)',
    etapa: null,
    telas: ['jornada.detalhe'],
    implementacao:
      'digitosVerificadoresNup, formatarNup, validarNup, nivelAcessoSei, dataHoraSeiParaIso, dataHoraSei, situacaoAssinaturaSei; api: GET /processos/:id/sei; POST /processos/:id/sei/enviar; POST /processos/:id/sei/consultar-assinaturas',
  },
  {
    id: 'RF-36',
    tipo: 'RF',
    titulo: 'Publicação no Diário Oficial da União',
    descricao:
      'Gera, no padrão da Seção 3 do DOU, o aviso de licitação (automático quando o edital é aceito no PNCP), o extrato de contrato e o extrato de termo aditivo, sem CPF completo. Como a Imprensa Nacional não oferece API pública de envio, o servidor credenciado envia a matéria pelo INCom e registra na Ágora o protocolo e a data do envio; a Ágora calcula a edição prevista e confere a publicação na consulta pública do DOU, pelo servidor e pela fila de integrações, ou aceita o registro manual da edição. A publicação do aviso no jornal diário de grande circulação também é registrada.',
    fundamento: 'Lei 14.133/2021, art. 54, § 1º, e art. 94',
    etapa: 5,
    telas: ['publicacoes.dou', 'jornada.detalhe'],
    implementacao:
      'montarMateriaDou, dataPrevistaPublicacaoDou, localizarMateriaDou; api: GET /publicacoes-dou; POST /publicacoes-dou; POST /publicacoes-dou/:id/envio; POST /publicacoes-dou/:id/conferir; POST /publicacoes-dou/:id/publicacao; POST /publicacoes-dou/:id/jornal',
  },
  {
    id: 'RN-40',
    tipo: 'RN',
    titulo: 'Sigilo de segurança pública: classificação, acesso restrito e divulgação',
    descricao:
      'O processo, cada documento gerado, cada anexo e o contrato podem ser classificados como informação classificada da LAI (reservada, secreta ou ultrassecreta, com hipótese do art. 23, razões, termo final por data ou evento dentro do prazo máximo do grau e autoridade com competência do art. 27) ou como sigilo do orçamento estimado (art. 24), que exige a decisão motivada na pesquisa de preços, não vale no julgamento por maior desconto e termina com a fase de lances ou o julgamento. A classificação, a reclassificação e a desclassificação vão para a trilha de auditoria; vencido o prazo, a informação fica pública sozinha. O servidor só libera o conteúdo para quem tem credencial no processo, ativa e de grau suficiente; os órgãos de controle têm acesso irrestrito; todo acesso, permitido ou negado, é registrado. Documento classificado não aparece na transparência nem vai ao PNCP, contrato sigiloso mostra só um registro mínimo e o PDF interno sai com a marcação do grau nos cabeçalhos e rodapés. Nas listas internas de processos e contratos, o título e o objeto aparecem como "Informação classificada" com o grau para quem não tem credencial, e as páginas internas de contrato sigiloso negam acesso a quem não tem credencial.',
    fundamento:
      'Lei 14.133/2021, arts. 13, 18, § 1º, VI, 24, 91, § 1º, e 169, § 2º; Lei 12.527/2011, arts. 23 a 27; Decreto 7.845/2012, arts. 18, 19, 20, 23 e 38, § 4º',
    etapa: null,
    telas: ['jornada.sigilo', 'jornada.detalhe', 'transparencia'],
    implementacao:
      'validarClassificacaoSigilo, prazoMaximoSigilo, autoridadeCompetenteSigilo, classificacaoVigente, situacaoOrcamentoSigiloso, decidirAcessoSigilo, marcacaoSigilo, codigoIndexacaoSigilo; api: POST /processos/:id/sigilo/classificacoes; POST /processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar; POST /processos/:id/sigilo/documentos/:tipo/pdf; checagens em /publico/editais, /publico/contratos e na fila do PNCP',
  },
  {
    id: 'RF-33',
    tipo: 'RF',
    titulo: 'Sigilo do processo: classificação, credenciamento e registro de acessos',
    descricao:
      'A tela de sigilo do processo mostra a classificação do processo, dos documentos, dos anexos e do contrato, com o código de indexação, o grau, o termo final e a autoridade classificadora; permite classificar, reclassificar e desclassificar com motivo; credenciar e descredenciar quem precisa conhecer a informação, por credencial de segurança ou termo de compromisso de manutenção de sigilo, com grau máximo e validade; enviar anexos direto ao cofre; baixar o PDF marcado e o anexo do cofre informando o motivo; e consultar o registro de todos os acessos, permitidos e negados.',
    fundamento: 'Lei 12.527/2011, arts. 25 e 27; Decreto 7.845/2012, arts. 18, 19 e 38, § 4º',
    etapa: null,
    telas: ['jornada.sigilo'],
    implementacao:
      'api: GET /processos/:id/sigilo; POST /processos/:id/sigilo/credenciais; POST /processos/:id/sigilo/credenciais/:credencialId/revogar; GET /processos/:id/sigilo/acessos; POST /processos/:id/sigilo/anexos; POST /processos/:id/sigilo/anexos/:arquivoId/baixar',
  },
  {
    id: 'RNF-09',
    tipo: 'RNF',
    titulo: 'Cofre de anexos sigilosos e carimbo de tempo da trilha de auditoria',
    descricao:
      'Anexos sigilosos ficam cifrados em repouso com AES-256-GCM, com a chave do órgão vinda de variável de ambiente e o registro ligado ao conteúdo (dados autenticados); o arquivo em claro é apagado do armazenamento quando nenhum outro registro o usa, e o download exige motivo e fica registrado. A trilha de auditoria é ancorada periodicamente: o servidor envia o hash da cadeia a uma autoridade de carimbo do tempo RFC 3161 configurada pelo órgão (servida por ele ou credenciada na ICP-Brasil) e guarda o token; sem a autoridade, registra a ancoragem local. A tela da trilha confere cada ancoragem: o hash da cadeia, a declaração carimbada e a assinatura do token.',
    fundamento: 'Decreto 7.845/2012, arts. 31 e 38; Lei 14.133/2021, art. 12, VI; RFC 3161 (Time-Stamp Protocol); MP 2.200-2/2001 (ICP-Brasil)',
    etapa: null,
    telas: ['jornada.sigilo', 'auditoria'],
    implementacao:
      'declaracaoAncoragem, ancoragemDevida, conferirAncoragem; api: GET /auditoria/ancoragens; POST /auditoria/ancoragens; GET /auditoria/ancoragens/verificacao; cofre (apps/api/src/modulos/sigilo/cofre.ts)',
  },
  {
    id: 'RN-37',
    tipo: 'RN',
    titulo: 'Avaliação de desempenho do contratado e registro cadastral de atestos',
    descricao:
      'Ao final de cada etapa da execução ou na conclusão, o gestor ou o fiscal designado do contrato emite o documento de avaliação de desempenho, com os indicadores objetivamente aferidos no período (entregas no prazo e recebimentos definitivos sem ressalva contados dos termos de recebimento provisório e definitivo da fiscalização, e ocorrências resolvidas no prazo do livro único de ocorrências), as penalidades aplicadas e a avaliação motivada. A nota não é digitada: resulta dos indicadores, com os mesmos pesos do IDC. O contratado pode se manifestar em 5 dias úteis; havendo discordância, o avaliador mantém ou revisa a avaliação com motivação. A avaliação definitiva passa a constar do registro cadastral do fornecedor, cuja nota (média por contrato nos últimos 36 meses) é a usada no desempate do art. 60, II, e, quando o edital adota fórmula com regulamento, na pontuação técnica. O certificado de desempenho exige nota de ao menos 90, sem impedimento vigente. A avaliação não é sanção.',
    fundamento: 'Lei 14.133/2021, art. 36, § 3º, art. 37, III, art. 60, II, art. 87 e art. 88, §§ 2º a 4º; Lei 9.784/1999, art. 24',
    etapa: 7,
    telas: ['contratos.detalhe', 'fornecedores', 'desempenho', 'jornada.detalhe'],
    implementacao:
      'avaliarDesempenhoContratado, situacaoAvaliacaoDesempenho, validarManifestacaoContratado, validarAnaliseManifestacao, consolidarRegistroDesempenho, avaliarIncentivoDesempenho, validarCriterioDesempenhoTecnica, comporNotaTecnicaComDesempenho, clausulaCriterioDesempenhoEdital, aplicarDesempate; api: POST /contratos/:id/avaliacoes-desempenho; GET /fornecedores/:id/desempenho; PUT /processos/:id/criterio-desempenho; PUT /processos/:id/disputa',
  },
  {
    id: 'RF-30',
    tipo: 'RF',
    titulo: 'Avaliação de desempenho, histórico do fornecedor e certificado',
    descricao:
      'Na aba de avaliação do contrato, o gestor ou o fiscal emite a avaliação de desempenho a partir dos indicadores e das ocorrências registradas, registra a manifestação do contratado e a análise, e baixa o documento em PDF com o protocolo do registro. No fornecedor, a aba de desempenho mostra a nota do registro, o histórico das avaliações e a emissão do certificado de desempenho e da declaração para uso em licitações, em PDF com código de verificação. A tela de desempenho reúne o ranking pelo registro e o simulador de impacto em editais futuros (desempate e técnica e preço).',
    fundamento: 'Lei 14.133/2021, art. 87 e art. 88, §§ 2º a 4º',
    etapa: 7,
    telas: ['contratos.detalhe', 'fornecedores', 'desempenho'],
    implementacao:
      'redigirDocumentoAvaliacaoDesempenho, redigirCertificadoDesempenho, simularImpactoDesempenho, rotuloFaixaDesempenho; api: GET /avaliacoes-desempenho/:id/documento.pdf; POST /fornecedores/:id/certificados-desempenho; GET /certificados-desempenho/:id/documento.pdf; POST /desempenho/simulacao',
  },
  {
    id: 'RIA-12',
    tipo: 'RIA',
    titulo: 'Lições aprendidas da execução no DFD, no ETP e no TR',
    descricao:
      'A base de conhecimento reúne os fatos da execução dos contratos: ocorrências, glosas, atrasos e rescisões registrados pela fiscalização, aditivos de acréscimo acima de 15%, sanções aplicadas e avaliações de desempenho abaixo de 60. Ao preencher o DFD, o ETP ou o TR de objeto semelhante (mesmo código do catálogo ou objeto com termos em comum), a Ágora sugere cláusulas mais rigorosas de prazo, qualidade e amostras, níveis de serviço, garantia, quantidades e fiscalização, cada uma com os contratos e fatos de origem, as premissas, a data e a marca "requer revisão humana". É sinal, não decisão: o agente aceita ou recusa, a escolha fica registrada na trilha e só o que foi aceito entra no rascunho do documento.',
    fundamento: 'Lei 14.133/2021, art. 11, art. 18, art. 117 e art. 169',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe', 'contratos.detalhe'],
    implementacao:
      'sugerirClausulasLicoes, semelhancaObjeto, termosObjeto, derivarFatosExecucao, categoriaPadraoFato, secaoLicoesAceitas, rotuloCategoriaLicao; api: GET /processos/:id/licoes-aprendidas; POST /processos/:id/licoes-aprendidas/decisoes; POST /contratos/:id/ocorrencias-execucao',
  },
  {
    id: 'RN-41',
    tipo: 'RN',
    titulo: 'Dispensa eletrônica: aviso de 3 dias úteis, propostas adicionais, limites e fracionamento',
    descricao:
      'A dispensa por valor (art. 75, I e II) só é aceita até o limite vigente, atualizado por decreto (Decreto 12.807/2025 em 2026). O processo informa o ramo de atividade do objeto, e a Ágora soma as dispensas por valor de mesma natureza da unidade gestora no exercício, inclusive as compras com cartão de pagamento; compras pelo Sicx e licitações não entram na soma. A partir de 80% do limite há sinal de atenção; acima dele, sinal de risco de fracionamento, que só deixa avançar com a análise do agente registrada. Antes da seleção, o aviso de contratação direta é divulgado no PNCP pela fila de integrações por no mínimo 3 dias úteis, com a manifestação de interesse em propostas adicionais; enquanto o aviso está aberto, as propostas adicionais são registradas, e o julgamento só começa depois do encerramento, selecionando a proposta mais vantajosa dentro do limite. A contratação depende da autorização da autoridade competente, e as compras pagas com cartão de pagamento têm extrato mensal divulgado no PNCP.',
    fundamento: 'Lei 14.133/2021, art. 72, art. 75, I e II e §§ 1º, 3º e 4º, e art. 182; Decreto 12.807/2025',
    etapa: 5,
    telas: ['jornada.detalhe', 'jornada.rota', 'jornada.dispensa', 'cartao-pagamento'],
    implementacao:
      'situacaoAvisoDispensa, prazoAvisoDispensaEletronica, julgarPropostasDispensa, avaliarFracionamentoPorObjeto, validarCompraCartao, montarExtratoCartao, limiteDispensaVigente; api: POST /processos/:id/dispensa/aviso; POST /processos/:id/dispensa/propostas; POST /processos/:id/dispensa/julgamento; POST /cartao-pagamento/compras; POST /cartao-pagamento/extratos',
  },
  {
    id: 'RN-42',
    tipo: 'RN',
    titulo: 'Comércio eletrônico pelo Sicx: ranqueamento, segregação, recebimento e pagamento em até 30 dias',
    descricao:
      'Bens e serviços comuns padronizados podem ser comprados na vitrine do Sistema de Compras Expressas (Sicx), sem termo de referência nem edital da contratação. A vitrine ranqueia só as ofertas aptas: fornecedor credenciado, sem restrição no Cadin, que atende à UF do comprador e com prazo de pagamento de até 30 dias; ordena pelo valor total com o preço escalonado e desempata pela reputação e por sorteio. A melhor oferta é selecionada sem justificativa; outra exige justificativa. Quem emite a ordem de compra não conclui a compra, salvo autorização prévia no ETP abrangente, cuja reserva de limite controla os valores. A conclusão vale como contratação; o recebimento provisório é de até 2 dias úteis da entrega e o definitivo de até 10 dias, com recebimento tácito no silêncio, e o pagamento ocorre em até 30 dias do recebimento. No modo offline a vitrine é simulada; a integração com a plataforma do governo depende das normas complementares da SGI.',
    fundamento: 'Lei 14.133/2021, art. 79, IV e § 1º, VII, e art. 174, § 3º, VII (Lei 15.266/2025); Decreto 13.106/2026, arts. 11 a 23 e 37',
    etapa: 6,
    telas: ['jornada.detalhe', 'sicx'],
    implementacao:
      'ranquearOfertasSicx, validarCompraSicx, prazosCompraSicx, avaliarReservaSicx; api: GET /sicx/ofertas; POST /sicx/compras; POST /sicx/compras/:id/conclusao; POST /sicx/compras/:id/recebimento; POST /sicx/compras/:id/pagamento',
  },
  {
    id: 'RF-34',
    tipo: 'RF',
    titulo: 'Rotas de contratação: licitação, dispensa, inexigibilidade, adesão a ata e Sicx',
    descricao:
      'Na etapa 1 da jornada o processo escolhe a rota de contratação, e cada rota define os documentos e as travas do art. 72. A licitação segue a jornada completa. Na dispensa e na inexigibilidade não há edital nem disputa: o processo traz a razão da escolha, a justificativa de preço e a autorização da autoridade competente, e o contrato é divulgado em 10 dias úteis. Na dispensa por valor, o ETP e a matriz de riscos são facultativos e há o aviso de 3 dias úteis. A inexigibilidade exige a hipótese do art. 74 com a sua comprovação: exclusividade sem preferência por marca, notória especialização, credenciamento, artista consagrado ou imóvel singular. A adesão a ata confere a vigência e a previsão de adesão, recusa pedido acima de 50% do registrado por órgão ou do dobro no total, exige aceite do fornecedor e anuência do gerenciador e conta 90 dias para contratar. No Sicx a compra é feita na vitrine.',
    fundamento: 'Lei 14.133/2021, arts. 72, 74, 75, 79, IV, e 86, §§ 2º a 5º e 8º; Decreto 11.462/2023, arts. 31 e 32; Decreto 13.106/2026',
    etapa: 1,
    telas: ['jornada.detalhe', 'jornada.rota', 'jornada.dispensa', 'jornada.adesao', 'sicx'],
    implementacao:
      'adaptacaoDaRota, validarEscolhaRota, validarInexigibilidade, avaliarAdesaoAta, prazoContratacaoAdesao; api: GET /processos/:id/rota; PUT /processos/:id/rota; PUT /processos/:id/inexigibilidade; POST /processos/:id/adesao; POST /atas/adesoes/:id/anuencia; POST /processos/:id/contratacao-direta/autorizacao',
  },
]);
/** Regras associadas a um id de tela (correspondência exata, ex.: 'contratos.detalhe'). */
export function regrasPorTela(tela: string): RegraCatalogo[] {
  if (typeof tela !== 'string' || tela.length === 0) throw new ErroDominio('TELA_INVALIDA', 'Informe o id da tela.');
  return CATALOGO_REGRAS.filter((r) => r.telas.includes(tela));
}

/** Regras de uma etapa da jornada (1 a 7). */
export function regrasPorEtapa(etapa: number): RegraCatalogo[] {
  if (!Number.isInteger(etapa) || etapa < 1 || etapa > 7) throw new ErroDominio('ETAPA_INVALIDA', 'A etapa deve ser um inteiro de 1 a 7.');
  return CATALOGO_REGRAS.filter((r) => r.etapa === etapa);
}
