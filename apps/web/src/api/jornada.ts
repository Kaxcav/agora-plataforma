/**
 * Jornada da contratação (`/processos*`). Toda mutação devolve o `ProcessoDetalhe` atualizado, que substitui
 * o cache do detalhe; a lista é invalidada. 422 `REGRA_NEGOCIO` traz em `detalhes` as regras que bloqueiam.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentoGerado,
  EntradaDisputa,
  EntradaNovoProcesso,
  EtapaJornada,
  Id,
  OrgaoRequisitante,
  Pagina,
  ParametrosEdital,
  ProcessoDetalhe,
  ProcessoResumo,
  UsuarioDesignavel,
} from '@agora/contratos';
import type { analisarCestaPrecos, aplicarDesempate } from '@agora/dominio';
import { api, ErroApi } from './cliente';

const segmento = (id: string) => encodeURIComponent(id);

export interface FiltroProcessos {
  busca?: string;
  orgao?: OrgaoRequisitante;
  etapa?: EtapaJornada;
  pagina?: number;
  tamanhoPagina?: number;
}

export const chaveListaProcessos = ['processos', 'lista'] as const;
export const chaveProcesso = (id: string) => ['processos', 'detalhe', id] as const;

/** GET /processos?orgao&etapa&busca&pagina&tamanhoPagina */
export function useProcessos(filtro: FiltroProcessos) {
  return useQuery({
    queryKey: [...chaveListaProcessos, filtro],
    queryFn: ({ signal }) => api.ler<Pagina<ProcessoResumo>>('/processos', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** GET /processos/:id */
export function useProcesso(id: string) {
  return useQuery({
    queryKey: chaveProcesso(id),
    queryFn: ({ signal }) => api.ler<ProcessoDetalhe>(`/processos/${segmento(id)}`, undefined, signal),
  });
}

/** POST /processos */
export function useCriarProcesso() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaNovoProcesso) => api.criar<ProcessoDetalhe>('/processos', entrada),
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(processo.id), processo);
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
    },
  });
}

/** GET /processos/designaveis — servidores ativos no escopo de UASG, para a designação da equipe. */
export function useDesignaveis(habilitado: boolean) {
  return useQuery({
    queryKey: ['processos', 'designaveis'],
    queryFn: ({ signal }) => api.ler<UsuarioDesignavel[]>('/processos/designaveis', undefined, signal),
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
  });
}

/** Mutação de processo: grava a resposta no cache do detalhe e invalida a lista (etapa, bloqueios, valor). */
function useMutacaoProcesso<E>(id: string, executar: (entrada: E) => Promise<ProcessoDetalhe>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(id), processo);
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
    },
  });
}

export type DadosDfd = ProcessoDetalhe['dfd'];
export type DadosEtp = ProcessoDetalhe['etp'];
export type RiscoProcesso = ProcessoDetalhe['riscos'][number];
export type CotacaoProcesso = ProcessoDetalhe['cestaPrecos']['cotacoes'][number];
export type LicitanteProcesso = ProcessoDetalhe['disputa']['licitantes'][number];
export type ItemParecer = ProcessoDetalhe['parecer']['itens'][number];
export type TipoDocumento = DocumentoGerado['tipo'];

export interface EntradaEquipe {
  designacoes: { papel: string; usuarioId: Id }[];
}
export interface EntradaCestaPrecos {
  cotacoes: CotacaoProcesso[];
  orcamentoSigiloso: boolean;
  motivoSigilo: string | null;
}
export interface EntradaExpurgos {
  aceitar: Id[];
  justificativa: string;
}
export type EntradaParecer = Omit<ProcessoDetalhe['parecer'], 'parecerista'>;

const caminho = (id: string, sufixo: string) => `/processos/${segmento(id)}/${sufixo}`;

/** PUT /processos/:id/dfd */
export function useSalvarDfd(id: string) {
  return useMutacaoProcesso(id, (dfd: DadosDfd) => api.substituir<ProcessoDetalhe>(caminho(id, 'dfd'), dfd));
}

/** PUT /processos/:id/equipe — 422 com os conflitos de segregação (RN-03). */
export function useSalvarEquipe(id: string) {
  return useMutacaoProcesso(id, (entrada: EntradaEquipe) => api.substituir<ProcessoDetalhe>(caminho(id, 'equipe'), entrada));
}

/** POST /processos/:id/sei/assinar — simulação; a assinatura ICP-Brasil real exige integração com o SEI do órgão. */
export function useAssinarDocumentoSei(id: string) {
  return useMutacaoProcesso(id, (documentoNumero: string) => api.criar<ProcessoDetalhe>(caminho(id, 'sei/assinar'), { documentoNumero }));
}

/** PUT /processos/:id/etp */
export function useSalvarEtp(id: string) {
  return useMutacaoProcesso(id, (etp: DadosEtp) => api.substituir<ProcessoDetalhe>(caminho(id, 'etp'), etp));
}

/** PUT /processos/:id/riscos */
export function useSalvarRiscos(id: string) {
  return useMutacaoProcesso(id, (riscos: RiscoProcesso[]) => api.substituir<ProcessoDetalhe>(caminho(id, 'riscos'), { riscos }));
}

/** PUT /processos/:id/cesta-precos */
export function useSalvarCestaPrecos(id: string) {
  return useMutacaoProcesso(id, (entrada: EntradaCestaPrecos) => api.substituir<ProcessoDetalhe>(caminho(id, 'cesta-precos'), entrada));
}

/** POST /processos/:id/cesta-precos/expurgos — aceite humano, com justificativa, dos expurgos sugeridos (RIA-03). */
export function useAceitarExpurgos(id: string) {
  return useMutacaoProcesso(id, (entrada: EntradaExpurgos) => api.criar<ProcessoDetalhe>(caminho(id, 'cesta-precos/expurgos'), entrada));
}

/** POST /processos/:id/documentos/gerar — rascunho por modelo (IA só se habilitada no servidor). */
export function useGerarDocumento(id: string) {
  return useMutacaoProcesso(id, (tipo: TipoDocumento) => api.criar<ProcessoDetalhe>(caminho(id, 'documentos/gerar'), { tipo }));
}

/** POST /processos/:id/documentos/:docId/aprovar — revisão humana do rascunho. */
export function useAprovarDocumento(id: string) {
  return useMutacaoProcesso(id, (documentoId: Id) =>
    api.criar<ProcessoDetalhe>(caminho(id, `documentos/${segmento(documentoId)}/aprovar`)),
  );
}

/** PUT /processos/:id/parametros-edital (jornada:editar; só na etapa 4) */
export function useSalvarParametrosEdital(id: string) {
  return useMutacaoProcesso(id, (parametros: ParametrosEdital) =>
    api.substituir<ProcessoDetalhe>(caminho(id, 'parametros-edital'), parametros),
  );
}

/** PUT /processos/:id/parecer (jornada:aprovar_juridico) */
export function useSalvarParecer(id: string) {
  return useMutacaoProcesso(id, (parecer: EntradaParecer) => api.substituir<ProcessoDetalhe>(caminho(id, 'parecer'), parecer));
}

/** POST /processos/:id/publicar (jornada:publicar) — fila de envio ao PNCP e ao DOU. */
export function usePublicarProcesso(id: string) {
  return useMutacaoProcesso<void>(id, () => api.criar<ProcessoDetalhe>(caminho(id, 'publicar')));
}

/** PUT /processos/:id/disputa — licitantes são fornecedores do cadastro; o servidor calcula o desempate (art. 60). */
export function useSalvarDisputa(id: string) {
  return useMutacaoProcesso(id, (entrada: EntradaDisputa) => api.substituir<ProcessoDetalhe>(caminho(id, 'disputa'), entrada));
}

/** POST /processos/:id/avancar — 422 REGRA_NEGOCIO com as regras que impedem o avanço. */
export function useAvancarEtapa(id: string) {
  return useMutacaoProcesso<void>(id, () => api.criar<ProcessoDetalhe>(caminho(id, 'avancar')));
}

/** POST /processos/:id/contratar — RN-09; cria o contrato na carteira (com tarefas de assinatura e pendências). */
export function useContratar(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<ProcessoDetalhe>(caminho(id, 'contratar')),
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(id), processo);
      // O contrato novo aparece na carteira, no painel, nas pendências, nas tarefas e no detalhe do fornecedor.
      for (const chave of [chaveListaProcessos, ['contratos'], ['painel'], ['pendencias'], ['tarefas'], ['fornecedores'], ['publico'], ['auditoria']]) {
        void cliente.invalidateQueries({ queryKey: chave });
      }
    },
  });
}

// ───────────────────────── Regras bloqueantes (422) ─────────────────────────

export interface RegraBloqueante {
  /** Identificador da regra do catálogo ("RN-04"), quando a API o informa. */
  regra: string | null;
  mensagem: string;
}

const PADRAO_REGRA = /\b(?:RNF|RIA|RN|RF)-\d{1,3}\b/;

/** Regras que impediram a operação (422 REGRA_NEGOCIO); `null` para qualquer outro erro. */
export function regrasBloqueantes(erro: unknown): RegraBloqueante[] | null {
  if (!(erro instanceof ErroApi) || erro.status !== 422 || erro.codigo !== 'REGRA_NEGOCIO') return null;
  return erro.detalhes.map((d) => {
    const encontrada = PADRAO_REGRA.exec(d.campo ?? '') ?? PADRAO_REGRA.exec(d.mensagem);
    return { regra: encontrada ? encontrada[0] : null, mensagem: d.mensagem };
  });
}

// ───────────────────────── Campos `unknown` do contrato ─────────────────────────

export type AnaliseCesta = ReturnType<typeof analisarCestaPrecos>;
export type ResultadoDesempate = ReturnType<typeof aplicarDesempate>;

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function numeros(registro: Record<string, unknown>, campos: readonly string[]): boolean {
  return campos.every((c) => typeof registro[c] === 'number');
}

function textos(registro: Record<string, unknown>, campos: readonly string[]): boolean {
  return campos.every((c) => typeof registro[c] === 'string');
}

function listaDe(valor: unknown, item: (r: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(valor) && valor.every((v) => ehRegistro(v) && item(v));
}

/** `cestaPrecos.analise` no formato de `analisarCestaPrecos` (@agora/dominio). */
export function ehAnaliseCesta(valor: unknown): valor is AnaliseCesta {
  if (!ehRegistro(valor)) return false;
  const brutas = valor.estatisticas;
  const saneadas = valor.estatisticasSaneadas;
  return (
    ehRegistro(brutas) &&
    numeros(brutas, ['n', 'media', 'mediana', 'menor', 'maior', 'desvioPadrao', 'coeficienteVariacao']) &&
    ehRegistro(saneadas) &&
    numeros(saneadas, ['n', 'media', 'mediana', 'menor', 'coeficienteVariacao']) &&
    listaDe(valor.sugeridasExpurgo, (s) => textos(s, ['id', 'motivo', 'explicacao'])) &&
    listaDe(valor.alertas, (a) => textos(a, ['codigo', 'mensagem', 'fundamento'])) &&
    (valor.metodologiaRecomendada === 'media' || valor.metodologiaRecomendada === 'mediana') &&
    typeof valor.valorEstimado === 'number' &&
    typeof valor.aviso === 'string'
  );
}

/** `disputa.resultado` no formato de `aplicarDesempate` (@agora/dominio). */
export function ehResultadoDesempate(valor: unknown): valor is ResultadoDesempate {
  if (!ehRegistro(valor)) return false;
  return (
    listaDe(valor.classificacao, (c) => textos(c, ['id', 'nome']) && numeros(c, ['posicao', 'valorConsiderado'])) &&
    listaDe(valor.passos, (p) => numeros(p, ['ordem']) && textos(p, ['criterio', 'fundamento', 'resultado'])) &&
    typeof valor.empateDetectado === 'boolean' &&
    typeof valor.sorteioNecessario === 'boolean' &&
    (valor.criterioDecisivo === null || typeof valor.criterioDecisivo === 'string')
  );
}
