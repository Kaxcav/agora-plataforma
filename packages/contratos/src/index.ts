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
  | 'controle_interno'
  | 'cidadao';

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
  | 'fiscalizacao:designar'
  | 'fiscalizacao:registrar'
  | 'recebimentos:registrar'
  | 'garantias:registrar'
  | 'garantias:executar'
  | 'pagamentos:ordem_cronologica'
  | 'pca:ler'
  | 'pca:editar'
  | 'pca:aprovar'
  | 'irp:gerenciar'
  | 'irp:aderir'
  | 'operacao:ler'
  | 'operacao:administrar'
  | 'metas:ler'
  | 'metas:configurar'
  | 'imr:configurar'
  | 'imr:medir'
  | 'pagamentos:conferir'
  | 'jornada:autorizar'
  | 'sociedade:ler'
  | 'sociedade:manifestar'
  | 'sociedade:moderar'
  | 'sociedade:responder'
  | 'sociedade:registrar'
  | 'sociedade:relatorio_final'
  | 'alteracoes:parecer'
  | 'alteracoes:decidir'
  | 'normas:ler'
  | 'qualidade_ia:ler'
  | 'sigilo:ler'
  | 'sigilo:classificar'
  | 'sigilo:credenciar'
  | 'sigilo:controle'
  | 'auditoria:ancorar'
  | 'desempenho:avaliar'
  | 'desempenho:certificar'
  | 'licoes:registrar'
  | 'pagamentos:registrar';

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
  impedido: boolean;
  idc: { nota: number; faixa: FaixaIdc; semHistorico: boolean } | null;
}

export type FaixaIdc = 'diamante' | 'ouro' | 'prata' | 'em_observacao' | 'critico' | 'sem_historico';

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
  tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste' | 'qualitativa' | 'reequilibrio';
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
  tipo: 'dfd' | 'etp' | 'matriz_riscos' | 'nota_tecnica_precos' | 'tr' | 'edital' | 'minuta_contrato' | 'parecer_checklist' | TipoDocumentoComplementar;
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
export type PapelDestinatario = 'gestor' | 'fiscal' | 'contratada' | 'responsavel' | 'emitente_garantia';
export type SituacaoEnvio = 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'suprimido';
export type FaixaVencimento = 30 | 60 | 90 | 120;
/** smtp = servidor de e-mail do órgão; webservice = SEI do órgão (SeiWS); simulado = driver de demonstração (nada sai do servidor). */
export type ModoCanalNotificacao = 'simulado' | 'smtp' | 'desligado' | 'webservice';

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
  tipo: 'nao_padronizacao' | 'artigo_luxo' | 'etp_ausencia' | 'expurgo_cotacao' | 'ordem_cronologica';
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
  /** RN-33 (arts. 105 a 114): travas da prorrogação, conforme a natureza do contrato. */
  natureza?: NaturezaDuracaoContrato;
  vantajosidadeAtestada?: boolean;
  precoCompativel?: boolean;
  previsaoEdital?: boolean;
  creditoOrcamentario?: boolean;
  causaAtraso?: 'sem_culpa_contratado' | 'culpa_contratado';
  moraConstituida?: boolean;
}
export interface RespostaProrrogacao {
  aditivo: Aditivo;
  verificacao: VerificacaoRegularidade;
  /** Registro do termo na aba Alterações (RF-27), com a divulgação no PNCP. */
  alteracao?: AlteracaoContratual;
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
export type TipoTarefaFila =
  | 'sincronizacao'
  | 'pncp.compra'
  | 'pncp.arquivo'
  | 'pncp.contrato'
  | 'pncp.termo'
  | 'sei.envio'
  | 'sei.assinaturas'
  | 'dou.conferencia'
  | 'pncp.pca'
  | 'pncp.contratacao_direta'
  | 'pncp.extrato_cartao';
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

// ───────────────────────── Execução contratual: fiscalização, recebimentos, garantias e prazos de pagamento (F22, frente L) ─────────────────────────

export type PapelFiscalizacao = 'gestor' | 'fiscal_tecnico' | 'fiscal_administrativo' | 'fiscal_requisitante' | 'comissao_recebimento';

/** Designação de gestor, fiscal ou membro da comissão de recebimento (art. 117). `fim` preenchido = encerrada. */
export interface DesignacaoContrato {
  id: Id;
  papel: PapelFiscalizacao;
  usuario: UsuarioResumo;
  substituto: boolean;
  /** Portaria ou ato de designação (número no SEI). */
  ato: string;
  inicio: DataISO;
  fim: DataISO | null;
  motivoEncerramento: string | null;
  designadoPor: UsuarioResumo | null;
  designadoEm: InstanteISO;
}

export type TipoOcorrenciaContrato = 'falha_execucao' | 'atraso' | 'inconformidade' | 'comunicacao' | 'outra' | 'ocorrencia' | 'glosa' | 'rescisao';
export type SituacaoOcorrenciaContrato = 'aberta' | 'regularizada' | 'resolvida_no_prazo' | 'resolvida_fora_do_prazo';

/** Registro no livro de ocorrências do contrato (art. 117, § 1º). */
export interface OcorrenciaContrato {
  id: Id;
  numero: number;
  tipo: TipoOcorrenciaContrato;
  categoria?: CategoriaLicao | null;
  dataFato: DataISO;
  relato: string;
  providencia: string | null;
  prazoRegularizacao: DataISO | null;
  situacao: SituacaoOcorrenciaContrato;
  diasAtraso?: number | null;
  valorGlosa?: Centavos | null;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
  /** Aviso enviado à contratada pela central de notificações. */
  notificacaoId: Id | null;
  recebimentoId: Id | null;
  regularizadaEm: DataISO | null;
  observacaoRegularizacao: string | null;
}

/** Prazos e critérios de execução definidos no contrato (art. 92, V a VII, e art. 140, § 3º). */
export interface ParametrosExecucaoContrato {
  prazoProvisorioDiasUteis: number;
  prazoDefinitivoDiasUteis: number;
  prazoCorrecaoDiasUteis: number;
  prazoLiquidacaoDiasUteis: number;
  /** Dias corridos (art. 183: vencendo em dia sem expediente, passa ao dia útil seguinte). */
  prazoPagamentoDias: number;
  marcoPagamento: 'recebimento_definitivo' | 'liquidacao';
  indiceAtualizacao: string;
  /** Juros de mora por atraso imputável à Administração, % ao mês (0 = sem juros). */
  jurosMoraMensal: number;
  /** Prazo de garantia técnica do objeto contado do recebimento definitivo (0 = sem). */
  garantiaObjetoMeses: number;
  /** Período antecedente à ordem de serviço, em dias úteis da assinatura (art. 92, § 2º; 0 = sem). */
  periodoAntecedenteDiasUteis: number;
  /** Percentual de vagas para mulheres vítimas de violência doméstica exigido no edital (Decreto 11.430/2023; 0 = não exigido). */
  reservaMulheresPercentual: number;
  /** O edital exigiu vagas para pessoas presas ou egressas do sistema prisional (Decreto 9.450/2018). */
  reservaEgressos: boolean;
  atualizadoEm: InstanteISO | null;
  atualizadoPor: UsuarioResumo | null;
}
export type EntradaParametrosExecucao = Omit<ParametrosExecucaoContrato, 'atualizadoEm' | 'atualizadoPor'>;

export type SituacaoRecebimento = 'aguardando_provisorio' | 'aguardando_definitivo' | 'em_correcao' | 'recebido';
export type TipoTermoRecebimento = 'provisorio' | 'definitivo';
export type ResultadoTermoRecebimento = 'aceito' | 'com_ressalva' | 'rejeitado';

export interface TermoRecebimento {
  id: Id;
  tipo: TipoTermoRecebimento;
  resultado: ResultadoTermoRecebimento;
  data: DataISO;
  observacoes: string | null;
  prazoCorrecao: DataISO | null;
  responsavel: UsuarioResumo;
  papelResponsavel: PapelFiscalizacao;
  foraDoPrazo: boolean;
  /** SHA-256 do PDF do termo (o mesmo arquivo é gerado de novo a cada download). */
  hashPdf: string;
  registradoEm: InstanteISO;
}

export interface RecebimentoContrato {
  id: Id;
  numero: number;
  descricao: string;
  valor: Centavos;
  quantidade?: number | null;
  itens?: { itemContratoId: Id; quantidade: number }[] | null;
  entregueEm: DataISO;
  notaFiscal: { pagamentoId: Id; numero: string; situacao: SituacaoPagamento } | null;
  situacao: SituacaoRecebimento;
  etapaCorrecao: TipoTermoRecebimento | null;
  /** Limite do próximo termo (provisório, definitivo ou novo exame depois da correção). */
  prazoAtual: DataISO | null;
  situacaoPrazo: 'no_prazo' | 'vence_hoje' | 'vencido' | null;
  prazoCorrecao: DataISO | null;
  definitivoEm: DataISO | null;
  garantiaObjetoAte: DataISO | null;
  termos: TermoRecebimento[];
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

export type ModalidadeGarantia = 'caucao_dinheiro' | 'caucao_titulos' | 'seguro_garantia' | 'fianca_bancaria' | 'titulo_capitalizacao';
export type FinalidadeGarantia = 'execucao' | 'antecipacao';
export type SituacaoGarantiaContrato = 'aguardando_apresentacao' | 'apresentacao_vencida' | 'vigente' | 'vence_em_breve' | 'vencida' | 'liberada' | 'executada';
export type TipoMovimentoGarantia = 'exigencia' | 'apresentacao' | 'renovacao' | 'desconto_multa' | 'execucao' | 'liberacao';

export interface MovimentoGarantia {
  id: Id;
  tipo: TipoMovimentoGarantia;
  data: DataISO;
  valor: Centavos | null;
  descricao: string;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

export interface GarantiaContrato {
  id: Id;
  finalidade: FinalidadeGarantia;
  percentual: number;
  valorBase: Centavos;
  baseAnual: boolean;
  valorExigido: Centavos;
  justificativaPercentual: string | null;
  grandeVultoEngenharia: boolean;
  clausulaRetomada: boolean;
  modalidadeExigida: ModalidadeGarantia | null;
  prazoApresentacao: DataISO | null;
  modalidade: ModalidadeGarantia | null;
  /** Valor apresentado pela contratada. */
  valor: Centavos | null;
  /** Valor apresentado menos descontos e execuções. */
  saldo: Centavos;
  emissor: string | null;
  documento: string | null;
  apresentadaEm: DataISO | null;
  validaAte: DataISO | null;
  situacao: SituacaoGarantiaContrato;
  rotuloSituacao: string;
  diasParaVencer: number | null;
  alertas: string[];
  liberadaEm: DataISO | null;
  valorRestituido: Centavos | null;
  movimentos: MovimentoGarantia[];
}

export interface DescontoMulta {
  id: Id;
  origem: 'pagamento' | 'garantia';
  valor: Centavos;
  pagamento: { id: Id; notaFiscal: string } | null;
  garantiaId: Id | null;
  autoridade: string;
  ato: string;
  decididaEm: DataISO;
  justificativa: string;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

/** Multa aplicada no contrato, com o que já foi descontado (art. 156, § 8º). */
export interface MultaContrato {
  sancaoId: Id;
  incisoInfracao: string;
  aplicadaEm: DataISO | null;
  valorMulta: Centavos;
  descontado: Centavos;
  saldo: Centavos;
  descontos: DescontoMulta[];
}

export interface NotaFiscalExecucao {
  pagamentoId: Id;
  notaFiscal: string;
  competencia: string;
  valor: Centavos;
  situacao: SituacaoPagamento;
}

/** Ordem de serviço do contrato (art. 92, § 2º). */
export interface OrdemServicoContrato {
  id: Id;
  numero: string;
  expedidaEm: DataISO;
  descricao: string;
  antesDoPeriodo: boolean;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

export type ReservaCargos = 'mulheres_violencia_domestica' | 'egressos_sistema_prisional' | 'pessoas_com_deficiencia' | 'aprendizes';

/** Verificação das reservas legais de cargos em uma competência (art. 92, XVII). */
export interface VerificacaoReservasCargos {
  id: Id;
  competencia: string;
  empregados: number;
  atende: boolean;
  itens: { reserva: ReservaCargos; descricao: string; aplica: boolean; exigido: number | null; informado: number | null; atende: boolean; fundamento: string }[];
  pendencias: string[];
  observacao: string | null;
  ocorrenciaId: Id | null;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

export interface EntradaOrdemServico {
  numero: string;
  expedidaEm: DataISO;
  descricao: string;
}

export interface EntradaReservasCargos {
  competencia: string;
  empregados: number;
  mulheres: number;
  egressos: number;
  pcdComprovada: boolean;
  aprendizesComprovada: boolean;
  observacao: string | null;
}

/** GET /contratos/:id/execucao → ExecucaoContrato (contratos:ler): abas Fiscalização, Recebimentos e Garantias. */
export interface ExecucaoContrato {
  contratoId: Id;
  parametros: ParametrosExecucaoContrato | null;
  ordensServico: OrdemServicoContrato[];
  reservasCargos: VerificacaoReservasCargos[];
  designacoes: DesignacaoContrato[];
  equipe: { completa: boolean; temFiscal: boolean; faltantes: PapelFiscalizacao[] };
  ocorrencias: OcorrenciaContrato[];
  recebimentos: RecebimentoContrato[];
  garantias: GarantiaContrato[];
  multas: MultaContrato[];
  /** Notas fiscais "previstas" do contrato ainda sem entrega ligada. */
  notasDisponiveis: NotaFiscalExecucao[];
  /** Pagamentos devidos (atestados ou liquidados e não pagos), com o valor ainda disponível para retenção. */
  pagamentosDevidos: { pagamentoId: Id; notaFiscal: string; disponivel: Centavos }[];
  /** Papéis ativos do usuário da sessão neste contrato (orienta a tela; o servidor decide). */
  meusPapeis: PapelFiscalizacao[];
  /** Base de cálculo sugerida para a garantia de execução (art. 98). */
  baseGarantia: { valorBase: Centavos; anual: boolean; fundamento: string };
}

/** GET /contratos/:id/designaveis → servidores que podem ser designados (perfil de gestão ou fiscalização e UASG no escopo). */
export interface ServidorDesignavel {
  id: Id;
  nome: string;
  perfis: CodigoPerfil[];
}

export interface EntradaDesignacao {
  papel: PapelFiscalizacao;
  usuarioId: Id;
  substituto?: boolean;
  ato: string;
  inicio: DataISO;
}
export interface EntradaEncerrarDesignacao {
  fim: DataISO;
  motivo: string;
}
export interface EntradaOcorrencia {
  tipo: TipoOcorrenciaContrato;
  dataFato: DataISO;
  relato: string;
  providencia?: string | null;
  prazoRegularizacao: DataISO | null;
  notificarContratada: boolean;
}
export interface EntradaRegularizarOcorrencia {
  data: DataISO;
  observacao: string;
}
export interface EntradaRecebimento {
  descricao: string;
  valor: Centavos;
  quantidade?: number | null;
  itens?: { itemContratoId: Id; quantidade: number }[] | null;
  entregueEm: DataISO;
  pagamentoId: Id | null;
}
export interface EntradaTermoRecebimento {
  tipo: TipoTermoRecebimento;
  resultado: ResultadoTermoRecebimento;
  data: DataISO;
  observacoes: string | null;
}
export interface RespostaTermoRecebimento {
  recebimento: RecebimentoContrato;
  termo: TermoRecebimento;
  avisos: string[];
  /** Atesto da nota fiscal ligada, feito no recebimento definitivo (com o recheque de regularidade, RN-23). */
  atesto: { pagamentoId: Id; notaFiscal: string; regular: boolean; pendenciaAberta: boolean } | null;
  /** Limite de pagamento quando o marco é o recebimento definitivo. */
  limitePagamento: DataISO | null;
  notificacaoId: Id | null;
}
export interface EntradaExigenciaGarantia {
  finalidade: FinalidadeGarantia;
  percentual: number;
  /** Na antecipação, o valor antecipado; na execução, omitido (a base vem do contrato). */
  valorBase?: Centavos | null;
  justificativa: string | null;
  grandeVultoEngenharia: boolean;
  clausulaRetomada: boolean;
  modalidadeExigida: ModalidadeGarantia | null;
  prazoApresentacao: DataISO;
}
export interface EntradaApresentacaoGarantia {
  modalidade: ModalidadeGarantia;
  valor: Centavos;
  apresentadaEm: DataISO;
  validaAte: DataISO;
  emissor: string | null;
  documento: string | null;
}
export interface EntradaRenovacaoGarantia {
  data: DataISO;
  validaAte: DataISO;
  documento: string | null;
  /** Complementação do valor (recomposição), quando houver. */
  valor: Centavos | null;
}
export interface EntradaLiberacaoGarantia {
  data: DataISO;
  extincaoCulpaAdministracao: boolean;
  observacao: string;
}
export type MotivoExecucaoGarantia = 'ressarcimento_prejuizos' | 'verbas_trabalhistas' | 'retomada_seguradora';
export interface EntradaDecisaoAutoridade {
  autoridade: string;
  ato: string;
  decididaEm: DataISO;
  justificativa: string;
}
export interface EntradaExecucaoGarantia extends EntradaDecisaoAutoridade {
  motivo: MotivoExecucaoGarantia;
  valor: Centavos;
}
export interface EntradaDescontoMulta extends EntradaDecisaoAutoridade {
  valor: Centavos;
}
export interface RespostaGarantia {
  garantia: GarantiaContrato;
  avisos: string[];
  notificacaoId: Id | null;
}
export interface RespostaDescontoMulta {
  plano: { pagamentos: { pagamentoId: Id; notaFiscal: string; valor: Centavos }[]; garantia: Centavos; remanescente: Centavos; memoria: string[] };
  descontos: DescontoMulta[];
  notificacaoId: Id | null;
}

export type SituacaoPrazoPagamento = 'aguardando_marco' | 'no_prazo' | 'vence_hoje' | 'vencido' | 'pago_no_prazo' | 'pago_com_atraso';

export interface ComunicacaoAlteracaoOrdem {
  orgao: 'controle_interno' | 'tribunal_contas';
  data: DataISO;
  protocolo: string;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
}

/** Alteração justificada da ordem cronológica de pagamentos (art. 141, § 1º). */
export interface AlteracaoOrdemCronologica {
  id: Id;
  pagamento: { id: Id; notaFiscal: string; valor: Centavos; fonteRecurso: string; pagoEm: DataISO | null };
  contrato: { id: Id; numero: string; uasg: string };
  inciso: 'I' | 'II' | 'III' | 'IV' | 'V';
  hipotese: string;
  justificativa: string;
  autoridade: string;
  ato: string;
  decididaEm: DataISO;
  registradoPor: UsuarioResumo | null;
  registradoEm: InstanteISO;
  comunicacoes: ComunicacaoAlteracaoOrdem[];
  comunicacaoPendente: boolean;
}

export interface PrazoPagamento {
  pagamento: {
    id: Id;
    notaFiscal: string;
    competencia: string;
    valor: Centavos;
    situacao: SituacaoPagamento;
    pagoEm: DataISO | null;
    fonteRecurso: string;
    posicaoOrdemCronologica: number | null;
    /** Atestada ou liquidada e ainda não paga: na fila da ordem cronológica. */
    exigivel: boolean;
  };
  contrato: { id: Id; numero: string; uasg: string };
  fornecedor: string;
  parametrosDefinidos: boolean;
  marco: 'recebimento_definitivo' | 'liquidacao' | null;
  dataMarco: DataISO | null;
  /** De onde veio a data do marco: termo de recebimento definitivo, atesto (nota anterior ao registro dos termos) ou liquidação. */
  origemMarco: 'recebimento_definitivo' | 'atesto' | 'liquidacao' | null;
  limiteLiquidacao: DataISO | null;
  liquidacaoAtrasada: boolean;
  limitePagamento: DataISO | null;
  situacao: SituacaoPrazoPagamento;
  diasAtraso: number;
  explicacao: string;
  /** Atualização monetária estimada quando o limite passou (art. 92, V); requer confirmação humana. */
  atualizacao: {
    indice: string;
    percentualIndice: number;
    valorCorrecao: Centavos;
    valorJuros: Centavos;
    valorTotal: Centavos;
    competenciasSemIndice: string[];
    memoriaCalculo: string[];
    aviso: string;
  } | null;
  descontosMulta: Centavos;
  alteracoesOrdem: number;
}

export interface FiltroPrazosPagamento extends ParametrosLista {
  situacao?: SituacaoPrazoPagamento;
  uasg?: string;
}

/** GET /pagamentos/prazos → PaginaPrazosPagamento (pagamentos:ler). */
export interface PaginaPrazosPagamento extends Pagina<PrazoPagamento> {
  resumo: { vencidos: number; venceHoje: number; noPrazo: number; aguardandoMarco: number; atualizacaoEstimada: Centavos };
}

export interface EntradaAlteracaoOrdem extends EntradaDecisaoAutoridade {
  inciso: 'I' | 'II' | 'III' | 'IV' | 'V';
}
export interface EntradaComunicacaoAlteracao {
  orgao: 'controle_interno' | 'tribunal_contas';
  data: DataISO;
  protocolo: string;
}
// GET /contratos/:id/execucao → ExecucaoContrato (contratos:ler)
// PUT /contratos/:id/parametros-execucao → ParametrosExecucaoContrato (recebimentos:registrar)
// POST /contratos/:id/designacoes → DesignacaoContrato (fiscalizacao:designar); POST /designacoes/:id/encerrar
// POST /contratos/:id/ocorrencias → OcorrenciaContrato (fiscalizacao:registrar); POST /ocorrencias/:id/regularizar
// POST /contratos/:id/recebimentos → RecebimentoContrato (recebimentos:registrar)
// POST /recebimentos/:id/termos → RespostaTermoRecebimento (recebimentos:registrar); GET /recebimentos/termos/:id.pdf (contratos:ler)
// POST /contratos/:id/garantias → RespostaGarantia (garantias:registrar); POST /garantias/:id/apresentacao | renovacao | liberacao
// POST /garantias/:id/execucao → RespostaGarantia (garantias:executar); POST /sancoes/:id/descontos → RespostaDescontoMulta (garantias:executar)
// GET /pagamentos/prazos → PaginaPrazosPagamento (pagamentos:ler); GET /alteracoes-ordem → AlteracaoOrdemCronologica[] (pagamentos:ler)
// POST /pagamentos/:id/alteracoes-ordem → AlteracaoOrdemCronologica (pagamentos:ordem_cronologica)
// POST /alteracoes-ordem/:id/comunicacoes → AlteracaoOrdemCronologica (pagamentos:ordem_cronologica)
// ───────────────────────── Planejamento: PCA, catálogo e IRP (F10, F19 e F5; RF-31, RIA-13, RN-38) ─────────────────────────

export type PrioridadeDemandaPca = 'baixa' | 'media' | 'alta';
/** Categoria do item do plano (tabela 5.16 do Manual de Integração PNCP). */
export type CategoriaPca =
  | 'material'
  | 'servico'
  | 'obras'
  | 'servicos_engenharia'
  | 'solucoes_tic'
  | 'locacao_imoveis'
  | 'alienacao_concessao_permissao'
  | 'obras_servicos_engenharia';
export type SituacaoPlanoContratacoes = 'em_elaboracao' | 'consolidado' | 'aprovado' | 'publicado';
/** CATMAT (material) ou CATSER (serviço). */
export type TipoItemCatalogo = 'material' | 'servico';

/** Origem e integridade de uma consulta a sistema externo feita pelo servidor (PNCP, dados abertos de compras). */
export interface ProvenienciaConsulta {
  fonte: string;
  modo: 'offline' | 'online';
  endereco: string | null;
  consultadoEm: InstanteISO;
  registros: number;
  /** SHA-256 do conteúdo recebido (ou do resultado simulado, no modo offline). */
  hash: string;
  /** true = resposta do cache local, dentro da validade configurada. */
  deCache: boolean;
}

export interface PublicacaoPca {
  situacao: 'na_fila' | 'publicado' | 'erro';
  /** Número de controle do PCA no PNCP (`CNPJ-0-SEQUENCIAL/ANO`). */
  idPncp: string | null;
  protocolo: string | null;
  modo: 'offline' | 'online' | null;
  hashEnvio: string | null;
  publicadoEm: InstanteISO | null;
  tentativas: number;
  ultimoErro: string | null;
}

export interface ResumoPlanoContratacoes {
  id: Id;
  uasg: string;
  uasgNome: string;
  ano: number;
  situacao: SituacaoPlanoContratacoes;
  /** 'pncp' = plano lido do PNCP pelo conector (não elaborado na Ágora). */
  origem: 'agora' | 'pncp';
  demandas: number;
  itens: number;
  valorTotal: Centavos;
  publicacao: PublicacaoPca | null;
}

export interface DemandaPlanoContratacoes {
  id: Id;
  unidadeRequisitante: string;
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: TipoItemCatalogo | null;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: Centavos;
  valorTotal: Centavos;
  dataDesejada: DataISO;
  prioridade: PrioridadeDemandaPca;
  categoria: CategoriaPca;
  /** Número do item consolidado que agregou a demanda (null antes da consolidação). */
  itemNumero: number | null;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}

export interface ItemPlanoContratacoes {
  id: Id;
  numero: number;
  /** `UASG/ANO-NNNN`. */
  identificador: string;
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: TipoItemCatalogo | null;
  unidadeFornecimento: string;
  categoria: CategoriaPca;
  quantidade: number;
  valorUnitario: Centavos;
  valorTotal: Centavos;
  dataDesejada: DataISO;
  prioridade: PrioridadeDemandaPca;
  unidadesRequisitantes: string[];
  demandas: number;
}

export interface PlanoContratacoesDetalhe extends ResumoPlanoContratacoes {
  demandasRegistradas: DemandaPlanoContratacoes[];
  itensConsolidados: ItemPlanoContratacoes[];
  consolidadoPor: UsuarioResumo | null;
  consolidadoEm: InstanteISO | null;
  aprovadoPor: UsuarioResumo | null;
  aprovadoEm: InstanteISO | null;
  /** Última devolução para ajustes pela autoridade (Decreto 10.947/2022, art. 12, § 1º). */
  devolucao: { motivo: string; em: InstanteISO; por: UsuarioResumo | null } | null;
  fundamento: string;
}

export interface EntradaPlanoContratacoes {
  uasg: string;
  ano: number;
}
export interface EntradaDemandaPca {
  unidadeRequisitante: string;
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: TipoItemCatalogo | null;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: Centavos;
  dataDesejada: DataISO;
  prioridade: PrioridadeDemandaPca;
  categoria: CategoriaPca;
}
export interface EntradaDevolucaoPca {
  motivo: string;
}

/** Item de PCA publicado que o DFD pode apontar (art. 18, § 1º, II). */
export interface ItemPcaDisponivel {
  id: Id;
  identificador: string;
  uasg: string;
  ano: number;
  numero: number;
  descricao: string;
  codigoCatalogo: string | null;
  unidadeFornecimento: string;
  quantidade: number;
  valorTotal: Centavos;
  dataDesejada: DataISO;
  prioridade: PrioridadeDemandaPca;
  /** Número de controle do PCA no PNCP. */
  idPcaPncp: string | null;
}

export interface SugestaoRegistroCompartilhado {
  codigoCatalogo: string;
  descricao: string;
  quantidadeTotal: number;
  outrasUnidades: { uasg: string; quantidade: number }[];
  mensagem: string;
  fundamento: string;
}

export type SituacaoIntencaoRegistroPrecos = 'agendada' | 'aberta' | 'encerrada' | 'consolidada';

/** Planejamento do DFD: vínculo com o PCA, conferência, itens disponíveis e sinais de registro compartilhado (RIA-01). */
export interface PlanejamentoDfd {
  processoId: Id;
  uasg: string;
  exercicio: number;
  /** A UASG tem PCA publicado para o exercício: o DFD aponta o item ou justifica (art. 18, § 1º, II). */
  exigePca: boolean;
  vinculo: { tipo: 'item'; item: ItemPcaDisponivel } | { tipo: 'fora_do_pca'; justificativa: string } | null;
  vinculoRegistradoPor: UsuarioResumo | null;
  vinculoRegistradoEm: InstanteISO | null;
  conferencia: {
    situacao: 'vinculado' | 'fora_do_pca' | 'pendente' | 'sem_pca_publicado';
    pendencias: string[];
    alertas: { nivel: 'informativo' | 'atencao'; mensagem: string }[];
    fundamento: string;
  };
  itensDisponiveis: ItemPcaDisponivel[];
  /** Última consulta do PCA publicado no PNCP para a UASG. */
  consultaPncp: ProvenienciaConsulta | null;
  registroPrecosCompartilhado: SugestaoRegistroCompartilhado[];
  /** Intenções de registro de preços propostas a partir do processo. */
  irps: { id: Id; numero: string; situacao: SituacaoIntencaoRegistroPrecos; codigoCatalogo: string | null }[];
}
export type EntradaVinculoPca = { tipo: 'item'; itemId: Id } | { tipo: 'fora_do_pca'; justificativa: string };

export interface ItemCatalogoCompras {
  codigo: string;
  tipo: TipoItemCatalogo;
  descricao: string;
  /** Classe do material ou grupo do serviço. */
  classeCodigo: string | null;
  classeNome: string | null;
  pdmCodigo: string | null;
  pdmNome: string | null;
  sustentavel: boolean;
  ativo: boolean;
  origem: 'seed' | 'api';
  atualizadoEm: InstanteISO;
}
export interface ConsultaCatalogo {
  itens: ItemCatalogoCompras[];
  proveniencia: ProvenienciaConsulta;
  aviso: string | null;
}
export interface SugestaoItemCatalogo {
  codigo: string;
  tipo: TipoItemCatalogo;
  descricao: string;
  classe: string | null;
  /** 0 a 100. */
  pontuacao: number;
  termosComuns: string[];
}
/** Sinal da RIA-13: quem escolhe o código é o agente. */
export interface SugestoesCatalogo {
  regra: 'RIA-13';
  termos: string[];
  sugestoes: SugestaoItemCatalogo[];
  aviso: string;
  fundamento: string;
  fontes: string[];
  premissas: string[];
  geradoEm: InstanteISO;
  proveniencia: ProvenienciaConsulta;
}
export interface EntradaEscolhaCatalogo {
  codigo: string;
  tipo: TipoItemCatalogo;
  origem: 'sugestao' | 'busca';
  /** Pontuação da sugestão escolhida (null quando o código veio da busca). */
  pontuacao: number | null;
}

export interface AdesaoIrp {
  id: Id;
  uasg: string;
  uasgNome: string;
  quantidade: number;
  manifestacao: string;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}
export interface IntencaoRegistroPrecos {
  id: Id;
  numero: string;
  uasgGerenciadora: string;
  uasgGerenciadoraNome: string;
  processo: { id: Id; numeroSei: string } | null;
  objeto: string;
  codigoCatalogo: string | null;
  unidadeFornecimento: string;
  quantidadeGerenciador: number;
  abertura: DataISO;
  encerramento: DataISO;
  /** Dias úteis do período (RN-38: pelo menos 8). */
  diasUteis: number;
  situacao: SituacaoIntencaoRegistroPrecos;
  adesoes: AdesaoIrp[];
  /** Gerenciador + adesões registradas até agora. */
  quantidadeTotal: number;
  consolidacao: {
    quantidadeTotal: number;
    participantes: { uasg: string; papel: 'gerenciador' | 'participante'; quantidade: number; percentual: number }[];
    consolidadaEm: InstanteISO;
    consolidadaPor: UsuarioResumo | null;
  } | null;
  criadaPor: UsuarioResumo | null;
  criadaEm: InstanteISO;
  fundamento: string;
}
export interface EntradaIrp {
  uasgGerenciadora: string;
  processoId: Id | null;
  objeto: string;
  codigoCatalogo: string | null;
  unidadeFornecimento: string;
  quantidadeGerenciador: number;
  abertura: DataISO;
  encerramento: DataISO;
}
export interface EntradaAdesaoIrp {
  uasg: string;
  quantidade: number;
  manifestacao: string;
}
// GET /pca?ano&uasg → ResumoPlanoContratacoes[] (pca:ler; escopo de UASG)
// POST /pca body EntradaPlanoContratacoes → PlanoContratacoesDetalhe (pca:editar)
// GET /pca/:id → PlanoContratacoesDetalhe (pca:ler)
// POST /pca/:id/demandas body EntradaDemandaPca → PlanoContratacoesDetalhe (pca:editar; plano em elaboração)
// DELETE /pca/:id/demandas/:demandaId → PlanoContratacoesDetalhe (pca:editar; plano em elaboração)
// POST /pca/:id/consolidar → PlanoContratacoesDetalhe (pca:editar)
// POST /pca/:id/devolver body EntradaDevolucaoPca → PlanoContratacoesDetalhe (pca:aprovar)
// POST /pca/:id/aprovar → PlanoContratacoesDetalhe (pca:aprovar; quem consolidou não aprova; enfileira a publicação no PNCP)
// POST /pca/:id/publicar → PlanoContratacoesDetalhe (pca:aprovar; reabre a publicação que foi para a fila de erro)
// GET /processos/:id/pca → PlanejamentoDfd (jornada:ler) ; PUT /processos/:id/pca body EntradaVinculoPca → ProcessoDetalhe (jornada:editar; etapa 1)
// POST /processos/:id/pca/consultar → PlanejamentoDfd (jornada:editar; consulta o PCA publicado no PNCP pelo conector)
// GET /catalogo/itens?busca&tipo → ConsultaCatalogo ; GET /catalogo/sugestoes?descricao&tipo → SugestoesCatalogo (jornada:ler ou pca:ler)
// PUT /processos/:id/dfd/itens/:indice/catalogo body EntradaEscolhaCatalogo → ProcessoDetalhe (jornada:editar; etapa 1; auditado)
// GET /irps → IntencaoRegistroPrecos[] (pca:ler) ; GET /irps/:id → IntencaoRegistroPrecos
// POST /irps body EntradaIrp → IntencaoRegistroPrecos (irp:gerenciar; 422 REGRA_NEGOCIO com RN-38 se o prazo for menor que 8 dias úteis)
// POST /irps/:id/adesoes body EntradaAdesaoIrp → IntencaoRegistroPrecos (irp:aderir; só com a IRP aberta)
// POST /irps/:id/consolidar → IntencaoRegistroPrecos (irp:gerenciar; depois do encerramento)
// ───────────────────────── Operação: disponibilidade e janelas do PNCP (RNF-10, IMR-01) ─────────────────────────

export type ComponenteOperacao = 'api' | 'banco' | 'fila' | 'sincronizacao';
/** 'atingida'/'nao_atingida' com meta e medição; 'sem_meta' sem meta configurada; 'sem_dados' sem medição. */
export type SituacaoMetaIndicador = 'atingida' | 'nao_atingida' | 'sem_meta' | 'sem_dados';

export interface SituacaoComponenteOperacao {
  componente: ComponenteOperacao;
  nome: string;
  disponivel: boolean;
  /** Explicação curta do resultado (latência do banco, tarefas atrasadas, hora da última sincronização...). */
  detalhe: string;
}

export interface SituacaoOperacao {
  /** Última sondagem registrada (de qualquer réplica); null se a sonda nunca rodou. */
  verificadaEm: InstanteISO | null;
  /** A última sondagem ainda vale (não passou da validade). */
  atual: boolean;
  componentes: SituacaoComponenteOperacao[];
  /** Tarefas do PNCP aguardando nova tentativa por indisponibilidade do portal. */
  pncpEmManutencao: boolean;
  sonda: { ligada: boolean; intervaloSegundos: number; validadeSegundos: number };
  ambiente: 'demonstracao' | 'homologacao' | 'producao';
  versao: string;
  integracoes: 'offline' | 'online';
  fila: { transporte: 'rabbitmq' | 'postgres'; trabalhador: 'embutido' | 'separado' };
  /** Meta de disponibilidade configurada pelo órgão (AGORA_OPERACAO_META_DISPONIBILIDADE), ou null. */
  metaDisponibilidade: number | null;
}

export interface OcorrenciaIndisponibilidade {
  inicio: InstanteISO;
  fim: InstanteISO;
  minutos: number;
  causas: (ComponenteOperacao | 'sem_medicao')[];
}

export interface JanelaManutencaoPncp {
  /** Janela registrada pelo órgão (id) ou detectada pela fila (null). */
  id: Id | null;
  origem: 'registrada' | 'detectada';
  inicio: InstanteISO;
  fim: InstanteISO;
  minutos: number;
  descricao: string | null;
  /** Tarefas do PNCP criadas antes do fim da janela e concluídas depois dela: absorvidas pela fila. */
  tarefasAbsorvidas: number;
  /** Tarefas do PNCP daquela janela que estão na fila de erro (precisam de reprocessamento). */
  tarefasNaFilaDeErro: number;
}

export interface RelatorioDisponibilidade {
  /** Mês de referência 'AAAA-MM'. */
  mes: string;
  periodo: { inicio: InstanteISO; fim: InstanteISO };
  inicioMedicao: InstanteISO | null;
  minutosConsiderados: number;
  minutosDisponiveis: number;
  minutosIndisponiveis: number;
  minutosSemMedicao: number;
  percentual: number | null;
  metaPercentual: number | null;
  situacao: SituacaoMetaIndicador;
  componentes: { componente: ComponenteOperacao; nome: string; minutosIndisponiveis: number; percentual: number | null }[];
  ocorrencias: OcorrenciaIndisponibilidade[];
  janelasPncp: JanelaManutencaoPncp[];
  premissas: string[];
  fontes: string[];
  geradoEm: InstanteISO;
}

export interface EntradaJanelaManutencao {
  inicio: InstanteISO;
  fim: InstanteISO;
  descricao: string;
}
// GET /operacao/situacao → SituacaoOperacao (operacao:ler)
// POST /operacao/sondar → SituacaoOperacao (operacao:administrar; auditado)
// GET /operacao/disponibilidade?mes=AAAA-MM → RelatorioDisponibilidade (operacao:ler)
// GET /operacao/disponibilidade.csv?mes=AAAA-MM → CSV (operacao:ler; a exportação fica na trilha)
// POST /operacao/janelas → JanelaManutencaoPncp (operacao:administrar; auditado)

// ───────────────────────── Painel das metas do ETP (RF-39) ─────────────────────────

export interface ConfiguracaoMetasEtp {
  tempoInstrucao: {
    /** Redução pretendida do tempo de instrução sobre a linha de base (%). */
    reducaoPercentual: number | null;
    /** Linha de base de cada etapa da instrução (1 a 4), em dias corridos. */
    linhaBaseDias: Record<'1' | '2' | '3' | '4', number | null>;
  };
  errosFormais: { mitigacaoPercentual: number | null };
  economia: { economiaPercentual: number | null };
  /** Quem configurou por último (null = nunca configuradas). */
  atualizadaEm: InstanteISO | null;
  atualizadaPor: UsuarioResumo | null;
}
export type EntradaMetasEtp = Pick<ConfiguracaoMetasEtp, 'tempoInstrucao' | 'errosFormais' | 'economia'>;

export interface MedicaoTempoInstrucao {
  processosMedidos: number;
  mediaDias: number | null;
  medianaDias: number | null;
  linhaBaseDias: number | null;
  alvoDias: number | null;
  reducaoObtidaPercentual: number | null;
  situacao: SituacaoMetaIndicador;
}

export interface ExplicacaoIndicador {
  /** O que o número mede, em linguagem simples. */
  mede: string;
  /** O que ele não mede (e não deve ser lido como se medisse). */
  naoMede: string;
}

export interface EconomiaProcessoPainel {
  processo: ReferenciaControle;
  titulo: string;
  uasg: string;
  origem: 'contrato' | 'homologacao';
  /** Data do contrato ou da homologação. */
  data: DataISO;
  valorEstimado: Centavos;
  valorContratado: Centavos;
  economia: Centavos;
  economiaPercentual: number | null;
  expurgos: {
    cotacoes: number;
    descartadas: number;
    mediaComDescartadas: Centavos | null;
    mediaSemDescartadas: Centavos | null;
    efeitoNoEstimado: Centavos;
  };
}

export interface PainelMetasEtp {
  filtro: { uasg: string | null; de: DataISO; ate: DataISO };
  tempoInstrucao: {
    metaReducaoPercentual: number | null;
    etapas: (MedicaoTempoInstrucao & { etapa: number; titulo: string })[];
    fase: MedicaoTempoInstrucao;
    explicacao: ExplicacaoIndicador;
  };
  errosFormais: {
    bloqueios: number;
    processosAfetados: number;
    ocorrenciasNaoBarradas: number;
    mitigacaoPercentual: number | null;
    metaPercentual: number | null;
    situacao: SituacaoMetaIndicador;
    porRegra: { regra: string; titulo: string; bloqueios: number }[];
    porTrava: { trava: string; rotulo: string; bloqueios: number }[];
    explicacao: ExplicacaoIndicador;
  };
  economia: {
    processos: EconomiaProcessoPainel[];
    totalEstimado: Centavos;
    totalContratado: Centavos;
    economia: Centavos;
    economiaPercentual: number | null;
    metaPercentual: number | null;
    situacao: SituacaoMetaIndicador;
    expurgos: { processosComExpurgo: number; cotacoesDescartadas: number; efeitoNoEstimado: Centavos };
    explicacao: ExplicacaoIndicador;
  };
  metasConfiguradas: boolean;
  premissas: string[];
  fontes: string[];
  geradoEm: InstanteISO;
}
// GET /metas-etp?uasg&de&ate → PainelMetasEtp (metas:ler; escopo de UASG)
// GET /metas-etp/exportar.csv?uasg&de&ate → CSV (metas:ler; a exportação fica na trilha)
// GET /metas-etp/configuracao → ConfiguracaoMetasEtp (metas:ler)
// PUT /metas-etp/configuracao ← EntradaMetasEtp → ConfiguracaoMetasEtp (metas:configurar; auditado)
// Cada bloqueio aplicado por uma trava (RN-04, RN-01, RN-09, RN-30, RN-06, RN-21, RF-15 e as travas de avanço) vira o evento `trava.bloqueio` na trilha.
// ───────────────────────── IMR e conferência da nota fiscal (F7: RF-29 e RN-36) ─────────────────────────

/** `percentual_razao`: numerador ÷ denominador × 100. `valor_medido`: o valor aferido (horas, ocorrências...). */
export type FormaCalculoImr = 'percentual_razao' | 'valor_medido';
/** `maior_igual`: meta atingida com resultado ≥ meta. `menor_igual`: resultado ≤ meta. */
export type SentidoMetaImr = 'maior_igual' | 'menor_igual';
export type PeriodicidadeImr = 'mensal' | 'bimestral' | 'trimestral' | 'semestral';

/** Faixa de ajuste do pagamento: vale quando o resultado passa do `limite` para o lado de fora da meta. */
export interface FaixaAjusteImr {
  limite: number;
  /** Glosa fixa, em % da base do indicador. */
  percentualGlosa: number;
  /** Glosa adicional por unidade além do limite, em % da base (0 = não há). */
  percentualPorUnidade: number;
  /** Encaminha para avaliar a abertura de processo sancionatório (decisão humana). */
  encaminharSancionatorio: boolean;
}

export interface IndicadorImrContrato {
  id: Id;
  codigo: string;
  nome: string;
  formaCalculo: FormaCalculoImr;
  /** Mecanismo de cálculo descrito em palavras. */
  descricaoCalculo: string;
  rotuloNumerador: string | null;
  rotuloDenominador: string | null;
  unidade: string;
  sentidoMeta: SentidoMetaImr;
  meta: number;
  periodicidade: PeriodicidadeImr;
  /** Primeira competência medida (AAAA-MM). */
  inicioCompetencia: string;
  fonteMedicao: string;
  /** Itens do contrato que formam a base da glosa; vazio = todos os itens da nota. */
  itensAlcancados: { id: Id; numero: number; descricao: string }[];
  /** Em ordem de severidade (1 = mais branda). */
  faixas: FaixaAjusteImr[];
  tetoPercentual: number | null;
  situacao: 'ativo' | 'encerrado';
  /** Última competência medida, quando encerrado. */
  encerradoApos: string | null;
  justificativaEncerramento: string | null;
  /** Com medições registradas, o indicador não é mais editado (só encerrado). */
  temMedicoes: boolean;
  criadoPor: UsuarioResumo | null;
  criadoEm: InstanteISO;
}

export interface MedicaoImr {
  id: Id;
  indicador: { id: Id; codigo: string; nome: string; unidade: string };
  competencia: string;
  numerador: number | null;
  denominador: number | null;
  valorInformado: number | null;
  resultado: number;
  atingiuMeta: boolean;
  /** Faixa aplicada (1 = mais branda); null sem glosa. */
  faixa: number | null;
  percentualGlosa: number;
  encaminharSancionatorio: boolean;
  memoriaCalculo: string[];
  evidencia: string;
  referenciaEvidencia: string | null;
  observacao: string | null;
  /** Pendência aberta para o gestor avaliar o encaminhamento sancionatório. */
  pendenciaId: Id | null;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}

export interface CompetenciaImr {
  competencia: string;
  /** Indicadores com medição devida na competência e ainda sem registro. */
  pendentes: { id: Id; codigo: string; nome: string }[];
  medicoes: number;
  /** Soma dos percentuais de glosa dos indicadores medidos (cada um incide sobre a sua base). */
  percentualGlosaSomado: number;
  pagamento: { id: Id; notaFiscal: string; situacao: SituacaoPagamento; valor: Centavos } | null;
  conferencia: { situacao: SituacaoConferenciaNota; valorDevido: Centavos; glosaImr: Centavos } | null;
}

export interface ImrContrato {
  contrato: { id: Id; numero: string };
  indicadores: IndicadorImrContrato[];
  /** Mais recentes primeiro. */
  medicoes: MedicaoImr[];
  /** Competências encerradas com medição devida, mais recentes primeiro. */
  competencias: CompetenciaImr[];
  itensContrato: { id: Id; numero: number; descricao: string; unidade: string }[];
  resumo: { medicoes: number; naMeta: number; comGlosa: number; percentualNaMeta: number | null };
  fundamento: string;
  aviso: string;
}

export interface EntradaIndicadorImr {
  codigo: string;
  nome: string;
  formaCalculo: FormaCalculoImr;
  descricaoCalculo: string;
  rotuloNumerador: string | null;
  rotuloDenominador: string | null;
  unidade: string;
  sentidoMeta: SentidoMetaImr;
  meta: number;
  periodicidade: PeriodicidadeImr;
  inicioCompetencia: string;
  fonteMedicao: string;
  itensAlcancados: Id[];
  faixas: FaixaAjusteImr[];
  tetoPercentual: number | null;
}
export interface EntradaEncerrarIndicadorImr {
  /** Última competência em que o indicador vale (AAAA-MM). */
  ultimaCompetencia: string;
  justificativa: string;
}
export interface EntradaMedicaoImr {
  indicadorId: Id;
  competencia: string;
  numerador?: number | null;
  denominador?: number | null;
  valor?: number | null;
  /** Evidência da medição: relatório, sistema ou documento de onde vêm os números. */
  evidencia: string;
  /** Referência do documento da evidência (ex.: número SEI). */
  referenciaEvidencia?: string | null;
  observacao?: string | null;
}
export interface RespostaMedicaoImr {
  medicao: MedicaoImr;
  /** true quando a faixa previa encaminhamento sancionatório e a pendência do gestor foi aberta. */
  pendenciaAberta: boolean;
  /** Conferências de nota da competência ainda não atestadas e recalculadas com a nova glosa. */
  conferenciasRecalculadas: number;
}
// GET /contratos/:id/imr (contratos:ler) → ImrContrato
// POST /contratos/:id/imr/indicadores (imr:configurar) → ImrContrato (201)
// PUT /contratos/:id/imr/indicadores/:indicadorId (imr:configurar; só sem medições) → ImrContrato
// POST /contratos/:id/imr/indicadores/:indicadorId/encerrar (imr:configurar) → ImrContrato
// POST /contratos/:id/imr/medicoes (imr:medir; competência já encerrada) → RespostaMedicaoImr (201)

export type SituacaoConferenciaNota = 'conforme' | 'divergente' | 'justificada';
export type TipoDivergenciaNota =
  | 'preco_acima_contratado'
  | 'quantidade_faturada_maior_que_recebida'
  | 'quantidade_acima_do_saldo'
  | 'soma_itens_diferente_do_total'
  | 'medicao_imr_pendente'
  | 'valor_nota_diferente_do_devido';

export interface ItemConferenciaNota {
  itemContratoId: Id;
  numero: number;
  descricao: string;
  quantidadeRecebida: number;
  quantidadeFaturada: number;
  valorUnitarioContratado: Centavos;
  valorUnitarioFaturado: Centavos;
  /** Preço contratado × quantidade recebida. */
  valorDevido: Centavos;
  /** Preço cobrado × quantidade cobrada. */
  valorFaturado: Centavos;
}

export interface ConferenciaNotaFiscal {
  id: Id;
  pagamentoId: Id;
  competencia: string;
  numeroNota: string;
  emitidaEm: DataISO;
  valorNota: Centavos;
  itens: ItemConferenciaNota[];
  valorBruto: Centavos;
  glosas: { codigo: string; nome: string; percentual: number; base: Centavos; valor: Centavos }[];
  glosaImr: Centavos;
  valorDevido: Centavos;
  /** Valor da nota menos o valor devido. */
  diferenca: Centavos;
  /** O menor entre o valor da nota e o valor devido. */
  valorALiquidar: Centavos;
  divergencias: { tipo: TipoDivergenciaNota; mensagem: string; itemContratoId: Id | null }[];
  situacao: SituacaoConferenciaNota;
  justificativa: string | null;
  justificadaPor: UsuarioResumo | null;
  justificadaEm: InstanteISO | null;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
  /** Cada novo registro (correção da nota) ou recálculo pela medição aumenta a versão. */
  versao: number;
  conferidaPor: UsuarioResumo | null;
  conferidaEm: InstanteISO;
}

export interface RecebimentoDefinitivoConferencia {
  id: Id;
  numero: number;
  data: DataISO;
  termoId: Id;
  descricao?: string;
  valor?: Centavos;
  quantidadeRecebida: number;
  itens?: { itemContratoId: Id; quantidadeRecebida: number }[];
}

export interface ContextoConferenciaNota {
  pagamento: Pagamento;
  contrato: { id: Id; numero: string; objeto: string; temImr: boolean };
  itensContrato: { id: Id; numero: number; descricao: string; unidade: string; quantidade: number; valorUnitario: Centavos; saldoQuantidade: number }[];
  /** Glosas e medições pendentes do IMR na competência do pagamento. */
  imr: { competencia: string; glosas: { codigo: string; nome: string; percentual: number; itensAlcancados: Id[] }[]; pendentes: { codigo: string; nome: string }[] };
  conferencia: ConferenciaNotaFiscal | null;
  /** Situação do atesto quanto à conferência (RN-36); a regularidade do contratado (RN-23) é verificada no próprio atesto. */
  atesto: { liberado: boolean; motivo: string | null; /** A parcela ainda não foi atestada: a nota pode ser conferida, corrigida ou justificada. */ parcelaEmAberto: boolean };
  /** Termo de recebimento definitivo (art. 140) ligado a esta parcela e quantidade recebida. */
  recebimentoDefinitivo: RecebimentoDefinitivoConferencia | null;
}
export interface EntradaConferenciaNota {
  numeroNota: string;
  emitidaEm: DataISO;
  valorNota: Centavos;
  itens: { itemContratoId: Id; quantidadeRecebida: number; quantidadeFaturada: number; valorUnitarioFaturado: Centavos }[];
}
export interface EntradaJustificativaConferencia {
  justificativa: string;
}
// GET /pagamentos/:id/conferencia (pagamentos:ler) → ContextoConferenciaNota
// POST /pagamentos/:id/conferencia (pagamentos:conferir; só pagamento previsto) → ContextoConferenciaNota: registra ou corrige a nota
// POST /pagamentos/:id/conferencia/justificativa (pagamentos:conferir; só conferência divergente) → ContextoConferenciaNota
// POST /pagamentos/:id/atestar: 422 enquanto a conferência estiver divergente sem justificativa ou, em contrato com IMR, sem conferência.
// ───────────────────────── Fase preparatória: peças complementares e dotação (frente P — RF-32 e RN-39) ─────────────────────────

/**
 * Peças complementares da instrução, geradas pelo mesmo painel de documentos da jornada (POST /processos/:id/documentos/gerar),
 * com versões, aprovação e entrada na árvore do SEI. Portaria, declaração orçamentária e despacho são aprovados e assinados
 * pela autoridade competente designada no processo (`jornada:autorizar`).
 */
export type TipoDocumentoComplementar =
  | 'portaria_designacao'
  | 'declaracao_orcamentaria'
  | 'despacho_autorizacao'
  | 'nota_tecnica_conjur'
  | 'modelo_proposta'
  | 'ordem_servico'
  | 'termo_sigilo'
  | 'termo_recebimento_provisorio'
  | 'termo_recebimento_definitivo'
  | 'caderno_prova_conceito'
  | 'checklist_documentos';

/** Crédito orçamentário da contratação (RN-39; art. 150 e art. 6º, XXIII, "j"). */
export interface LinhaDotacao {
  unidadeGestora: string; // 6 dígitos
  programaTrabalho: string; // 00.000.0000.0000.0000 (função.subfunção.programa.ação.localizador)
  naturezaDespesa: string; // 4.4.90.52 (categoria.grupo.modalidade.elemento)
  fonteRecursos: string; // 10 dígitos (ou 3 a 4 na classificação anterior)
  exercicio: number;
  valor: Centavos;
  preEmpenho: string | null; // AAAAPE000000
}
export interface EntradaDotacao {
  linhas: LinhaDotacao[];
}
export type SituacaoDeclaracaoOrcamentaria = 'nao_gerada' | 'rascunho' | 'aprovada' | 'desatualizada';
export interface DotacaoProcesso {
  linhas: LinhaDotacao[];
  registradaEm: InstanteISO | null;
  registradaPor: UsuarioResumo | null;
  exercicioReferencia: number;
  total: Centavos;
  totalExercicio: Centavos;
  /** Campos completos e coerentes (validarDotacaoOrcamentaria). */
  valida: boolean;
  pendencias: string[];
  sinais: string[];
  /** Declaração de adequação orçamentária (documento `declaracao_orcamentaria`) frente à dotação atual. */
  declaracao: {
    situacao: SituacaoDeclaracaoOrcamentaria;
    versao: number | null;
    aprovadaPor: UsuarioResumo | null;
    numeroSei: string | null;
  };
  /** Dotação válida e declaração aprovada com ela: o que a RN-39 exige para seguir ao edital. */
  declarada: boolean;
  /** Pode ser alterada (até a etapa 4, processo sem contrato). */
  editavel: boolean;
  fundamento: string;
}
// GET /processos/:id/dotacao → DotacaoProcesso (jornada:ler)
// PUT /processos/:id/dotacao body EntradaDotacao → DotacaoProcesso (jornada:editar; até a etapa 4; mudar a dotação desatualiza a declaração)

export type SituacaoPecaProcesso = 'pronta' | 'rascunho' | 'desatualizada' | 'falta' | 'nao_aplicavel';
export interface ItemChecklistDocumentos {
  tipo: DocumentoGerado['tipo'];
  titulo: string;
  fundamento: string;
  obrigatoriedade: 'obrigatoria' | 'condicional' | 'recomendada';
  situacao: SituacaoPecaProcesso;
  versao: number | null;
  /** Assinada na árvore do SEI (só para peça aprovada). */
  assinado: boolean | null;
  /** Peça exigida que ainda não está pronta. */
  falta: boolean;
}
export interface ChecklistDocumentosProcesso {
  etapaAtual: EtapaJornada;
  etapas: { etapa: EtapaJornada; titulo: string; itens: ItemChecklistDocumentos[]; prontas: number; faltantes: number }[];
  prontas: number;
  faltantes: number;
  recomendadasPendentes: number;
  fundamento: string;
}
// GET /processos/:id/checklist-documentos → ChecklistDocumentosProcesso (jornada:ler)
// GET /processos/:id/documentos/:docId/pdf → application/pdf (jornada:ler; escopo de UASG): qualquer versão de documento da jornada
// ───────────────────────── Gestão compartilhada com a sociedade (RF-37) ─────────────────────────

export type AssuntoManifestacao = 'execucao' | 'qualidade' | 'prazo' | 'atendimento' | 'outro';
export type SituacaoManifestacao = 'em_moderacao' | 'publicada' | 'recusada';
export type SituacaoPrazoResposta = 'aguardando' | 'vence_em_breve' | 'vencido' | 'respondida_no_prazo' | 'respondida_fora_do_prazo';
export type FormatoMidiaSociedade = 'jpeg' | 'png' | 'mp4';
export type ConclusaoRelatorioFinal = 'atingidos' | 'parcialmente_atingidos' | 'nao_atingidos';

/** Resposta identificada: servidor com a função ou contratado com o preposto (art. 174, § 3º, VI, "c"). */
export interface RespostaManifestacao {
  id: Id;
  origem: 'administracao' | 'contratado';
  /** "Rafael A. V." (servidor) ou razão social do contratado. */
  autor: string;
  /** "Gestor do contrato", "Fiscal do contrato" ou "Preposto: <nome>". */
  funcao: string;
  texto: string; // dados pessoais tarjados
  respondidaEm: InstanteISO;
}

/** Manifestação publicada pela moderação: autor só com primeiro nome e iniciais; texto com dados pessoais tarjados. */
export interface ManifestacaoPublica {
  id: Id;
  assunto: AssuntoManifestacao;
  autor: string;
  texto: string;
  recebidaEm: InstanteISO;
  publicadaEm: InstanteISO | null;
  /** Imagem sem metadados de localização, servida pela Ágora; null sem imagem. */
  imagemUrl: string | null;
  prazoResposta: DataISO;
  situacaoPrazo: SituacaoPrazoResposta;
  respostas: RespostaManifestacao[];
}

/** Foto ou vídeo do acompanhamento da execução publicado pela fiscalização (art. 19, III). */
export interface RegistroExecucaoPublico {
  id: Id;
  titulo: string;
  descricao: string;
  midia: 'imagem' | 'video';
  formato: FormatoMidiaSociedade;
  url: string;
  /** Dia em que a foto ou o vídeo foi feito. */
  registradoEm: DataISO;
  publicadoEm: InstanteISO;
  sha256: string;
  bytes: number;
}

export interface RelatorioFinalPublico {
  objetivos: string;
  resultados: string;
  conclusao: ConclusaoRelatorioFinal;
  publicadoEm: InstanteISO;
  publicadoPor: string; // "Gestor do contrato — Rafael A. V."
  /** Dados da execução congelados na publicação. */
  execucao: {
    vigenciaInicio: DataISO;
    vigenciaFim: DataISO;
    valorGlobal: Centavos;
    valorPago: Centavos;
    aditivos: number;
    manifestacoesPublicadas: number;
    registrosPublicados: number;
  };
  /** SHA-256 do conteúdo publicado (objetivos, resultados, conclusão e dados da execução). */
  sha256: string;
  fundamento: string;
}

export interface GestaoCompartilhadaPublica {
  contratoId: Id;
  numero: string;
  manifestacoes: ManifestacaoPublica[];
  registros: RegistroExecucaoPublico[];
  relatorioFinal: RelatorioFinalPublico | null;
  /** O relatório final é publicado a partir do fim da vigência. */
  vigenciaFim: DataISO;
  prazoRespostaDias: number;
  fundamento: string;
}
// GET /publico/contratos/:id/gestao-compartilhada → GestaoCompartilhadaPublica (sem login)
// GET /publico/contratos/:id/manifestacoes/:manifestacaoId/imagem e /publico/contratos/:id/registros/:registroId/midia → bytes (só o publicado)

export interface EntradaManifestacao {
  assunto: AssuntoManifestacao;
  texto: string; // 20 a 2.000 caracteres
}
// POST /sociedade/contratos/:id/manifestacoes (sociedade:manifestar) body EntradaManifestacao → MinhaManifestacao (201, em moderação)
// POST /sociedade/manifestacoes/:id/imagem (sociedade:manifestar; corpo binário PNG ou JPEG; só o autor e só em moderação) → MinhaManifestacao

export interface MinhaManifestacao {
  id: Id;
  contrato: { id: Id; numero: string; objeto: string };
  assunto: AssuntoManifestacao;
  texto: string;
  situacao: SituacaoManifestacao;
  motivoModeracao: string | null;
  recebidaEm: InstanteISO;
  moderadaEm: InstanteISO | null;
  temImagem: boolean;
  /** Metadados removidos da imagem enviada (ex.: "EXIF e localização (APP1)"). */
  metadadosRemovidos: string[];
  prazoResposta: DataISO;
  respostas: RespostaManifestacao[];
}
// GET /sociedade/minhas-manifestacoes (sociedade:manifestar) → MinhaManifestacao[]

/** Manifestação vista pela moderação e pela Administração (escopo de UASG do contrato). */
export interface ManifestacaoModeracao {
  id: Id;
  contrato: { id: Id; numero: string; uasg: string; objeto: string };
  assunto: AssuntoManifestacao;
  autor: string; // primeiro nome e iniciais
  /** Texto como sairá em público (dados pessoais tarjados). */
  texto: string;
  dadosPessoaisTarjados: boolean;
  situacao: SituacaoManifestacao;
  motivoModeracao: string | null;
  moderadaPor: string | null;
  moderadaEm: InstanteISO | null;
  recebidaEm: InstanteISO;
  /** Imagem para a moderação (rota autenticada); null sem imagem. */
  imagemUrl: string | null;
  metadadosRemovidos: string[];
  prazoResposta: DataISO;
  situacaoPrazo: SituacaoPrazoResposta;
  respostas: RespostaManifestacao[];
}
// GET /sociedade/manifestacoes?situacao&pagina&tamanhoPagina (sociedade:ler) → Pagina<ManifestacaoModeracao>
// GET /sociedade/manifestacoes/:id/imagem (sociedade:ler) → bytes

export interface EntradaModeracao {
  decisao: 'publicar' | 'recusar';
  motivo: string; // 10 a 500 caracteres, sempre
}
// POST /sociedade/manifestacoes/:id/moderacao (sociedade:moderar) → ManifestacaoModeracao

export interface EntradaRespostaManifestacao {
  origem: 'administracao' | 'contratado';
  texto: string;
  /** Nome do preposto, obrigatório quando a resposta é do contratado. */
  representante: string | null;
}
// POST /sociedade/manifestacoes/:id/respostas (sociedade:responder) → ManifestacaoModeracao

export interface RegistroExecucaoInterno {
  id: Id;
  titulo: string;
  descricao: string;
  midia: 'imagem' | 'video';
  formato: FormatoMidiaSociedade;
  registradoEm: DataISO;
  sha256: string;
  bytes: number;
  publicado: boolean;
  /** Motivo de não publicar (ponto de checagem do sigilo). */
  motivoRetencao: string | null;
  enviadoPor: string;
  enviadoEm: InstanteISO;
  metadadosRemovidos: string[];
  url: string; // rota autenticada
}

export interface GestaoCompartilhadaContrato {
  contrato: { id: Id; numero: string; uasg: string; objeto: string; vigenciaInicio: DataISO; vigenciaFim: DataISO; encerrado: boolean };
  manifestacoes: ManifestacaoModeracao[];
  registros: RegistroExecucaoInterno[];
  relatorioFinal: RelatorioFinalPublico | null;
  armazenamentoDisponivel: boolean;
  tamanhoMaximoImagemBytes: number;
  tamanhoMaximoVideoBytes: number;
  formatosAceitos: FormatoMidiaSociedade[];
  prazoRespostaDias: number;
}
// GET /sociedade/contratos/:id (sociedade:ler) → GestaoCompartilhadaContrato
// POST /sociedade/contratos/:id/registros?titulo&descricao&registradoEm&sigiloso (sociedade:registrar; corpo binário JPEG, PNG ou MP4) → RegistroExecucaoInterno
// GET /sociedade/contratos/:id/registros/:registroId/midia (sociedade:ler) → bytes

export interface EntradaRelatorioFinal {
  objetivos: string;
  resultados: string;
  conclusao: ConclusaoRelatorioFinal;
}
// POST /sociedade/contratos/:id/relatorio-final (sociedade:relatorio_final; só após o fim da vigência; um por contrato) → RelatorioFinalPublico

// ───────────────────────── Dados abertos (RF-38) ─────────────────────────

export type TipoColunaDadosAbertos = 'identificador' | 'texto' | 'inteiro' | 'decimal' | 'data' | 'booleano';
export interface ColunaDicionarioDados {
  nome: string;
  tipo: TipoColunaDadosAbertos;
  descricao: string;
}
export interface ArquivoConjuntoDados {
  formato: 'csv' | 'json';
  url: string;
  tipoMidia: string;
  sha256: string;
  bytes: number;
}
export interface ConjuntoDadosAbertos {
  id: string;
  titulo: string;
  descricao: string;
  fundamento: string;
  publicador: string;
  licenca: { nome: string; identificador: string; url: string };
  /** Última alteração dos dados do conjunto (null quando vazio). */
  atualizadoEm: InstanteISO | null;
  periodicidade: string;
  registros: number;
  arquivos: ArquivoConjuntoDados[];
  dicionario: ColunaDicionarioDados[];
}
export interface CatalogoDadosAbertos {
  publicador: string;
  geradoEm: InstanteISO;
  conjuntos: ConjuntoDadosAbertos[];
  limiteRequisicoesPorMinuto: number;
  /** Conjuntos previstos que ainda não existem na Ágora (ex.: plano de contratações anual). */
  indisponiveis: { id: string; titulo: string; motivo: string }[];
}
// GET /publico/dados-abertos → CatalogoDadosAbertos ; GET /publico/dados-abertos/:conjunto → ConjuntoDadosAbertos
// GET /publico/dados-abertos/:conjunto/csv e /json → arquivo (sem login; limite de requisições por IP; cabeçalho X-Agora-SHA256)
// ───────── Frente K (F22a): execução contratual como ato — RN-32, RN-33 e RF-27 ─────────

/** Natureza do contrato quanto à duração (Lei 14.133/2021, arts. 105 a 114). */
export type NaturezaDuracaoContrato = 'continuo' | 'ti_estruturante' | 'escopo' | 'receita_sem_investimento' | 'receita_com_investimento';
export type RegimeMaoDeObra = 'dedicacao_exclusiva' | 'predominancia' | 'sem_dedicacao';
export type EspecieAlteracaoContratual = 'aditivo' | 'apostila' | 'rescisao';
export type TipoAlteracaoContratual = 'acrescimo' | 'supressao' | 'qualitativa' | 'prazo' | 'reequilibrio' | 'reajuste' | 'repactuacao' | 'extincao';
export type SituacaoAlteracaoContratual =
  | 'aguardando_parecer'
  | 'pronto_para_assinatura'
  | 'devolvido'
  | 'em_contraditorio'
  | 'aguardando_decisao'
  | 'assinado'
  | 'indeferido'
  | 'arquivado';
export type ResultadoParecerAlteracao = 'favoravel' | 'favoravel_com_ressalvas' | 'desfavoravel';
export type EnquadramentoReequilibrio =
  | 'forca_maior'
  | 'caso_fortuito'
  | 'fato_principe'
  | 'fato_imprevisivel'
  | 'previsivel_consequencias_incalculaveis'
  | 'tributo_superveniente'
  | 'alteracao_unilateral';
export type FormaExtincaoContrato = 'unilateral' | 'consensual' | 'judicial_arbitral';
export type MotivoExtincaoContrato =
  | 'art137_I'
  | 'art137_II'
  | 'art137_III'
  | 'art137_IV'
  | 'art137_V'
  | 'art137_VI'
  | 'art137_VII'
  | 'art137_VIII'
  | 'art137_IX'
  | 'art137_p2_I'
  | 'art137_p2_II'
  | 'art137_p2_III'
  | 'art137_p2_IV'
  | 'art137_p2_V';
export type EfeitoExtincaoContrato =
  | 'assuncao_objeto'
  | 'ocupacao_local'
  | 'execucao_garantia'
  | 'retencao_creditos'
  | 'devolucao_garantia'
  | 'pagamentos_devidos'
  | 'custo_desmobilizacao'
  | 'ressarcimento_prejuizos';

/** Divulgação do termo no PNCP pela fila de integrações (art. 94 para o aditivo; art. 174 para apostila e rescisão). */
export interface DivulgacaoAlteracaoPncp {
  situacao: SituacaoEnvioPncp | 'nao_solicitada' | 'importado';
  modo: 'offline' | 'online' | null;
  tarefaId: Id | null;
  protocolo: string | null;
  numeroControle: string | null;
  hashDados: string | null;
  enviadoEm: InstanteISO | null;
  ultimoErro: string | null;
  prazo: {
    situacao: 'divulgado_no_prazo' | 'divulgado_fora_do_prazo' | 'pendente_no_prazo' | 'pendente_vencido' | 'sem_prazo_de_eficacia';
    limite: DataISO | null;
    explicacao: string;
  } | null;
}

/** Um ato do histórico de alterações (termo aditivo, apostila, reequilíbrio ou extinção). */
export interface AlteracaoContratual {
  id: Id;
  contratoId: Id;
  especie: EspecieAlteracaoContratual;
  tipo: TipoAlteracaoContratual;
  situacao: SituacaoAlteracaoContratual;
  /** "2º Termo Aditivo", "1º Apostilamento", "Termo de Rescisão" (definido na assinatura). */
  numero: string | null;
  /** Efeito no valor global, com sinal (supressão e redução negativas). */
  valor: Centavos;
  novaVigenciaFim: DataISO | null;
  justificativa: string;
  /** 'importado': termo assinado antes da Ágora (carga do Contratos.gov.br), sem o ciclo de parecer e assinatura. */
  origem: 'agora' | 'importado';
  /** Linhas de resumo do ato, já formatadas pelo servidor (índice, percentuais, componentes, motivo...). */
  detalhes: { rotulo: string; valor: string }[];
  /** Explicação da trava aplicada (RN-32, RN-33...), com o fundamento. */
  avaliacao: { explicacao: string; fundamento: string } | null;
  parecer: { resultado: ResultadoParecerAlteracao; numero: string; texto: string; emitidoPor: UsuarioResumo | null; emitidoEm: InstanteISO } | null;
  decisao: { resultado: string; fundamentacao: string; decididoPor: UsuarioResumo | null; decididoEm: InstanteISO } | null;
  contraditorio: {
    prazoDiasUteis: number;
    prazoFim: DataISO;
    notificadoEm: InstanteISO;
    defesa: { apresentadaEm: DataISO; resumo: string } | null;
    semManifestacao: boolean;
  } | null;
  propostoPor: UsuarioResumo | null;
  propostoEm: InstanteISO;
  assinadoPor: UsuarioResumo | null;
  assinadoEm: DataISO | null;
  verificacaoRegularidadeId: Id | null;
  divulgacao: DivulgacaoAlteracaoPncp;
  /** Termo em PDF (GET), quando assinado. */
  linkTermo: string | null;
  /** Próximos passos possíveis pela situação (o servidor ainda confere a permissão de quem pede). */
  acoes: { parecer: boolean; assinar: boolean; indeferir: boolean; defesa: boolean; decidirExtincao: boolean; divulgar: boolean };
}

/** GET /contratos/:id/alteracoes → PainelAlteracoesContrato (contratos:ler) */
export interface PainelAlteracoesContrato {
  contratoId: Id;
  natureza: NaturezaDuracaoContrato | null;
  regimeMaoDeObra: RegimeMaoDeObra | null;
  extintoEm: DataISO | null;
  /** Art. 125: acréscimos e supressões acumulados sobre o valor inicial atualizado. */
  limites: {
    valorInicial: Centavos;
    reajustes: Centavos;
    valorInicialAtualizado: Centavos;
    acrescimos: Centavos;
    supressoes: Centavos;
    percentualAcrescimos: number;
    percentualSupressoes: number;
    limiteAcrescimos: number;
    limiteSupressoes: number;
    margemAcrescimos: Centavos;
    margemSupressoes: Centavos;
    nivel: 'regular' | 'proximo' | 'excedido';
    explicacao: string;
    fundamento: string;
  };
  prorrogacao: {
    tipo: 'planejar_prorrogacao' | 'limite_prorrogacao' | 'nova_licitacao' | 'prorrogacao_automatica' | 'natureza_nao_informada';
    limiteVigencia: DataISO | null;
    diasRestantes: number;
    mensagem: string;
    fundamento: string;
  };
  reajuste: {
    indice: string;
    dataBase: DataISO;
    ciclosAplicados: number;
    proximoAniversario: DataISO;
    /** O interregno de 12 meses do próximo ciclo já se completou. */
    disponivel: boolean;
    saldoContratual: Centavos;
  };
  alteracoes: AlteracaoContratual[];
}

/** POST /contratos/:id/alteracoes → 201 AlteracaoContratual (contratos:editar). Recusa com 422 (RN-32, RN-33). */
export type EntradaProporAlteracao =
  | {
      tipo: 'acrescimo' | 'supressao';
      valor: Centavos;
      reformaEdificioOuEquipamento?: boolean;
      justificativa: string;
    }
  | {
      tipo: 'qualitativa';
      valor: Centavos;
      efeitoFinanceiro: 'acrescimo' | 'supressao' | 'nenhum';
      descricaoAlteracao: string;
      justificativa: string;
    }
  | ({ tipo: 'prazo'; justificativa: string } & Omit<EntradaProrrogarContrato, 'justificativa'>)
  | {
      tipo: 'reequilibrio';
      enquadramento: EnquadramentoReequilibrio;
      /** Risco da matriz de riscos do contrato ao qual o evento se refere; ausente = evento não previsto na matriz. */
      riscoId?: Id | null;
      dataEvento: DataISO;
      solicitadoEm: DataISO;
      solicitante: 'contratada' | 'administracao';
      sentido: 'aumento' | 'reducao';
      valor: Centavos;
      demonstracao: string;
      justificativa: string;
    };

/** POST /contratos/:id/alteracoes/:alteracaoId/parecer (alteracoes:parecer) */
export interface EntradaParecerAlteracao {
  resultado: ResultadoParecerAlteracao;
  numero: string;
  texto: string;
}
/** POST /contratos/:id/alteracoes/:alteracaoId/assinar (alteracoes:decidir) → AlteracaoContratual. No reequilíbrio, o valor reconhecido pode ser menor que o pleiteado. */
export interface EntradaAssinarAlteracao {
  confirmacao: true;
  valorReconhecido?: Centavos;
  fundamentacao?: string;
}
/** POST /contratos/:id/alteracoes/:alteracaoId/indeferir (alteracoes:decidir) */
export interface EntradaIndeferirAlteracao {
  fundamentacao: string;
}
/** POST /contratos/:id/reajustes → 201 AlteracaoContratual (alteracoes:decidir): apostila (art. 136, I). */
export interface EntradaReajusteContrato {
  percentual: number;
  fonteIndice: string;
  observacao?: string | null;
}
/** POST /contratos/:id/repactuacoes → 201 AlteracaoContratual (alteracoes:decidir): apostila (art. 135 e art. 136, I). */
export interface EntradaRepactuacaoContrato {
  regimeMaoDeObra?: RegimeMaoDeObra;
  solicitadaEm: DataISO;
  efeitosDesde: DataISO;
  componentes: {
    descricao: string;
    origem: 'mao_de_obra' | 'insumos';
    dataBase: DataISO;
    valorMensalAnterior: Centavos;
    valorMensalNovo: Centavos;
    documento: string;
  }[];
  clausulasNaoTrabalhistasExcluidas: boolean;
  justificativa: string;
}
/** POST /contratos/:id/extincao → 201 AlteracaoContratual (contratos:editar) */
export interface EntradaInstaurarExtincao {
  forma: FormaExtincaoContrato;
  motivo: MotivoExtincaoContrato;
  fundamentacao: string;
  prazoDefesaDiasUteis?: number | null;
  interesseAdministracao?: boolean;
  referenciaDecisao?: string | null;
}
/** POST /contratos/:id/alteracoes/:alteracaoId/defesa (contratos:editar) */
export type EntradaDefesaExtincao = { semManifestacao: true } | { semManifestacao?: false; apresentadaEm: DataISO; resumo: string };
/** POST /contratos/:id/alteracoes/:alteracaoId/decidir-extincao (alteracoes:decidir) */
export interface EntradaDecidirExtincao {
  decisao: 'extinguir' | 'arquivar';
  dataEfeitos: DataISO;
  fundamentacao: string;
  culpaAdministracao: boolean;
  efeitos: EfeitoExtincaoContrato[];
  autorizacaoMinistro?: boolean;
}
// GET /contratos/:id/alteracoes/:alteracaoId/termo.pdf (contratos:ler) — termo assinado em PDF, para juntar ao processo
// POST /contratos/:id/alteracoes/:alteracaoId/divulgar-pncp (alteracoes:decidir) — reabre a divulgação que está na fila de erro
// ───────────────────────── IA ancorada: base normativa (RNF-08), citações (RIA-14) e conferência cruzada (RIA-15) ─────────────────────────

/** Origem do texto da lei guardado na Ágora: órgão, endereço, data e hash do arquivo e do texto. */
export interface ProvenienciaBaseNormativa {
  fonte: string;
  url: string;
  obtidoEm: InstanteISO;
  formato: string;
  sha256Arquivo: string;
  sha256Texto: string;
  observacao: string;
}

/** GET /normas (normas:ler) */
export interface ResumoBaseNormativa {
  norma: { id: string; titulo: string; ementa: string };
  proveniencia: ProvenienciaBaseNormativa;
  totalArtigos: number;
  /** Divisões da lei (títulos e capítulos) com o primeiro e o último artigo. */
  divisoes: { titulo: string; primeiroArtigo: string; ultimoArtigo: string }[];
}

export interface TrechoLei {
  referencia: string;
  texto: string;
}

/** GET /normas/busca?q&limite (normas:ler) — BM25 local, sem serviço externo */
export interface ResultadoBuscaNormas {
  consulta: string;
  resultados: { artigo: string; rotulo: string; divisao: string | null; pontuacao: number; exato: boolean; trechos: TrechoLei[] }[];
}

export interface IncisoLeiApi {
  numero: string;
  texto: string;
  alineas: { letra: string; texto: string }[];
}

/** GET /normas/artigos/:numero (normas:ler) */
export interface ArtigoLeiApi {
  numero: string;
  rotulo: string;
  caput: string;
  incisos: IncisoLeiApi[];
  paragrafos: { numero: string; rotulo: string; texto: string; incisos: IncisoLeiApi[] }[];
  titulos: string[];
  /** Texto que o artigo insere em outra lei (não é dispositivo desta lei). */
  textoAlterador: string[];
  anterior: string | null;
  proximo: string | null;
  norma: string;
  proveniencia: ProvenienciaBaseNormativa;
}

/** GET /normas/modelos (normas:ler) — estrutura obrigatória dos modelos padronizados (art. 19, IV) */
export interface ModeloPadronizadoApi {
  tipo: string;
  documento: string;
  fundamento: string;
  secoes: { id: string; titulo: string; fundamento: string }[];
}

export type SituacaoCitacaoLegal = 'confere' | 'inexistente' | 'sem_efeito' | 'suspeita' | 'outra_norma';

export interface CitacaoLegalConferida {
  trecho: string;
  referencias: string[];
  norma: string;
  situacao: SituacaoCitacaoLegal;
  motivo: string;
  sugestao: string | null;
  contexto: string;
  posicao: number;
}

/** Conferência das citações de um texto com a base normativa — sinal que requer revisão humana. */
export interface ConferenciaCitacoesApi {
  norma: string;
  total: number;
  conferem: number;
  inexistentes: number;
  semEfeito: number;
  suspeitas: number;
  outrasNormas: number;
  /** Inexistentes + sem efeito: a aprovação do documento exige revisão humana registrada. */
  bloqueantes: number;
  problemas: number;
  fiel: boolean;
  citacoes: CitacaoLegalConferida[];
  premissas: string[];
  aviso: string;
  conferidoEm: InstanteISO;
}
// POST /normas/conferir { texto } → ConferenciaCitacoesApi (normas:ler; sem gravação)

export interface EstruturaModeloDocumento {
  aplicavel: boolean;
  documento: string | null;
  fundamento: string | null;
  presentes: number;
  total: number;
  percentual: number;
  ausentes: { id: string; titulo: string; fundamento: string }[];
}

export interface RevisaoCitacoes {
  revisadoPor: UsuarioResumo;
  revisadoEm: InstanteISO;
  justificativa: string;
}

export interface CitacoesDocumento {
  documentoId: Id;
  tipo: DocumentoGerado['tipo'];
  titulo: string;
  versao: number;
  situacao: DocumentoGerado['situacao'];
  geradoPor: DocumentoGerado['geradoPor'];
  geradoEm: InstanteISO;
  conferencia: ConferenciaCitacoesApi;
  estrutura: EstruturaModeloDocumento;
  revisao: RevisaoCitacoes | null;
  /** Citação inexistente ou sem efeito sem revisão registrada: o servidor recusa a aprovação (RIA-14). */
  aprovacaoBloqueada: boolean;
}
// GET /processos/:id/citacoes → CitacoesDocumento[] (jornada:ler; versões mais recentes primeiro)
// POST /processos/:id/documentos/:docId/citacoes/revisao { justificativa } → CitacoesDocumento (jornada:editar, ou aprovar_juridico no checklist; auditado)

export type AspectoConferenciaDocumentos = 'objeto' | 'quantidade' | 'valor_estimado' | 'prazo' | 'dotacao' | 'modalidade' | 'criterio_julgamento';

export interface DivergenciaDocumentosApi {
  aspecto: AspectoConferenciaDocumentos;
  chave: string;
  titulo: string;
  descricao: string;
  fundamento: string;
  ocorrencias: { tipo: DocumentoGerado['tipo']; documento: string; versao: number; valor: string; trecho: string }[];
}

/** GET /processos/:id/conferencia-cruzada (jornada:ler) — versão mais recente de cada documento */
export interface ConferenciaCruzadaApi {
  processoId: Id;
  geradoEm: InstanteISO;
  documentos: { tipo: DocumentoGerado['tipo']; titulo: string; versao: number; fatos: number }[];
  aspectos: { aspecto: AspectoConferenciaDocumentos; rotulo: string; comparacoes: number; divergencias: number }[];
  divergencias: DivergenciaDocumentosApi[];
  consistente: boolean;
  premissas: string[];
  fontes: string[];
  aviso: string;
}

export interface IndicadorImr02 {
  total: number;
  fieis: number;
  /** null quando não houve minuta no período. */
  percentual: number | null;
  situacao: 'atingida' | 'abaixo' | 'sem_minutas';
}

export interface ApontamentoCitacao {
  processo: ReferenciaControle;
  documentoId: Id;
  tipoDocumento: DocumentoGerado['tipo'];
  titulo: string;
  versao: number;
  geradoPor: DocumentoGerado['geradoPor'];
  geradoEm: InstanteISO;
  trecho: string;
  referencias: string[];
  situacao: SituacaoCitacaoLegal;
  motivo: string;
  sugestao: string | null;
  contexto: string;
  revisado: boolean;
}

/** GET /qualidade-normativa?mes&uasg (qualidade_ia:ler) — IMR-02: minutas com citações fiéis (meta 100%) */
export interface PainelQualidadeNormativa {
  mes: string; // AAAA-MM
  uasg: string | null;
  geradoEm: InstanteISO;
  meta: number;
  imr02: IndicadorImr02;
  /** Últimos 6 meses até o mês escolhido. */
  serie: (IndicadorImr02 & { mes: string })[];
  porTipo: { tipo: DocumentoGerado['tipo']; rotulo: string; total: number; fieis: number }[];
  porOrigem: { origem: DocumentoGerado['geradoPor']; total: number; fieis: number }[];
  estrutura: { conferidos: number; completos: number };
  apontamentos: ApontamentoCitacao[];
  base: { norma: string; proveniencia: ProvenienciaBaseNormativa };
  premissas: string[];
  fontes: string[];
  aviso: string;
}

export interface SinalAuditorIa {
  tipo: string;
  nivel: 'risco' | 'atencao';
  titulo: string;
  descricao: string;
  fundamento: string;
  evidencias: string[];
  referencia: ReferenciaControle;
}

/** GET /controle/auditor-ia?uasg (controle:segunda_linha) — auditor contínuo (RIA-15), sinais para revisão humana */
export interface PainelAuditorIa {
  geradoEm: InstanteISO;
  uasg: string | null;
  indicadores: { contratosVarridos: number; processosVarridos: number; sinaisRisco: number; sinaisAtencao: number };
  sinais: SinalAuditorIa[];
  premissas: string[];
  fontes: string[];
  aviso: string;
}
// ───────────────────────── Integração com o SEI (RF-35) ─────────────────────────

/** Situação de uma tarefa do SEI ou do DOU na fila de integrações. */
export type SituacaoTarefaSei = 'na_fila' | 'nova_tentativa' | 'executando' | 'concluida' | 'erro';
export interface TarefaSei {
  id: Id;
  tipo: 'sei.envio' | 'sei.assinaturas';
  situacao: SituacaoTarefaSei;
  tentativas: number;
  maximoTentativas: number;
  proximaTentativaEm: InstanteISO | null;
  ultimoErro: string | null;
  criadaEm: InstanteISO;
  concluidaEm: InstanteISO | null;
}
/** Assinatura feita no SEI (certificado ICP-Brasil ou login do servidor), devolvida por `consultarDocumento`. */
export interface AssinaturaDocumentoSei {
  nome: string;
  cargoFuncao: string | null;
  assinadoEm: InstanteISO;
}
export interface DocumentoSei {
  /** Número do documento na árvore do processo da Ágora (`ProcessoDetalhe.arvoreSei[].numero`). */
  numeroArvore: string;
  titulo: string;
  tipo: DocumentoGerado['tipo'] | null;
  enviado: boolean;
  /** Número do documento no SEI (DocumentoFormatado). */
  numeroSei: string | null;
  linkSei: string | null;
  enviadoEm: InstanteISO | null;
  /** 'restrito' = documento com dado pessoal ou orçamento sigiloso; 'padrao' = nível do tipo de processo no SEI. */
  nivelAcesso: 'restrito' | 'padrao' | null;
  /** Bloco de assinatura do SEI em que o documento foi incluído. */
  blocoAssinatura: string | null;
  assinaturas: AssinaturaDocumentoSei[];
  assinado: boolean;
  /** "Ana Ribeiro (Requisitante)" — vazio enquanto não houver assinatura. */
  resumoAssinatura: string;
  consultadoEm: InstanteISO | null;
}
export interface IntegracaoSeiProcesso {
  processoId: Id;
  /** 'online' = SEI real do órgão (SeiWS); 'offline' = simulação determinística. */
  modo: 'offline' | 'online';
  /** Online: endereço, sigla do sistema, identificação do serviço e unidade informados (AGORA_SEI_*). */
  configurado: boolean;
  processo: {
    numero: string;
    idProcedimento: string;
    link: string | null;
    geradoEm: InstanteISO;
    unidadeDestino: string | null;
    enviadoUnidadeEm: InstanteISO | null;
  } | null;
  documentos: DocumentoSei[];
  /** Documentos aprovados na Ágora que ainda não foram incluídos no SEI. */
  pendentesEnvio: number;
  /** Documentos já no SEI e ainda sem assinatura. */
  pendentesAssinatura: number;
  envio: TarefaSei | null;
  consulta: TarefaSei | null;
}
// GET /processos/:id/sei → IntegracaoSeiProcesso (jornada:ler)
// POST /processos/:id/sei/enviar → IntegracaoSeiProcesso (jornada:editar): gera o processo no SEI, inclui os documentos aprovados, monta o bloco de assinatura e, se configurado, envia à unidade
// POST /processos/:id/sei/consultar-assinaturas → IntegracaoSeiProcesso (jornada:editar ou jornada:aprovar_juridico): reflete as assinaturas feitas no SEI

// ───────────────────────── Publicação no DOU (RF-36) ─────────────────────────

export type TipoMateriaDou = 'aviso_licitacao' | 'extrato_contrato' | 'extrato_aditivo';
/** rascunho = gerada, a enviar pelo INCom; enviada = protocolo do INCom registrado; publicada = edição conferida. */
export type SituacaoMateriaDou = 'rascunho' | 'enviada' | 'publicada';
export interface MateriaDou {
  id: Id;
  tipo: TipoMateriaDou;
  situacao: SituacaoMateriaDou;
  /** Seção do DOU (3 = contratos, editais e avisos). */
  secao: number;
  titulo: string;
  identificacao: string;
  /** Texto no padrão de publicação, sem CPF completo. */
  texto: string;
  hashTexto: string;
  obrigatoria: boolean;
  fundamento: string;
  uasg: string;
  processo: { id: Id | null; numero: string };
  contrato: { id: Id; numero: string } | null;
  aditivo: { id: Id; numero: string } | null;
  /** Gerada sozinha quando o edital foi aceito no PNCP (aviso de licitação). */
  automatica: boolean;
  geradaEm: InstanteISO;
  geradaPor: UsuarioResumo | null;
  envio: { protocolo: string; enviadaEm: InstanteISO; registradoPor: UsuarioResumo | null; dataPrevista: DataISO } | null;
  publicacao: {
    data: DataISO;
    edicao: string | null;
    pagina: string | null;
    url: string | null;
    /** consulta = conferida na consulta pública do DOU pelo servidor; manual = registrada pelo servidor responsável. */
    forma: 'consulta' | 'manual';
    modo: 'offline' | 'online';
    registradaEm: InstanteISO;
  } | null;
  conferencia: {
    vezes: number;
    ultimaEm: InstanteISO | null;
    /** Resultado da última conferência, ex.: "Ainda não localizada no DOU até 10/11/2026". */
    resultado: string | null;
    tarefa: { situacao: SituacaoTarefaSei; ultimoErro: string | null; proximaTentativaEm: InstanteISO | null } | null;
  };
  /** Publicação do aviso em jornal diário de grande circulação (art. 54, § 1º). */
  jornal: { nome: string; data: DataISO; registradoEm: InstanteISO } | null;
}
export interface ResumoPublicacoesDou {
  modo: 'offline' | 'online';
  /** Consulta pública do DOU usada na conferência, pelo servidor. */
  consulta: string;
  rascunho: number;
  enviada: number;
  publicada: number;
  /** Avisos de licitação (obrigatórios) ainda sem publicação conferida. */
  avisosPendentes: number;
}
export interface CandidatoMateriaDou {
  tipo: TipoMateriaDou;
  processoId: Id | null;
  contratoId: Id | null;
  aditivoId: Id | null;
  /** Ex.: "Contrato 12/2026 — Aquisição de coletes". */
  rotulo: string;
  uasg: string;
  /** Matéria já gerada para este ato, se houver. */
  materiaId: Id | null;
}
export interface EntradaMateriaDou {
  tipo: TipoMateriaDou;
  processoId?: Id;
  contratoId?: Id;
  aditivoId?: Id;
}
export interface EntradaEnvioDou {
  /** Protocolo devolvido pelo INCom. */
  protocolo: string;
  /** Instante do envio pelo INCom (padrão: agora). */
  enviadaEm?: InstanteISO;
}
export interface EntradaPublicacaoDou {
  data: DataISO;
  edicao: string;
  pagina: string;
  url?: string | null;
}
export interface EntradaJornalDou {
  nome: string;
  data: DataISO;
}
// GET /publicacoes-dou/resumo → ResumoPublicacoesDou (jornada:ler ou contratos:ler)
// GET /publicacoes-dou?tipo&situacao&processoId&pagina&tamanhoPagina → Pagina<MateriaDou> (aviso: jornada:ler; extratos: contratos:ler; escopo de UASG)
// GET /publicacoes-dou/candidatos?tipo → CandidatoMateriaDou[]
// GET /publicacoes-dou/:id → MateriaDou
// POST /publicacoes-dou body EntradaMateriaDou → MateriaDou (aviso: jornada:publicar; extratos: contratos:editar) — gera ou refaz o rascunho
// POST /publicacoes-dou/:id/envio body EntradaEnvioDou → MateriaDou: registra o envio pelo INCom e a edição prevista
// POST /publicacoes-dou/:id/conferir → MateriaDou: confere a publicação na consulta pública do DOU, pela fila
// POST /publicacoes-dou/:id/publicacao body EntradaPublicacaoDou → MateriaDou: registra manualmente a edição
// POST /publicacoes-dou/:id/jornal body EntradaJornalDou → MateriaDou: publicação do aviso em jornal (art. 54, § 1º)
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

// ───────────────────────── Avaliação de desempenho do contratado (RN-37, RF-30) ─────────────────────────

export type TipoAvaliacaoDesempenho = 'parcial' | 'final';
export type SituacaoAvaliacaoDesempenho = 'em_manifestacao' | 'manifestada' | 'definitiva';
export type PapelAvaliadorDesempenho = 'gestor' | 'fiscal';

export interface IndicadoresAvaliacaoDesempenho {
  entregasNoPrazo: number;
  entregasTotal: number;
  recebimentosAprovados: number;
  recebimentosTotal: number;
  /** Derivadas das ocorrências registradas no período (não digitadas). */
  ocorrenciasFiscalizacao: number;
  ocorrenciasResolvidasNoPrazo: number;
}

/** Quem pode emitir a avaliação do contrato: o gestor ou o fiscal designado (decidido no servidor). */
export interface AvaliadorContrato {
  podeAvaliar: boolean;
  papel: PapelAvaliadorDesempenho | null;
  motivo: string | null;
}

export interface AvaliacaoDesempenho {
  id: Id;
  protocolo: string;
  versao: number;
  contrato: { id: Id; numero: string; objeto: string; uasg: string };
  fornecedor: { id: Id; razaoSocial: string };
  tipo: TipoAvaliacaoDesempenho;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  indicadores: IndicadoresAvaliacaoDesempenho;
  evidencias: string;
  motivacao: string;
  nota: number;
  faixa: FaixaIdc;
  componentes: { nome: string; valor: number; peso: number; contribuicao: number }[];
  penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[];
  metodologia: string;
  avaliador: { id: Id; nome: string; papel: PapelAvaliadorDesempenho };
  emitidaEm: InstanteISO;
  prazoManifestacao: DataISO;
  manifestacao: { texto: string; recebidaEm: DataISO; concorda: boolean; registradaPor: UsuarioResumo; registradaEm: InstanteISO } | null;
  analise: { decisao: 'mantida' | 'revista'; motivacao: string; por: UsuarioResumo; em: InstanteISO } | null;
  situacao: SituacaoAvaliacaoDesempenho;
  explicacaoSituacao: string;
  /** Envio ao cadastro de atesto do PNCP: o Manual de Integração não tem esse serviço; fica o protocolo do registro na Ágora. */
  envioCadastro: { situacao: 'aguardando_cadastro_pncp'; explicacao: string };
  hashDocumento: string;
}

export interface AvaliacoesContrato {
  avaliador: AvaliadorContrato;
  avaliacoes: AvaliacaoDesempenho[];
}

/** Dados que o servidor deriva para o período (ocorrências registradas, sanções aplicadas e contagens de recebimentos no contrato). */
export interface PreviaAvaliacaoDesempenho {
  periodoInicio: DataISO;
  periodoFim: DataISO;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  ocorrencias: { total: number; resolvidasNoPrazo: number; abertas: number };
  sancoesNoPeriodo: { tipo: TipoSancao; dataAplicacao: DataISO }[];
  entregas: { total: number; noPrazo: number };
  recebimentos: { total: number; aprovados: number };
  avaliador: AvaliadorContrato;
}

export interface EntradaAvaliacaoDesempenho {
  tipo: TipoAvaliacaoDesempenho;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  entregasNoPrazo?: number;
  entregasTotal?: number;
  recebimentosAprovados?: number;
  recebimentosTotal?: number;
  evidencias: string;
  motivacao: string;
}
export interface EntradaManifestacaoAvaliacao {
  texto: string;
  recebidaEm: DataISO;
  concorda: boolean;
}
export interface EntradaAnaliseAvaliacao {
  decisao: 'mantida' | 'revista';
  motivacao: string;
  /** Na revisão, as contagens corrigidas (a nota é recalculada). */
  entregasNoPrazo?: number;
  entregasTotal?: number;
  recebimentosAprovados?: number;
  recebimentosTotal?: number;
}
// GET  /contratos/:id/avaliacoes-desempenho → AvaliacoesContrato (contratos:ler; escopo de UASG)
// GET  /contratos/:id/avaliacoes-desempenho/previa?periodoInicio&periodoFim → PreviaAvaliacaoDesempenho (contratos:ler)
// POST /contratos/:id/avaliacoes-desempenho EntradaAvaliacaoDesempenho → AvaliacaoDesempenho (desempenho:avaliar; gestor ou fiscal designado)
// POST /avaliacoes-desempenho/:id/manifestacao EntradaManifestacaoAvaliacao → AvaliacaoDesempenho (desempenho:avaliar)
// POST /avaliacoes-desempenho/:id/analise EntradaAnaliseAvaliacao → AvaliacaoDesempenho (desempenho:avaliar)
// GET  /avaliacoes-desempenho/:id/documento.pdf → PDF (fornecedores:ler)

export interface AvaliacaoDesempenhoResumo {
  id: Id;
  protocolo: string;
  contrato: { id: Id; numero: string; uasg: string };
  tipo: TipoAvaliacaoDesempenho;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  nota: number;
  faixa: FaixaIdc;
  situacao: SituacaoAvaliacaoDesempenho;
  consideradaNoRegistro: boolean;
  emitidaEm: InstanteISO;
}

export type TipoDocumentoIncentivo = 'certificado' | 'declaracao';
export interface CertificadoDesempenho {
  id: Id;
  tipo: TipoDocumentoIncentivo;
  codigo: string;
  nota: number | null;
  faixa: FaixaIdc;
  emitidoEm: InstanteISO;
  validoAte: DataISO;
  emitidoPor: UsuarioResumo | null;
  versaoRegistro: string;
  /** 'registro_atualizado': o registro mudou depois da emissão (art. 88, § 2º: renove o documento). */
  situacao: 'valido' | 'registro_atualizado' | 'vencido';
}

export interface ElegibilidadeIncentivo {
  elegivel: boolean;
  motivos: string[];
  criterio: string;
}

export interface RegistroDesempenhoFornecedor {
  fornecedor: { id: Id; razaoSocial: string; documento: string; impedido: boolean };
  nota: number | null;
  faixa: FaixaIdc;
  contratosConsiderados: number;
  versaoRegistro: string;
  metodologia: string;
  fundamento: string;
  avaliacoes: AvaliacaoDesempenhoResumo[];
  certificados: CertificadoDesempenho[];
  incentivo: { certificado: ElegibilidadeIncentivo; declaracao: ElegibilidadeIncentivo };
}
export interface EntradaCertificadoDesempenho {
  tipo: TipoDocumentoIncentivo;
}
// GET  /fornecedores/:id/desempenho → RegistroDesempenhoFornecedor (fornecedores:ler; registro cadastral do órgão, art. 87)
// POST /fornecedores/:id/certificados-desempenho EntradaCertificadoDesempenho → CertificadoDesempenho (desempenho:certificar; 422 sem critério)
// GET  /certificados-desempenho/:id/documento.pdf → PDF (fornecedores:ler)

export interface NotaRegistroDesempenho {
  fornecedorId: Id;
  razaoSocial: string;
  nota: number | null;
  faixa: FaixaIdc;
  contratosConsiderados: number;
}
// GET /desempenho/notas?fornecedores=<id>,<id> → NotaRegistroDesempenho[] (fornecedores:ler)
// GET /desempenho/ranking → NotaRegistroDesempenho[] (fornecedores:ler; fornecedores com avaliação, da maior nota para a menor)

export interface CriterioDesempenhoTecnicaEdital {
  pesoDesempenhoPercentual: number;
  notaSemHistorico: number;
  regulamento: string;
}
export interface EntradaSimulacaoDesempenho {
  licitantes: { fornecedorId: Id; valorProposta: Centavos; notaProposta?: number | null }[];
  criterio?: (CriterioDesempenhoTecnicaEdital & { pesoTecnicoPercentual: number }) | null;
}
export interface ResultadoSimulacaoDesempenho {
  licitantes: { fornecedorId: Id; nome: string; notaDesempenho: number | null; faixa: FaixaIdc }[];
  desempate: {
    classificacao: { id: Id; nome: string; posicao: number; valorConsiderado: Centavos }[];
    empateDetectado: boolean;
    criterioDecisivo: string | null;
    passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[];
    sorteioNecessario: boolean;
  };
  tecnicaEPreco:
    | { id: Id; nome: string; posicao: number; notaProposta: number; notaDesempenho: number; origem: 'registro' | 'sem_historico'; notaTecnica: number; notaPreco: number; notaFinal: number }[]
    | null;
  aviso: string;
}
// POST /desempenho/simulacao EntradaSimulacaoDesempenho → ResultadoSimulacaoDesempenho (fornecedores:ler; somente leitura)

/** Fórmula do desempenho anterior na pontuação técnica, configurada no edital (art. 36, § 3º; art. 37, III). */
export interface CriterioDesempenhoEdital {
  adotado: boolean;
  pesoDesempenhoPercentual: number | null;
  notaSemHistorico: number | null;
  regulamento: string | null;
  criterioJulgamento: CriterioJulgamentoEdital;
  /** O critério de julgamento do edital admite a pontuação técnica (técnica e preço ou melhor técnica). */
  aplicavel: boolean;
  explicacao: string;
  atualizadoEm: InstanteISO | null;
  atualizadoPor: UsuarioResumo | null;
}
export interface EntradaCriterioDesempenhoEdital {
  adotado: boolean;
  pesoDesempenhoPercentual?: number | null;
  notaSemHistorico?: number | null;
  regulamento?: string | null;
}
// GET /processos/:id/criterio-desempenho → CriterioDesempenhoEdital (jornada:ler)
// PUT /processos/:id/criterio-desempenho EntradaCriterioDesempenhoEdital → CriterioDesempenhoEdital (jornada:editar; até a etapa 4)

// ───────────────────────── Lições aprendidas da execução (RIA-12) ─────────────────────────

export type TipoOcorrenciaExecucao = 'ocorrencia' | 'glosa' | 'atraso' | 'rescisao';
export type TipoFatoExecucao = TipoOcorrenciaExecucao | 'aditivo' | 'sancao' | 'avaliacao';
export type CategoriaLicao = 'prazo' | 'qualidade' | 'nivel_servico' | 'garantia' | 'quantitativo' | 'fiscalizacao';
export type SituacaoOcorrenciaExecucao = 'aberta' | 'resolvida_no_prazo' | 'resolvida_fora_do_prazo';

export interface OcorrenciaExecucao {
  id: Id;
  contratoId: Id;
  tipo: TipoOcorrenciaExecucao;
  categoria: CategoriaLicao;
  data: DataISO;
  descricao: string;
  diasAtraso: number | null;
  valorGlosa: Centavos | null;
  situacao: SituacaoOcorrenciaExecucao;
  resolvidaEm: DataISO | null;
  registradaPor: UsuarioResumo | null;
  registradaEm: InstanteISO;
}
export interface BaseConhecimentoContrato {
  ocorrencias: OcorrenciaExecucao[];
  /** Fatos derivados do que já está registrado: aditivos acima de 15%, sanções e avaliações abaixo de 60. */
  fatosDerivados: { tipo: TipoFatoExecucao; categoria: CategoriaLicao; data: DataISO; descricao: string }[];
}
export interface EntradaOcorrenciaExecucao {
  tipo: TipoOcorrenciaExecucao;
  categoria?: CategoriaLicao | null;
  data: DataISO;
  descricao: string;
  diasAtraso?: number | null;
  valorGlosa?: Centavos | null;
}
export interface EntradaSolucaoOcorrencia {
  situacao: 'resolvida_no_prazo' | 'resolvida_fora_do_prazo';
  resolvidaEm: DataISO;
}
// GET  /contratos/:id/ocorrencias-execucao → BaseConhecimentoContrato (contratos:ler)
// POST /contratos/:id/ocorrencias-execucao EntradaOcorrenciaExecucao → OcorrenciaExecucao (licoes:registrar)
// POST /ocorrencias-execucao/:id/solucao EntradaSolucaoOcorrencia → OcorrenciaExecucao (licoes:registrar)

export type DocumentoLicao = 'dfd' | 'etp' | 'tr';
export interface SugestaoLicaoAprendida {
  chave: string;
  regra: 'RIA-12';
  documento: DocumentoLicao;
  categoria: CategoriaLicao;
  rotuloCategoria: string;
  titulo: string;
  clausula: string;
  fundamento: string;
  ocorrencias: number;
  fontes: { contratoId: Id; numero: string; objeto: string; motivo: string; fatos: { tipo: TipoFatoExecucao; data: DataISO; descricao: string }[] }[];
  premissas: string[];
  geradoEm: DataISO;
  aviso: string;
  decisao: DecisaoLicao | null;
}
export interface DecisaoLicao {
  chave: string;
  titulo: string;
  decisao: 'aceita' | 'recusada';
  motivo: string | null;
  por: UsuarioResumo | null;
  em: InstanteISO;
}
export interface LicoesAprendidasProcesso {
  documento: DocumentoLicao;
  sugestoes: SugestaoLicaoAprendida[];
  /** Decisões já registradas cuja sugestão não aparece mais (a base mudou); as aceitas continuam no rascunho. */
  decisoesAnteriores: DecisaoLicao[];
  contratosAnalisados: number;
  consultadoEm: DataISO;
}
export interface EntradaDecisaoLicao {
  documento: DocumentoLicao;
  chave: string;
  decisao: 'aceita' | 'recusada';
  motivo?: string | null;
}
// GET  /processos/:id/licoes-aprendidas?documento=dfd|etp|tr → LicoesAprendidasProcesso (jornada:ler)
// POST /processos/:id/licoes-aprendidas/decisoes EntradaDecisaoLicao → LicoesAprendidasProcesso (jornada:editar; auditado)
// ───────────────────────── Rotas de contratação, dispensa eletrônica, Sicx e cartão de pagamento (F9: RN-41, RN-42, RF-34) ─────────────────────────

export type RotaContratacao = 'licitacao' | 'dispensa' | 'inexigibilidade' | 'adesao_ata' | 'sicx';
export type HipoteseDispensa = 'valor_obras_engenharia' | 'valor_demais' | 'outra';
export type HipoteseInexigibilidade = 'exclusividade' | 'artista' | 'notoria_especializacao' | 'credenciamento' | 'imovel';
export type ExigenciaDocumentoRota = 'obrigatorio' | 'facultativo' | 'nao_se_aplica';

export interface DocumentoRotaContratacao {
  id: string;
  titulo: string;
  exigencia: ExigenciaDocumentoRota;
  fundamento: string;
}

/** PUT /processos/:id/rota (jornada:editar, só na etapa 1) → RotaProcesso */
export interface EntradaRotaContratacao {
  rota: RotaContratacao;
  hipoteseDispensa?: HipoteseDispensa | null;
  incisoDispensa?: string | null;
  hipoteseInexigibilidade?: HipoteseInexigibilidade | null;
  justificativa?: string | null;
  /** Ramo de atividade do objeto (art. 75, § 1º, II). */
  natureza?: string | null;
  /** Análise do agente quando a soma do mesmo ramo passa do limite (indício de fracionamento). */
  justificativaFracionamento?: string | null;
}

export interface FracionamentoRota {
  natureza: string;
  somaComNova: number;
  limite: number;
  percentualDoLimite: number;
  sinal: 'sem_risco' | 'atencao' | 'risco';
  explicacao: string;
  fundamento: string;
  consideradas: number;
}

export interface AvisoDispensa {
  situacao: 'na_fila' | 'publicado' | 'erro';
  publicadoEm: DataISO | null;
  /** Último dia do prazo de 3 dias úteis (art. 75, § 3º). */
  encerramento: DataISO | null;
  aberto: boolean;
  julgamentoLiberado: boolean;
  diasUteisRestantes: number;
  mensagem: string;
  protocolo: string | null;
  numeroControle: string | null;
  modo: 'offline' | 'online' | null;
  ultimoErro: string | null;
}

export interface PropostaDispensaResumo {
  id: Id;
  fornecedor: { id: Id; nome: string };
  valor: number;
  recebidaEm: InstanteISO;
  /** Recebida durante o aviso (proposta adicional, art. 75, § 3º). */
  adicional: boolean;
  /** Posição no julgamento (null antes do julgamento ou se desclassificada). */
  posicao: number | null;
  motivoDesclassificacao: string | null;
}

export interface ComprovacaoInexigibilidadeProcesso {
  hipotese: HipoteseInexigibilidade;
  justificativaInviabilidade: string | null;
  documentoExclusividade?: 'atestado' | 'contrato' | 'declaracao' | 'carta_exclusividade' | 'outro' | null;
  semPreferenciaMarca?: boolean;
  consagracao?: string | null;
  porEmpresario?: boolean;
  exclusividadePermanente?: boolean;
  alinea?: string | null;
  elementosNotoriaEspecializacao?: string | null;
  publicidade?: boolean;
  editalChamamento?: string | null;
  avaliacaoPrevia?: boolean;
  semImovelPublicoDisponivel?: boolean;
  justificativaSingularidade?: string | null;
}

export interface AdesaoProcesso {
  id: Id;
  ata: { id: Id; numero: string; uasg: string; objeto: string; vigenciaFim: DataISO };
  item: { id: Id; numero: number; descricao: string; unidade: string; valorUnitario: number; quantidadeRegistrada: number };
  fornecedor: { id: Id; nome: string };
  quantidade: number;
  valorTotal: number;
  justificativaVantagem: string;
  situacao: 'solicitada' | 'aceita_fornecedor' | 'autorizada' | 'recusada';
  aceiteFornecedorEm: DataISO | null;
  anuenciaEm: DataISO | null;
  anuenciaPor: UsuarioResumo | null;
  motivoRecusa: string | null;
  /** Até 90 dias da anuência, na vigência da ata (Decreto 11.462/2023, art. 31, § 2º). */
  limiteContratacao: DataISO | null;
  limites: { limitePorOrgao: number; limiteTotal: number; aderidoPeloOrgao: number; aderidoTotal: number };
}

/** POST /processos/:id/adesao (jornada:editar) → RotaProcesso; acima dos limites do art. 86, §§ 4º e 5º → 422 */
export interface EntradaAdesao {
  ataId: Id;
  itemId: Id;
  quantidade: number;
  justificativaVantagem: string;
}

export interface AutorizacaoContratacaoDireta {
  fornecedor: { id: Id; nome: string };
  valor: number;
  razaoEscolha: string;
  justificativaPreco: string;
  data: DataISO;
  por: UsuarioResumo;
}

/** POST /processos/:id/contratacao-direta/autorizacao (jornada:homologar + autoridade designada, etapa 6) → RotaProcesso */
export interface EntradaAutorizacaoContratacao {
  fornecedorId: Id;
  /** Valor contratado; na dispensa por valor e na adesão vem da proposta selecionada e do item da ata. */
  valor?: number | null;
  razaoEscolha: string;
  justificativaPreco: string;
  habilitacaoVerificada: boolean;
}

export interface RotaProcesso {
  processoId: Id;
  /** UASG do processo (a vitrine do Sicx usa a UF dela). */
  uasg: string;
  rota: RotaContratacao;
  titulo: string;
  fundamento: string;
  modalidade: string;
  hipoteseDispensa: HipoteseDispensa | null;
  incisoDispensa: string | null;
  hipoteseInexigibilidade: HipoteseInexigibilidade | null;
  natureza: string | null;
  justificativa: string | null;
  justificativaFracionamento: string | null;
  escolhidaEm: InstanteISO | null;
  escolhidaPor: UsuarioResumo | null;
  documentos: DocumentoRotaContratacao[];
  exigencias: {
    etp: ExigenciaDocumentoRota;
    matrizRiscos: ExigenciaDocumentoRota;
    pesquisaPrecos: ExigenciaDocumentoRota;
    termoReferencia: ExigenciaDocumentoRota;
    edital: ExigenciaDocumentoRota;
    minutaContrato: ExigenciaDocumentoRota;
    parecerJuridico: ExigenciaDocumentoRota;
    avisoDispensa: boolean;
    autorizacaoContratacao: boolean;
    contratoNaJornada: boolean;
  };
  limite: { valor: number; norma: string; fundamento: string } | null;
  valorEstimado: number | null;
  fracionamento: FracionamentoRota | null;
  aviso: AvisoDispensa | null;
  /** Prévia do encerramento se o aviso fosse publicado hoje. */
  previaEncerramentoAviso: DataISO | null;
  propostas: PropostaDispensaResumo[];
  julgadoEm: InstanteISO | null;
  inexigibilidade: (ComprovacaoInexigibilidadeProcesso & { pendencias: string[] }) | null;
  adesao: AdesaoProcesso | null;
  autorizacao: AutorizacaoContratacaoDireta | null;
  comprasSicx: CompraSicx[];
  /** O que falta na etapa atual por causa da rota (as regras da etapa também aparecem nos bloqueios do processo). */
  pendencias: string[];
}

// ── Sicx (RN-42) ──

export interface FaixaPrecoSicx {
  aPartirDe: number;
  precoUnitario: number;
}

export interface OfertaVitrineSicx {
  id: Id;
  fornecedor: { id: Id; nome: string };
  precoUnitario: number;
  faixas: FaixaPrecoSicx[];
  localidades: string[];
  prazoEntregaDias: number;
  prazoPagamentoDias: number;
  reputacao: number;
  /** Ranqueamento para a quantidade e a UF informadas (null = inapta). */
  posicao: number | null;
  precoNaQuantidade: number;
  valorTotal: number;
  desempate: 'nenhum' | 'reputacao' | 'sorteio';
  motivoInaptidao: string | null;
}

export interface ItemVitrineSicx {
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string;
  ofertas: OfertaVitrineSicx[];
}

/** GET /sicx/ofertas?busca&quantidade&uasg → VitrineSicx (jornada:ler) */
export interface VitrineSicx {
  uf: string;
  uasg: string;
  quantidade: number;
  modo: 'offline' | 'online';
  itens: ItemVitrineSicx[];
  fundamento: string;
}

export interface ReservaSicx {
  id: Id;
  uasg: string;
  descricao: string;
  etpReferencia: string;
  limite: number;
  utilizado: number;
  saldo: number;
  autorizacaoPrevia: boolean;
  vigenciaFim: DataISO;
}

export type SituacaoCompraSicx = 'ordem_emitida' | 'concluida' | 'cancelada';

export interface PrazosCompraSicxResumo {
  situacao: 'aguardando_entrega' | 'aguardando_recebimento_provisorio' | 'aguardando_recebimento_definitivo' | 'aguardando_pagamento' | 'paga';
  limiteRecebimentoProvisorio: DataISO | null;
  limiteRecebimentoDefinitivo: DataISO | null;
  recebimentoTacito: boolean;
  limitePagamento: DataISO | null;
  pagamentoVencido: boolean;
  mensagem: string;
}

export interface CompraSicx {
  id: Id;
  numero: string;
  uasg: string;
  processoId: Id | null;
  reservaId: Id | null;
  item: { codigo: string; descricao: string; unidade: string };
  fornecedor: { id: Id; nome: string };
  quantidade: number;
  precoUnitario: number;
  valorTotal: number;
  posicao: number;
  justificativaSelecao: string | null;
  situacao: SituacaoCompraSicx;
  ordemEm: InstanteISO;
  ordemPor: UsuarioResumo;
  conclusaoEm: InstanteISO | null;
  conclusaoPor: UsuarioResumo | null;
  entregaRegistradaEm: DataISO | null;
  recebimentoProvisorioEm: DataISO | null;
  recebimentoDefinitivoEm: DataISO | null;
  pagoEm: DataISO | null;
  /** Só depois da conclusão da compra. */
  prazos: PrazosCompraSicxResumo | null;
}

/** POST /sicx/compras (jornada:editar) → CompraSicx (ordem de compra; processo na rota Sicx ou reserva do ETP abrangente) */
export interface EntradaCompraSicx {
  ofertaId: Id;
  quantidade: number;
  uasg: string;
  processoId?: Id | null;
  reservaId?: Id | null;
  justificativaSelecao?: string | null;
}

// ── Cartão de pagamento (art. 75, § 4º) ──

export interface CompraCartaoPagamento {
  id: Id;
  uasg: string;
  data: DataISO;
  fornecedor: { id: Id; nome: string; documento: string };
  valor: number;
  objeto: string;
  natureza: string;
  tipoObjeto: 'obras_servicos_engenharia' | 'demais';
  registradaPor: UsuarioResumo;
  extratoId: Id | null;
}

/** POST /cartao-pagamento/compras (pagamentos:registrar) → RespostaCompraCartao */
export interface EntradaCompraCartao {
  uasg: string;
  data: DataISO;
  fornecedorId: Id;
  valor: number;
  objeto: string;
  natureza: string;
  tipoObjeto: 'obras_servicos_engenharia' | 'demais';
}

export interface RespostaCompraCartao {
  compra: CompraCartaoPagamento;
  fracionamento: FracionamentoRota;
}

export interface ExtratoCartaoPagamento {
  id: Id;
  uasg: string;
  competencia: string;
  quantidade: number;
  total: number;
  hash: string;
  texto: string;
  situacao: 'na_fila' | 'publicado' | 'erro';
  protocolo: string | null;
  modo: 'offline' | 'online' | null;
  publicadoEm: InstanteISO | null;
  ultimoErro: string | null;
}
// GET /cartao-pagamento/compras?uasg&competencia → CompraCartaoPagamento[] (pagamentos:ler)
// GET /cartao-pagamento/extratos → ExtratoCartaoPagamento[] (pagamentos:ler)
// POST /cartao-pagamento/extratos { uasg, competencia } → ExtratoCartaoPagamento (pagamentos:registrar): divulgação no PNCP pela fila

export interface ItemAtaDisponivelAdesao {
  id: Id;
  numero: number;
  descricao: string;
  unidade: string;
  valorUnitario: number;
  quantidadeRegistrada: number;
  fornecedor: { id: Id; nome: string };
  /** 50% do registrado por órgão aderente (art. 86, § 4º) e o que ainda cabe para a UASG do processo. */
  limitePorOrgao: number;
  saldoOrgao: number;
  /** O dobro do registrado no total das adesões (art. 86, § 5º) e o que ainda cabe. */
  limiteTotal: number;
  saldoTotal: number;
}

/** GET /processos/:id/adesao/atas-disponiveis?busca → AtaDisponivelAdesao[] (jornada:ler): atas vigentes que aceitam adesão, de outra UASG */
export interface AtaDisponivelAdesao {
  id: Id;
  numero: string;
  uasg: string;
  objeto: string;
  vigenciaFim: DataISO;
  itens: ItemAtaDisponivelAdesao[];
}
