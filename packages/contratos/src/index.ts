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

export type Semaforo = 'vencido' | 'critico' | 'atencao' | 'alerta' | 'regular';

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
  | 'consulta';

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
  | 'lgpd:relatorio';

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
  vencimentos: { em30: number; em60: number; em90: number; vencidos: number };
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
