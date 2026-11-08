import { adicionarDias, type PapelProcesso } from '@agora/dominio';
import type { EtapaJornada, OrgaoRequisitante } from '@agora/contratos';
import { criarProvedorIa } from '../ia/provedor.ts';
import { DISPUTA_INICIAL, EDITAL_PADRAO, ITENS_PARECER, parecerInicial, PUBLICACAO_INICIAL, TITULOS_ETAPA } from '../modulos/jornada/constantes.ts';
import { carregarProcesso, obterLinhaProcesso } from '../modulos/jornada/repositorio.ts';
import {
  aprovarDocumento,
  assinarNaArvore,
  gravarEquipe,
  gravarJson,
  inserirDocumento,
  inserirProcesso,
  montarDisputa,
  obterDocumentoParaAprovar,
  prepararDocumento,
  publicarOffline,
  type ContextoJornada,
} from '../modulos/jornada/servico.ts';
import type {
  CestaArmazenada,
  DfdProcesso,
  EtpProcesso,
  ParametrosEdital,
  RiscoProcesso,
  TipoDocumento,
} from '../modulos/jornada/tipos.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';
import { USUARIOS_DEMONSTRACAO } from './usuarios-demonstracao.ts';

/**
 * Jornada da contratação (docs/JORNADA.md §5): 8 processos sintéticos de segurança pública distribuídos pelas
 * 7 etapas, com dados coerentes com a etapa, documentos gerados pelos mesmos modelos da API, publicações com data
 * passada (para o avanço funcionar na demonstração), um conflito de segregação, um indício de artigo de luxo,
 * um empate resolvido pelo art. 60 e cestas de preços com um preço discrepante cada.
 */

type Pessoa = 'requisitante' | 'planejamento' | 'agente' | 'autoridade' | 'gestor' | 'fiscal' | 'juridico';

interface PlanoCotacao {
  fonte: CestaArmazenada['cotacoes'][number]['fonte'];
  descricao: string;
  /** Valor unitário em reais. */
  valor: number;
  diasAtras: number;
  justificativa?: string;
  /** Justificativa do expurgo já confirmado pelo agente (o preço discrepante). */
  expurgo?: string;
}

interface PlanoDocumento {
  tipo: TipoDocumento;
  aprovar: boolean;
  /** Aprovado mas ainda não assinado na árvore SEI (demonstração da assinatura). Padrão: assina ao aprovar. */
  semAssinatura?: boolean;
}

interface PlanoProcesso {
  titulo: string;
  orgao: OrgaoRequisitante;
  uasg: string;
  etapa: EtapaJornada;
  /** Dias atrás em que cada etapa começou (índice 0 = etapa 1). */
  marcos: number[];
  modalidade: string;
  dfd: DfdProcesso;
  etp: EtpProcesso;
  riscos: Omit<RiscoProcesso, 'id'>[];
  cotacoes: PlanoCotacao[];
  edital: ParametrosEdital;
  equipe: { papel: PapelProcesso; pessoa: Pessoa }[];
  /** Documentos da etapa atual (as anteriores têm todos os seus documentos aprovados e assinados). */
  documentosEtapaAtual: PlanoDocumento[];
  parecerFavoravel: boolean;
  /** Dias atrás da publicação no PNCP (etapa 5 em diante). */
  publicacaoDiasAtras: number | null;
  licitantes: { chave: string; valorProposta: number; nota: number }[];
}

const DOCUMENTOS_POR_ETAPA: Partial<Record<EtapaJornada, TipoDocumento[]>> = {
  2: ['dfd'],
  3: ['etp', 'matriz_riscos', 'nota_tecnica_precos'],
  4: ['tr', 'edital', 'minuta_contrato'],
  5: ['parecer_checklist'],
};

const EQUIPE_COMPLETA: { papel: PapelProcesso; pessoa: Pessoa }[] = [
  { papel: 'requisitante', pessoa: 'requisitante' },
  { papel: 'equipe_planejamento', pessoa: 'planejamento' },
  { papel: 'agente_contratacao', pessoa: 'agente' },
  { papel: 'autoridade_competente', pessoa: 'autoridade' },
  { papel: 'gestor_contrato', pessoa: 'gestor' },
  { papel: 'fiscal_tecnico', pessoa: 'fiscal' },
  { papel: 'parecerista_juridico', pessoa: 'juridico' },
];

const EQUIPE_PLANEJAMENTO: { papel: PapelProcesso; pessoa: Pessoa }[] = EQUIPE_COMPLETA.slice(0, 4);

const reais = (valor: number) => Math.round(valor * 100);

/** Texto padrão dos incisos de apoio do ETP, completado pelos fatos de cada objeto. */
function etpCompleto(f: {
  necessidade: string;
  requisitos: string;
  quantidades: string;
  mercado: string;
  solucao: string;
  parcelamento: string;
  resultados: string;
  ambiental: string;
  conclusao: string;
}): EtpProcesso {
  return {
    I: { texto: f.necessidade },
    II: { texto: 'A contratação consta do Plano de Contratações Anual do exercício, com a mesma descrição e estimativa preliminar do DFD, em conformidade com o art. 12, VII, da Lei 14.133/2021.' },
    III: { texto: f.requisitos },
    IV: { texto: f.quantidades },
    V: { texto: f.mercado },
    VI: { texto: 'A estimativa do valor resulta da pesquisa de preços registrada na Nota Técnica de Pesquisa de Preços, com parâmetros do art. 23, § 1º, e saneamento estatístico conforme a IN SEGES/ME 65/2021.' },
    VII: { texto: f.solucao },
    VIII: { texto: f.parcelamento },
    IX: { texto: f.resultados },
    X: { texto: 'Designação formal do gestor e dos fiscais do contrato, capacitação da equipe de fiscalização e definição do local de entrega e do fluxo de recebimento provisório e definitivo.' },
    XI: { justificativaAusencia: 'Não há contratações correlatas ou interdependentes: o objeto é autônomo e não depende de outra contratação para produzir resultados.' },
    XII: { texto: f.ambiental },
    XIII: { texto: f.conclusao },
  };
}

function planos(): PlanoProcesso[] {
  return [
    // 1 — Viaturas caracterizadas (PRF): etapa 7, pronto para gerar o contrato.
    {
      titulo: 'Aquisição de viaturas caracterizadas para o policiamento e a fiscalização das rodovias federais',
      orgao: 'PRF',
      uasg: '920001',
      etapa: 7,
      marcos: [150, 132, 118, 96, 80, 52, 30],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Renovação de 40 viaturas da frota operacional de policiamento rodoviário com mais de sete anos de uso e quilometragem superior a 250 mil km, cujo custo anual de manutenção já supera 35% do valor de mercado.',
        justificativa:
          'A indisponibilidade média de 22% da frota compromete as operações de fiscalização, o atendimento a acidentes e o patrulhamento de trechos críticos; a renovação preserva a capacidade operacional prevista no planejamento estratégico.',
        itens: [
          {
            catmat: '150350',
            descricao: 'Viatura caracterizada tipo SUV 4x4, motor a diesel, com kit de sinalização visual e acústica, compartimento de detenção e rádio veicular',
            unidade: 'unidade',
            quantidade: 40,
            valorUnitarioEstimado: reais(389_500),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: etpCompleto({
        necessidade: 'Substituir 40 viaturas operacionais com vida útil esgotada, reduzindo a indisponibilidade da frota e o custo de manutenção corretiva nas superintendências com maior extensão de malha rodoviária.',
        requisitos: 'Veículo 4x4 a diesel, transmissão automática, potência mínima de 190 cv, caracterização conforme o manual de identidade visual, compartimento de detenção com ventilação e garantia mínima de 36 meses.',
        quantidades: 'Quantidade calculada pela substituição das viaturas com mais de 250 mil km (34 unidades) acrescida de 6 unidades para a reserva técnica de 15% definida no plano de frota.',
        mercado: 'Há ao menos três fabricantes nacionais e concessionárias com rede de assistência técnica em todas as unidades da Federação; atas de outros órgãos de segurança pública indicam preços na mesma faixa.',
        solucao: 'Aquisição de veículos novos já caracterizados e equipados, entregues prontos para uso, com garantia e revisões programadas na rede autorizada, sem necessidade de adaptação posterior.',
        parcelamento: 'Item único: a padronização da frota reduz custos de manutenção, treinamento e peças, e o parcelamento por fornecedor comprometeria a economia de escala.',
        resultados: 'Redução da indisponibilidade da frota para menos de 8% e economia estimada de 30% no custo anual de manutenção corretiva.',
        ambiental: 'Exigência de motor conforme a fase vigente do PROCONVE e destinação ambientalmente adequada das viaturas substituídas, por leilão ou doação.',
        conclusao: 'A contratação é viável técnica e economicamente e adequada ao atendimento da necessidade, recomendando-se o prosseguimento por pregão eletrônico.',
      }),
      riscos: [
        { descricao: 'Atraso na entrega das viaturas pelo fabricante', probabilidade: 3, impacto: 4, alocacao: 'contratada', mitigacao: 'Cronograma de entrega com multa moratória e acompanhamento quinzenal pela fiscalização' },
        { descricao: 'Caracterização em desacordo com o manual de identidade visual', probabilidade: 2, impacto: 3, alocacao: 'contratada', mitigacao: 'Aprovação de protótipo antes da produção em série' },
        { descricao: 'Variação cambial de componentes importados', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: 'Risco precificado na proposta; reajuste anual pelo IPCA' },
        { descricao: 'Insuficiência orçamentária no exercício', probabilidade: 2, impacto: 5, alocacao: 'contratante', mitigacao: 'Reserva de dotação antes da publicação e empenho na assinatura' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — mediana de 7 compras de viaturas 4x4 caracterizadas', valor: 384_900, diasAtras: 128 },
        { fonte: 'contratacao_similar', descricao: 'Contrato de viaturas 4x4 caracterizadas de órgão de segurança pública estadual', valor: 392_300, diasAtras: 175 },
        { fonte: 'contratacao_similar', descricao: 'Ata de registro de preços de veículos policiais de outro órgão federal', valor: 379_800, diasAtras: 200 },
        { fonte: 'midia_especializada', descricao: 'Tabela de referência de veículos novos com acessórios policiais', valor: 395_000, diasAtras: 126 },
        { fonte: 'nota_fiscal', descricao: 'Nota fiscal eletrônica de venda de veículo equivalente a órgão público', valor: 388_200, diasAtras: 160 },
        {
          fonte: 'midia_especializada',
          descricao: 'Sítio de revenda com veículo blindado de configuração superior',
          valor: 512_000,
          diasAtras: 125,
          expurgo: 'Preço de veículo blindado, com configuração superior à especificada; excessivamente elevado em relação à cesta.',
        },
      ],
      edital: EDITAL_PADRAO,
      equipe: EQUIPE_COMPLETA,
      documentosEtapaAtual: [],
      parecerFavoravel: true,
      publicacaoDiasAtras: 74,
      licitantes: [
        { chave: 'rota', valorProposta: reais(15_180_000), nota: 90 },
        { chave: 'fortaleza', valorProposta: reais(15_420_000), nota: 86 },
        { chave: 'horizonte', valorProposta: reais(15_640_000), nota: 71 },
      ],
    },
    // 2 — Coletes balísticos (SENASP): etapa 6, empate resolvido pelo art. 60, II.
    {
      titulo: 'Aquisição de coletes balísticos nível III-A para a Força Nacional de Segurança Pública',
      orgao: 'SENASP',
      uasg: '930002',
      etapa: 6,
      marcos: [112, 98, 86, 70, 58, 30],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Reposição de coletes balísticos com prazo de validade vencido ou a vencer em até 6 meses, para os efetivos mobilizados pela Força Nacional em operações de apoio aos estados.',
        justificativa:
          'O uso de proteção balística dentro da validade é requisito de segurança do servidor e condição de emprego do efetivo; 1.200 coletes perdem a validade no próximo semestre.',
        itens: [
          {
            catmat: '446901',
            descricao: 'Colete balístico nível III-A (NIJ 0101.06), modelos masculino e feminino, com capa tática e painéis flexíveis',
            unidade: 'unidade',
            quantidade: 1200,
            valorUnitarioEstimado: reais(2_890),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: etpCompleto({
        necessidade: 'Garantir proteção balística dentro do prazo de validade para o efetivo mobilizado, substituindo 1.200 coletes com vencimento no próximo semestre.',
        requisitos: 'Nível de proteção III-A conforme NIJ 0101.06, certificação de conformidade do Exército Brasileiro, modelagem feminina específica e validade mínima de 5 anos para os painéis.',
        quantidades: 'Quantidade igual ao número de coletes com validade expirando no período, conforme o inventário patrimonial da coordenação de logística.',
        mercado: 'Há fabricantes nacionais com produto controlado pelo Exército e capacidade de produção compatível com o prazo de entrega de 90 dias.',
        solucao: 'Aquisição de coletes completos (painéis e capa), com tamanhos definidos por grade de medidas do efetivo e entrega parcelada em dois lotes.',
        parcelamento: 'Item único por padronização de proteção e logística; a divisão por tamanho é feita na grade de entrega, sem prejudicar a competitividade.',
        resultados: 'Efetivo integralmente protegido por equipamento dentro da validade, sem interrupção das mobilizações.',
        ambiental: 'Logística reversa dos painéis balísticos vencidos para descaracterização e destinação final pelo fabricante.',
        conclusao: 'A contratação é viável e adequada, recomendando-se o prosseguimento por pregão eletrônico com critério de menor preço.',
      }),
      riscos: [
        { descricao: 'Reprovação do lote nos ensaios balísticos de recebimento', probabilidade: 2, impacto: 5, alocacao: 'contratada', mitigacao: 'Ensaios por amostragem em laboratório acreditado antes do recebimento definitivo' },
        { descricao: 'Grade de tamanhos inadequada ao efetivo', probabilidade: 3, impacto: 2, alocacao: 'contratante', mitigacao: 'Levantamento de medidas antes da emissão da ordem de fornecimento' },
        { descricao: 'Atraso na autorização de produto controlado', probabilidade: 2, impacto: 4, alocacao: 'compartilhado', mitigacao: 'Exigência de registro vigente no Exército na habilitação técnica' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — coletes nível III-A adquiridos nos últimos 12 meses', valor: 2_874.5, diasAtras: 92 },
        { fonte: 'contratacao_similar', descricao: 'Ata de registro de preços de coletes III-A de secretaria estadual', valor: 2_912, diasAtras: 140 },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fabricante nacional com produto controlado', valor: 2_950, diasAtras: 90, justificativa: 'Fabricante com certificado de conformidade vigente e fornecimento recente a órgãos de segurança.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fabricante catarinense de equipamentos táticos', valor: 2_880, diasAtras: 90, justificativa: 'Empresa de pequeno porte com registro no Exército e capacidade produtiva comprovada.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fornecedor de uniformes e equipamentos de proteção', valor: 2_990, diasAtras: 89, justificativa: 'Fornecedor habitual da Força Nacional, com atestados de fornecimento de coletes.' },
        {
          fonte: 'midia_especializada',
          descricao: 'Anúncio de colete nível II sem certificação',
          valor: 1_240,
          diasAtras: 88,
          expurgo: 'Produto de nível de proteção inferior e sem certificação; preço inexequível para o objeto especificado.',
        },
      ],
      edital: EDITAL_PADRAO,
      equipe: EQUIPE_COMPLETA,
      documentosEtapaAtual: [],
      parecerFavoravel: true,
      publicacaoDiasAtras: 48,
      licitantes: [
        { chave: 'escudo', valorProposta: reais(3_408_000), nota: 92 },
        { chave: 'boreal', valorProposta: reais(3_408_000), nota: 85 },
        { chave: 'guardiao', valorProposta: reais(3_468_000), nota: 88 },
      ],
    },
    // 3 — Rádios digitais (PF): etapa 5, parecer favorável e edital publicado com prazo já cumprido.
    {
      titulo: 'Aquisição de rádios digitais portáteis padrão P25 para as operações da Polícia Federal',
      orgao: 'PF',
      uasg: '910001',
      etapa: 5,
      marcos: [92, 78, 62, 44, 30],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Substituição de rádios analógicos sem suporte do fabricante por equipamentos digitais criptografados, interoperáveis com a rede de radiocomunicação crítica das forças de segurança.',
        justificativa:
          'Os rádios analógicos não oferecem criptografia, expondo comunicações operacionais sigilosas; a migração para o padrão P25 assegura sigilo e interoperabilidade em operações integradas.',
        itens: [
          {
            catmat: '420615',
            descricao: 'Rádio transceptor digital portátil padrão APCO P25 fase 2, com criptografia AES-256, bateria de alta capacidade e carregador',
            unidade: 'unidade',
            quantidade: 600,
            valorUnitarioEstimado: reais(12_480),
          },
          {
            catmat: '420620',
            descricao: 'Bateria sobressalente de íons de lítio para rádio portátil P25',
            unidade: 'unidade',
            quantidade: 600,
            valorUnitarioEstimado: reais(690),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: etpCompleto({
        necessidade: 'Garantir comunicação operacional criptografada e interoperável, substituindo 600 rádios analógicos sem suporte do fabricante.',
        requisitos: 'Padrão APCO P25 fase 2, criptografia AES-256, grau de proteção IP67, compatibilidade com a infraestrutura troncalizada existente e garantia de 36 meses.',
        quantidades: 'Um rádio por agente em atividade operacional nas unidades contempladas (600), com uma bateria sobressalente por equipamento para turnos de 12 horas.',
        mercado: 'O mercado conta com fabricantes e integradores com produtos homologados pela Anatel e compatíveis com a rede existente.',
        solucao: 'Aquisição dos rádios com programação, chaves de criptografia carregadas, treinamento de operadores e garantia com reposição em até 10 dias.',
        parcelamento: 'Rádios e baterias em itens distintos, permitindo a competição por item sem perder a compatibilidade, assegurada pela especificação técnica.',
        resultados: 'Comunicação 100% criptografada nas operações e interoperabilidade com as demais forças de segurança.',
        ambiental: 'Recolhimento das baterias e dos rádios substituídos pelo fabricante, conforme a Política Nacional de Resíduos Sólidos.',
        conclusao: 'A contratação é viável e necessária, recomendando-se o prosseguimento por pregão eletrônico por item.',
      }),
      riscos: [
        { descricao: 'Incompatibilidade com a infraestrutura troncalizada existente', probabilidade: 2, impacto: 5, alocacao: 'contratada', mitigacao: 'Prova de conceito com amostra antes do recebimento definitivo' },
        { descricao: 'Vazamento de chaves de criptografia na programação', probabilidade: 1, impacto: 5, alocacao: 'compartilhado', mitigacao: 'Programação em ambiente da contratante com termo de sigilo' },
        { descricao: 'Atraso na importação de componentes', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: 'Prazo de entrega de 90 dias e multa moratória' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — rádios P25 fase 2 portáteis', valor: 12_310, diasAtras: 70 },
        { fonte: 'contratacao_similar', descricao: 'Contrato de rádios P25 de polícia estadual', valor: 12_640, diasAtras: 150 },
        { fonte: 'contratacao_similar', descricao: 'Ata de registro de preços de rádios digitais de órgão federal', valor: 12_150, diasAtras: 210 },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de integrador de comunicações táticas', valor: 12_720, diasAtras: 68, justificativa: 'Integrador com atestados de implantação de redes P25 em órgãos de segurança.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fornecedor regional de radiocomunicação', valor: 12_590, diasAtras: 68, justificativa: 'Fornecedor com assistência técnica nas regiões Norte e Centro-Oeste.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de empresa de telecomunicações', valor: 12_880, diasAtras: 67, justificativa: 'Empresa com produto homologado pela Anatel e rede de assistência nacional.' },
        {
          fonte: 'midia_especializada',
          descricao: 'Catálogo internacional de rádio com recursos de banda larga',
          valor: 21_900,
          diasAtras: 66,
          expurgo: 'Equipamento de categoria superior (banda larga LTE integrada), não exigida; preço excessivamente elevado.',
        },
      ],
      edital: EDITAL_PADRAO,
      equipe: EQUIPE_COMPLETA,
      documentosEtapaAtual: [{ tipo: 'parecer_checklist', aprovar: true }],
      parecerFavoravel: true,
      publicacaoDiasAtras: 21,
      licitantes: [],
    },
    // 4 — Drones (SENASP): etapa 4, edital com exigência de faturamento mínimo (RN-06) e minuta em revisão.
    {
      titulo: 'Aquisição de aeronaves remotamente pilotadas (drones) para operações de segurança pública',
      orgao: 'SENASP',
      uasg: '930001',
      etapa: 4,
      marcos: [58, 46, 34, 14],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Dotar as operações integradas de capacidade de vigilância aérea noturna e busca de pessoas, hoje dependentes de aeronaves tripuladas de alto custo e disponibilidade limitada.',
        justificativa:
          'Drones com câmera termal reduzem o custo por hora de vigilância e ampliam a cobertura de operações em fronteiras, grandes eventos e desastres, com menor risco às equipes.',
        itens: [
          {
            catmat: '471210',
            descricao: 'Aeronave remotamente pilotada multirrotor com câmera termal radiométrica, zoom óptico de 30x e autonomia mínima de 40 minutos',
            unidade: 'unidade',
            quantidade: 30,
            valorUnitarioEstimado: reais(96_500),
          },
          {
            catmat: '471215',
            descricao: 'Kit de baterias inteligentes e estação de carregamento para aeronave remotamente pilotada',
            unidade: 'kit',
            quantidade: 30,
            valorUnitarioEstimado: reais(8_900),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: etpCompleto({
        necessidade: 'Prover vigilância aérea diurna e noturna às operações integradas, com custo por hora inferior ao da aviação tripulada.',
        requisitos: 'Câmera termal radiométrica, zoom óptico de 30x, transmissão criptografada, homologação pela Anatel e cadastro no SISANT/ANAC.',
        quantidades: 'Duas aeronaves por base operacional (15 bases), com um kit de baterias por aeronave para operações contínuas.',
        mercado: 'Há fornecedores nacionais e representantes de fabricantes estrangeiros com assistência técnica no país.',
        solucao: 'Aquisição das aeronaves com treinamento de pilotos, software de gestão de voo e garantia com reposição.',
        parcelamento: 'Aeronaves e baterias em itens distintos para ampliar a competição, mantida a compatibilidade por especificação.',
        resultados: 'Redução de 60% no custo por hora de vigilância aérea e ampliação da cobertura noturna.',
        ambiental: 'Baterias com logística reversa pelo fornecedor e operação restrita às normas de ruído e privacidade.',
        conclusao: 'A contratação é viável e adequada, recomendando-se o prosseguimento por pregão eletrônico por item.',
      }),
      riscos: [
        { descricao: 'Restrições de espaço aéreo e autorizações de voo', probabilidade: 3, impacto: 3, alocacao: 'contratante', mitigacao: 'Cadastro prévio das aeronaves e dos pilotos nos sistemas da ANAC e do DECEA' },
        { descricao: 'Falha de bateria em operação', probabilidade: 2, impacto: 4, alocacao: 'contratada', mitigacao: 'Garantia de 24 meses para baterias e reposição em 5 dias' },
        { descricao: 'Perda de enlace e queda da aeronave', probabilidade: 2, impacto: 4, alocacao: 'compartilhado', mitigacao: 'Retorno automático ao ponto de decolagem e seguro de responsabilidade civil' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — drones com câmera termal', valor: 95_800, diasAtras: 40 },
        { fonte: 'contratacao_similar', descricao: 'Contrato de drones de corpo de bombeiros estadual', valor: 97_400, diasAtras: 120 },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fabricante nacional de drones e sensores', valor: 96_900, diasAtras: 38, justificativa: 'Fabricante nacional com assistência técnica própria e atestados em segurança pública.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de representante de fabricante estrangeiro', valor: 98_200, diasAtras: 38, justificativa: 'Representante autorizado com estoque e reposição no país.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de integrador de sistemas de vigilância', valor: 95_400, diasAtras: 37, justificativa: 'Integrador com experiência em videomonitoramento para órgãos de segurança.' },
        {
          fonte: 'nota_fiscal',
          descricao: 'Nota fiscal de drone recreativo sem câmera termal',
          valor: 18_700,
          diasAtras: 36,
          expurgo: 'Equipamento recreativo, sem câmera termal nem transmissão criptografada; preço inexequível para o objeto.',
        },
      ],
      edital: { ...EDITAL_PADRAO, exigeFaturamentoMinimo: true, patrimonioLiquidoMinimoPercentual: 10 },
      equipe: EQUIPE_COMPLETA,
      documentosEtapaAtual: [
        { tipo: 'tr', aprovar: true },
        { tipo: 'edital', aprovar: false },
        { tipo: 'minuta_contrato', aprovar: false },
      ],
      parecerFavoravel: false,
      publicacaoDiasAtras: null,
      licitantes: [],
    },
    // 5 — Scanners corporais (SENAPPEN): etapa 3, ETP incompleto e preço discrepante sugerido para expurgo.
    {
      titulo: 'Aquisição de scanners corporais para revista em unidades do sistema penitenciário federal',
      orgao: 'SENAPPEN',
      uasg: '940001',
      etapa: 3,
      marcos: [36, 24, 10],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Substituir a revista manual de visitantes e servidores por inspeção corporal não invasiva, coibindo a entrada de celulares, drogas e armas nas penitenciárias federais.',
        justificativa:
          'A revista manual é constrangedora, lenta e de eficácia limitada; scanners corporais aumentam a segurança das unidades e atendem às diretrizes de revista humanizada.',
        itens: [
          {
            catmat: '470830',
            descricao: 'Scanner corporal de inspeção por transmissão de raios X de baixa dose, com software de detecção automática e certificação de dose',
            unidade: 'unidade',
            quantidade: 8,
            valorUnitarioEstimado: reais(1_180_000),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: {
        I: { texto: 'Inspeção corporal não invasiva de visitantes, servidores e prestadores nas cinco penitenciárias federais, substituindo a revista manual.' },
        II: { texto: 'A contratação consta do Plano de Contratações Anual do exercício, com a mesma estimativa preliminar do DFD.' },
        III: { texto: 'Dose por inspeção inferior a 0,25 µSv, licença da CNEN, detecção automática de objetos e integração ao sistema de controle de acesso.' },
        IV: { texto: 'Um equipamento por portaria de acesso de visitantes (5) e três para os acessos de servidores das unidades de maior fluxo.' },
        V: { texto: 'Há ao menos quatro fornecedores com equipamentos licenciados pela CNEN e instalados em unidades prisionais estaduais.' },
        VI: { texto: 'A estimativa do valor resulta da pesquisa de preços, com parâmetros do art. 23, § 1º, e saneamento conforme a IN SEGES/ME 65/2021.' },
        VII: { texto: 'Fornecimento, instalação, licenciamento, treinamento de operadores e manutenção preventiva e corretiva por 36 meses.' },
        VIII: { texto: 'Item único: a integração ao controle de acesso e a manutenção exigem fornecedor único por solução.' },
        IX: { texto: 'Redução do tempo médio de revista e da entrada de ilícitos, com fim da revista manual invasiva.' },
        X: { justificativaAusencia: 'Providências prévias já atendidas: as portarias têm infraestrutura elétrica e espaço físico adequados.' },
      },
      riscos: [
        { descricao: 'Atraso na licença de operação da CNEN', probabilidade: 3, impacto: 4, alocacao: 'contratada', mitigacao: 'Exigir licença vigente do modelo na habilitação técnica' },
        { descricao: 'Resistência de visitantes e questionamentos sobre radiação', probabilidade: 3, impacto: 2, alocacao: 'contratante', mitigacao: 'Campanha informativa e protocolo de dose publicado' },
        { descricao: 'Indisponibilidade por falha sem manutenção local', probabilidade: 2, impacto: 4, alocacao: 'contratada', mitigacao: 'Acordo de nível de serviço com atendimento em 48 horas' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — scanners corporais de transmissão', valor: 1_165_000, diasAtras: 20 },
        { fonte: 'contratacao_similar', descricao: 'Contrato de scanner corporal de secretaria estadual de administração penitenciária', valor: 1_198_000, diasAtras: 140 },
        { fonte: 'contratacao_similar', descricao: 'Ata de registro de preços de equipamentos de inspeção', valor: 1_172_500, diasAtras: 190 },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de fabricante com equipamento licenciado pela CNEN', valor: 1_210_000, diasAtras: 18, justificativa: 'Fabricante com equipamentos instalados em unidades prisionais.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de representante de equipamentos de inspeção', valor: 1_189_000, diasAtras: 18, justificativa: 'Representante com assistência técnica em Brasília e Porto Velho.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de integrador de segurança eletrônica', valor: 1_176_000, diasAtras: 17, justificativa: 'Integrador com atestado de instalação em penitenciária estadual.' },
        { fonte: 'midia_especializada', descricao: 'Catálogo de scanner de segurança aeroportuária de ondas milimétricas', valor: 1_890_000, diasAtras: 16 },
      ],
      edital: EDITAL_PADRAO,
      equipe: EQUIPE_PLANEJAMENTO,
      documentosEtapaAtual: [{ tipo: 'etp', aprovar: false }],
      parecerFavoravel: false,
      publicacaoDiasAtras: null,
      licitantes: [],
    },
    // 6 — Licenças de software de perícia (PF): etapa 5, aguardando o parecer jurídico.
    {
      titulo: 'Aquisição de licenças de software de extração e análise forense de dispositivos móveis',
      orgao: 'PF',
      uasg: '910003',
      etapa: 5,
      marcos: [72, 60, 46, 28, 9],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Ampliar a capacidade de extração e análise de dados de celulares apreendidos, cujo passivo de exames periciais cresceu 40% no último ano.',
        justificativa:
          'As licenças atuais não suportam os sistemas operacionais mais recentes, o que impede exames em parte dos aparelhos e atrasa inquéritos com réus presos.',
        itens: [
          {
            catmat: '27502',
            descricao: 'Licença perpétua de software de extração e análise forense de dispositivos móveis, com atualização e suporte por 36 meses',
            unidade: 'licença',
            quantidade: 25,
            valorUnitarioEstimado: reais(148_000),
          },
          {
            catmat: '27510',
            descricao: 'Treinamento oficial certificado no software forense para turma de 10 peritos',
            unidade: 'turma',
            quantidade: 3,
            valorUnitarioEstimado: reais(36_000),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: etpCompleto({
        necessidade: 'Restabelecer a capacidade de exame de dispositivos móveis com sistemas operacionais atuais e reduzir o passivo de laudos.',
        requisitos: 'Extração física e lógica dos principais sistemas operacionais, decodificação de aplicativos de mensagens, relatórios com cadeia de custódia e atualizações por 36 meses.',
        quantidades: 'Uma licença por estação pericial ativa (25) e três turmas de capacitação para os peritos que operarão as estações.',
        mercado: 'Há ao menos três soluções com reconhecimento em laudos judiciais, comercializadas por representantes no país.',
        solucao: 'Licenças perpétuas com atualização e suporte, instalação nas estações periciais e capacitação certificada dos peritos.',
        parcelamento: 'Licenças e treinamento em itens distintos; o treinamento depende da solução vencedora e é contratado com o mesmo fornecedor.',
        resultados: 'Redução de 50% do passivo de exames em 12 meses e cobertura dos aparelhos atuais.',
        ambiental: 'Solução sem impacto ambiental relevante; licenças entregues por meio eletrônico, sem mídias físicas.',
        conclusao: 'A contratação é viável e adequada, recomendando-se o prosseguimento por pregão eletrônico.',
      }),
      riscos: [
        { descricao: 'Descontinuidade do suporte a novos sistemas operacionais', probabilidade: 3, impacto: 4, alocacao: 'contratada', mitigacao: 'Atualizações trimestrais obrigatórias com acordo de nível de serviço' },
        { descricao: 'Questionamento judicial da cadeia de custódia', probabilidade: 2, impacto: 5, alocacao: 'compartilhado', mitigacao: 'Relatórios com hash e registro de todas as operações' },
        { descricao: 'Dependência tecnológica de fornecedor único', probabilidade: 3, impacto: 3, alocacao: 'contratante', mitigacao: 'Formatos de exportação abertos e documentação técnica entregue' },
      ],
      cotacoes: [
        { fonte: 'painel_precos', descricao: 'Painel de Preços — licenças de software forense móvel', valor: 146_500, diasAtras: 52 },
        { fonte: 'contratacao_similar', descricao: 'Contrato de polícia científica estadual', valor: 151_200, diasAtras: 160 },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de representante de software forense', valor: 149_800, diasAtras: 50, justificativa: 'Representante autorizado com suporte em português.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de empresa de tecnologia forense', valor: 147_300, diasAtras: 50, justificativa: 'Empresa com atestados de fornecimento a órgãos de perícia.' },
        { fonte: 'fornecedor_direto', descricao: 'Proposta de laboratório de perícia digital', valor: 150_400, diasAtras: 49, justificativa: 'Laboratório que comercializa e treina usuários da solução.' },
        {
          fonte: 'midia_especializada',
          descricao: 'Licença anual de versão de demonstração',
          valor: 38_000,
          diasAtras: 48,
          expurgo: 'Licença anual de versão limitada, não equivalente à licença perpétua; preço inexequível.',
        },
      ],
      edital: EDITAL_PADRAO,
      equipe: EQUIPE_COMPLETA,
      documentosEtapaAtual: [{ tipo: 'parecer_checklist', aprovar: false }],
      parecerFavoravel: false,
      publicacaoDiasAtras: null,
      licitantes: [],
    },
    // 7 — EPIs (SENASP): etapa 1, indício de artigo de luxo e demanda fora do PCA.
    {
      titulo: 'Aquisição de equipamentos de proteção individual para operações integradas',
      orgao: 'SENASP',
      uasg: '930001',
      etapa: 1,
      marcos: [6],
      modalidade: 'Dispensa eletrônica (art. 75, II)',
      dfd: {
        descricaoNecessidade:
          'Prover equipamentos de proteção individual às equipes mobilizadas em operações integradas de curta duração, que hoje utilizam material próprio sem padronização.',
        justificativa:
          'A ausência de EPI padronizado expõe os servidores a lesões em incursões e operações em áreas de difícil acesso, com afastamentos e custos indiretos para a Administração.',
        itens: [
          {
            catmat: '357301',
            descricao: 'Luvas táticas de couro legítimo com proteção de impacto nos nós dos dedos',
            unidade: 'par',
            quantidade: 300,
            valorUnitarioEstimado: reais(89.9),
          },
          {
            catmat: '357310',
            descricao: 'Conjunto de joelheira e cotoveleira táticas em polímero de alta resistência',
            unidade: 'conjunto',
            quantidade: 200,
            valorUnitarioEstimado: reais(79),
          },
          {
            catmat: '357320',
            descricao: 'Óculos de proteção balística com lente incolor e tratamento antiembaçante',
            unidade: 'unidade',
            quantidade: 300,
            valorUnitarioEstimado: reais(46.5),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: false,
        tipoObjeto: 'bens',
      },
      etp: {},
      riscos: [],
      cotacoes: [],
      edital: EDITAL_PADRAO,
      equipe: [],
      documentosEtapaAtual: [],
      parecerFavoravel: false,
      publicacaoDiasAtras: null,
      licitantes: [],
    },
    // 8 — Munição de treinamento (PRF): etapa 2, conflito de segregação de funções e DFD aprovado aguardando assinatura no SEI.
    {
      titulo: 'Aquisição de munição de treinamento para a capacitação em tiro dos policiais rodoviários',
      orgao: 'PRF',
      uasg: '920002',
      etapa: 2,
      marcos: [18, 9],
      modalidade: 'Pregão eletrônico',
      dfd: {
        descricaoNecessidade:
          'Garantir a munição necessária ao programa anual de habilitação e reciclagem em tiro dos policiais rodoviários da superintendência, interrompido por falta de estoque.',
        justificativa:
          'A habilitação periódica em tiro é requisito para o porte de arma em serviço; sem munição de treinamento, os cursos programados para o semestre serão cancelados.',
        itens: [
          {
            catmat: '343101',
            descricao: 'Cartucho calibre 9 mm de manejo para treinamento, projétil encamisado, caixa com 50 unidades',
            unidade: 'caixa',
            quantidade: 2000,
            valorUnitarioEstimado: reais(152),
          },
          {
            catmat: '343120',
            descricao: 'Cartucho calibre 5,56 mm de festim para exercícios táticos, caixa com 20 unidades',
            unidade: 'caixa',
            quantidade: 500,
            valorUnitarioEstimado: reais(118),
          },
        ],
        usaCatalogoPadronizado: true,
        justificativaNaoPadronizacao: null,
        justificativaArtigoLuxo: null,
        previstoNoPca: true,
        tipoObjeto: 'bens',
      },
      etp: {},
      riscos: [],
      cotacoes: [],
      edital: EDITAL_PADRAO,
      equipe: [
        { papel: 'requisitante', pessoa: 'requisitante' },
        { papel: 'equipe_planejamento', pessoa: 'planejamento' },
        { papel: 'agente_contratacao', pessoa: 'planejamento' },
        { papel: 'autoridade_competente', pessoa: 'autoridade' },
      ],
      documentosEtapaAtual: [{ tipo: 'dfd', aprovar: true, semAssinatura: true }],
      parecerFavoravel: false,
      publicacaoDiasAtras: null,
      licitantes: [],
    },
  ];
}

export async function gerarProcessos(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora, eventos, calendario } = ctx;
  const usuario = (email: string) => {
    const u = dados.usuarios.get(email);
    if (!u) throw new Error(`Usuário de demonstração ausente: ${email}`);
    return u;
  };
  const planejamento = usuario('planejamento@agora.demo');
  const agente = usuario('agente@agora.demo');
  const juridico = usuario('juridico@agora.demo');
  const gestor = usuario('gestor@agora.demo');
  const fiscalDemo = usuario('fiscal@agora.demo');
  const emailsDemonstracao = new Set(USUARIOS_DEMONSTRACAO.map((u) => u.email));
  const sinteticos = [...dados.usuarios.values()].filter((u) => !emailsDemonstracao.has(u.email));
  const requisitante = sinteticos.find((u) => u.perfis.includes('planejamento')) ?? planejamento;
  const autoridade = sinteticos.find((u) => u.perfis.includes('gestor_contratos')) ?? gestor;
  const fiscalPara = (uasg: string) => {
    if (fiscalDemo.uasgs === 'todas' || fiscalDemo.uasgs.includes(uasg)) return fiscalDemo;
    return sinteticos.find((u) => u.perfis.includes('fiscal') && (u.uasgs === 'todas' || u.uasgs.includes(uasg))) ?? fiscalDemo;
  };
  const fornecedorPorChave = new Map(dados.fornecedores.map((f) => [f.chave, f]));
  const provedor = criarProvedorIa({ provedor: 'nenhum', url: null, modelo: null, chave: null }, (entrada, init) => fetch(entrada, init));
  const carga = { carga: 'demonstracao' };
  let documentosGerados = 0;

  for (const plano of planos()) {
    const id = prng.uuid();
    const data = (etapa: number) => adicionarDias(hoje, -(plano.marcos[etapa - 1] ?? 0));
    let ultimaAlteracao = new Date(0);
    const instante = (dataIso: string) => {
      const momento = instanteEm(dataIso, prng, agora);
      if (momento > ultimaAlteracao) ultimaAlteracao = momento;
      return momento;
    };
    const donoDaEtapa = (etapa: number) => (etapa <= 3 ? planejamento : agente);
    const pessoas: Record<Pessoa, { id: string; nome: string }> = {
      requisitante,
      planejamento,
      agente,
      autoridade,
      gestor,
      fiscal: fiscalPara(plano.uasg),
      juridico,
    };
    const criacao = instante(data(1));
    const cesta: CestaArmazenada = {
      cotacoes: plano.cotacoes.map((c) => ({
        id: prng.uuid(),
        fonte: c.fonte,
        descricaoFonte: c.descricao,
        valorUnitario: reais(c.valor),
        dataCotacao: adicionarDias(hoje, -c.diasAtras),
        ...(c.justificativa ? { justificativaEscolhaFornecedor: c.justificativa } : {}),
        expurgada: c.expurgo !== undefined,
        motivoExpurgo: c.expurgo ?? null,
      })),
      orcamentoSigiloso: false,
      motivoSigilo: null,
    };
    const { numeroSei } = await inserirProcesso(tx, {
      id,
      titulo: plano.titulo,
      orgao: plano.orgao,
      uasg: plano.uasg,
      responsavelId: donoDaEtapa(plano.etapa).id,
      etapa: plano.etapa,
      modalidadePrevista: plano.modalidade,
      dfd: plano.dfd,
      etp: plano.etp,
      riscos: plano.riscos.map((r) => ({ ...r, id: prng.uuid() })),
      cesta,
      edital: plano.edital,
      parecer: parecerInicial(),
      publicacao: PUBLICACAO_INICIAL,
      disputa: DISPUTA_INICIAL,
      criadoEm: criacao.toISOString(),
    });
    eventos.push({
      ocorridoEm: criacao,
      usuarioId: planejamento.id,
      acao: 'processo.criar',
      recurso: 'processo',
      recursoId: id,
      resumo: `Autuou o processo ${numeroSei} — ${plano.titulo}`,
      dados: { ...carga, numeroSei, orgao: plano.orgao, uasg: plano.uasg },
    });

    if (plano.equipe.length > 0) {
      const designacao = instante(data(2));
      await gravarEquipe(tx, id, plano.equipe.map((e) => ({ papel: e.papel, usuarioId: pessoas[e.pessoa].id })), designacao);
      eventos.push({
        ocorridoEm: designacao,
        usuarioId: planejamento.id,
        acao: 'processo.equipe.designar',
        recurso: 'processo',
        recursoId: id,
        resumo: `Designou a equipe do processo (${plano.equipe.length} designação(ões))`,
        dados: { ...carga, numeroSei, designacoes: plano.equipe.map((e) => ({ papel: e.papel, usuarioId: pessoas[e.pessoa].id })) },
      });
    }

    for (let etapa = 1; etapa <= plano.etapa; etapa++) {
      const dataEtapa = data(etapa);
      if (etapa >= 2) {
        eventos.push({
          ocorridoEm: instante(dataEtapa),
          usuarioId: donoDaEtapa(etapa - 1).id,
          acao: 'processo.avancar',
          recurso: 'processo',
          recursoId: id,
          resumo: `Concluiu a etapa ${etapa - 1} e avançou para a etapa ${etapa} — ${TITULOS_ETAPA[etapa as EtapaJornada]}`,
          dados: { ...carga, numeroSei, de: etapa - 1, para: etapa },
        });
      }
      const documentos: PlanoDocumento[] =
        etapa === plano.etapa ? plano.documentosEtapaAtual : (DOCUMENTOS_POR_ETAPA[etapa as EtapaJornada] ?? []).map((tipo) => ({ tipo, aprovar: true }));
      const dataDocumentos = adicionarDias(dataEtapa, 1) > hoje ? hoje : adicionarDias(dataEtapa, 1);

      for (const planoDoc of documentos) {
        const linha = await obterLinhaProcesso(tx, id, null);
        if (!linha) throw new Error('Processo recém-criado não encontrado');
        const contextoDoc: ContextoJornada = { hoje: dataDocumentos, agora: instante(dataDocumentos), calendario };
        const preparado = await prepararDocumento(await carregarProcesso(tx, linha), planoDoc.tipo, provedor, contextoDoc);
        const autor = planoDoc.tipo === 'parecer_checklist' ? juridico : donoDaEtapa(etapa);
        const doc = await inserirDocumento(tx, id, preparado, { id: prng.uuid(), geradoEm: contextoDoc.agora.toISOString(), usuarioId: autor.id });
        documentosGerados++;
        if (planoDoc.tipo === 'parecer_checklist' && plano.parecerFavoravel) {
          const emitido = instante(dataDocumentos);
          await gravarJson(
            tx,
            id,
            'parecer',
            {
              itens: ITENS_PARECER.map((i) => ({ id: i.id, atendido: true, observacao: null })),
              conclusao: 'favoravel',
              pareceristaId: juridico.id,
              emitidoEm: emitido.toISOString(),
            },
            emitido,
          );
          eventos.push({
            ocorridoEm: emitido,
            usuarioId: juridico.id,
            acao: 'processo.parecer.registrar',
            recurso: 'processo',
            recursoId: id,
            resumo: 'Registrou o parecer jurídico: favoravel',
            dados: { ...carga, numeroSei, conclusao: 'favoravel' },
          });
        }
        if (!planoDoc.aprovar) continue;
        const paraAprovar = await obterDocumentoParaAprovar(tx, id, doc.id);
        if (!paraAprovar) throw new Error('Documento recém-gerado não encontrado');
        const aprovacao = instante(dataDocumentos);
        const { numeroSei: numeroDocumento } = await aprovarDocumento(tx, id, paraAprovar, autor, aprovacao, dataDocumentos, prng.uuid());
        if (planoDoc.semAssinatura) continue;
        await assinarNaArvore(tx, id, numeroDocumento, autor.id, aprovacao);
      }

      if (etapa === 5 && plano.publicacaoDiasAtras !== null) {
        const linha = await obterLinhaProcesso(tx, id, null);
        if (!linha) throw new Error('Processo recém-criado não encontrado');
        const dataPublicacao = adicionarDias(hoje, -plano.publicacaoDiasAtras);
        const publicado = instante(dataPublicacao);
        const resultado = publicarOffline(linha, dados.cnpjOrgao, { hoje: dataPublicacao, agora: publicado, calendario });
        await gravarJson(tx, id, 'publicacao', resultado.publicacao, publicado);
        eventos.push({
          ocorridoEm: publicado,
          usuarioId: agente.id,
          acao: 'processo.publicar',
          recurso: 'processo',
          recursoId: id,
          resumo: `Publicou o edital no PNCP e o extrato no DOU (fila offline); propostas a partir de ${resultado.publicacao.dataMinimaPropostas ?? '—'}`,
          dados: { ...carga, numeroSei, ...resultado.publicacao, diasUteis: resultado.diasUteis },
        });
      }

      if (etapa === 6 && plano.licitantes.length > 0) {
        const registro = instante(adicionarDias(dataEtapa, 2) > hoje ? hoje : adicionarDias(dataEtapa, 2));
        const disputa = await montarDisputa(
          tx,
          plano.licitantes.map((l) => {
            const fornecedor = fornecedorPorChave.get(l.chave);
            if (!fornecedor) throw new Error(`Fornecedor sintético ausente: ${l.chave}`);
            return { id: fornecedor.id, valorProposta: l.valorProposta, notaDesempenhoPrevio: l.nota };
          }),
          registro,
        );
        await gravarJson(tx, id, 'disputa', disputa, registro);
        eventos.push({
          ocorridoEm: registro,
          usuarioId: agente.id,
          acao: 'processo.disputa.registrar',
          recurso: 'processo',
          recursoId: id,
          resumo: `Registrou a disputa com ${plano.licitantes.length} licitante(s)${disputa.resultado?.empateDetectado ? ' e aplicou os critérios de desempate do art. 60' : ''}`,
          dados: { ...carga, numeroSei, empateDetectado: disputa.resultado?.empateDetectado ?? false, criterioDecisivo: disputa.resultado?.criterioDecisivo ?? null },
        });
      }
    }
    await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [id, ultimaAlteracao.toISOString()]);
  }

  dados.contagens.processos = planos().length;
  dados.contagens.documentosGerados = documentosGerados;
}
