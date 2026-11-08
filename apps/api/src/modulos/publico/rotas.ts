import { CATALOGO_REGRAS, mascararDocumento } from '@agora/dominio';
import type { ContratoPublico, Pagina } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Executor } from '../../banco/tipos.ts';
import { linkPncpContrato } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { naoEncontrado } from '../../http/erros.ts';
import { camposPaginacao, deslocamento, idDaRota, pagina, textoBusca } from '../../http/validacao.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

interface LinhaPublica {
  id: string;
  numero: string;
  orgao: string;
  uasg: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  documento: string;
  objeto: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_global: number;
  valor_pago: number;
  id_pncp: string | null;
}

const CONDICOES = `
    FROM contratos c
    JOIN uasgs u ON u.codigo = c.uasg
    JOIN fornecedores f ON f.id = c.fornecedor_id
    JOIN vw_contratos_valores v ON v.contrato_id = c.id
   WHERE ($1::text IS NULL OR c.busca_normalizada LIKE $1 ESCAPE '\\')
     AND ($2::uuid IS NULL OR c.id = $2)`;

/** Transparência ativa (LAI): só dados públicos; pessoa física com nome e documento mascarados. Sem servidores. */
function mapear(l: LinhaPublica): ContratoPublico {
  return {
    id: l.id,
    numero: l.numero,
    orgao: l.orgao,
    uasg: l.uasg,
    fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
    documentoFornecedor: mascararDocumento(l.documento),
    objeto: l.objeto,
    vigenciaInicio: l.vigencia_inicio,
    vigenciaFim: l.vigencia_fim,
    valorGlobal: l.valor_global,
    valorPago: l.valor_pago,
    linkPncp: linkPncpContrato(l.id_pncp),
  };
}

async function consultar(executor: Executor, busca: string | null, id: string | null, limite: number, inicio: number) {
  const parametros = [busca ? padraoContem(busca) : null, id] as const;
  const linhas = await executor.consultar<LinhaPublica>(
    `SELECT c.id, c.numero, u.orgao, c.uasg, f.tipo_pessoa, f.razao_social, f.documento, c.objeto,
            c.vigencia_inicio, c.vigencia_fim, v.valor_global, v.valor_pago, c.id_pncp
     ${CONDICOES}
      ORDER BY c.assinatura_em DESC, c.numero
      LIMIT $3 OFFSET $4`,
    [...parametros, limite, inicio],
  );
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total ${CONDICOES}`, [...parametros]);
  return { itens: linhas.map(mapear), total: contagem?.total ?? 0 };
}

/** Rotas públicas (sem login): transparência de contratos e Caderno de Regras. */
export async function rotasPublico(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/publico/contratos', async (request): Promise<Pagina<ContratoPublico>> => {
    const f = z.object({ busca: textoBusca, ...camposPaginacao }).parse(request.query);
    const { itens, total } = await consultar(ctx.banco, f.busca ?? null, null, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina));
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  app.get('/publico/contratos/:id', async (request): Promise<ContratoPublico> => {
    const id = idDaRota(request.params);
    const { itens } = await consultar(ctx.banco, null, id, 1, 0);
    const contrato = itens[0];
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  });

  app.get('/publico/catalogo-regras', async () => CATALOGO_REGRAS);
}
