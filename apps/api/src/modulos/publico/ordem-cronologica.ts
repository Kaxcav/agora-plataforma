/**
 * Consulta pública da ordem cronológica de pagamentos (Lei 14.133/2021, art. 141, § 3º; RN-43).
 * Publicação mensal na internet, sem login, para cada UASG e fonte de recursos: notas na ordem de
 * exigibilidade e alterações justificadas da ordem decididas no mês. Contratos com classificação
 * de sigilo vigente pela LAI exibem "Informação classificada" no lugar do objeto e do fornecedor.
 */
import { mascararCpf, mascararNome } from '@agora/dominio';
import type {
  AlteracaoOrdemCronologicaPublica,
  FornecedorOrdemCronologicaPublica,
  GrupoFonteOrdemCronologicaPublica,
  NotaOrdemCronologicaPublica,
  OrdemCronologicaPublicaResposta,
  UasgOrdemCronologicaPublica,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import type { SessaoAtiva } from '../../http/contexto.ts';
import { situacaoExibida } from '../financeiro/repositorio.ts';
import { contratosSemAcesso, rotuloInformacaoClassificada } from '../sigilo/acesso.ts';

const SESSAO_PUBLICA: SessaoAtiva = {
  id: '00000000-0000-0000-0000-000000000000',
  csrfToken: '',
  expiraEm: '2099-12-31T23:59:59.999Z',
  usuario: { id: '00000000-0000-0000-0000-000000000000', nome: 'Público', email: 'publico@agora.gov.br' },
  perfis: [],
  permissoes: new Set(),
  todasUasgs: false,
  uasgs: [],
  deveTrocarSenha: false,
};

interface LinhaPagamentoPublico {
  id: string;
  fonte_recurso: string;
  posicao: number | null;
  vencimento: string;
  contrato_id: string;
  contrato_numero: string;
  contrato_objeto: string;
  uasg: string;
  orgao: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  documento: string;
  valor: number;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  pago_em: string | null;
}

interface LinhaAlteracaoPublica {
  id: string;
  pagamento_id: string;
  contrato_id: string;
  contrato_numero: string;
  uasg: string;
  orgao: string;
  fonte_recurso: string;
  inciso: 'I' | 'II' | 'III' | 'IV' | 'V';
  justificativa: string;
  autoridade: string;
  ato: string;
  data: string;
}

export async function consultarOrdemCronologicaPublica(
  executor: Executor,
  mes: string,
  hoje: string,
): Promise<OrdemCronologicaPublicaResposta> {
  const restritos = await contratosSemAcesso(executor, SESSAO_PUBLICA, hoje);

  // Reaproveita a CTE padrão de ordem cronológica de pagamentos.ts / conjuntos.ts
  const linhasPagamentos = await executor.consultar<LinhaPagamentoPublico>(
    `WITH ordem AS (
       SELECT op.id, ROW_NUMBER() OVER (PARTITION BY op.fonte_recurso ORDER BY op.vencimento, op.criado_em, op.nota_fiscal)::integer AS posicao
         FROM pagamentos op
        WHERE op.situacao <> 'pago'
     )
     SELECT p.id, p.fonte_recurso, o.posicao, p.vencimento, p.contrato_id, c.numero AS contrato_numero, c.objeto AS contrato_objeto, c.uasg, u.orgao,
            f.tipo_pessoa, f.razao_social, f.documento, p.valor, p.situacao, p.pago_em
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
       JOIN uasgs u ON u.codigo = c.uasg
       JOIN fornecedores f ON f.id = c.fornecedor_id
       LEFT JOIN ordem o ON o.id = p.id
      WHERE to_char(p.vencimento, 'YYYY-MM') = $1
         OR to_char(p.pago_em, 'YYYY-MM') = $1
         OR p.competencia = $1
      ORDER BY u.orgao, c.uasg, p.fonte_recurso, p.vencimento, p.criado_em, p.nota_fiscal`,
    [mes],
  );

  const linhasAlteracoes = await executor.consultar<LinhaAlteracaoPublica>(
    `SELECT a.id, a.pagamento_id, c.id AS contrato_id, c.numero AS contrato_numero, c.uasg, u.orgao, p.fonte_recurso,
            a.inciso, a.justificativa, a.autoridade, a.ato, a.decidida_em AS data
       FROM alteracoes_ordem_cronologica a
       JOIN pagamentos p ON p.id = a.pagamento_id
       JOIN contratos c ON c.id = p.contrato_id
       JOIN uasgs u ON u.codigo = c.uasg
      WHERE to_char(a.decidida_em, 'YYYY-MM') = $1
      ORDER BY a.decidida_em DESC, a.registrado_em DESC`,
    [mes],
  );

  const uasgsMap = new Map<string, { uasg: string; orgao: string; fontesMap: Map<string, GrupoFonteOrdemCronologicaPublica> }>();

  const obterOuCriarUasg = (uasg: string, orgao: string) => {
    let u = uasgsMap.get(uasg);
    if (!u) {
      u = { uasg, orgao, fontesMap: new Map() };
      uasgsMap.set(uasg, u);
    }
    return u;
  };

  const obterOuCriarFonte = (u: { fontesMap: Map<string, GrupoFonteOrdemCronologicaPublica> }, fonte: string) => {
    let f = u.fontesMap.get(fonte);
    if (!f) {
      f = { fonteRecurso: fonte, notas: [], alteracoes: [] };
      u.fontesMap.set(fonte, f);
    }
    return f;
  };

  for (const l of linhasPagamentos) {
    const u = obterOuCriarUasg(l.uasg, l.orgao);
    const f = obterOuCriarFonte(u, l.fonte_recurso);

    const sigilo = restritos.get(l.contrato_id);
    const ehSigiloso = Boolean(sigilo);

    const objeto = ehSigiloso ? rotuloInformacaoClassificada(sigilo!) : l.contrato_objeto;
    let fornecedor: FornecedorOrdemCronologicaPublica;
    if (ehSigiloso) {
      fornecedor = {
        razaoSocial: rotuloInformacaoClassificada(sigilo!),
        cnpj: null,
        cpf: null,
      };
    } else if (l.tipo_pessoa === 'PF') {
      fornecedor = {
        razaoSocial: mascararNome(l.razao_social),
        cnpj: null,
        cpf: mascararCpf(l.documento),
      };
    } else {
      fornecedor = {
        razaoSocial: l.razao_social,
        cnpj: l.documento,
        cpf: null,
      };
    }

    f.notas.push({
      id: l.id,
      numeroContrato: l.contrato_numero,
      objeto,
      fornecedor,
      valor: l.valor,
      dataExigibilidade: l.vencimento,
      situacao: situacaoExibida(l.situacao, l.vencimento, hoje),
      posicaoFila: l.situacao === 'pago' ? null : l.posicao,
      pagoEm: l.pago_em,
    });
  }

  for (const a of linhasAlteracoes) {
    const u = obterOuCriarUasg(a.uasg, a.orgao);
    const f = obterOuCriarFonte(u, a.fonte_recurso);

    f.alteracoes.push({
      id: a.id,
      pagamentoId: a.pagamento_id,
      numeroContrato: a.contrato_numero,
      inciso: a.inciso,
      justificativa: a.justificativa,
      autoridade: a.autoridade,
      ato: a.ato,
      data: a.data,
    });
  }

  const uasgs: UasgOrdemCronologicaPublica[] = Array.from(uasgsMap.values()).map((u) => ({
    uasg: u.uasg,
    orgao: u.orgao,
    fontes: Array.from(u.fontesMap.values()),
  }));

  return { mes, uasgs };
}
