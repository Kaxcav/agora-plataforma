/**
 * Sigilo na transparência pública (RN-40), aplicado pelas rotas sem login:
 *   - processo classificado pela LAI: o edital aparece só como registro mínimo — número, data e aviso, sem objeto nem
 *     documentos (Decreto 7.845/2012, art. 20);
 *   - documento classificado: some da lista e o PDF responde 404, como se não existisse (art. 13);
 *   - orçamento sigiloso: o valor estimado só aparece depois da fase de lances ou do julgamento (art. 24);
 *   - contrato sigiloso: registro mínimo no lugar de fornecedor, objeto e valores (art. 91, § 1º).
 */
import type { ContratoPublico, EditalPublico, SigiloEditalPublico } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { valorTotalEstimado } from '../documentos/servico.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { contratosSigilosos, documentosRetidos, marcosOrcamento, vigentesPorProcesso } from './consultas.ts';

export const AVISO_REGISTRO_MINIMO =
  'Contratação classificada como sigilosa por razões de segurança da sociedade e do Estado (Lei 14.133/2021, art. 13; Lei 12.527/2011, art. 24). Divulga-se apenas o registro mínimo.';

export async function aplicarSigiloEditais(executor: Executor, editais: readonly EditalPublico[], hoje: string): Promise<EditalPublico[]> {
  if (editais.length === 0) return [];
  const ids = editais.map((e) => e.id);
  const vigentes = await vigentesPorProcesso(executor, ids, hoje);
  const retidos = await documentosRetidos(executor, ids, hoje);
  const marcos = await marcosOrcamento(executor, ids);
  const resultado: EditalPublico[] = [];
  for (const e of editais) {
    const doProcesso = (vigentes.get(e.id) ?? []).find((c) => c.alvo === 'processo' && c.tipo === 'lai') ?? null;
    const retidosDoProcesso = retidos.get(e.id) ?? new Map();
    const situacao = marcos.get(e.id)?.situacao;
    const divulgavel = situacao?.divulgavel ?? true;
    let valorEstimado: number | null = null;
    if (doProcesso === null && divulgavel) {
      const linha = await obterLinhaProcesso(executor, e.id, null);
      valorEstimado = linha ? valorTotalEstimado(linha, hoje) : null;
    }
    const orcamento: SigiloEditalPublico['orcamento'] = {
      situacao: doProcesso !== null ? 'sigiloso' : (situacao?.situacao ?? 'publico'),
      valorEstimado,
      divulgadoEm: situacao?.divulgadoEm ?? null,
      mensagem: doProcesso !== null ? 'Informação classificada.' : (situacao?.mensagem ?? 'O orçamento estimado não é sigiloso.'),
      fundamento: situacao?.fundamento ?? 'Lei 14.133/2021, art. 24',
    };
    if (doProcesso !== null) {
      resultado.push({
        ...e,
        objeto: 'Informação classificada (Lei 14.133/2021, art. 13)',
        modalidade: null,
        documentos: [],
        documentosPreparatorios: [],
        sigilo: { registroMinimo: true, mensagem: AVISO_REGISTRO_MINIMO, documentosRetidos: e.documentos.length + e.documentosPreparatorios.length, orcamento },
      });
      continue;
    }
    const documentos = e.documentos.filter((d) => !retidosDoProcesso.has(d.tipo));
    const documentosPreparatorios = e.documentosPreparatorios.filter((d) => !retidosDoProcesso.has(d.tipo));
    const quantidade = e.documentos.length - documentos.length + (e.documentosPreparatorios.length - documentosPreparatorios.length);
    resultado.push({
      ...e,
      documentos,
      documentosPreparatorios,
      sigilo: {
        registroMinimo: false,
        mensagem: quantidade > 0 ? 'Parte dos documentos desta contratação é sigilosa (Lei 14.133/2021, art. 13) e não é divulgada enquanto durar a classificação.' : null,
        documentosRetidos: quantidade,
        orcamento,
      },
    });
  }
  return resultado;
}

export async function aplicarSigiloContratos(executor: Executor, contratos: readonly ContratoPublico[], hoje: string): Promise<ContratoPublico[]> {
  const sigilosos = await contratosSigilosos(
    executor,
    contratos.map((c) => c.id),
    hoje,
  );
  return contratos.map((c) =>
    sigilosos.has(c.id)
      ? {
          ...c,
          fornecedor: 'Informação sigilosa',
          documentoFornecedor: '',
          objeto: 'Contrato sigiloso (Lei 14.133/2021, art. 91, § 1º)',
          valorGlobal: 0,
          valorPago: 0,
          linkPncp: null,
          sigilo: {
            mensagem: 'Contrato mantido em sigilo por ser imprescindível à segurança da sociedade e do Estado. Divulga-se apenas o registro mínimo: número, unidade e vigência.',
            fundamento: 'Lei 14.133/2021, art. 91, § 1º; Lei 12.527/2011, art. 24; Decreto 7.845/2012, art. 20',
          },
        }
      : c,
  );
}

