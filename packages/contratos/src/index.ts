/**
 * @agora/contratos — contrato HTTP entre a API e a interface da Ágora.
 *
 * Convenções:
 * - Prefixo de todas as rotas: `/api/v1`. JSON UTF-8.
 * - Dinheiro em centavos inteiros (`Centavos`). Datas de calendário `DataISO` (YYYY-MM-DD); instantes `InstanteISO` (ISO 8601 UTC).
 * - Identificadores `Id` são UUID v4 (string).
 * - Listas paginadas devolvem `Pagina<T>`; parâmetros `pagina` (1..n) e `tamanhoPagina` (10, 25, 50, 100; padrão 25).
 * - Erros devolvem `RespostaErro` com status HTTP adequado (400, 401, 403, 404, 409, 422, 429, 500).
 * - Escritas exigem o cabeçalho `X-Agora-CSRF` com o `csrfToken` da sessão.
 * - Dados pessoais chegam mascarados; o valor completo só via `POST /lgpd/revelar`.
 */

export type Id = string;
export type Centavos = number;
export type DataISO = string;
export type InstanteISO = string;

// ───────────────────────── Infra ─────────────────────────

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  tamanhoPagina: number;
}

export interface RespostaErro {
  erro: {
    codigo: string; // ex.: 'NAO_AUTENTICADO', 'SEM_PERMISSAO', 'NAO_ENCONTRADO', 'VALIDACAO', 'CONFLITO', 'REGRA_NEGOCIO', 'LIMITE_TENTATIVAS', 'INTERNO'
    mensagem: string; // pt-BR, pronta para exibir
    detalhes?: { campo?: string; mensagem: string }[];
    idRequisicao: string;
  };
}

export interface ParametrosLista {
  busca?: string;
  pagina?: number;
  tamanhoPagina?: number;
  ordenarPor?: string;
  ordem?: 'asc' | 'desc';
}

export type Semaforo = 'vencido' | 'critico' | 'atencao' | 'alerta' | 'planejamento' | 'regular';

/** Proveniência de um conjunto de dados (exibida junto de cada tabela). */
export interface Proveniencia {
  fonte: FonteDados;
  atualizadoEm: InstanteISO | null;
  situacao: 'atualizado' | 'desatualizado' | 'falhou' | 'nunca_sincronizado';
}

export type FonteDados = 'PNCP' | 'COMPRAS_GOV' | 'CONTRATOS_GOV' | 'SIAFI' | 'AGORA';

// ───────────────────────── Configuração pública e sessão ─────────────────────────

/** GET /configuracao-publica (sem autenticação) */
export interface ConfiguracaoPublica {
  produto: string; // 'Ágora'
  versao: string;
  ambiente: 'demonstracao' | 'homologacao' | 'producao';
  orgao: { nome: string; sigla: string; unidade: string };
  govbrHabilitado: boolean;
  iaHabilitada: boolean;
  encarregadoLgpd: { nome: string; email: string };
  usuariosDemonstracao?: { email: string; perfil: CodigoPerfil; descricao: string }[]; // só em ambiente 'demonstracao'
}

export type CodigoPerfil =
  | 'administrador'
  | 'gestor_contratos'
  | 'fiscal'
  | 'financeiro'
  | 'planejamento'
  | 'agente_contratacao'
  | 'juridico'
  | 'auditor'
  | 'consulta'
  | 'controle_interno';

export type Permissao =
  | 'painel:ler'
  | 'pendencias:resolver'
  | 'atas:ler'
  | 'atas:editar'
  | 'contratos:ler'
  | 'contratos:editar'
  | 'itens:ler'
  | 'empenhos:ler'
  | 'pagamentos:ler'
  | 'pagamentos:atestar'
  | 'vinculos:editar'
  | 'tarefas:editar'
  | 'ajustes:editar'
  | 'fornecedores:ler'
  | 'sancoes:ler'
  | 'sancoes:instruir'
  | 'jornada:ler'
  | 'jornada:editar'
  | 'jornada:aprovar_juridico'
  | 'jornada:publicar'
  | 'integracoes:executar'
  | 'admin:usuarios'
  | 'auditoria:ler'
  | 'lgpd:revelar'
  | 'lgpd:relatorio'
  | 'notificacoes:ler'
  | 'notificacoes:enviar'
  | 'notificacoes:administrar'
  | 'disputa:conduzir'
  | 'controle:primeira_linha'
  | 'controle:segunda_linha'
  | 'controle:terceira_linha'
  | 'controle_externo:ler'
  | 'controle_externo:registrar'
  | 'riscos:revisar'
  | 'jornada:homologar'
  | 'certidoes:registrar'
  | 'regularidade:consultar'
  | 'documentos:ler'
  | 'documentos:enviar'
  | 'documentos:analisar'
  | 'impedimentos:ler'
  | 'impedimentos:registrar'
  | 'impedimentos:parecer'
  | 'impedimentos:decidir'
  | 'agentes:declarar'
  | 'sigilo:ler'
  | 'sigilo:classificar'
  | 'sigilo:credenciar'
  | 'sigilo:controle'
  | 'auditoria:ancorar';

export interface UsuarioSessao {
  id: Id;
  nome: string;
  email: string; // o próprio usuário vê o seu e-mail completo
  perfis: CodigoPerfil[];
  permissoes: Permissao[];
  uasgs: string[]; // códigos de UASG no escopo; vazio + perfil administrador/auditor = todas
  todasUasgs: boolean;
  /** true quando a senha atual é temporária: a interface leva o usuário a /trocar-senha antes de qualquer outra tela. */
  deveTrocarSenha: boolean;
}

/** POST /sessao/senha (autenticado, CSRF) → 204 | 400 VALIDACAO | 401 (senha atual incorreta) */
export interface EntradaTrocarSenha {
  senhaAtual: string;
  novaSenha: string; // mínimo 12 caracteres, diferente da atual
}

/** POST /usuarios/:id/senha-temporaria (admin:usuarios, CSRF) → RespostaSenhaTemporaria.
 *  A senha é exibida uma única vez, expira em 72 h e obriga a troca no primeiro acesso. Todas as sessões do usuário são encerradas. */
export interface RespostaSenhaTemporaria {
  senhaTemporaria: string;
  expiraEm: InstanteISO;
}

/** POST /sessao  body: EntradaLogin  →  200 Sessao | 401 | 429 */
export interface EntradaLogin {
  email: string;
  senha: string;
}
/** GET /sessao → 200 Sessao | 401 ; DELETE /sessao → 204 */
export interface Sessao {
  usuario: UsuarioSessao;
  csrfToken: string;
  expiraEm: InstanteISO;
}
// GET /sessao/govbr/iniciar → 302 para o Login Único (só se govbrHabilitado)
// GET /sessao/govbr/retorno → 302 para "/" (cria sessão) ou "/entrar?erro=govbr"

// ───────────────────────── Cadastros base ─────────────────────────

export interface Uasg {
  codigo: string; // 6 dígitos
  nome: string;
  sigla: string;
  uf: string;
}

export interface UsuarioResumo {
  id: Id;
  nome: string;
}

export interface FornecedorResumo {
  id: Id;
  documento: string; // CNPJ formatado ou CPF mascarado
  tipoPessoa: 'PJ' | 'PF';
  razaoSocial: string; // PF: nome mascarado
  porte: 'ME' | 'EPP' | 'DEMAIS' | null;
  uf: string | null;
  sancoesVigentes: number;
  idc: { nota: number; faixa: FaixaIdc; semHistorico: boolean } | null;
}

export type FaixaIdc = 'excelente' | 'bom' | 'regular' | 'insuficiente' | 'critico';

// ───────────────────────── Painel e pendências ─────────────────────────

/** GET /painel?uasg= */
export interface Painel {
  indicadores: {
    atasVigentes: number;
    contratosVigentes: number;
    valorGlobalContratos: Centavos;
    valorEmpenhado: Centavos;
    valorPago: Centavos;
    saldoAEmpenhar: Centavos;
    pendenciasAbertas: number;
    pendenciasAltaPrioridade: number;
  };
  vencimentos: { em30: number; em60: number; em90: number; vencidos: number; em120: number }; // em120: 91 a 120 dias (RN-31)
  divulgacaoPncpPendente: number; // contratos com prazo do art. 94 vencido sem divulgação
  queimaAcelerada: number; // contratos com sinal 'acelerado' de projetarQueimaSaldo
  proximosVencimentos: InstrumentoVencimento[]; // até 8, ordenados por dias restantes
  proveniencia: Proveniencia[];
}

export interface InstrumentoVencimento {
  tipo: 'ata' | 'contrato';
  id: Id;
  identificador: string; // "Contrato 12/2025"
  objeto: string;
  uasg: string;
  vigenciaFim: DataISO;
  diasRestantes: number;
  semaforo: Semaforo;
}

export type TipoPendencia = 'saldo' | 'vigencia' | 'reajuste' | 'pagamento' | 'tarefa' | 'divulgacao_pncp' | 'garantia' | 'lembrete';
export type Prioridade = 'alta' | 'media' | 'baixa';

export interface Pendencia {
  id: Id;
  tipo: TipoPendencia;
  prioridade: Prioridade;
  instrumento: { tipo: 'ata' | 'contrato'; id: Id; identificador: string };
  uasg: string;
  objeto: string;
  fornecedor: string | null;
  motivo: string;
  prazo: DataISO | null;
  responsavel: UsuarioResumo | null;
  situacao: 'aberta' | 'resolvida';
  resolvidaEm: InstanteISO | null;
  resolvidaPor: UsuarioResumo | null;
  observacaoResolucao: string | null;
}
/** GET /pendencias?busca&tipo&prioridade&situacao(aberta|resolvida)&uasg&responsavel(eu|todos)&ordenarPor(prioridade|prazo|uasg)&pagina&tamanhoPagina → Pagina<Pendencia> */
export interface FiltroPendencias extends ParametrosLista {
  tipo?: TipoPendencia;
  prioridade?: Prioridade;
  situacao?: 'aberta' | 'resolvida';
  uasg?: string;
  responsavel?: 'eu' | 'todos';
}
/** POST /pendencias/:id/resolver  body → Pendencia ; POST /pendencias/:id/reabrir → Pendencia (desfazer) */
export interface EntradaResolverPendencia {
  observacao: string; // 5..500 caracteres
}

// ───────────────────────── Atas ─────────────────────────

export type SituacaoInstrumento = 'vigente' | 'a_vencer' | 'encerrado';

export interface AtaResumo {
  id: Id;
  numero: string; // "12/2025"
  uasgGerenciadora: Uasg;
  objeto: string;
  fornecedores: string[]; // razões sociais (PJ)
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  diasRestantes: number;
  semaforo: Semaforo;
  situacao: SituacaoInstrumento;
  valorRegistrado: Centavos;
  valorContratado: Centavos;
  percentualConsumido: number;
  quantidadeItens: number;
  itensEmRisco: number; // itens com consumo ≥ 90% ou sem saldo
  criticidade: Prioridade;
  gestor: UsuarioResumo | null;
}
/** GET /atas?busca&situacao&criticidade&uasg&gestor(eu|todos)&pagina... → Pagina<AtaResumo> */
export interface FiltroAtas extends ParametrosLista {
  situacao?: SituacaoInstrumento;
  criticidade?: Prioridade;
  uasg?: string;
  gestor?: 'eu' | 'todos';
}

/** GET /atas/a-montar → Pagina<AtaAMontar>: pregões homologados (fonte PNCP) cuja ata ainda não foi montada */
export interface AtaAMontar {
  id: Id;
  numeroCompra: string; // "90012/2026"
  modalidade: string;
  uasg: Uasg;
  objeto: string;
  homologadaEm: DataISO;
  quantidadeItens: number;
  valorHomologado: Centavos;
  idPncp: string;
}

export interface EventoLinhaDoTempo {
  data: DataISO;
  titulo: string;
  descricao: string | null;
  tipo: 'assinatura' | 'divulgacao' | 'inicio_vigencia' | 'fim_vigencia' | 'aditivo' | 'reajuste' | 'apostilamento' | 'marco';
  futuro: boolean;
}

/** GET /atas/:id */
export interface AtaDetalhe extends AtaResumo {
  processoSei: string; // "08000.012345/2025-11"
  modalidade: string;
  numeroCompra: string;
  assinaturaEm: DataISO;
  divulgacaoPncpEm: DataISO | null;
  aceitaAdesao: boolean;
  idPncp: string;
  linkPncp: string; // link de navegação (o navegador NÃO chama a API do PNCP)
  saldoContratavel: Centavos;
  linhaDoTempo: EventoLinhaDoTempo[];
  proveniencia: Proveniencia;
}

export interface ItemAta {
  id: Id;
  numero: number;
  descricao: string;
  catmat: string | null;
  unidadeFornecimento: string;
  fornecedor: string;
  valorUnitario: Centavos;
  quantidadeRegistrada: number;
  quantidadeContratada: number;
  quantidadeEmpenhada: number;
  percentualConsumido: number;
  emRisco: boolean;
}
// GET /atas/:id/itens → ItemAta[]
// GET /atas/:id/contratos → ContratoResumo[]
// GET /atas/:id/tarefas → Tarefa[]
// GET /atas/:id/historico → EventoHistorico[]

/** GET /atas/:id/reajuste */
export interface InfoReajuste {
  indice: string; // "IPCA"
  dataBase: DataISO;
  proximoReajustePossivelEm: DataISO; // 12 meses da data-base (art. 25, § 7º, e art. 92, § 3º)
  ciclos: { inicio: DataISO; fim: DataISO; percentual: number; aplicadoEm: DataISO | null }[];
  observacao: string;
}

// ───────────────────────── Contratos ─────────────────────────

export interface ContratoResumo {
  id: Id;
  numero: string; // "45/2025"
  uasg: Uasg;
  fornecedor: FornecedorResumo;
  objeto: string;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  diasRestantes: number;
  semaforo: Semaforo;
  situacao: SituacaoInstrumento;
  valorGlobal: Centavos; // valor atual (inicial + aditivos)
  valorEmpenhado: Centavos;
  valorPago: Centavos;
  percentualExecutado: number;
  pendenciasAbertas: number;
  gestor: UsuarioResumo | null;
  ataOrigem: { id: Id; numero: string } | null;
}
/** GET /contratos?busca&situacao&uasg&gestor&semAta(true)&pagina... → Pagina<ContratoResumo> */
export interface FiltroContratos extends ParametrosLista {
  situacao?: SituacaoInstrumento;
  uasg?: string;
  gestor?: 'eu' | 'todos';
  semAta?: boolean;
}

/** GET /contratos/:id */
export interface ContratoDetalhe extends ContratoResumo {
  processoSei: string;
  origem: 'licitacao' | 'contratacao_direta';
  modalidade: string;
  assinaturaEm: DataISO;
  divulgacaoPncpEm: DataISO | null;
  divulgacaoPncp: {
    situacao: 'divulgado_no_prazo' | 'divulgado_fora_do_prazo' | 'pendente_no_prazo' | 'pendente_vencido';
    limite: DataISO;
    explicacao: string;
  };
  valorInicial: Centavos;
  acrescimos: Centavos;
  supressoes: Centavos;
  fiscal: UsuarioResumo | null;
  idPncp: string | null;
  linkPncp: string | null;
  garantia: { tipo: string; valor: Centavos; validaAte: DataISO } | null;
  queimaSaldo: {
    percentualExecutado: number;
    percentualTempoDecorrido: number;
    dataEsgotamentoProjetada: DataISO | null;
    esgotaAntesDoFim: boolean;
    sinal: 'normal' | 'acelerado' | 'lento';
    explicacao: string;
  };
  linhaDoTempo: EventoLinhaDoTempo[];
  proveniencia: Proveniencia;
}

export interface ItemContrato {
  id: Id;
  numero: number;
  descricao: string;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: Centavos;
  valorTotal: Centavos;
  quantidadeEmpenhada: number;
  quantidadeRecebida: number;
}
// GET /contratos/:id/itens → ItemContrato[]
// GET /contratos/:id/empenhos → Empenho[]
// GET /contratos/:id/pagamentos → Pagamento[]
// GET /contratos/:id/tarefas → Tarefa[]
// GET /contratos/:id/historico → EventoHistorico[]
// GET /contratos/:id/aditivos → Aditivo[]

export interface Aditivo {
  id: Id;
  numero: string; // "1º Termo Aditivo"
  tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste';
  valor: Centavos;
  novaVigenciaFim: DataISO | null;
  assinadoEm: DataISO;
  justificativa: string;
}

/** POST /contratos/:id/aditivos/simular  (somente leitura; aplica art. 125 via @agora/dominio) */
export interface EntradaSimularAditivo {
  tipo: 'acrescimo' | 'supressao';
  valor: Centavos;
  reformaEdificioOuEquipamento?: boolean;
}
export interface ResultadoSimulacaoAditivo {
  percentualAcumulado: number;
  limitePercentual: number;
  permitido: boolean;
  margemRestante: Centavos;
  explicacao: string;
  fundamento: string;
  /** RN-09: consulta de regularidade antes de prorrogar/assinar */
  regularidadeFornecedor: { regular: boolean; motivos: string[] };
}

// ───────────────────────── Tarefas (plano de gestão) ─────────────────────────

export interface Tarefa {
  id: Id;
  titulo: string;
  macrotarefa: string; // agrupador ("Assinatura", "Fiscalização mensal"...)
  prazo: DataISO | null;
  situacao: 'pendente' | 'concluida' | 'atrasada';
  responsavel: UsuarioResumo | null;
  concluidaEm: InstanteISO | null;
}
/** PATCH /tarefas/:id  body → Tarefa */
export interface EntradaAtualizarTarefa {
  situacao: 'pendente' | 'concluida';
}

export interface EventoHistorico {
  id: Id;
  ocorridoEm: InstanteISO;
  usuario: UsuarioResumo | null; // null = sistema/integração
  acao: string; // texto pt-BR: "Resolveu pendência de saldo"
  detalhes: string | null;
}

// ───────────────────────── Itens (carteira) ─────────────────────────

export interface ItemCarteira {
  id: Id;
  ata: { id: Id; numero: string };
  numero: number;
  descricao: string;
  uasg: string;
  fornecedor: string;
  valorUnitario: Centavos;
  quantidadeRegistrada: number;
  quantidadeContratada: number;
  quantidadeEmpenhada: number;
  percentualConsumido: number;
  alocado: boolean;
  empenhado: boolean;
}
/** GET /itens?busca&uasg&alocacao(alocado|nao_alocado)&empenho(empenhado|nao_empenhado)&pagina... → Pagina<ItemCarteira>
 *  GET /itens/exportar.csv?mesmos filtros → text/csv; charset=utf-8 (com BOM, separador ';') */
export interface FiltroItens extends ParametrosLista {
  uasg?: string;
  alocacao?: 'alocado' | 'nao_alocado';
  empenho?: 'empenhado' | 'nao_empenhado';
}

// ───────────────────────── Financeiro ─────────────────────────

export interface Empenho {
  id: Id;
  numero: string; // "2026NE000123"
  uasg: string;
  credor: { documento: string; nome: string }; // documento mascarado se PF
  contrato: { id: Id; numero: string } | null;
  emissaoEm: DataISO;
  ano: number;
  naturezaDespesa: string; // "339030"
  valorEmpenhado: Centavos;
  valorLiquidado: Centavos;
  valorPago: Centavos;
  saldo: Centavos;
  restosAPagar: boolean;
}
/** GET /empenhos?busca&saldo(com|sem)&restosAPagar(true|false)&ano&uasg&pagina... → Pagina<Empenho> & { totais } */
export interface FiltroEmpenhos extends ParametrosLista {
  saldo?: 'com' | 'sem';
  restosAPagar?: boolean;
  ano?: number;
  uasg?: string;
}
export interface PaginaEmpenhos extends Pagina<Empenho> {
  totais: { empenhado: Centavos; liquidado: Centavos; pago: Centavos; saldo: Centavos };
  proveniencia: Proveniencia;
}

export type SituacaoPagamento = 'previsto' | 'atestado' | 'liquidado' | 'pago' | 'atrasado';
export interface Pagamento {
  id: Id;
  contrato: { id: Id; numero: string };
  fornecedor: string;
  notaFiscal: string;
  competencia: string; // "2026-10"
  valor: Centavos;
  vencimento: DataISO;
  pagoEm: DataISO | null;
  situacao: SituacaoPagamento;
  /** Posição na ordem cronológica de pagamentos por fonte de recurso (art. 141). null se pago. */
  posicaoOrdemCronologica: number | null;
  atestadoPor: UsuarioResumo | null;
}
/** GET /pagamentos?busca&situacao&uasg&pagina... → Pagina<Pagamento>
 *  POST /pagamentos/:id/atestar → Pagamento (permissão pagamentos:atestar; só de 'previsto' para 'atestado') */
export interface FiltroPagamentos extends ParametrosLista {
  situacao?: SituacaoPagamento;
  uasg?: string;
}

/** GET /pagamentos/previsao?ano=2026 */
export interface PrevisaoPagamentos {
  ano: number;
  meses: { mes: string /* "2026-01" */; previsto: Centavos; realizado: Centavos }[];
  porContrato: { contrato: { id: Id; numero: string }; fornecedor: string; previstoAno: Centavos; realizadoAno: Centavos }[];
}

// ───────────────────────── Vínculos ─────────────────────────

export interface SugestaoVinculoContratoAta {
  contrato: { id: Id; numero: string; objeto: string; fornecedor: string };
  ataSugerida: { id: Id; numero: string; objeto: string } | null;
  confianca: 'alta' | 'media' | 'baixa' | null;
  motivo: string;
}
export interface EmpenhoSemContrato {
  empenho: Empenho;
  contratoSugerido: { id: Id; numero: string } | null;
  motivo: string;
}
export interface EmpenhoSemItem {
  empenho: Empenho;
  contrato: { id: Id; numero: string };
  itensCandidatos: { id: Id; numero: number; descricao: string }[];
}
// GET /vinculos/contratos-sem-ata → SugestaoVinculoContratoAta[]
// GET /vinculos/empenhos-sem-contrato → EmpenhoSemContrato[]
// GET /vinculos/empenhos-sem-item → EmpenhoSemItem[]
// POST /vinculos/contrato-ata { contratoId, ataId } → 204 ; DELETE /vinculos/contrato-ata/:contratoId → 204
// POST /vinculos/empenho-contrato { empenhoId, contratoId } → 204 ; DELETE /vinculos/empenho-contrato/:empenhoId → 204
// POST /vinculos/empenho-item { empenhoId, itemContratoId } → 204
export interface EntradaVinculoContratoAta { contratoId: Id; ataId: Id }
export interface EntradaVinculoEmpenhoContrato { empenhoId: Id; contratoId: Id }
export interface EntradaVinculoEmpenhoItem { empenhoId: Id; itemContratoId: Id }

// ───────────────────────── Ajustes ─────────────────────────

export interface ModeloGestao {
  id: Id;
  tipo: 'ata' | 'contrato';
  nome: string;
  evento: 'assinatura' | 'inicio_vigencia' | 'mensal' | 'reajuste' | 'fim_vigencia';
  ativo: boolean;
  tarefas: { titulo: string; macrotarefa: string; diasRelativos: number; papelResponsavel: 'gestor' | 'fiscal' | 'financeiro' }[];
}
// GET /modelos-gestao?tipo= → ModeloGestao[] ; POST /modelos-gestao body Omit<ModeloGestao,'id'> → ModeloGestao ; PUT /modelos-gestao/:id → ModeloGestao

export interface UnidadeInterna {
  id: Id;
  sigla: string;
  nome: string;
  ativa: boolean;
  usuarios: number;
}
// GET /unidades-internas ; POST /unidades-internas { sigla, nome } ; PUT /unidades-internas/:id { sigla, nome, ativa }

export interface GrupoUasg {
  id: Id;
  nome: string; // ex.: "GTI Segurança Pública — Região Norte"
  uasgs: Uasg[];
  situacao: 'confirmado' | 'pendente_confirmacao';
}
// GET /grupos-uasg ; POST /grupos-uasg/:id/confirmar → GrupoUasg

export interface Feriado {
  data: DataISO;
  nome: string;
  tipo: 'feriado' | 'ponto_facultativo' | 'local';
}
// GET /feriados?ano= → Feriado[] (nacionais calculados + locais cadastrados) ; POST /feriados { data, nome } (tipo local)

// ───────────────────────── Administração ─────────────────────────

export interface UsuarioAdmin {
  id: Id;
  nome: string;
  email: string; // mascarado para quem não tem lgpd:revelar
  cpf: string; // sempre mascarado
  perfis: CodigoPerfil[];
  uasgs: string[];
  unidadeInterna: { id: Id; sigla: string } | null;
  ativo: boolean;
  ultimoAcessoEm: InstanteISO | null;
}
// GET /usuarios → Pagina<UsuarioAdmin> ; POST /usuarios EntradaUsuario → UsuarioAdmin ; PATCH /usuarios/:id Partial<EntradaUsuario & {ativo:boolean}> → UsuarioAdmin
export interface EntradaUsuario {
  nome: string;
  email: string;
  cpf: string;
  perfis: CodigoPerfil[];
  uasgs: string[];
  unidadeInternaId: Id | null;
}

export interface PerfilAcesso {
  codigo: CodigoPerfil;
  nome: string;
  descricao: string;
  permissoes: Permissao[];
}
// GET /perfis → PerfilAcesso[]

// ───────────────────────── Auditoria, LGPD, integrações ─────────────────────────

export interface EventoAuditoria {
  id: Id;
  sequencia: number;
  ocorridoEm: InstanteISO;
  usuario: UsuarioResumo | null;
  acao: string; // código: 'pendencia.resolver', 'sessao.entrar', 'lgpd.revelar'...
  recurso: string; // 'pendencia', 'contrato'...
  recursoId: string | null;
  resumo: string; // pt-BR
  hash: string; // hex sha-256
  hashAnterior: string;
}
// GET /auditoria?busca&acao&recurso&usuario&de&ate&pagina... → Pagina<EventoAuditoria>
/** GET /auditoria/verificacao */
export interface VerificacaoAuditoria {
  integra: boolean;
  eventosVerificados: number;
  primeiraFalha: { sequencia: number; motivo: string } | null;
  verificadoEm: InstanteISO;
}

/** POST /lgpd/revelar (permissão lgpd:revelar; registra acesso) */
export interface EntradaRevelar {
  recurso: 'fornecedor' | 'usuario' | 'credor_empenho';
  id: Id;
  campo: 'documento' | 'email' | 'telefone';
  finalidade: string; // 10..300 caracteres, obrigatória
}
export interface RespostaRevelar {
  valor: string;
  registroAcessoId: Id;
}
export interface RegistroAcessoDadoPessoal {
  id: Id;
  ocorridoEm: InstanteISO;
  usuario: UsuarioResumo;
  recurso: string;
  recursoId: Id;
  campo: string;
  finalidade: string;
}
// GET /lgpd/acessos → Pagina<RegistroAcessoDadoPessoal> (permissão lgpd:relatorio)

export interface Sincronizacao {
  fonte: FonteDados;
  conjunto: string; // "Contratos", "Empenhos", "Atas", "Pregões homologados"
  modo: 'offline' | 'online';
  ultimaExecucaoEm: InstanteISO | null;
  ultimoSucessoEm: InstanteISO | null;
  situacao: 'ok' | 'executando' | 'falhou' | 'nunca_executado';
  registrosProcessados: number;
  mensagem: string | null;
  hashConteudo: string | null;
}
// GET /sincronizacoes → Sincronizacao[] ; POST /sincronizacoes/:fonte/executar → Sincronizacao (integracoes:executar)

// ───────────────────────── Fornecedores e sanções ─────────────────────────

export interface FornecedorDetalhe extends FornecedorResumo {
  idcDetalhe: {
    nota: number;
    faixa: FaixaIdc;
    semHistorico: boolean;
    componentes: { nome: string; valor: number; peso: number; contribuicao: number }[];
    penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[];
    metodologia: string;
    fundamento: string;
    aviso: string;
  };
  contratos: ContratoResumo[];
  sancoes: Sancao[];
  regularidade: { regular: boolean; consultadoEm: InstanteISO; fontes: string[]; motivos: string[] };
}
// GET /fornecedores?busca&faixa&comSancao → Pagina<FornecedorResumo> ; GET /fornecedores/:id → FornecedorDetalhe

export type TipoSancao = 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';
export interface Sancao {
  id: Id;
  fornecedor: { id: Id; razaoSocial: string; documento: string };
  contrato: { id: Id; numero: string } | null;
  incisoInfracao: string; // "VII"
  tipo: TipoSancao;
  situacao: 'em_instrucao' | 'defesa' | 'decisao' | 'aplicada' | 'arquivada';
  valorMulta: Centavos | null;
  inicioVigencia: DataISO | null;
  fimVigencia: DataISO | null;
  prazoDefesa: DataISO | null;
  prazoRegistroCeisCnep: DataISO | null;
  registradaCeisCnep: boolean;
  instauradaEm: DataISO;
}
// GET /sancoes?situacao&tipo → Pagina<Sancao>
// POST /sancoes EntradaInstaurarSancao → Sancao (sancoes:instruir)
export interface EntradaInstaurarSancao {
  fornecedorId: Id;
  contratoId: Id | null;
  incisoInfracao: string;
  tipo: TipoSancao;
  intimacaoEm: DataISO;
  relato: string;
}
/** POST /sancoes/dosimetria/simular (somente leitura) */
export interface EntradaDosimetria {
  valorContrato: Centavos;
  gravidade: 'leve' | 'media' | 'grave' | 'gravissima';
  agravantes: string[];
  atenuantes: string[];
  programaIntegridade: boolean;
  danoAdministracao: boolean;
}
export interface ResultadoDosimetria {
  percentualCalculado: number;
  percentualAplicado: number;
  valorMulta: Centavos;
  limitado: 'minimo' | 'maximo' | null;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
}

/** POST /sancoes/moratoria/simular (somente leitura; art. 162). Parâmetros da cláusula de multa moratória do contrato. */
export interface EntradaMultaMoratoria {
  valorParcela: Centavos;
  diasAtraso: number;
  percentualDia: number; // ex.: 0.5 (% ao dia)
  limiteDias: number; // teto de dias de incidência previsto no contrato
}
export interface ResultadoMultaMoratoria {
  diasConsiderados: number;
  percentualAplicado: number;
  valorMulta: Centavos;
  limitado: boolean;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
}

// ───────────────────────── Jornada da contratação (7 etapas) ─────────────────────────

export type OrgaoRequisitante = 'PF' | 'PRF' | 'SENASP' | 'SENAPPEN' | 'MJSP';
export type EtapaJornada = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ETAPAS_JORNADA: readonly { etapa: EtapaJornada; titulo: string }[] = [
  { etapa: 1, titulo: 'Demanda e PCA' },
  { etapa: 2, titulo: 'Instrução no SEI e equipe' },
  { etapa: 3, titulo: 'ETP, riscos e preços' },
  { etapa: 4, titulo: 'TR, edital e minuta' },
  { etapa: 5, titulo: 'Controle jurídico e publicação' },
  { etapa: 6, titulo: 'Seleção do fornecedor' },
  { etapa: 7, titulo: 'Contrato e gestão' },
];

export interface ProcessoResumo {
  id: Id;
  numeroSei: string; // "08000.014589/2026-11" (sintético)
  titulo: string;
  orgao: OrgaoRequisitante;
  etapaAtual: EtapaJornada;
  valorEstimado: Centavos | null;
  modalidadePrevista: string | null;
  bloqueios: number; // regras impedindo o avanço
  atualizadoEm: InstanteISO;
  responsavel: UsuarioResumo | null;
}
// GET /processos?orgao&etapa&busca → Pagina<ProcessoResumo>
// GET /processos/designaveis (jornada:ler) → UsuarioDesignavel[] — servidores ativos no escopo de UASG do usuário, para a designação da equipe
// POST /processos EntradaNovoProcesso → ProcessoDetalhe
export interface UsuarioDesignavel {
  id: Id;
  nome: string;
  perfis: CodigoPerfil[];
  unidadeInterna: string | null; // sigla
}

export type CriterioJulgamentoEdital = 'menor_preco' | 'maior_desconto' | 'tecnica_preco' | 'melhor_tecnica' | 'maior_lance' | 'maior_retorno_economico';
/**
 * PUT /processos/:id/parametros-edital body ParametrosEdital → ProcessoDetalhe (jornada:editar; só na etapa 4).
 * TR, edital e minuta gerados com os parâmetros anteriores ficam `geradoComParametrosAnteriores` (sinal e bloqueio RN-06).
 */
export interface ParametrosEdital {
  criterioJulgamento: CriterioJulgamentoEdital;
  regimeExecucao: 'integrada' | 'semi_integrada' | 'outro';
  exigeFaturamentoMinimo: boolean; // vedado (art. 69, § 2º) → bloqueio RN-06
  patrimonioLiquidoMinimoPercentual: number | null; // máximo 10% do valor estimado (art. 69, § 4º) → bloqueio RN-06 acima disso
  exigeRegistroCadastralComplementar: boolean; // vedado para acesso ao edital (art. 87, § 2º) → bloqueio RN-06/RN-07
  /** Prova de conceito ou amostra do licitante provisoriamente vencedor (RN-20). No PUT, ausente = não exigida; o GET sempre devolve. */
  provaConceito?: ProvaConceitoEdital;
  /** Inversão de fases (art. 17, § 1º; RN-22). No PUT, ausente = não adotada; o GET sempre devolve. */
  inversaoFases?: InversaoFasesEdital;
}
export interface EntradaNovoProcesso {
  titulo: string;
  orgao: OrgaoRequisitante;
}

export interface ItemDemanda {
  catmat: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitarioEstimado: Centavos;
}

export interface Bloqueio {
  regra: string; // "RN-04"
  mensagem: string;
  fundamento: string;
  etapa: EtapaJornada;
}

export interface Sinal {
  regra: string; // "RIA-01", "RN-01", "RN-14"
  nivel: 'informativo' | 'atencao' | 'risco';
  mensagem: string;
  fundamento: string;
}

export interface DocumentoGerado {
  id: Id;
  tipo: 'dfd' | 'etp' | 'matriz_riscos' | 'nota_tecnica_precos' | 'tr' | 'edital' | 'minuta_contrato' | 'parecer_checklist';
  titulo: string;
  versao: number;
  conteudo: string; // Markdown
  geradoPor: 'modelo' | 'ia';
  premissas: string[];
  fontes: string[];
  situacao: 'rascunho' | 'revisado' | 'aprovado';
  revisadoPor: UsuarioResumo | null;
  geradoEm: InstanteISO;
  numeroSei: string | null; // número do documento na árvore SEI (simulado)
  /**
   * TR, edital ou minuta gerado com parâmetros do edital diferentes dos atuais (RN-06): não conta como aprovado
   * no avanço à etapa 5 — gere de novo e aprove. Sempre `false` para os demais documentos.
   */
  geradoComParametrosAnteriores: boolean;
}

/**
 * Licitante da disputa (etapa 6). `id` é o fornecedor do cadastro (GET /fornecedores); nome e porte (ME/EPP)
 * vêm do cadastro no momento do registro. Critérios de desempate do art. 60 com `null` = não informados.
 */
export interface LicitanteDisputa {
  id: Id;
  nome: string;
  valorProposta: Centavos;
  meEpp: boolean;
  /** art. 60, II — 0 a 100. */
  notaDesempenhoPrevio: number | null;
  /** art. 60, I — lance na disputa final entre os empatados. */
  lanceDisputaFinal: Centavos | null;
  /** art. 60, III. */
  acoesEquidadeGenero: boolean | null;
  /** art. 60, IV. */
  programaIntegridade: boolean | null;
  /** art. 60, § 1º, II. */
  empresaBrasileira: boolean | null;
  /** art. 60, § 1º, III. */
  investePesquisaDesenvolvimentoNoPais: boolean | null;
  /** art. 60, § 1º, IV. */
  praticaMitigacaoClimatica: boolean | null;
}
/** Licitante no corpo de PUT /processos/:id/disputa: nome e porte são lidos do cadastro pelo servidor. */
export type EntradaLicitanteDisputa = Omit<LicitanteDisputa, 'nome' | 'meEpp'>;
export interface EntradaDisputa {
  licitantes: EntradaLicitanteDisputa[];
}

/** GET /processos/:id */
export interface ProcessoDetalhe extends ProcessoResumo {
  dfd: {
    descricaoNecessidade: string;
    justificativa: string;
    itens: ItemDemanda[];
    usaCatalogoPadronizado: boolean;
    justificativaNaoPadronizacao: string | null;
    justificativaArtigoLuxo: string | null;
    previstoNoPca: boolean;
    tipoObjeto: 'bens' | 'servicos_comuns' | 'servicos_especiais' | 'obras_servicos_engenharia_comuns' | 'obras_servicos_engenharia_especiais';
  };
  equipe: { papel: string; usuario: UsuarioResumo }[];
  arvoreSei: { numero: string; titulo: string; assinado: boolean; assinadoPor: string | null; assinadoEm: InstanteISO | null }[];
  /** Parâmetros do edital usados no RN-06 (art. 69) e no prazo mínimo de propostas (art. 55). */
  parametrosEdital: ParametrosEdital;
  etp: Record<string, { texto?: string; justificativaAusencia?: string }>;
  riscos: { id: Id; descricao: string; probabilidade: 1 | 2 | 3 | 4 | 5; impacto: 1 | 2 | 3 | 4 | 5; alocacao: 'contratante' | 'contratada' | 'compartilhado'; mitigacao: string }[];
  cestaPrecos: {
    cotacoes: { id: Id; fonte: string; descricaoFonte: string; valorUnitario: Centavos; dataCotacao: DataISO; justificativaEscolhaFornecedor?: string; expurgada: boolean; motivoExpurgo: string | null }[];
    orcamentoSigiloso: boolean;
    motivoSigilo: string | null;
    analise: unknown | null; // retorno de analisarCestaPrecos (@agora/dominio)
  };
  documentos: DocumentoGerado[];
  parecer: { itens: { id: string; texto: string; atendido: boolean | null; observacao: string | null }[]; conclusao: 'favoravel' | 'favoravel_com_ressalvas' | 'desfavoravel' | null; parecerista: UsuarioResumo | null };
  publicacao: { pncp: 'nao_publicado' | 'na_fila' | 'publicado'; dou: 'nao_publicado' | 'na_fila' | 'publicado'; publicadoEm: DataISO | null; dataMinimaPropostas: DataISO | null; idPncp: string | null };
  disputa: { licitantes: LicitanteDisputa[]; resultado: unknown | null /* retorno de aplicarDesempate */ };
  contratoGerado: { id: Id; numero: string } | null;
  bloqueiosDetalhe: Bloqueio[];
  sinais: Sinal[];
  /** Atos da seleção (etapa 6): prova de conceito, habilitação, fase recursal, adjudicação e homologação. */
  selecao: SelecaoProcesso;
  /** Critérios de sustentabilidade do ETP e do TR e a política do órgão (RN-21). */
  sustentabilidade: SustentabilidadeProcesso;
}
// PUT /processos/:id/dfd        body ProcessoDetalhe['dfd']             → ProcessoDetalhe
// PUT /processos/:id/equipe     body { designacoes: {papel, usuarioId}[] } → ProcessoDetalhe (422 com conflitos se RN-03 violar)
// POST /processos/:id/sei/assinar body { documentoNumero } → ProcessoDetalhe (simulação de assinatura; ICP-Brasil real exige integração)
// PUT /processos/:id/etp        body ProcessoDetalhe['etp']             → ProcessoDetalhe
// PUT /processos/:id/riscos     body { riscos }                        → ProcessoDetalhe
// PUT /processos/:id/cesta-precos body { cotacoes, orcamentoSigiloso, motivoSigilo } → ProcessoDetalhe
// POST /processos/:id/cesta-precos/expurgos body { aceitar: Id[], justificativa } → ProcessoDetalhe
// POST /processos/:id/documentos/gerar body { tipo } → ProcessoDetalhe (rascunho por modelo; IA só se habilitada)
// POST /processos/:id/documentos/:docId/aprovar → ProcessoDetalhe
// PUT /processos/:id/parecer    body ProcessoDetalhe['parecer'] sem parecerista → ProcessoDetalhe (jornada:aprovar_juridico; 409 CONFLITO com a publicação na fila ou feita)
// POST /processos/:id/publicar  → ProcessoDetalhe (jornada:publicar; fila offline PNCP/DOU)
// PUT /processos/:id/disputa    body EntradaDisputa → ProcessoDetalhe (fornecedores do cadastro; calcula o desempate)
// POST /processos/:id/avancar   → ProcessoDetalhe (422 RespostaErro com codigo 'REGRA_NEGOCIO' e detalhes = bloqueios)
// POST /processos/:id/contratar → ProcessoDetalhe (RN-09; cria contrato na carteira)

/** Importação da cesta de preços por planilha (RF-16). O texto é lido e validado no servidor; o navegador só envia o conteúdo. */
export interface EntradaImportacaoCesta {
  conteudo: string; // CSV (separado por ponto e vírgula, vírgula ou tabulação) ou linhas coladas de uma planilha
  modo: 'acrescentar' | 'substituir';
}
export interface LinhaImportacaoCesta {
  linha: number; // linha da planilha, contando o cabeçalho
  fonte: 'painel_precos' | 'contratacao_similar' | 'midia_especializada' | 'fornecedor_direto' | 'nota_fiscal' | null;
  descricaoFonte: string;
  valorUnitario: Centavos | null;
  dataCotacao: DataISO | null;
  justificativaEscolhaFornecedor: string | null;
  erros: string[]; // vazio = linha válida
}
export interface PreviaImportacaoCesta {
  linhas: LinhaImportacaoCesta[];
  validas: number;
  comErro: number;
  cabecalhoReconhecido: boolean; // false = colunas lidas na ordem do modelo
  errosGerais: string[]; // problemas da planilha inteira (vazia, colunas obrigatórias ausentes, limite de linhas)
  totalAposImportacao: number; // cotações na cesta depois da importação (limite de 50)
}
// POST /processos/:id/cesta-precos/importacao/previa  body EntradaImportacaoCesta → PreviaImportacaoCesta (nada é gravado)
// POST /processos/:id/cesta-precos/importacao         body EntradaImportacaoCesta → ProcessoDetalhe (422 se houver erro)
// GET  /cesta-precos/modelo.csv → modelo de planilha com as colunas aceitas

// ───────────────────────── Transparência (sem login) ─────────────────────────

export interface ContratoPublico {
  id: Id;
  numero: string;
  orgao: string;
  uasg: string;
  fornecedor: string; // PJ: razão social e CNPJ; PF: nome mascarado
  documentoFornecedor: string;
  objeto: string;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  valorGlobal: Centavos;
  valorPago: Centavos;
  linkPncp: string | null;
  /** Contrato sigiloso (art. 91, § 1º): só o registro mínimo é divulgado; fornecedor, objeto e valores ficam ocultos (valores zerados). */
  sigilo?: SigiloContratoPublico;
}
// GET /publico/contratos?busca&pagina → Pagina<ContratoPublico> ; GET /publico/contratos/:id → ContratoPublico

/** Edital publicado (art. 25, § 3º, e art. 54): inteiro teor do edital e dos anexos, sem cadastro nem login. */
export interface DocumentoEditalPublico {
  tipo: 'edital' | 'tr' | 'minuta_contrato';
  titulo: string;
  versao: number;
  url: string; // PDF gerado no servidor, com dados pessoais tarjados (RIA-05)
}
export interface EditalPublico {
  id: Id;
  numeroSei: string;
  objeto: string;
  orgaoRequisitante: string;
  modalidade: string | null;
  publicadoEm: DataISO;
  dataMinimaPropostas: DataISO | null;
  idPncp: string | null;
  linkPncp: string | null; // só quando a publicação foi feita no PNCP real
  documentos: DocumentoEditalPublico[];
  /** Data da homologação (art. 71, IV); `null` antes dela. */
  homologadoEm: DataISO | null;
  /** Documentos da fase preparatória divulgados após a homologação (art. 54, § 3º; RF-18). Vazio antes dela. */
  documentosPreparatorios: DocumentoPreparatorioPublico[];
  /** Sigilo de segurança pública (RN-40): registro mínimo, documentos retidos e orçamento sigiloso (art. 24). */
  sigilo?: SigiloEditalPublico;
}
// GET /publico/editais?busca&pagina → Pagina<EditalPublico> ; GET /publico/editais/:id → EditalPublico
// GET /publico/editais/:id/documentos/:tipo → application/pdf (inteiro teor, sem login)
// GET /publico/catalogo-regras → regras do @agora/dominio (Caderno de Regras)

// ───────────────────────── Saúde ─────────────────────────
// GET /saude/vivo → { situacao: 'ok' }   GET /saude/pronto → { situacao: 'ok' | 'indisponivel', banco: boolean, versao: string }

// ───────────────────────── Pesquisa de preços automatizada (RF-25) e projeção (RIA-11) ─────────────────────────

/** Fontes consultadas pelo servidor. O navegador nunca chama essas APIs. */
export type FontePesquisaPrecos = 'PAINEL_PRECOS' | 'CONTRATACOES_SIMILARES' | 'NOTAS_FISCAIS' | 'SINAPI' | 'SICRO';
export type SituacaoFontePesquisa = 'ok' | 'sem_resultado' | 'falhou' | 'dependente_de_acesso' | 'nao_aplicavel';

/** Proveniência de cada fonte numa consulta: modo, horário, quantidade e hash do conteúdo recebido. */
export interface ResultadoFontePesquisa {
  fonte: FontePesquisaPrecos;
  nome: string;
  situacao: SituacaoFontePesquisa;
  /** 'offline' = simulação determinística; 'online' = API oficial; 'local' = tabela oficial importada no servidor. */
  modo: 'offline' | 'online' | 'local';
  registros: number;
  mensagem: string;
  hashConteudo: string | null;
  consultadoEm: InstanteISO;
  /** Endereço consultado, sem chaves de acesso. */
  endereco: string | null;
}

export interface SugestaoPreco {
  id: Id;
  fonte: FontePesquisaPrecos;
  /** Parâmetro da cesta (art. 23, § 1º) em que a sugestão entra. */
  fonteCotacao: 'painel_precos' | 'contratacao_similar' | 'midia_especializada' | 'fornecedor_direto' | 'nota_fiscal';
  inciso: string; // "art. 23, § 1º, I"
  fundamento: string;
  identificador: string;
  descricao: string;
  descricaoFonte: string; // texto gravado na cotação
  local: string | null;
  unidade: string | null;
  valorUnitario: Centavos;
  data: DataISO;
  /** Id da cotação criada na cesta, quando o agente incluiu a sugestão. */
  cotacaoId: Id | null;
  incluidaEm: InstanteISO | null;
}

export interface ItemReferenciaPesquisa {
  numero: number;
  descricao: string;
  catmat: string | null;
  unidade: string;
}

export interface ConsultaPrecos {
  id: Id;
  item: ItemReferenciaPesquisa;
  termo: string;
  uf: string;
  modo: 'offline' | 'online';
  executadaEm: InstanteISO;
  executadaPor: string | null; // nome do usuário
  fontes: ResultadoFontePesquisa[];
  sugestoes: SugestaoPreco[];
  descartadas: { fonte: FontePesquisaPrecos; identificador: string; motivo: string }[];
  excedentes: number;
  alertas: { codigo: string; mensagem: string; fundamento: string }[];
  aviso: string;
}

/** Série oficial usada na projeção, com a proveniência da consulta. */
export interface SerieIndiceProjecao {
  serie: 'IPCA' | 'CAMBIO_USD';
  nome: string;
  fonte: string; // "IBGE — SIDRA, tabela 1737, variável 63"
  modo: 'offline' | 'online';
  competencias: { competencia: string; valor: number }[];
  consultadoEm: InstanteISO;
  hashConteudo: string;
}

export interface ProjecaoValorEstimado {
  id: Id;
  dataBase: DataISO;
  dataPrevista: DataISO;
  percentualCambial: number;
  /** Valor estimado do processo (item de referência pela cesta; demais itens pela estimativa do DFD). */
  valorBase: Centavos;
  valorProjetado: Centavos;
  faixa: { minimo: Centavos; maximo: Centavos };
  /** Valor unitário da cesta projetado pelo mesmo fator (null sem análise da cesta). */
  valorUnitarioBase: Centavos | null;
  valorUnitarioProjetado: Centavos | null;
  variacaoPercentual: number;
  meses: number;
  inflacao: { taxaMensalMedia: number; desvioMensal: number; competencias: number; periodo: string; acumuladoPeriodo: number };
  cambio: { participacao: number; taxaMensalMedia: number; desvioMensal: number; competencias: number; periodo: string; ultimaCotacao: number } | null;
  sinal: { nivel: 'informativo' | 'atencao'; mensagem: string };
  premissas: string[];
  memoriaCalculo: string[];
  fontes: SerieIndiceProjecao[];
  fundamento: string;
  aviso: string; // inclui "Requer revisão humana"
  geradaEm: InstanteISO;
  geradaPor: string | null;
}

export interface TabelaReferenciaEngenharia {
  sistema: 'SINAPI' | 'SICRO';
  uf: string;
  dataBase: string; // AAAA-MM
  desonerado: boolean;
  itens: number;
  importadaEm: InstanteISO;
  hashConteudo: string;
}

export interface PesquisaPrecosProcesso {
  modo: 'offline' | 'online';
  itemReferencia: ItemReferenciaPesquisa | null;
  termoSugerido: string;
  uf: string;
  engenharia: boolean;
  consultas: ConsultaPrecos[]; // mais recente primeiro (até 5)
  projecao: ProjecaoValorEstimado | null;
  tabelasEngenharia: TabelaReferenciaEngenharia[];
}

export interface EntradaConsultaPrecos {
  termo?: string; // padrão: palavras principais da descrição do item de referência
  catmat?: string | null; // padrão: CATMAT/CATSER do item de referência
}
export interface EntradaIncluirSugestoes {
  sugestoes: Id[];
}
export interface EntradaProjecaoValor {
  dataPrevista: DataISO;
  percentualCambial: number; // 0 a 100
}
export interface EntradaImportacaoReferencias {
  sistema: 'SINAPI' | 'SICRO';
  uf: string;
  dataBase: string; // AAAA-MM
  desonerado: boolean;
  conteudo: string; // CSV: codigo;descricao;unidade;preco
}
export interface ResultadoImportacaoReferencias {
  tabela: TabelaReferenciaEngenharia;
  substituidos: number;
}
// GET  /processos/:id/pesquisa-precos → PesquisaPrecosProcesso (jornada:ler)
// POST /processos/:id/pesquisa-precos/consultas body EntradaConsultaPrecos → ConsultaPrecos (jornada:editar; consulta as fontes no servidor)
// POST /processos/:id/pesquisa-precos/consultas/:consultaId/incluir body EntradaIncluirSugestoes → ProcessoDetalhe (jornada:editar)
// POST /processos/:id/pesquisa-precos/projecao body EntradaProjecaoValor → ProjecaoValorEstimado (jornada:editar; sinal, não altera o valor)
// GET  /pesquisa-precos/referencias-engenharia → TabelaReferenciaEngenharia[] (jornada:ler)
// POST /pesquisa-precos/referencias-engenharia/importacao body EntradaImportacaoReferencias → ResultadoImportacaoReferencias (integracoes:executar; 422 com erros por linha)
// ───────────────────────── Notificações (RF-26) e vencimentos 30/60/90/120 (RN-31) ─────────────────────────

export type TipoNotificacao = 'vencimento' | 'reajuste' | 'garantia' | 'pendencia' | 'ocorrencia';
export type CanalNotificacao = 'email' | 'sei' | 'govbr';
/** gestor, fiscal e responsável são servidores; a contratada é a parte externa do contrato. */
export type PapelDestinatario = 'gestor' | 'fiscal' | 'contratada' | 'responsavel';
export type SituacaoEnvio = 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'suprimido';
export type FaixaVencimento = 30 | 60 | 90 | 120;
/** smtp = servidor de e-mail do órgão; simulado = driver de demonstração (nada sai do servidor). */
export type ModoCanalNotificacao = 'simulado' | 'smtp' | 'desligado';

export interface EnvioNotificacao {
  id: Id;
  canal: CanalNotificacao;
  papel: PapelDestinatario;
  destinatario: string; // nome do servidor ou razão social da contratada
  endereco: string | null; // e-mail SEMPRE mascarado (canal email) ou número do processo SEI (canal sei); null no gov.br
  situacao: SituacaoEnvio;
  tentativas: number;
  maxTentativas: number;
  proximaTentativaEm: InstanteISO | null;
  ultimaTentativaEm: InstanteISO | null;
  enviadoEm: InstanteISO | null;
  modo: ModoCanalNotificacao | null; // driver que processou o envio
  protocolo: string | null; // Message-ID do e-mail, nº do documento SEI ou id da mensagem gov.br
  ultimoErro: string | null;
  motivoSupressao: string | null; // preferência do destinatário ou canal inaplicável
  baseLegal: string; // LGPD: base legal do tratamento do contato
  reenvioDe: Id | null;
  criadoEm: InstanteISO;
}

export interface ContagemEnvios {
  total: number;
  enviados: number;
  pendentes: number; // pendente ou enviando
  falhas: number;
  suprimidos: number;
}

export interface NotificacaoResumo {
  id: Id;
  tipo: TipoNotificacao;
  origem: 'automatica' | 'manual';
  instrumento: { tipo: 'ata' | 'contrato'; id: Id; identificador: string };
  uasg: string;
  faixa: FaixaVencimento | null;
  obrigatoria: boolean; // aviso legal obrigatório: ignora a preferência do destinatário
  assunto: string;
  criadaEm: InstanteISO;
  criadaPor: UsuarioResumo | null; // null = varredura automática
  contagem: ContagemEnvios;
}

export interface NotificacaoDetalhe extends NotificacaoResumo {
  corpo: string;
  fundamento: string;
  envios: EnvioNotificacao[];
}

export interface FiltroNotificacoes {
  tipo?: TipoNotificacao;
  origem?: 'automatica' | 'manual';
  situacao?: SituacaoEnvio; // ao menos um envio na situação
  faixa?: FaixaVencimento;
  minhas?: boolean; // destinadas ao usuário da sessão
  instrumentoTipo?: 'ata' | 'contrato';
  instrumentoId?: Id;
  busca?: string;
  pagina?: number;
  tamanhoPagina?: number;
}
// GET /notificacoes?FiltroNotificacoes → Pagina<NotificacaoResumo> (escopo de UASG) ; GET /notificacoes/:id → NotificacaoDetalhe

/** Disparo manual em um clique a partir do contrato ou da ata. */
export interface EntradaNotificacao {
  instrumentoTipo: 'ata' | 'contrato';
  instrumentoId: Id;
  tipo: TipoNotificacao;
  destinatarios: ('gestor' | 'fiscal' | 'contratada')[];
  canais: CanalNotificacao[];
  dataReferencia?: DataISO | null; // aniversário (reajuste), validade (garantia) ou prazo (pendência e ocorrência)
  detalhe?: string | null; // motivo da pendência ou relato da ocorrência
  complemento?: string | null; // até 2000 caracteres
}
// POST /notificacoes body EntradaNotificacao → 201 NotificacaoDetalhe (envios já processados uma vez)
// POST /notificacoes/envios/:id/reenviar → 201 NotificacaoDetalhe (novo envio ligado ao original)

export interface PreferenciaNotificacao {
  tipo: TipoNotificacao;
  canal: 'email' | 'govbr';
  ativo: boolean;
  padrao: boolean; // true = nunca alterada (vale o padrão: e-mail ligado, gov.br desligado)
  obrigatorios: string | null; // avisos desse tipo que saem mesmo com a preferência desligada
}
export interface EntradaPreferenciasNotificacao {
  preferencias: { tipo: TipoNotificacao; canal: 'email' | 'govbr'; ativo: boolean }[];
}
// GET /notificacoes/preferencias → PreferenciaNotificacao[] ; PUT /notificacoes/preferencias body EntradaPreferenciasNotificacao → PreferenciaNotificacao[]

export interface EstadoCanalNotificacao {
  canal: CanalNotificacao;
  modo: ModoCanalNotificacao;
  descricao: string;
}
export interface EstadoNotificacoes {
  canais: EstadoCanalNotificacao[];
  agendador: 'api' | 'externo';
  fila: { pendentes: number; falhas: number; enviadosHoje: number };
  ultimaVarredura: { data: DataISO; executadaEm: InstanteISO; notificacoesCriadas: number; enviosCriados: number } | null;
}
// GET /notificacoes/canais → EstadoNotificacoes

export interface ResultadoVarreduraNotificacoes {
  data: DataISO;
  executadaEm: InstanteISO;
  notificacoesCriadas: number;
  enviosCriados: number;
  enviosProcessados: number;
}
// POST /notificacoes/varredura → ResultadoVarreduraNotificacoes (idempotente: repetir no mesmo dia não duplica avisos)

export interface VencimentoLinhaTempo extends InstrumentoVencimento {
  faixa: FaixaVencimento;
}
export interface LinhaTempoVencimentos {
  hoje: DataISO;
  instrumentos: VencimentoLinhaTempo[]; // contratos e atas que vencem em 0 a 120 dias, por dias restantes
}
// GET /vencimentos?uasg → LinhaTempoVencimentos
// ───────────────────────── Sala de disputa (RF-22, RN-26, RIA-09) ─────────────────────────

/** Simulação (treino e prova de conceito) ou acompanhamento da sessão oficial, que acontece no Compras.gov.br. */
export type UsoSessaoDisputa = 'simulacao' | 'acompanhamento';
export type CriterioJulgamentoSessao = 'menor_preco' | 'maior_desconto' | 'tecnica_e_preco';
export type ModoDisputaSessao = 'aberto' | 'aberto_fechado' | 'fechado_aberto' | 'fechado';
export type FaseSessaoDisputa = 'aguardando_abertura' | 'lances_abertos' | 'fechamento_iminente' | 'lance_final_fechado' | 'encerrada' | 'concluida';
export type PerfilLicitanteSimulado = 'competitivo' | 'tardio' | 'robo' | 'combinado' | 'conservador';
export type CenarioSimulacaoDisputa = 'concorrencia' | 'conluio_e_robo';

/** Parâmetros do rito (IN SEGES/ME 73/2022; Lei 14.133/2021, arts. 36, § 2º, 56, § 4º, e 57). Tempos em segundos. */
export interface ParametrosSessaoDisputa {
  duracaoEtapaAbertaSegundos: number;
  janelaProrrogacaoSegundos: number;
  prorrogacaoSegundos: number;
  fechamentoIminenteMaximoSegundos: number;
  prazoLanceFechadoSegundos: number;
  faixaSelecaoPercentual: number;
  minimoSelecionados: number;
  diferencaReinicioPercentual: number;
  /** Centavos ou pontos percentuais (absoluto), ou percentual da oferta de referência. */
  intervaloMinimo: { tipo: 'absoluto' | 'percentual'; valor: number } | null;
  pesoTecnicoPercentual: number | null;
}

/**
 * Participante da sessão. `chave` ("L1", "L2"…) identifica o participante na sala. Enquanto a etapa de lances da
 * simulação não termina, a identidade fica oculta (IN SEGES/ME 73/2022, art. 21, § 6º): `fornecedorId`, `nome` e
 * `perfilSimulado` vêm nulos e `rotulo` é "Licitante N".
 */
export interface ParticipanteSessao {
  chave: string;
  rotulo: string;
  fornecedorId: Id | null;
  nome: string | null; // PF: nome mascarado
  meEpp: boolean | null;
  propostaInicial: number | null; // centavos ou % de desconto
  notaTecnica: number | null;
  perfilSimulado: PerfilLicitanteSimulado | null;
  ofertaAtual: number | null; // última oferta pública
  lances: number;
  lanceFinalRegistrado: boolean; // o valor do lance final e fechado fica sigiloso até o fim do prazo
  convocado: boolean; // participa da etapa de lances em curso
  lider: boolean;
}

export interface LanceSessao {
  sequencia: number;
  participante: string; // chave
  rotulo: string;
  valor: number; // centavos ou % de desconto
  instante: InstanteISO;
  fase: 'lances_abertos' | 'fechamento_iminente' | 'lance_final_fechado';
  rodada: number; // 0 = disputa original; 1… = reinício (art. 56, § 4º)
  intermediario: boolean;
  origem: 'simulador' | 'registrado' | 'transcrito';
}

/** Sinal para análise (RIA-09 padrão de lances; RIA-06 sócio em comum). Requer revisão humana; nunca desclassifica. */
export interface SinalSessaoDisputa {
  regra: 'RIA-09' | 'RIA-06';
  tipo: 'intervalos_regulares' | 'decrementos_identicos' | 'alternancia_combinada' | 'lances_iguais' | 'socio_em_comum';
  titulo: string;
  participantes: string[]; // chaves
  evidencias: string[];
  fundamento: string;
  aviso: string;
  reforcadoPorVinculo: boolean;
}

export interface MarcoSessao {
  instante: InstanteISO;
  descricao: string;
  fundamento: string;
}

export interface ClassificadoSessao {
  posicao: number;
  participante: string; // chave
  rotulo: string;
  valorOfertado: number;
  valorConsiderado: Centavos;
  origem: 'proposta' | 'lance' | 'lance_final' | 'negociacao' | 'resultado_oficial';
  notaTecnica: number | null;
  notaPreco: number | null;
  notaFinal: number | null;
}

/** Julgamento depois de encerrada a etapa de lances (classificação, desempate, reinício e negociação). */
export interface JulgamentoSessao {
  classificacao: ClassificadoSessao[];
  empateDetectado: boolean;
  criterioDecisivo: string | null;
  passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[];
  sorteioNecessario: boolean;
  acimaDoEstimado: boolean | null; // art. 59, III: sinal para o agente, não desclassifica
  memoria: string[];
  fundamento: string;
  reinicio: { cabivel: boolean; diferencaPercentual: number | null; motivo: string; fundamento: string };
}

/** Dados da compra e do resultado trazidos do Compras.gov.br pelo servidor, com proveniência. */
export interface DadosOficiaisSessao {
  fonte: 'COMPRAS_GOV';
  modo: 'offline' | 'online';
  consultadoEm: InstanteISO;
  hash: string; // SHA-256 do conteúdo recebido
  registros: number;
  endereco: string | null; // consulta feita pelo servidor (online)
  compra: {
    idCompra: string;
    numeroCompra: string | null;
    modalidade: string | null;
    modoDisputa: string | null;
    situacao: string | null;
    objeto: string | null;
    valorTotalEstimado: Centavos | null;
    valorTotalHomologado: Centavos | null;
    aberturaPropostas: InstanteISO | null;
    existeResultado: boolean;
  };
  resultados: { participante: string | null; documento: string; nome: string; valorTotalHomologado: Centavos; itens: number }[];
}

export interface AtaSessao {
  titulo: string;
  emitidaEm: InstanteISO;
  texto: string; // Markdown
  fontes: string[];
  premissas: string[];
  aviso: string; // "requer revisão humana"
  definitiva: boolean; // false = prévia (sessão não concluída)
}

export interface SessaoDisputa {
  id: Id;
  processoId: Id;
  numeroSei: string;
  processoTitulo: string;
  uso: UsoSessaoDisputa;
  criterio: CriterioJulgamentoSessao;
  modo: ModoDisputaSessao;
  parametros: ParametrosSessaoDisputa;
  fundamentosParametros: Record<string, string>;
  cenario: CenarioSimulacaoDisputa | null;
  idCompra: string | null;
  valorReferencia: Centavos | null;
  fase: FaseSessaoDisputa;
  rodada: number;
  /** Relógio da sessão (na simulação, com o adiantamento acumulado). */
  agora: InstanteISO;
  adiantamentoSegundos: number;
  abertaEm: InstanteISO | null;
  faseIniciadaEm: InstanteISO | null;
  fimPrevisto: InstanteISO | null; // nulo no fechamento iminente (sorteado e sigiloso)
  fimSigiloso: boolean;
  encerradaEm: InstanteISO | null;
  concluidaEm: InstanteISO | null;
  identidadesOcultas: boolean;
  participantes: ParticipanteSessao[];
  melhorOferta: number | null;
  lider: string | null; // chave
  lances: LanceSessao[];
  lancesSigilosos: number; // lances finais e fechados ainda não divulgados
  prorrogacoes: number;
  marcos: MarcoSessao[];
  sinais: SinalSessaoDisputa[];
  julgamento: JulgamentoSessao | null;
  oficial: DadosOficiaisSessao | null;
  conduzidaPor: string | null;
  criadaEm: InstanteISO;
  atualizadaEm: InstanteISO;
  /** Ações que o servidor aceita agora para quem tem `disputa:conduzir` no escopo da UASG. */
  acoes: {
    abrir: boolean;
    adiantarRelogio: boolean;
    registrarLance: boolean;
    transcreverLances: boolean;
    sincronizar: boolean;
    reiniciar: boolean;
    negociar: boolean;
    encerrar: boolean;
  };
}

export interface SessaoDisputaResumo {
  id: Id;
  uso: UsoSessaoDisputa;
  criterio: CriterioJulgamentoSessao;
  modo: ModoDisputaSessao;
  fase: FaseSessaoDisputa;
  participantes: number;
  lances: number;
  conduzidaPor: string | null;
  criadaEm: InstanteISO;
  concluidaEm: InstanteISO | null;
}

export interface EntradaSessaoDisputa {
  uso: UsoSessaoDisputa;
  criterio: CriterioJulgamentoSessao;
  modo: ModoDisputaSessao;
  /** Fornecedores do cadastro. Simulação: 2 a 20 (propostas sintéticas quando não informadas). */
  participantes: { fornecedorId: Id; propostaInicial?: number | null; notaTecnica?: number | null }[];
  cenario?: CenarioSimulacaoDisputa | null;
  idCompra?: string | null; // acompanhamento: identificador da compra no Compras.gov.br
  parametros?: Partial<ParametrosSessaoDisputa>;
}
/** Lance de treino em nome de um participante da simulação. */
export interface EntradaLanceSessao {
  participante: string;
  valor: number;
}
/** Lances transcritos da sessão oficial (acompanhamento), para os sinais RIA-09. */
export interface EntradaTranscricaoLances {
  lances: { documento: string; valor: number; instante: InstanteISO }[];
}
export interface EntradaRelogioSessao {
  avancar: 'minuto' | 'fim_da_etapa';
}
export interface EntradaJustificativaSessao {
  justificativa: string;
}
export interface EntradaNegociacaoSessao {
  valor: number;
  justificativa: string;
}
// GET  /processos/:id/sessoes-disputa                  → SessaoDisputaResumo[]           (jornada:ler)
// POST /processos/:id/sessoes-disputa                  body EntradaSessaoDisputa → 201 SessaoDisputa (disputa:conduzir; etapa 6)
// GET  /sessoes-disputa/:id                             → SessaoDisputa (consulta periódica pela sala) (jornada:ler)
// GET  /sessoes-disputa/:id/ata                         → AtaSessao (prévia até a conclusão)      (jornada:ler)
// POST /sessoes-disputa/:id/abertura                    → SessaoDisputa (simulação)              (disputa:conduzir)
// POST /sessoes-disputa/:id/relogio                     body EntradaRelogioSessao → SessaoDisputa (simulação)
// POST /sessoes-disputa/:id/lances                      body EntradaLanceSessao → SessaoDisputa (simulação; 422 LANCE_RECUSADO)
// POST /sessoes-disputa/:id/lances/transcricao          body EntradaTranscricaoLances → SessaoDisputa (acompanhamento)
// POST /sessoes-disputa/:id/sincronizacao               → SessaoDisputa (acompanhamento; consulta o Compras.gov.br no servidor)
// POST /sessoes-disputa/:id/reinicio                    body EntradaJustificativaSessao → SessaoDisputa (art. 56, § 4º)
// POST /sessoes-disputa/:id/negociacao                  body EntradaNegociacaoSessao → SessaoDisputa (art. 61)
// POST /sessoes-disputa/:id/encerramento                body EntradaJustificativaSessao → SessaoDisputa (ata + registro da disputa no processo)
// ───────────────────────── Controle: linhas de defesa (art. 169) e controle externo (art. 171) ─────────────────────────

export type OrgaoControle = 'TCU' | 'CGU';
export type TipoMedidaControle = 'cautelar' | 'determinacao' | 'diligencia' | 'recomendacao';
export type SituacaoMedidaControle = 'aguardando_resposta' | 'resposta_vencida' | 'respondida' | 'revogada';
export type SemaforoPrazoControle = 'vencido' | 'critico' | 'atencao' | 'regular' | 'concluido';

/** Registro atingido por uma medida, achado ou exceção. `identificador`: "Processo 08000.014501/2026-11" ou "Contrato 12/2025". */
export interface ReferenciaControle {
  tipo: 'processo' | 'contrato' | 'ata' | 'pagamento' | 'sancao';
  id: Id;
  identificador: string;
  /** Rota da interface que abre o registro (processo, contrato ou lista correspondente). */
  caminho: string;
}

/** Medida do tribunal de contas (TCU) ou do órgão central de controle interno (CGU) sobre um processo ou contrato. */
export interface MedidaControle {
  id: Id;
  orgao: OrgaoControle;
  tipo: TipoMedidaControle;
  numero: string; // número da decisão, acórdão ou ofício
  decididaEm: DataISO;
  cienciaEm: DataISO; // intimação do órgão: início do prazo de resposta
  objeto: string;
  efeitoSuspensivo: boolean;
  alvo: ReferenciaControle;
  uasg: string;
  prazoResposta: DataISO;
  diasUteisPrazo: number;
  fundamentoPrazo: string;
  prorrogacao: { ate: DataISO; justificativa: string } | null;
  situacao: SituacaoMedidaControle;
  semaforo: SemaforoPrazoControle;
  diasUteisRestantes: number | null; // negativo = vencido; null = respondida ou revogada
  explicacao: string;
  resposta: { em: DataISO; texto: string; por: UsuarioResumo | null } | null;
  revogacao: { em: DataISO; texto: string; por: UsuarioResumo | null } | null;
  /** Só para suspensão cautelar respondida: prazo do tribunal para decidir o mérito (art. 171, § 1º), informativo. */
  prazoDecisaoMerito: { limite: DataISO; fundamento: string } | null;
  /** RN-30: cautelar suspensiva não revogada impede avançar o processo e assinar o contrato. */
  bloqueia: boolean;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}
/** GET /medidas-controle?situacao(abertas|aguardando_resposta|resposta_vencida|respondida|revogada)&orgao&alvo(processo|contrato)&alvoId&pagina&tamanhoPagina → Pagina<MedidaControle> (controle_externo:ler) */
export interface FiltroMedidasControle extends ParametrosLista {
  situacao?: SituacaoMedidaControle | 'abertas';
  orgao?: OrgaoControle;
  alvo?: 'processo' | 'contrato';
  alvoId?: Id;
}
/** POST /medidas-controle → MedidaControle (controle_externo:registrar). Informe o processo OU o contrato. */
export interface EntradaMedidaControle {
  orgao: OrgaoControle;
  tipo: TipoMedidaControle;
  numero: string;
  decididaEm: DataISO;
  cienciaEm: DataISO;
  objeto: string; // 20..2000 caracteres
  efeitoSuspensivo: boolean; // só para tipo 'cautelar'
  processoId: Id | null;
  contratoId: Id | null;
  /** Prazo fixado na comunicação, em dias úteis (1..120), para medidas sem efeito suspensivo; a suspensão cautelar tem os 10 dias úteis do art. 171, § 2º. */
  prazoDiasUteis: number | null;
}
/** POST /medidas-controle/:id/prorrogacao → MedidaControle */
export interface EntradaProrrogacaoMedida {
  prorrogadoAte: DataISO;
  justificativa: string; // 10..1000
}
/** POST /medidas-controle/:id/resposta → MedidaControle (medidas adotadas e informações prestadas, art. 171, § 2º, I a III) */
export interface EntradaRespostaMedida {
  respondidaEm: DataISO;
  texto: string; // 20..5000
}
/** POST /medidas-controle/:id/revogacao → MedidaControle (revogação ou decisão de mérito do órgão de controle) */
export interface EntradaRevogacaoMedida {
  revogadaEm: DataISO;
  texto: string; // 10..2000
}

// ───────── RN-29: revisão trimestral da matriz de riscos do contrato ─────────

export type RiscoMatriz = ProcessoDetalhe['riscos'][number];

export interface SituacaoRevisaoRiscos {
  situacao: 'em_dia' | 'a_vencer' | 'vencida' | 'encerrado';
  proximaRevisao: DataISO | null;
  diasRestantes: number | null;
  explicacao: string;
  fundamento: string;
}

export interface RevisaoMatrizRiscos {
  id: Id;
  revisadaEm: DataISO;
  linha: 'primeira' | 'segunda'; // 1ª linha (gestão e fiscalização) ou 2ª linha (controle interno)
  observacao: string;
  riscos: RiscoMatriz[];
  revisadaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}

/** GET /contratos/:id/riscos (contratos:ler) */
export interface MatrizRiscosContrato {
  /** De onde vem a matriz vigente: última revisão, matriz do processo da jornada que gerou o contrato ou nenhuma. */
  origem: 'revisao' | 'processo' | 'sem_matriz';
  processo: { id: Id; numeroSei: string } | null;
  riscos: RiscoMatriz[];
  revisao: SituacaoRevisaoRiscos;
  revisoes: RevisaoMatrizRiscos[]; // mais recente primeiro
}
/** POST /contratos/:id/riscos/revisoes → MatrizRiscosContrato (riscos:revisar). A data da revisão é a de hoje no servidor. */
export interface EntradaRevisaoRiscos {
  riscos: (Omit<RiscoMatriz, 'id'> & { id?: Id })[];
  observacao: string; // 20..2000
}

// ───────── RF-23: painéis das linhas de defesa ─────────

export interface ContratoRevisaoRiscos {
  contrato: ReferenciaControle;
  uasg: string;
  objeto: string;
  revisao: SituacaoRevisaoRiscos;
}

export interface ProcessoBloqueadoControle {
  processo: ReferenciaControle;
  titulo: string;
  etapaAtual: EtapaJornada;
  uasg: string;
  bloqueios: Bloqueio[];
  diasSemAtualizacao: number;
}

export interface TarefaAtrasadaControle {
  id: Id;
  titulo: string;
  prazo: DataISO;
  instrumento: ReferenciaControle;
  responsavel: UsuarioResumo | null;
}

export interface AtestoAtrasadoControle {
  id: Id;
  contrato: ReferenciaControle;
  notaFiscal: string;
  valor: Centavos;
  vencimento: DataISO;
}

/** Matriz de achados preventivos: sinal para conferência humana, nunca conclusão de irregularidade. */
export interface AchadoPreventivo {
  tipo: 'aditivo_limite' | 'sem_fiscal' | 'sem_gestor' | 'divulgacao_pncp' | 'ceis_cnep' | 'processo_parado' | 'ordem_cronologica' | 'revisao_riscos';
  nivel: 'risco' | 'atencao';
  titulo: string;
  descricao: string;
  fundamento: string;
  referencia: ReferenciaControle;
}

export interface ExcecaoJustificada {
  tipo: 'nao_padronizacao' | 'artigo_luxo' | 'etp_ausencia' | 'expurgo_cotacao';
  titulo: string;
  justificativa: string;
  fundamento: string;
  referencia: ReferenciaControle;
}

export interface ParecerPendenteControle {
  processo: ReferenciaControle;
  titulo: string;
  uasg: string;
  desde: InstanteISO; // última atualização do processo na etapa 5
}

export interface IndicadoresPrimeiraLinha {
  pendenciasAbertas: number;
  pendenciasVencidas: number;
  tarefasAtrasadas: number;
  atestosAtrasados: number;
  processosBloqueados: number;
  revisoesRiscosPendentes: number; // vencidas + a vencer
  cautelaresSuspensivas: number;
}

/** GET /controle/primeira-linha?uasg (controle:primeira_linha) — escopo de UASG do usuário */
export interface PainelPrimeiraLinha {
  geradoEm: InstanteISO;
  uasg: string | null;
  indicadores: IndicadoresPrimeiraLinha;
  pendenciasVencidas: Pendencia[]; // até 10, mais antigas primeiro
  tarefasAtrasadas: TarefaAtrasadaControle[]; // até 10
  atestosAtrasados: AtestoAtrasadoControle[]; // até 10
  processosBloqueados: ProcessoBloqueadoControle[];
  revisoesRiscos: ContratoRevisaoRiscos[]; // vencidas e a vencer
  medidas: MedidaControle[]; // abertas ou suspensivas ativas
  fontes: string[];
}

export interface IndicadoresSegundaLinha {
  pareceresPendentes: number;
  achadosRisco: number;
  achadosAtencao: number;
  excecoesJustificadas: number;
  sancoesEmAndamento: number;
  medidasAbertas: number;
}

/** GET /controle/segunda-linha?uasg (controle:segunda_linha) */
export interface PainelSegundaLinha {
  geradoEm: InstanteISO;
  uasg: string | null;
  indicadores: IndicadoresSegundaLinha;
  pareceresPendentes: ParecerPendenteControle[];
  achados: AchadoPreventivo[];
  excecoes: ExcecaoJustificada[];
  sancoes: Sancao[]; // em instrução, defesa ou decisão, e aplicadas com registro no CEIS/CNEP pendente
  medidas: MedidaControle[];
  fontes: string[];
}

/** GET /controle/terceira-linha?uasg&de&ate (controle:terceira_linha) — leitura ampla (art. 169, § 2º) */
export interface PainelTerceiraLinha {
  geradoEm: InstanteISO;
  uasg: string | null;
  periodo: { de: DataISO; ate: DataISO };
  indicadores: {
    medidasAbertas: number;
    respostasVencidas: number;
    cautelaresSuspensivas: number;
    eventosNoPeriodo: number;
    acessosDadosPessoais: number;
    achadosRisco: number;
  };
  medidas: MedidaControle[];
  integridade: VerificacaoAuditoria;
  eventosPorRecurso: { recurso: string; total: number }[];
  ultimosEventos: EventoAuditoria[]; // até 10, no período
  primeiraLinha: IndicadoresPrimeiraLinha;
  segundaLinha: IndicadoresSegundaLinha;
  achados: AchadoPreventivo[];
  fontes: string[];
}
// GET /controle/relatorio.pdf?uasg&de&ate → application/pdf (controle:terceira_linha): relatório executivo de auditoria com fontes, data e período
// ───────────────────────── Jornada: prova de conceito, sustentabilidade e atos da seleção ─────────────────────────

export type ExigenciaProvaConceito = 'nenhuma' | 'prova_conceito' | 'amostra';
/** Prova de conceito ou amostra prevista no edital (art. 17, § 3º; art. 41, II) — RN-20. */
export interface ProvaConceitoEdital {
  exigencia: ExigenciaProvaConceito;
  roteiro: string | null; // testes e critérios objetivos de aprovação
  justificativa: string | null; // necessidade (art. 41, II)
  prazoDiasUteis: number | null; // contados da convocação (1 a 30)
}
/** Inversão de fases (art. 17, § 1º): a habilitação antecede o julgamento, por ato motivado. */
export interface InversaoFasesEdital {
  adotada: boolean;
  motivacao: string | null;
}

export type ProximoAtoSelecao =
  | 'registrar_disputa'
  | 'convocar_prova_conceito'
  | 'registrar_resultado_prova_conceito'
  | 'registrar_habilitacao'
  | 'registrar_intencao_recurso'
  | 'aguardar_razoes'
  | 'aguardar_contrarrazoes'
  | 'decidir_reconsideracao'
  | 'decidir_recurso'
  | 'adjudicar'
  | 'homologar'
  | 'concluida'
  | 'fracassada';
export type SituacaoFaseRecursal =
  | 'intencao'
  | 'razoes'
  | 'contrarrazoes'
  | 'reconsideracao'
  | 'decisao_superior'
  | 'preclusa'
  | 'deserta'
  | 'improvida'
  | 'decidida_em_recurso';
export interface LicitanteReferencia {
  id: Id;
  nome: string;
}
/** Efeito da reforma do ato recorrido, escolhido por quem decide. */
export type EfeitoReforma = { tipo: 'desclassificar_vencedor' } | { tipo: 'reintegrar_licitante'; fornecedorId: Id };
export interface ManifestacaoRecursalProcesso {
  licitante: LicitanteReferencia;
  data: DataISO;
  texto: string;
}
export interface DecisaoRecursalProcesso<D extends string> {
  decisao: D;
  data: DataISO;
  motivacao: string;
  efeito: EfeitoReforma | null;
  por: UsuarioResumo | null;
}
export interface FaseRecursalProcesso {
  vencedor: LicitanteReferencia;
  atoRecorrivel: 'habilitacao' | 'julgamento';
  dataAto: DataISO;
  situacao: SituacaoFaseRecursal;
  intencaoAberta: boolean;
  prazos: { razoes: DataISO; contrarrazoes: DataISO; reconsideracao: DataISO; decisaoSuperior: DataISO | null };
  intencoes: ManifestacaoRecursalProcesso[];
  intencaoEncerradaEm: DataISO | null;
  razoes: ManifestacaoRecursalProcesso[];
  contrarrazoes: ManifestacaoRecursalProcesso[];
  reconsideracao: DecisaoRecursalProcesso<'reconsiderada' | 'mantida'> | null;
  decisaoSuperior: DecisaoRecursalProcesso<'provido' | 'nao_provido'> | null;
}
export interface ProvaConceitoProcesso {
  licitante: LicitanteReferencia;
  convocadoEm: DataISO;
  limite: DataISO;
  convocacaoAutomatica: boolean; // próximo colocado convocado após reprovação, inabilitação ou recurso
  resultado: 'aprovado' | 'reprovado' | null;
  realizadaEm: DataISO | null;
  motivacao: string | null;
  linkGravacao: string | null; // sessão pública gravada (art. 17, § 2º)
  registradoPor: UsuarioResumo | null;
}
export interface HabilitacaoProcesso {
  licitante: LicitanteReferencia;
  resultado: 'habilitado' | 'inabilitado';
  data: DataISO;
  motivacao: string;
  registradoPor: UsuarioResumo | null;
}
/** Atos da seleção (etapa 6): RN-20, RN-22 e RF-18. A ordem e os prazos vêm de `avaliarSelecao` (@agora/dominio). */
export interface SelecaoProcesso {
  proximoAto: ProximoAtoSelecao;
  vencedorProvisorio: LicitanteReferencia | null;
  excluidos: { licitante: LicitanteReferencia; motivo: 'prova_conceito' | 'habilitacao' | 'recurso' }[];
  reintegrados: Id[];
  provasConceito: ProvaConceitoProcesso[];
  habilitacoes: HabilitacaoProcesso[];
  faseRecursal: FaseRecursalProcesso | null; // a do vencedor provisório
  fasesRecursaisAnteriores: FaseRecursalProcesso[]; // de vencedores anteriores, desfeitos em recurso
  recursosExauridos: boolean;
  adjudicacao: { data: DataISO; licitante: LicitanteReferencia; motivacao: string | null; por: UsuarioResumo | null } | null;
  homologacao: { data: DataISO; motivacao: string | null; por: UsuarioResumo | null } | null;
  documentosPreparatoriosDivulgadosEm: InstanteISO | null;
  pendencia: { regra: string; mensagem: string; fundamento: string } | null;
}
// POST /processos/:id/selecao/prova-conceito/convocacao                                 → ProcessoDetalhe (jornada:editar; RN-20)
// POST /processos/:id/selecao/prova-conceito/resultado  body EntradaResultadoProvaConceito → ProcessoDetalhe (reprovado → próximo convocado)
// POST /processos/:id/selecao/habilitacao               body EntradaHabilitacao         → ProcessoDetalhe (jornada:editar)
// POST /processos/:id/selecao/recurso/manifestacao      body EntradaManifestacaoRecursal → ProcessoDetalhe (intenção, razões, contrarrazões)
// POST /processos/:id/selecao/recurso/encerrar-intencao                                  → ProcessoDetalhe (encerra o registro das intenções)
// POST /processos/:id/selecao/recurso/reconsideracao    body EntradaDecisaoRecursal<'reconsiderada' | 'mantida'> (jornada:editar)
// POST /processos/:id/selecao/recurso/decisao           body EntradaDecisaoRecursal<'provido' | 'nao_provido'>   (jornada:homologar + autoridade designada)
// POST /processos/:id/selecao/adjudicacao               body EntradaAtoAutoridade (jornada:homologar + autoridade competente designada; art. 71)
// POST /processos/:id/selecao/homologacao               body EntradaAtoAutoridade (idem; divulga os documentos preparatórios — art. 54, § 3º)
export interface EntradaResultadoProvaConceito {
  resultado: 'aprovado' | 'reprovado';
  motivacao: string;
  linkGravacao: string | null; // http(s); obrigatório quando aprovado
}
export interface EntradaHabilitacao {
  resultado: 'habilitado' | 'inabilitado';
  motivacao: string;
}
export interface EntradaManifestacaoRecursal {
  tipo: 'intencao' | 'razoes' | 'contrarrazoes';
  fornecedorId: Id;
  texto: string;
}
export interface EntradaDecisaoRecursal<D extends string> {
  decisao: D;
  motivacao: string;
  efeito: EfeitoReforma | null; // obrigatório quando o ato é reformado
}
export interface EntradaAtoAutoridade {
  motivacao: string | null;
}

/** Critérios de sustentabilidade do processo e a política do órgão (RN-21). */
export interface SustentabilidadeProcesso {
  criteriosAmbientais: string | null;
  logisticaReversa: string | null;
  politicaObrigatoria: boolean; // política do órgão ligada: ETP e TR não se concluem sem os dois critérios
}
export type EntradaSustentabilidade = Pick<SustentabilidadeProcesso, 'criteriosAmbientais' | 'logisticaReversa'>;
// PUT /processos/:id/sustentabilidade body EntradaSustentabilidade → ProcessoDetalhe (jornada:editar; até a etapa 4)

/** Política de sustentabilidade do órgão: ligada por padrão; só o administrador altera, com justificativa auditada. */
export interface PoliticaSustentabilidade {
  ativa: boolean;
  justificativa: string | null;
  alteradaEm: InstanteISO | null;
  alteradaPor: UsuarioResumo | null;
}
export interface EntradaPoliticaSustentabilidade {
  ativa: boolean;
  justificativa: string; // mínimo de 20 caracteres
}
// GET /politicas-orgao/sustentabilidade (sessão) → PoliticaSustentabilidade ; PUT idem body EntradaPoliticaSustentabilidade (ajustes:editar)

/** Documento da fase preparatória divulgado após a homologação (art. 54, § 3º). */
export interface DocumentoPreparatorioPublico {
  tipo: 'dfd' | 'etp' | 'matriz_riscos' | 'nota_tecnica_precos' | 'parecer_checklist';
  titulo: string;
  versao: number;
  url: string; // PDF gerado no servidor, com dados pessoais tarjados
}
// GET /publico/editais/:id/preparatorios/:tipo → application/pdf (sem login; só após a homologação)
// ───────────────────────── Regularidade do contratado: CEIS, CNEP e certidões (RF-20, RN-09, RN-23, RN-24) ─────────────────────────

/** Momento em que o checklist é executado: assinatura e prorrogação bloqueiam (art. 91, § 4º); atesto e pagamento rechecam (art. 92, XVI). */
export type MomentoVerificacaoRegularidade = 'assinatura' | 'prorrogacao' | 'atesto' | 'pagamento';
export type TipoCertidao = 'fiscal_federal' | 'fgts' | 'trabalhista';
export type ResultadoCertidao = 'negativa' | 'positiva_com_efeitos_de_negativa' | 'positiva';
export type SituacaoCertidao = 'valida' | 'a_vencer' | 'vencida' | 'positiva';

export interface ItemChecklistRegularidade {
  id: 'ceis_cnep' | 'sancoes_agora' | TipoCertidao;
  rotulo: string;
  situacao: 'conforme' | 'atencao' | 'pendente' | 'impeditivo';
  detalhes: string[];
  fonte: string;
  /** Instante da consulta (CEIS/CNEP) ou data de validade (certidão). */
  referencia: string | null;
  fundamento: string;
}

/** Registro do CEIS/CNEP normalizado no servidor (sem nomes nem documentos de pessoas). */
export interface RegistroCadastroSancao {
  cadastro: 'CEIS' | 'CNEP';
  tipoSancao: string;
  orgaoSancionador: string;
  esfera: string | null;
  uf: string | null;
  dataInicio: DataISO | null;
  dataFim: DataISO | null;
  numeroProcesso: string | null;
  fundamentacao: string | null;
  abrangencia: string | null;
  vigente: boolean;
  impeditivo: boolean;
}

/** Consulta ao CEIS e ao CNEP com proveniência (cache no servidor). */
export interface ConsultaCadastrosSancoes {
  id: Id;
  modo: 'offline' | 'online';
  fonte: string;
  consultadoEm: InstanteISO;
  hashConteudo: string;
  quantidade: number;
  registros: RegistroCadastroSancao[];
}

export interface ChecklistRegularidade {
  fornecedor: { id: Id; razaoSocial: string; documento: string };
  momento: MomentoVerificacaoRegularidade;
  regular: boolean;
  /** true quando a irregularidade impede o ato (assinatura e prorrogação). */
  bloqueia: boolean;
  itens: ItemChecklistRegularidade[];
  motivos: string[];
  avisos: string[];
  providencias: string[];
  consulta: ConsultaCadastrosSancoes | null;
  falhaConsulta: string | null;
  fundamento: string;
  aviso: string;
  avaliadoEm: InstanteISO;
}

/** Verificação registrada (trilha de auditoria): checklist executado numa trava ou a pedido do agente. */
export interface VerificacaoRegularidade extends ChecklistRegularidade {
  id: Id;
  instrumento: { tipo: 'processo' | 'contrato' | 'pagamento' | 'fornecedor'; id: Id };
  verificadoPor: UsuarioResumo | null;
}
// GET  /fornecedores/:id/regularidade?momento → ChecklistRegularidade (fornecedores:ler; usa a última consulta, sem chamada externa)
// POST /fornecedores/:id/regularidade/consultar → VerificacaoRegularidade (regularidade:consultar; consulta CEIS/CNEP agora)
// GET  /contratos/:id/regularidade?momento → ChecklistRegularidade (contratos:ler)
// GET  /pagamentos/:id/regularidade → ChecklistRegularidade (pagamentos:ler; momento do atesto ou do pagamento)
// POST /pagamentos/:id/regularidade → VerificacaoRegularidade (regularidade:consultar; recheque antes do pagamento — RN-23)
// GET  /regularidade/verificacoes/:id/comprovante.pdf → application/pdf (fornecedores:ler; para juntar ao processo)

export interface CertidaoRegistrada {
  id: Id;
  tipo: TipoCertidao;
  numero: string;
  emissor: string;
  emitidaEm: DataISO;
  validaAte: DataISO;
  resultado: ResultadoCertidao;
  situacao: SituacaoCertidao;
  diasRestantes: number;
  mensagem: string;
  conferidaPor: UsuarioResumo | null;
  conferidaEm: InstanteISO;
  observacao: string | null;
}
/** POST /fornecedores/:id/certidoes (certidoes:registrar) → CertidaoRegistrada. `conferida` confirma que o agente conferiu a certidão no sítio do emissor. */
export interface EntradaRegistrarCertidao {
  tipo: TipoCertidao;
  numero: string;
  emissor: string;
  emitidaEm: DataISO;
  validaAte: DataISO;
  resultado: ResultadoCertidao;
  observacao?: string | null;
  conferida: true;
}
// GET /fornecedores/:id/certidoes → CertidaoRegistrada[] (fornecedores:ler; mais recentes primeiro)

/** POST /contratos/:id/prorrogacoes (contratos:editar) → RespostaProrrogacao; 422 REGRA_NEGOCIO com detalhes RN-09 se a regularidade bloquear. */
export interface EntradaProrrogarContrato {
  novaVigenciaFim: DataISO;
  valor: Centavos;
  justificativa: string;
}
export interface RespostaProrrogacao {
  aditivo: Aditivo;
  verificacao: VerificacaoRegularidade;
}

/** Resposta de POST /pagamentos/:id/atestar: o pagamento e o recheque de regularidade (RN-23). */
export interface RespostaAtesto extends Pagamento {
  verificacaoRegularidade: VerificacaoRegularidade;
  /** true quando o recheque apontou irregularidade e abriu pendência para notificar o contratado. */
  pendenciaAberta: boolean;
}

export type SituacaoRegistroCeisCnep = 'pendente_no_prazo' | 'pendente_vencida' | 'registrada_no_prazo' | 'registrada_fora_do_prazo';

/** Sanção aplicada e o seu registro no CEIS/CNEP (RN-24, art. 161). */
export interface RegistroSancaoCeisCnep {
  sancao: { id: Id; tipo: TipoSancao; incisoInfracao: string; aplicadaEm: DataISO; contrato: { id: Id; numero: string } | null };
  fornecedor: { id: Id; razaoSocial: string; documento: string };
  prazo: DataISO;
  situacao: SituacaoRegistroCeisCnep;
  diasUteisRestantes: number | null;
  diasUteisAtraso: number | null;
  alerta: boolean;
  mensagem: string;
  envio: {
    cadastro: 'CEIS' | 'CNEP';
    protocolo: string;
    enviadoEm: DataISO;
    responsavel: UsuarioResumo | null;
    registradoEm: InstanteISO;
    observacao: string | null;
  } | null;
}
/** POST /sancoes/:id/registro-ceis-cnep (sancoes:instruir) → RegistroSancaoCeisCnep. Não há API pública de escrita: registra o envio feito no sistema da CGU. */
export interface EntradaRegistrarEnvioCeisCnep {
  cadastro: 'CEIS' | 'CNEP';
  protocolo: string;
  enviadoEm: DataISO;
  observacao?: string | null;
}
// GET /sancoes/registro-ceis-cnep?situacao(pendentes|registradas) → RegistroSancaoCeisCnep[] (sancoes:ler; pendentes primeiro)
// ───────────────────────── Documentos do processo e leitura assistida de atestados (RF-21, RIA-08, RN-25) ─────────────────────────

export type CategoriaArquivoProcesso = 'processo' | 'habilitacao';
export type TipoArquivoProcesso = 'atestado_capacidade_tecnica' | 'balanco_patrimonial' | 'certidao' | 'proposta' | 'documento_processo' | 'outro';
/** Formato identificado pelo conteúdo do arquivo (assinatura inicial), nunca pela extensão. */
export type FormatoArquivo = 'pdf' | 'png' | 'jpeg';

/** Quantitativo localizado num atestado (RIA-08), com o trecho-fonte. */
export interface MencaoQuantitativoAtestado {
  indice: number;
  parcelaId: Id | null; // parcela do edital; null = sem correspondência ou ambígua
  quantidade: number;
  unidade: string;
  pagina: number;
  linha: number;
  trecho: string; // linha do documento, com CPF, e-mail e telefone tarjados
  confianca: 'alta' | 'media' | 'baixa';
  linhaDeTotal: boolean;
  quantidadePorExtenso: number | null;
  observacao: string | null;
}

/** Última leitura assistida de um atestado. As menções são recalculadas com as parcelas atuais do edital. */
export interface LeituraAtestado {
  id: Id;
  metodo: 'camada_texto' | 'ocr';
  situacao: 'concluida' | 'sem_texto' | 'ocr_indisponivel' | 'falhou';
  mensagem: string | null;
  paginas: number;
  linhas: number;
  confiancaOcr: number | null; // média de 0 a 100 informada pelo OCR
  motor: string | null; // "camada de texto do PDF" ou o motor de OCR
  hashTexto: string | null; // SHA-256 do texto lido (proveniência)
  mencoes: MencaoQuantitativoAtestado[];
  lidaEm: InstanteISO;
  lidaPor: UsuarioResumo;
  aviso: string; // "requer revisão humana"
}

export interface ArquivoProcesso {
  id: Id;
  processoId: Id;
  categoria: CategoriaArquivoProcesso;
  tipo: TipoArquivoProcesso;
  titulo: string;
  nomeOriginal: string;
  formato: FormatoArquivo;
  tamanhoBytes: number;
  sha256: string;
  contemDadoPessoal: boolean;
  antivirus: 'nao_verificado' | 'limpo';
  fornecedor: { id: Id; nome: string } | null; // licitante (documentos de habilitação)
  exercicio: number | null; // balanço patrimonial: exercício social
  dataConstituicao: DataISO | null; // balanço: constituição da empresa (art. 69, § 6º)
  enviadoPor: UsuarioResumo;
  enviadoEm: InstanteISO;
  leitura: LeituraAtestado | null;
}

export interface ArquivosProcesso {
  itens: ArquivoProcesso[];
  armazenamentoDisponivel: boolean;
  tamanhoMaximoBytes: number;
  formatosAceitos: FormatoArquivo[];
  ocrDisponivel: boolean;
  antivirusAtivo: boolean;
}
export interface EntradaBaixarArquivo {
  finalidade?: string; // obrigatória (10 a 300 caracteres) para documento com dado pessoal (LGPD, art. 37)
}
// GET  /processos/:id/arquivos → ArquivosProcesso (documentos:ler; escopo de UASG do processo)
// POST /processos/:id/arquivos?categoria&tipo&titulo&fornecedorId&contemDadoPessoal&exercicio&dataConstituicao
//      corpo binário (application/octet-stream) e cabeçalho X-Agora-Nome-Arquivo (URI-encoded) → 201 ArquivoProcesso (documentos:enviar)
// POST /processos/:id/arquivos/:arquivoId/baixar body EntradaBaixarArquivo → conteúdo do arquivo como anexo (documentos:ler)
// POST /processos/:id/arquivos/:arquivoId/leitura → ArquivoProcesso (documentos:analisar; só atestados)

/** Parcela de maior relevância exigida no edital (art. 67, §§ 1º e 2º), com a avaliação da RN-25. */
export interface ParcelaQualificacaoTecnica {
  id: Id;
  descricao: string;
  unidade: string;
  quantidadeObjeto: number;
  valorEstimado: Centavos;
  quantidadeMinima: number;
  termos: string[]; // palavras que identificam a parcela nos atestados
  percentualDoTotal: number;
  maiorRelevancia: boolean;
  percentualMinimo: number;
  limiteQuantidadeMinima: number;
}
export interface EntradaParcelaQualificacao {
  id?: Id;
  descricao: string;
  unidade: string;
  quantidadeObjeto: number;
  valorEstimado: Centavos;
  quantidadeMinima: number;
  termos: string[];
}
export interface EntradaQualificacaoTecnica {
  parcelas: EntradaParcelaQualificacao[];
}

export interface ContribuicaoAtestado {
  arquivoId: Id;
  titulo: string;
  quantidade: number;
  criterio: 'total_declarado' | 'soma_mencoes';
  observacao: string | null;
  evidencias: MencaoQuantitativoAtestado[];
}

/** Sinal da leitura assistida por licitante (RIA-08) e conferência dos balanços (art. 69, § 6º). Nunca é decisão. */
export interface AnaliseHabilitacaoLicitante {
  fornecedor: { id: Id; nome: string };
  atestados: number;
  atestadosLidos: number;
  sinal: 'indica_atendimento' | 'indica_insuficiencia' | 'inconclusivo';
  mensagem: string;
  parcelas: {
    parcelaId: Id;
    descricao: string;
    unidade: string;
    exigido: number;
    somado: number;
    atende: boolean | null;
    contribuicoes: ContribuicaoAtestado[];
  }[];
  balancos: { exigidos: 1 | 2 | null; apresentados: number[]; suficiente: boolean | null; mensagem: string };
}

export interface QualificacaoTecnica {
  processoId: Id;
  etapaAtual: EtapaJornada;
  editavel: boolean; // exigências alteráveis até a etapa 4 (antes do controle jurídico e da publicação)
  valorTotalEstimado: Centavos | null;
  parcelas: ParcelaQualificacaoTecnica[];
  definidaEm: InstanteISO | null;
  definidaPor: UsuarioResumo | null;
  licitantes: { id: Id; nome: string }[];
  analise: AnaliseHabilitacaoLicitante[];
  premissas: string[];
  fontes: string[];
  geradaEm: InstanteISO;
  fundamento: string;
  aviso: string;
}
// GET /processos/:id/qualificacao-tecnica → QualificacaoTecnica (documentos:ler)
// PUT /processos/:id/qualificacao-tecnica body EntradaQualificacaoTecnica → QualificacaoTecnica
//     (jornada:editar; até a etapa 4; 422 REGRA_NEGOCIO se violar o art. 67, §§ 1º e 2º)
// ───────────────────────── Vínculos, extensão de sanção e declarações dos agentes (F4 e F14) ─────────────────────────
// Fontes lícitas apenas (QSA dos dados abertos do CNPJ, cadastro, declarações e vínculos informados com evidência).
// Todo sinal é para análise humana: nunca desclassifica, impede ou sanciona. Pessoas e CPFs sempre mascarados.

export type FonteVinculo = 'qsa_receita' | 'cadastro_fornecedor' | 'declaracao_licitante' | 'declaracao_agente' | 'informado_agente';
export type NaturezaVinculo = 'conjuge' | 'parentesco' | 'societario' | 'tecnico' | 'comercial' | 'economico' | 'financeiro' | 'trabalhista' | 'civil';
export type TipoSinalVinculo =
  | 'socio_comum'
  | 'administrador_comum'
  | 'endereco_comum'
  | 'contato_comum'
  | 'vinculo_informado'
  | 'agente_publico'
  | 'possivel_sucessao';

export interface EvidenciaVinculo {
  fonte: FonteVinculo;
  descricao: string;
}

export interface SinalVinculo {
  regra: 'RIA-06' | 'RIA-10';
  tipo: TipoSinalVinculo;
  nivel: 'atencao' | 'risco';
  fornecedores: { id: Id; nome: string }[];
  agente: { usuarioId: Id; nome: string } | null;
  mensagem: string;
  evidencias: EvidenciaVinculo[];
  fundamento: string;
  requerRevisaoHumana: true;
  /** Só nos sinais de possível sucessão: sanção de origem, base da proposta de extensão (RN-27). */
  sancaoOrigemId: Id | null;
}

export interface AnaliseVinculos {
  licitantes: { id: Id; nome: string; documento: string; qsaConsultadoEm: InstanteISO | null }[];
  sinais: SinalVinculo[];
  grupos: { fornecedores: { id: Id; nome: string }[] }[];
  aviso: string;
  premissas: string[];
  fundamento: string;
  analisadoEm: InstanteISO;
}
/** POST /impedimentos/analise (impedimentos:ler; somente leitura) — 2 a 50 fornecedores. */
export interface EntradaAnaliseVinculos {
  fornecedorIds: Id[];
}

export interface VinculoRegistrado {
  id: Id;
  natureza: NaturezaVinculo;
  grauParentesco: 1 | 2 | 3 | null;
  fornecedor: { id: Id; nome: string };
  outroFornecedor: { id: Id; nome: string } | null;
  agente: UsuarioResumo | null;
  fonte: FonteVinculo;
  descricao: string;
  evidencia: string;
  processo: { id: Id; numeroSei: string } | null;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
  situacao: 'ativo' | 'revogado';
  motivoRevogacao: string | null;
}
/** POST /impedimentos/vinculos (impedimentos:registrar) → VinculoRegistrado. Uma contraparte: outro fornecedor ou agente público. */
export interface EntradaVinculo {
  natureza: NaturezaVinculo;
  grauParentesco: 1 | 2 | 3 | null;
  fornecedorId: Id;
  outroFornecedorId: Id | null;
  agenteId: Id | null;
  fonte: 'declaracao_licitante' | 'informado_agente';
  descricao: string;
  evidencia: string;
  processoId: Id | null;
}
// GET /impedimentos/vinculos?fornecedorId&processoId&situacao → VinculoRegistrado[]
// POST /impedimentos/vinculos/:id/revogar { motivo } → VinculoRegistrado (impedimentos:registrar)
// GET /impedimentos/agentes (impedimentos:registrar) → UsuarioResumo[] — agentes públicos do órgão, para registrar vínculo

export interface IntegranteQuadro {
  id: Id;
  nome: string; // mascarado
  documento: string; // CPF mascarado (***.456.789-**)
  qualificacao: 'socio' | 'administrador' | 'socio_administrador';
  dataEntrada: DataISO | null;
}
export interface QuadroSocietario {
  fornecedor: { id: Id; nome: string; documento: string };
  dataAbertura: DataISO | null;
  endereco: string | null;
  integrantes: IntegranteQuadro[];
  proveniencia: { fonte: string; modo: 'offline' | 'online'; consultadoEm: InstanteISO; hash: string; registros: number } | null;
}
// POST /impedimentos/fornecedores/:id/qsa (impedimentos:registrar) → QuadroSocietario (conector no servidor; offline por padrão)

export type AlvoExtensaoSancao = 'administrador' | 'socio_administrador' | 'sucessora' | 'coligada_controlada';
export type SituacaoExtensaoSancao = 'contraditorio' | 'analise_juridica' | 'decisao' | 'estendida' | 'nao_estendida' | 'arquivada';

export interface ExtensaoSancao {
  id: Id;
  sancaoOrigem: { id: Id; tipo: TipoSancao; fornecedor: { id: Id; nome: string; documento: string }; fimVigencia: DataISO | null };
  alvo: { tipo: AlvoExtensaoSancao; fornecedor: { id: Id; nome: string; documento: string } | null; pessoa: { nome: string; documento: string } | null };
  situacao: SituacaoExtensaoSancao;
  fundamentacao: string;
  sinal: string | null;
  intimacaoEm: DataISO;
  prazoDefesa: DataISO;
  defesa: { apresentada: boolean; resumo: string | null; registradaEm: InstanteISO } | null;
  parecer: { conclusao: 'favoravel' | 'desfavoravel'; texto: string; parecerista: UsuarioResumo; registradoEm: InstanteISO } | null;
  decisao: { resultado: 'estender' | 'nao_estender'; motivacao: string; autoridade: UsuarioResumo; decididaEm: InstanteISO; sancaoEstendidaId: Id | null } | null;
  arquivamento: { motivo: string; arquivadoEm: InstanteISO } | null;
  propostoPor: UsuarioResumo;
  propostaEm: InstanteISO;
}
/** POST /impedimentos/extensoes (sancoes:instruir) → ExtensaoSancao. Pessoa física: `alvoIntegranteId` do quadro da sancionada. */
export interface EntradaProporExtensao {
  sancaoOrigemId: Id;
  alvo: AlvoExtensaoSancao;
  alvoFornecedorId: Id | null;
  alvoIntegranteId: Id | null;
  fundamentacao: string;
  sinal: string | null;
  intimacaoEm: DataISO;
}
// GET /impedimentos/extensoes → ExtensaoSancao[] ; GET /impedimentos/extensoes/:id → ExtensaoSancao (impedimentos:ler)
// POST /impedimentos/extensoes/:id/defesa   { apresentada, resumo }  (sancoes:instruir)
// POST /impedimentos/extensoes/:id/parecer  { conclusao, texto }     (impedimentos:parecer; quem propôs não emite)
// POST /impedimentos/extensoes/:id/decisao  { resultado, motivacao } (impedimentos:decidir; nem quem propôs nem o parecerista)
// POST /impedimentos/extensoes/:id/arquivar { motivo }               (sancoes:instruir)
export interface EntradaDefesaExtensao {
  apresentada: boolean;
  resumo: string | null;
}
export interface EntradaParecerExtensao {
  conclusao: 'favoravel' | 'desfavoravel';
  texto: string;
}
export interface EntradaDecisaoExtensao {
  resultado: 'estender' | 'nao_estender';
  motivacao: string;
}

export type VinculoFuncional = 'servidor_efetivo' | 'empregado_publico_permanente' | 'cargo_comissao' | 'temporario' | 'outro';
export type CapacitacaoAgente = 'atribuicoes' | 'formacao' | 'certificacao_escola_governo' | 'nenhuma';

export interface DeclaracaoAgenteRegistrada {
  id: Id;
  usuario: UsuarioResumo;
  declaradaEm: InstanteISO;
  validaAte: DataISO;
  semParentescoOuVinculo: boolean;
  semConflitoInteresses: boolean;
  vinculo: VinculoFuncional;
  cargoMatricula: string | null;
  capacitacao: CapacitacaoAgente;
  capacitacaoDescricao: string | null;
  situacao: 'vigente' | 'vencida';
  vinculosDeclarados: VinculoRegistrado[];
}
/** POST /impedimentos/declaracoes (agentes:declarar) → MinhaDeclaracao. Declaração do próprio usuário; substitui a anterior. */
export interface EntradaDeclaracaoAgente {
  semParentescoOuVinculo: boolean;
  semConflitoInteresses: boolean;
  vinculo: VinculoFuncional;
  cargoMatricula: string | null;
  capacitacao: CapacitacaoAgente;
  capacitacaoDescricao: string | null;
  vinculosDeclarados: { fornecedorId: Id; natureza: NaturezaVinculo; grauParentesco: 1 | 2 | 3 | null; descricao: string }[];
}

export interface AptidaoAgente {
  usuario: UsuarioResumo;
  declaracao: { declaradaEm: InstanteISO; validaAte: DataISO; vinculo: VinculoFuncional; capacitacao: CapacitacaoAgente } | null;
  papeis: { papel: string; apto: boolean; pendencias: string[]; sinais: string[] }[];
}
/** GET /impedimentos/declaracoes/minha (agentes:declarar) */
export interface MinhaDeclaracao {
  declaracao: DeclaracaoAgenteRegistrada | null;
  aptidao: AptidaoAgente;
}

/** GET /impedimentos/processos/:id (impedimentos:ler; escopo de UASG) */
export interface VinculosProcesso {
  processo: { id: Id; numeroSei: string; titulo: string; etapaAtual: EtapaJornada };
  analise: AnaliseVinculos;
  equipe: AptidaoAgente[];
  vinculos: VinculoRegistrado[];
}
/** GET /impedimentos/processos (impedimentos:ler) — processos com licitantes registrados, no escopo de UASG. */
export interface ProcessoComLicitantes {
  id: Id;
  numeroSei: string;
  titulo: string;
  etapaAtual: EtapaJornada;
  licitantes: number;
}
/** GET /impedimentos/fornecedores/:id (impedimentos:ler) */
export interface VinculosFornecedor {
  quadro: QuadroSocietario;
  vinculos: VinculoRegistrado[];
  sinais: SinalVinculo[];
  extensoes: ExtensaoSancao[];
}
// GET /impedimentos/sucessoes (impedimentos:ler) → SinalVinculo[] (possíveis sucessões de empresas impedidas ou inidôneas)
// ───────────────────────── Fila de integrações (RNF-07) ─────────────────────────

/** Tarefa da fila durável de integrações (RabbitMQ ou PostgreSQL), executada pelo serviço trabalhador. */
export type TipoTarefaFila = 'sincronizacao' | 'pncp.compra' | 'pncp.arquivo' | 'pncp.contrato';
/** 'pendente' inclui a espera de nova tentativa (`tentativas` > 0 e `proximaTentativaEm`); 'erro' é a fila de erro (dead letter). */
export type SituacaoTarefaFila = 'pendente' | 'executando' | 'concluida' | 'erro';
export interface TarefaFila {
  id: Id;
  tipo: TipoTarefaFila;
  descricao: string;
  situacao: SituacaoTarefaFila;
  tentativas: number;
  maximoTentativas: number;
  proximaTentativaEm: InstanteISO | null;
  ultimoErro: string | null;
  chaveIdempotencia: string;
  recurso: { tipo: 'processo' | 'contrato' | 'sincronizacao'; id: string } | null;
  uasg: string | null;
  criadaEm: InstanteISO;
  atualizadaEm: InstanteISO;
  concluidaEm: InstanteISO | null;
}
export interface ResumoFila {
  transporte: 'rabbitmq' | 'postgres';
  trabalhador: 'embutido' | 'separado';
  pendentes: number;
  executando: number;
  comErro: number;
  concluidasUltimas24h: number;
  politica: { maximoTentativas: number; esperaBaseMs: number; esperaMaximaMs: number };
}
// GET /fila/resumo → ResumoFila ; GET /fila/tarefas?situacao&pagina&tamanhoPagina → Pagina<TarefaFila> (integracoes:executar ou admin:usuarios; escopo de UASG)
// POST /fila/tarefas/:id/reprocessar → TarefaFila (integracoes:executar; só tarefas na fila de erro; auditado)
// POST /sincronizacoes/:fonte/executar publica a tarefa: 200 com o resultado quando o trabalhador é embutido; 202 (situação 'executando') quando roda à parte.

// ───────────────────────── Publicação no PNCP (RF-19) ─────────────────────────

export type SituacaoEnvioPncp = 'na_fila' | 'nova_tentativa' | 'enviando' | 'publicado' | 'erro';
export interface EnvioPncp {
  id: Id;
  tarefaId: Id;
  objeto: 'compra' | 'arquivo' | 'contrato';
  titulo: string;
  /** Código da tabela "Tipo de documento" do PNCP (2 = Edital, 3 = Minuta do contrato, 4 = Termo de referência). */
  tipoDocumentoPncp: number | null;
  situacao: SituacaoEnvioPncp;
  /** 'online' = PNCP real (treinamento ou produção); 'offline' = simulação determinística. */
  modo: 'offline' | 'online';
  tentativas: number;
  maximoTentativas: number;
  proximaTentativaEm: InstanteISO | null;
  ultimoErro: string | null;
  /** Endereço devolvido pelo PNCP no 201 (`location`) ou protocolo simulado. */
  protocolo: string | null;
  numeroControle: string | null;
  /** SHA-256 do arquivo enviado (proveniência). */
  hashArquivo: string | null;
  enviadoEm: InstanteISO | null;
}
export interface PublicacaoPncp {
  processoId: Id;
  numeroControle: string | null;
  /** Registro oficial no portal do PNCP — só quando a publicação foi feita no PNCP real. */
  linkPncp: string | null;
  /** Página pública da Ágora com o inteiro teor, sem cadastro nem login (art. 25, § 3º). */
  linkPublico: string | null;
  envios: EnvioPncp[];
  /** Divulgação do contrato (art. 94), quando já solicitada. */
  contrato: EnvioPncp | null;
  /** Documentos que não vão ao PNCP por estarem classificados (RN-40; art. 13). */
  retidosPorSigilo?: DocumentoRetidoPorSigilo[];
}
// GET /processos/:id/publicacao-pncp → PublicacaoPncp (jornada:ler)
// POST /processos/:id/publicar → ProcessoDetalhe (jornada:publicar): publica a contratação com o edital pela fila; os anexos seguem depois do 201
// POST /processos/:id/contrato/publicar-pncp → PublicacaoPncp (jornada:publicar): divulga o contrato gerado (art. 94)

// ───────────────────────── Sigilo de segurança pública (F25: RN-40, RF-33 e RNF-09) ─────────────────────────

export type GrauSigilo = 'reservada' | 'secreta' | 'ultrassecreta';
/** `lai`: informação classificada (Lei 12.527/2011); `orcamento`: sigilo do orçamento estimado (Lei 14.133/2021, art. 24). */
export type TipoSigilo = 'lai' | 'orcamento';
/** Incisos do art. 23 da LAI. */
export type HipoteseSigiloLai = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII';
/** Autoridade classificadora (LAI, art. 27, I a III, e § 1º). */
export type NivelAutoridadeClassificadora = 'ministro_estado' | 'titular_entidade' | 'direcao_das_101_5' | 'delegacao';
/** O que é classificado: o processo inteiro, um documento gerado (por tipo), um anexo do processo ou o contrato. */
export type AlvoSigilo = 'processo' | 'documento' | 'anexo' | 'contrato';

export interface AutoridadeClassificadoraSigilo {
  nome: string;
  cargo: string;
  nivel: NivelAutoridadeClassificadora;
  atoDelegacao: string | null;
}

export interface ClassificacaoSigilo {
  id: Id;
  alvo: AlvoSigilo;
  documentoTipo: DocumentoGerado['tipo'] | null;
  arquivoId: Id | null;
  contratoId: Id | null;
  tipo: TipoSigilo;
  grau: GrauSigilo | null;
  hipotese: HipoteseSigiloLai | null;
  razoes: string;
  dataProducao: DataISO;
  prazoFim: DataISO | null;
  eventoFim: string | null;
  /** No termo por evento, a data em que a informação fica pública mesmo sem o evento (prazo máximo do grau). */
  prazoLimite: DataISO | null;
  autoridade: AutoridadeClassificadoraSigilo | null;
  fundamento: string;
  /** Código de indexação simplificado (Decreto 7.845/2012, art. 2º, III). */
  codigoIndexacao: string;
  /** 'expirada': o prazo passou e a informação ficou pública sozinha (LAI, art. 24, § 4º). */
  situacao: 'vigente' | 'desclassificada' | 'expirada';
  versao: number;
  classificadaEm: InstanteISO;
  classificadaPor: UsuarioResumo;
  desclassificadaEm: InstanteISO | null;
  motivoDesclassificacao: string | null;
}

export interface EntradaClassificacaoSigilo {
  alvo: AlvoSigilo;
  documentoTipo?: DocumentoGerado['tipo'];
  arquivoId?: Id;
  tipo: TipoSigilo;
  grau: GrauSigilo | null;
  hipotese: HipoteseSigiloLai | null;
  razoes: string;
  dataProducao: DataISO;
  prazoFim: DataISO | null;
  eventoFim: string | null;
  autoridade: AutoridadeClassificadoraSigilo | null;
  /** Obrigatório na reclassificação (já há classificação vigente para o mesmo alvo). */
  motivoReclassificacao?: string;
}

export interface CredencialAcessoSigilo {
  id: Id;
  usuario: UsuarioResumo;
  grauMaximo: GrauSigilo;
  /** Credencial de segurança (Decreto 7.845/2012, art. 18) ou, excepcionalmente, Termo de Compromisso de Manutenção de Sigilo (parágrafo único). */
  fundamento: 'credencial_seguranca' | 'tcms';
  necessidade: string;
  validaAte: DataISO | null;
  ativa: boolean;
  concedidaEm: InstanteISO;
  concedidaPor: UsuarioResumo;
  revogadaEm: InstanteISO | null;
  motivoRevogacao: string | null;
}

export interface EntradaCredencialSigilo {
  usuarioId: Id;
  grauMaximo: GrauSigilo;
  fundamento: 'credencial_seguranca' | 'tcms';
  necessidade: string;
  validaAte: DataISO | null;
}

export interface ItemSigiloProcesso {
  alvo: 'documento' | 'anexo';
  documentoTipo: DocumentoGerado['tipo'] | null;
  arquivoId: Id | null;
  titulo: string;
  descricao: string;
  /** Anexo cifrado no cofre (AES-256-GCM). */
  noCofre: boolean;
  classificacao: ClassificacaoSigilo | null;
}

export interface UsuarioCredenciavel {
  id: Id;
  nome: string;
  perfis: CodigoPerfil[];
}

export interface SigiloProcesso {
  processoId: Id;
  numeroSei: string;
  titulo: string;
  processo: ClassificacaoSigilo | null;
  contrato: { id: Id; numero: string; classificacao: ClassificacaoSigilo | null } | null;
  itens: ItemSigiloProcesso[];
  orcamento: {
    sigiloso: boolean;
    motivo: string | null;
    situacao: 'publico' | 'sigiloso' | 'divulgado';
    divulgadoEm: InstanteISO | null;
    mensagem: string;
    fundamento: string;
  };
  credenciais: CredencialAcessoSigilo[];
  /** Usuários com acesso à UASG do processo que podem receber credencial (diálogo de credenciamento). */
  credenciaveis: UsuarioCredenciavel[];
  meuAcesso: {
    orgaoControle: boolean;
    credencial: CredencialAcessoSigilo | null;
    podeClassificar: boolean;
    podeCredenciar: boolean;
  };
  cofre: { disponivel: boolean; algoritmo: 'AES-256-GCM'; chaveId: string | null; motivoIndisponivel: string | null };
  /** Classificações anteriores (desclassificadas ou substituídas), da mais recente para a mais antiga. */
  historico: ClassificacaoSigilo[];
}

export type BaseAcessoSigilo =
  | 'sem_sigilo'
  | 'controle'
  | 'credencial'
  | 'orcamento_divulgado'
  | 'negado_sem_credencial'
  | 'negado_credencial_vencida'
  | 'negado_grau_insuficiente';

export interface AcessoSigiloRegistrado {
  id: Id;
  ocorridoEm: InstanteISO;
  usuario: UsuarioResumo;
  alvo: AlvoSigilo;
  titulo: string;
  operacao: 'consulta' | 'pdf' | 'download';
  permitido: boolean;
  base: BaseAcessoSigilo;
  motivo: string | null;
}

export interface DocumentoRetidoPorSigilo {
  documento: 'edital' | 'tr' | 'minuta_contrato';
  titulo: string;
  motivo: string;
}

export interface SigiloEditalPublico {
  /** Processo classificado pela LAI: só número, data e aviso (Decreto 7.845/2012, art. 20). */
  registroMinimo: boolean;
  mensagem: string | null;
  /** Documentos do edital retidos por classificação (não aparecem e não vão ao PNCP). */
  documentosRetidos: number;
  orcamento: {
    situacao: 'publico' | 'sigiloso' | 'divulgado';
    /** Valor total estimado: com orçamento sigiloso, só depois da fase de lances ou do julgamento. */
    valorEstimado: Centavos | null;
    divulgadoEm: InstanteISO | null;
    mensagem: string;
    fundamento: string;
  };
}

export interface SigiloContratoPublico {
  mensagem: string;
  fundamento: string;
}

// GET  /processos/:id/sigilo → SigiloProcesso (sigilo:ler)
// POST /processos/:id/sigilo/classificacoes body EntradaClassificacaoSigilo → SigiloProcesso (sigilo:classificar)
// POST /processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar body { motivo } → SigiloProcesso (sigilo:classificar)
// POST /processos/:id/sigilo/credenciais body EntradaCredencialSigilo → SigiloProcesso (sigilo:credenciar)
// POST /processos/:id/sigilo/credenciais/:credencialId/revogar body { motivo } → SigiloProcesso (sigilo:credenciar)
// GET  /processos/:id/sigilo/acessos?pagina&tamanhoPagina → Pagina<AcessoSigiloRegistrado> (sigilo:ler)
// POST /processos/:id/sigilo/documentos/:tipo/pdf body { motivo } → application/pdf com a marcação (sigilo:ler + decisão de acesso)
// POST /processos/:id/sigilo/anexos?titulo&... (corpo binário) → SigiloProcesso 201 (sigilo:classificar)
// POST /processos/:id/sigilo/anexos/:arquivoId/baixar body { motivo } → arquivo decifrado (sigilo:ler + decisão de acesso)

// ───────────────────────── Carimbo de tempo da trilha de auditoria (RNF-09) ─────────────────────────

export interface AncoragemTrilha {
  id: Id;
  /** Último evento coberto: o hash da cadeia nesse evento garante todos os anteriores. */
  sequencia: number;
  hash: string;
  /** SHA-256 da declaração ancorada (o que a autoridade carimbou). */
  impressao: string;
  /** 'rfc3161': token de uma autoridade de carimbo do tempo; 'local': registro do próprio servidor (modo offline). */
  modo: 'rfc3161' | 'local';
  origem: 'periodica' | 'manual';
  ancoradaEm: InstanteISO;
  /** Endereço da autoridade de carimbo (sem credenciais). */
  autoridade: string | null;
  carimboEm: InstanteISO | null;
  numeroSerie: string | null;
  politica: string | null;
  hashToken: string | null;
  solicitadaPor: UsuarioResumo | null;
}

export interface SituacaoAncoragens {
  modo: 'rfc3161' | 'local';
  autoridade: string | null;
  intervaloHoras: number;
  proxima: { devida: boolean; motivo: string };
  itens: AncoragemTrilha[];
}

export interface ConferenciaAncoragemTrilha {
  ancoragemId: Id;
  sequencia: number;
  modo: 'rfc3161' | 'local';
  situacao: 'integra' | 'divergente';
  problemas: string[];
  avisos: string[];
}

export interface VerificacaoAncoragens {
  verificadoEm: InstanteISO;
  cadeiaIntegra: boolean;
  integras: number;
  divergentes: number;
  ancoragens: ConferenciaAncoragemTrilha[];
}
// GET  /auditoria/ancoragens → SituacaoAncoragens (auditoria:ler)
// POST /auditoria/ancoragens → AncoragemTrilha (auditoria:ancorar)
// GET  /auditoria/ancoragens/verificacao → VerificacaoAncoragens (auditoria:ler)
