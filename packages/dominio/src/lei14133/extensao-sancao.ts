/**
 * Extensão dos efeitos da sanção por desconsideração da personalidade jurídica (Lei 14.133/2021, art. 160).
 * Os efeitos da sanção aplicada à pessoa jurídica alcançam administradores e sócios com poderes de administração,
 * a pessoa jurídica sucessora ou a empresa do mesmo ramo com relação de coligação ou controle com o sancionado,
 * "observados, em todos os casos, o contraditório, a ampla defesa e a obrigatoriedade de análise jurídica prévia".
 * As funções aqui conduzem o rito; a decisão é sempre da autoridade competente.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario } from '../datas.ts';
import { lerData } from '../interno.ts';
import { prazoDefesa } from './sancoes.ts';

export type AlvoExtensaoSancao = 'administrador' | 'socio_administrador' | 'sucessora' | 'coligada_controlada';

export type SituacaoExtensaoSancao = 'contraditorio' | 'analise_juridica' | 'decisao' | 'estendida' | 'nao_estendida' | 'arquivada';

export type AcaoExtensaoSancao = 'registrar_defesa' | 'registrar_parecer' | 'decidir' | 'arquivar';

/** Quem pode ser alcançado pela extensão (art. 160). */
export const ALVOS_EXTENSAO_SANCAO: readonly { alvo: AlvoExtensaoSancao; rotulo: string; pessoa: 'fisica' | 'juridica' }[] = Object.freeze([
  { alvo: 'administrador', rotulo: 'Administrador da pessoa jurídica sancionada', pessoa: 'fisica' },
  { alvo: 'socio_administrador', rotulo: 'Sócio com poderes de administração', pessoa: 'fisica' },
  { alvo: 'sucessora', rotulo: 'Pessoa jurídica sucessora', pessoa: 'juridica' },
  { alvo: 'coligada_controlada', rotulo: 'Empresa do mesmo ramo coligada ou controlada, de fato ou de direito', pessoa: 'juridica' },
]);

export const SITUACOES_EXTENSAO_SANCAO: Readonly<Record<SituacaoExtensaoSancao, string>> = Object.freeze({
  contraditorio: 'Contraditório e ampla defesa',
  analise_juridica: 'Análise jurídica prévia',
  decisao: 'Aguardando decisão da autoridade',
  estendida: 'Sanção estendida',
  nao_estendida: 'Extensão não acolhida',
  arquivada: 'Arquivada',
});

const FUNDAMENTO = 'Lei 14.133/2021, art. 160';
const MINIMO_FUNDAMENTACAO = 50;

export interface SancaoOrigemExtensao {
  tipo: 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';
  situacao: 'em_instrucao' | 'defesa' | 'decisao' | 'aplicada' | 'arquivada';
  inicioVigencia: DataISO | null;
  fimVigencia: DataISO | null;
}

function exigirOrigemExtensivel(origem: SancaoOrigemExtensao, hoje: DataISO): void {
  if (origem.tipo !== 'impedimento_licitar' && origem.tipo !== 'declaracao_inidoneidade') {
    throw new ErroDominio(
      'EXTENSAO_SANCAO_INVALIDA',
      'Só se estende, nesta versão, sanção que impede de licitar e contratar: impedimento ou declaração de inidoneidade (art. 156, §§ 4º e 5º).',
    );
  }
  if (origem.situacao !== 'aplicada') {
    throw new ErroDominio('EXTENSAO_SANCAO_INVALIDA', 'A sanção de origem ainda não foi aplicada pela autoridade competente: não há efeitos a estender.');
  }
  if (origem.fimVigencia !== null && origem.fimVigencia < hoje) {
    throw new ErroDominio('EXTENSAO_SANCAO_INVALIDA', 'A sanção de origem já terminou: não há efeitos a estender.');
  }
}

/**
 * Abre o procedimento de extensão (art. 160): confere se a sanção de origem impede de licitar e está vigente, exige
 * fundamentação de pelo menos 50 caracteres e calcula o prazo de defesa de 15 dias úteis a partir da intimação,
 * o mesmo do processo de responsabilização (art. 158), na forma do art. 183.
 */
export function proporExtensaoSancao(
  e: { sancaoOrigem: SancaoOrigemExtensao; alvo: AlvoExtensaoSancao; fundamentacao: string; intimacaoEm: DataISO; hoje: DataISO },
  opcoes?: OpcoesCalendario,
): { situacao: 'contraditorio'; prazoDefesa: DataISO; fundamento: string; aviso: string } {
  lerData(e.hoje, 'hoje');
  lerData(e.intimacaoEm, 'intimacaoEm');
  if (!ALVOS_EXTENSAO_SANCAO.some((a) => a.alvo === e.alvo)) {
    throw new ErroDominio('EXTENSAO_SANCAO_INVALIDA', `Alvo de extensão inválido: ${String(e.alvo)}.`);
  }
  exigirOrigemExtensivel(e.sancaoOrigem, e.hoje);
  if (typeof e.fundamentacao !== 'string' || e.fundamentacao.trim().length < MINIMO_FUNDAMENTACAO) {
    throw new ErroDominio(
      'EXTENSAO_SANCAO_INVALIDA',
      `Descreva, com pelo menos ${MINIMO_FUNDAMENTACAO} caracteres, o abuso da personalidade jurídica ou a confusão patrimonial e as provas.`,
    );
  }
  if (e.intimacaoEm > e.hoje) throw new ErroDominio('EXTENSAO_SANCAO_INVALIDA', 'A data da intimação não pode ser futura.');
  const prazo = prazoDefesa(e.intimacaoEm, opcoes);
  return {
    situacao: 'contraditorio',
    prazoDefesa: prazo.vencimento,
    fundamento: `${FUNDAMENTO}; prazo de defesa de 15 dias úteis (art. 158)`,
    aviso:
      'Proposta de extensão: não estende nada por si. Os efeitos só alcançam o interessado depois do contraditório, da ampla defesa, da análise jurídica prévia e da decisão da autoridade competente (art. 160).',
  };
}

/**
 * Próxima situação do procedimento de extensão, com as travas do art. 160 e a segregação de funções:
 * - defesa: só no contraditório; sem defesa apresentada, só depois de vencido o prazo (revelia);
 * - parecer jurídico: só depois do contraditório, por pessoa diferente de quem propôs;
 * - decisão: só depois do parecer, pela autoridade, que não pode ser quem propôs nem quem deu o parecer;
 * - arquivamento: antes da decisão.
 */
export function avancarExtensaoSancao(e: {
  situacao: SituacaoExtensaoSancao;
  acao: AcaoExtensaoSancao;
  hoje: DataISO;
  prazoDefesa: DataISO;
  autorId: string;
  propostoPorId: string;
  pareceristaId: string | null;
  defesaApresentada?: boolean;
  decisao?: 'estender' | 'nao_estender';
}): { situacao: SituacaoExtensaoSancao; fundamento: string } {
  lerData(e.hoje, 'hoje');
  lerData(e.prazoDefesa, 'prazoDefesa');
  const exigir = (esperada: SituacaoExtensaoSancao, oQue: string) => {
    if (e.situacao !== esperada) {
      throw new ErroDominio(
        'EXTENSAO_TRANSICAO_INVALIDA',
        `${oQue} só é possível na fase "${SITUACOES_EXTENSAO_SANCAO[esperada]}"; o procedimento está em "${SITUACOES_EXTENSAO_SANCAO[e.situacao]}".`,
      );
    }
  };
  switch (e.acao) {
    case 'registrar_defesa':
      exigir('contraditorio', 'Registrar a defesa');
      if (e.defesaApresentada !== true && e.hoje <= e.prazoDefesa) {
        throw new ErroDominio('EXTENSAO_TRANSICAO_INVALIDA', 'O prazo de defesa ainda está correndo: aguarde a defesa ou o fim do prazo.');
      }
      return { situacao: 'analise_juridica', fundamento: `${FUNDAMENTO} (contraditório e ampla defesa)` };
    case 'registrar_parecer':
      exigir('analise_juridica', 'O parecer jurídico');
      if (e.autorId === e.propostoPorId) {
        throw new ErroDominio('EXTENSAO_SEGREGACAO', 'Quem propôs a extensão não pode emitir o parecer jurídico (art. 7º, § 1º).');
      }
      return { situacao: 'decisao', fundamento: `${FUNDAMENTO} (análise jurídica prévia)` };
    case 'decidir':
      exigir('decisao', 'A decisão');
      if (e.autorId === e.propostoPorId || e.autorId === e.pareceristaId) {
        throw new ErroDominio('EXTENSAO_SEGREGACAO', 'A autoridade que decide não pode ser quem propôs a extensão nem quem emitiu o parecer jurídico (art. 7º, § 1º).');
      }
      if (e.decisao !== 'estender' && e.decisao !== 'nao_estender') {
        throw new ErroDominio('EXTENSAO_TRANSICAO_INVALIDA', 'Informe a decisão: estender ou não estender os efeitos da sanção.');
      }
      return { situacao: e.decisao === 'estender' ? 'estendida' : 'nao_estendida', fundamento: FUNDAMENTO };
    case 'arquivar':
      if (e.situacao !== 'contraditorio' && e.situacao !== 'analise_juridica' && e.situacao !== 'decisao') {
        throw new ErroDominio('EXTENSAO_TRANSICAO_INVALIDA', 'O procedimento já foi decidido ou arquivado.');
      }
      return { situacao: 'arquivada', fundamento: FUNDAMENTO };
    default:
      throw new ErroDominio('EXTENSAO_TRANSICAO_INVALIDA', `Ação inválida: ${String(e.acao)}.`);
  }
}

/**
 * Efeitos da extensão decidida: a mesma sanção (impedimento ou inidoneidade), a partir da data da decisão e até o
 * fim da vigência da sanção de origem, porque "todos os efeitos das sanções aplicadas à pessoa jurídica serão
 * estendidos" (art. 160). A sanção de origem precisa continuar vigente na data da decisão.
 */
export function efeitosExtensaoSancao(
  origem: SancaoOrigemExtensao,
  decididaEm: DataISO,
): { tipo: 'impedimento_licitar' | 'declaracao_inidoneidade'; inicioVigencia: DataISO; fimVigencia: DataISO | null; fundamento: string } {
  lerData(decididaEm, 'decididaEm');
  exigirOrigemExtensivel(origem, decididaEm);
  return {
    tipo: origem.tipo as 'impedimento_licitar' | 'declaracao_inidoneidade',
    inicioVigencia: decididaEm,
    fimVigencia: origem.fimVigencia,
    fundamento: FUNDAMENTO,
  };
}
