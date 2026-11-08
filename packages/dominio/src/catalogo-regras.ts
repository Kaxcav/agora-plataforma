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
      'Os itens de consumo devem ser de qualidade comum, não superior à necessária para a finalidade a que se destinam. Ao descrever cada item do Documento de Formalização da Demanda (DFD), a Ágora compara a descrição com uma lista de termos indicativos de artigo de luxo (por palavra ou expressão inteira, sem distinção de acentos e de maiúsculas). Havendo indício, o processo só avança da etapa 1 com justificativa de que o bem é de qualidade comum ou de que se enquadra em exceção prevista no Decreto 10.818/2021. O sistema apenas sinaliza; a classificação final é do agente responsável.',
    fundamento: 'Lei 14.133/2021, art. 20; Decreto 10.818/2021',
    etapa: 1,
    telas: ['jornada.dfd', 'jornada.detalhe'],
    implementacao: 'sinalizarArtigoLuxo',
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
      'Antes de formalizar ou prorrogar o contrato, a Administração verifica a regularidade fiscal do contratado, consulta o Cadastro Nacional de Empresas Inidôneas e Suspensas (CEIS) e o Cadastro Nacional de Empresas Punidas (CNEP), emite as certidões negativas de inidoneidade, de impedimento e de débitos trabalhistas e as junta ao processo. Na contratação (etapa 7), a Ágora bloqueia a assinatura quando o fornecedor tem impedimento ou inidoneidade vigentes ou pendência de regularidade nas bases que o servidor consulta: as sanções registradas na Ágora e a última sincronização de regularidade. No simulador de aditivo, a mesma verificação aparece antes de uma prorrogação. A consulta online ao CEIS/CNEP e às certidões depende da integração do órgão.',
    fundamento: 'Lei 14.133/2021, art. 91, § 4º',
    etapa: 7,
    telas: ['jornada.detalhe', 'contratos.detalhe'],
    implementacao: 'api: POST /processos/:id/contratar (consulta CEIS/CNEP e regularidade)',
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
      'Contratos e atas de registro de preços são classificados pelo número de dias até o fim da vigência: vencido (prazo encerrado), crítico (até 30 dias), atenção (31 a 60 dias), alerta (61 a 90 dias) e regular (mais de 90 dias). O semáforo orienta a antecedência das providências de prorrogação ou de nova contratação.',
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
    implementacao: 'avaliarFracionamento',
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
    implementacao: 'arquitetura: implantação auto-hospedada (deploy/)',
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
    implementacao: 'web: componentes próprios acessíveis e testes automatizados com axe',
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
    implementacao: 'todas as funções de sinal do domínio retornam sinal e explicação, nunca decisão',
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
    implementacao: 'api: /modelos-gestao; /unidades-internas; /grupos-uasg; /feriados',
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
      'Lista os fornecedores com o índice de desempenho contratual (IDC) e as sanções. O detalhe mostra os componentes do IDC, a metodologia e o aviso de que o índice não constitui sanção, além de sanções, contratos e regularidade; o documento de pessoa física aparece mascarado, com opção de revelar quando permitido e registrado.',
    fundamento: 'Lei 14.133/2021, art. 88, §§ 3º e 4º',
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
