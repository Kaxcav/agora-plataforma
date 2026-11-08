import { adicionarDias, adicionarDiasUteis, CERTIDOES_REGULARIDADE, type TipoCertidaoRegularidade } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { consultarCadastrosOffline } from '../integracoes/transparencia.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/**
 * Carga sintética da regularidade (RF-20, RN-09, RN-23 e RN-24): certidões conferidas para cada fornecedor,
 * registros SIMULADOS do CEIS e do CNEP (base do modo offline), a primeira consulta de cada fornecedor e o protocolo
 * do envio das sanções já registradas. Tudo fictício e determinístico, com PRNG próprio (não altera as outras etapas).
 */

/** Semente própria: a ordem das etapas não muda os dados desta carga. */
const SEMENTE_REGULARIDADE = 14_133_161;

/** Órgãos sancionadores fictícios da base simulada. */
const ORGAO_FEDERAL_FICTICIO = 'Órgão federal de demonstração (fictício)';
const ORGAO_ESTADUAL_FICTICIO = 'Secretaria estadual de demonstração (fictícia)';
const ORGAO_CONTRATANTE_FICTICIO = 'Órgão contratante — carga de demonstração';

type Certidao = { tipo: TipoCertidaoRegularidade; emitida: string; validade: string; resultado: 'negativa' | 'positiva_com_efeitos_de_negativa' | 'positiva' };

export async function gerarRegularidade(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados } = ctx;
  const prng = new Prng(SEMENTE_REGULARIDADE);
  const conferente = dados.usuarios.get('gestor@agora.demo') ?? dados.usuarios.get('agente@agora.demo');
  if (!conferente) throw new Error('Usuários de demonstração ausentes');
  const porChave = new Map(dados.fornecedores.map((f) => [f.chave, f]));
  const processo = () => `00000.${prng.digitos(6)}/2026-${prng.digitos(2)}`;

  // ───────── Base simulada do CEIS e do CNEP ─────────
  const simulados: (readonly (string | null)[])[] = [];
  const mirante = porChave.get('mirante');
  if (mirante) {
    // PoC-04: CNPJ com sanção vigente no CEIS (inidoneidade, alcança todos os entes) — a assinatura é bloqueada.
    const inicio = adicionarDias(hoje, -120);
    simulados.push([mirante.documento, 'CEIS', 'Inidoneidade - Lei 14.133/2021', ORGAO_FEDERAL_FICTICIO, 'Federal', 'DF', inicio, adicionarDias(inicio, 4 * 365), processo(), 'Lei 14.133/2021, art. 156, § 5º', null]);
  }
  const aria = porChave.get('aria');
  if (aria) {
    // Impedimento aplicado por ente estadual: alcança só aquele ente (art. 156, § 4º) — sinal de atenção, sem bloqueio.
    const inicio = adicionarDias(hoje, -200);
    simulados.push([aria.documento, 'CEIS', 'Impedimento de licitar e contratar - Lei 14.133/2021', ORGAO_ESTADUAL_FICTICIO, 'Estadual', 'RJ', inicio, adicionarDias(inicio, 2 * 365), processo(), 'Lei 14.133/2021, art. 156, § 4º', null]);
  }
  const metropolitana = porChave.get('metropolitana');
  if (metropolitana) {
    // Multa aplicada pelo órgão e informada ao CNEP: não impede contratar, mas aparece como atenção.
    const inicio = adicionarDias(hoje, -210);
    simulados.push([metropolitana.documento, 'CNEP', 'Multa - Lei 14.133/2021', ORGAO_CONTRATANTE_FICTICIO, 'Federal', 'DF', inicio, null, processo(), 'Lei 14.133/2021, art. 156, § 3º', null]);
  }
  const precisao = porChave.get('precisao');
  if (precisao) {
    // Suspensão já encerrada: consta do histórico, sem efeito hoje.
    const inicio = adicionarDias(hoje, -900);
    simulados.push([precisao.documento, 'CEIS', 'Suspensão temporária - Lei 8.666/1993', ORGAO_FEDERAL_FICTICIO, 'Federal', 'DF', inicio, adicionarDias(inicio, 365), processo(), 'Lei 8.666/1993, art. 87, III', null]);
  }
  await inserirEmLote(
    tx,
    'ceis_cnep_simulados',
    ['documento', 'cadastro', 'tipo_sancao', 'orgao_sancionador', 'esfera', 'uf', 'data_inicio', 'data_fim', 'numero_processo', 'fundamentacao', 'abrangencia'],
    simulados,
  );

  // ───────── Certidões conferidas ─────────
  const emissor = (tipo: TipoCertidaoRegularidade) => CERTIDOES_REGULARIDADE.find((c) => c.tipo === tipo)?.emissor ?? 'Emissor';
  const regular = (tipo: TipoCertidaoRegularidade): Certidao => {
    const validade = CERTIDOES_REGULARIDADE.find((c) => c.tipo === tipo)?.validadeMaximaDias ?? 30;
    const emitida = adicionarDias(hoje, tipo === 'fgts' ? -prng.inteiro(1, 4) : -prng.inteiro(10, 60));
    return { tipo, emitida, validade: adicionarDias(emitida, validade), resultado: tipo === 'fiscal_federal' && prng.chance(0.2) ? 'positiva_com_efeitos_de_negativa' : 'negativa' };
  };
  const especiais: Record<string, Partial<Record<TipoCertidaoRegularidade, Certidao>>> = {
    // Coerente com o snapshot cadastral: CNDT vencida.
    metropolitana: { trabalhista: { tipo: 'trabalhista', emitida: adicionarDias(hoje, -200), validade: adicionarDias(hoje, -20), resultado: 'negativa' } },
    // CRF vencido e certidão federal positiva (com débitos).
    amazonia: {
      fgts: { tipo: 'fgts', emitida: adicionarDias(hoje, -45), validade: adicionarDias(hoje, -15), resultado: 'negativa' },
      fiscal_federal: { tipo: 'fiscal_federal', emitida: adicionarDias(hoje, -10), validade: adicionarDias(hoje, 170), resultado: 'positiva' },
    },
    // CRF perto do vencimento: aviso, sem bloqueio.
    lumen: { fgts: { tipo: 'fgts', emitida: adicionarDias(hoje, -24), validade: adicionarDias(hoje, 6), resultado: 'negativa' } },
  };
  const certidoes: (readonly (string | null)[])[] = [];
  for (const f of dados.fornecedores) {
    for (const definicao of CERTIDOES_REGULARIDADE) {
      const c = especiais[f.chave]?.[definicao.tipo] ?? regular(definicao.tipo);
      const numero = `${definicao.sigla.replace(/\s+/g, '').toUpperCase()}-${prng.digitos(10)}`;
      certidoes.push([
        prng.uuid(),
        f.id,
        c.tipo,
        numero,
        emissor(c.tipo),
        c.emitida,
        c.validade,
        c.resultado,
        null,
        conferente.id,
        instanteEm(c.emitida, prng, agora).toISOString(),
      ]);
    }
  }
  await inserirEmLote(
    tx,
    'certidoes_regularidade',
    ['id', 'fornecedor_id', 'tipo', 'numero', 'emissor', 'emitida_em', 'valida_ate', 'resultado', 'observacao', 'conferida_por', 'conferida_em'],
    certidoes,
  );

  // ───────── Primeira consulta de cada fornecedor (base simulada, modo offline) ─────────
  const consultas: (readonly (string | number | null)[])[] = [];
  for (const f of dados.fornecedores) {
    const r = await consultarCadastrosOffline(tx, f.documento);
    consultas.push([
      prng.uuid(),
      f.id,
      'offline',
      r.fonte,
      new Date(agora.getTime() - prng.inteiro(2, 20) * 3_600_000).toISOString(),
      r.hash,
      r.registros.length,
      JSON.stringify(r.registros),
      'carga',
    ]);
  }
  for (const c of consultas) {
    await tx.executar(
      `INSERT INTO consultas_ceis_cnep (id, fornecedor_id, modo, fonte, consultado_em, hash_conteudo, quantidade, registros, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      c,
    );
  }

  // ───────── Envio das sanções aplicadas ao CEIS/CNEP (art. 161) ─────────
  const aplicadas = await tx.consultar<{ id: string; tipo: string; aplicada_em: string; fornecedor_id: string }>(
    `SELECT s.id, s.tipo, s.aplicada_em, s.fornecedor_id FROM sancoes s
      WHERE s.situacao = 'aplicada' AND s.aplicada_em IS NOT NULL ORDER BY s.aplicada_em, s.id`,
  );
  const nortecom = porChave.get('nortecom');
  const envios: (readonly (string | null)[])[] = [];
  for (const s of aplicadas) {
    if (nortecom && s.fornecedor_id === nortecom.id) {
      // Demonstração da RN-24: impedimento aplicado e ainda não informado ao CEIS — pendência com prazo vencido.
      await tx.executar('UPDATE sancoes SET registrada_ceis_cnep = false WHERE id = $1', [s.id]);
      continue;
    }
    const enviado = adicionarDiasUteis(s.aplicada_em, prng.inteiro(3, 12), ctx.calendario);
    envios.push([
      s.id,
      s.tipo === 'multa' ? 'CNEP' : 'CEIS',
      `CGU-DEMO-${prng.digitos(8)}`,
      enviado,
      conferente.id,
      instanteEm(enviado, prng, agora).toISOString(),
      'Envio sintético da carga de demonstração.',
    ]);
  }
  await inserirEmLote(tx, 'sancoes_envios_ceis_cnep', ['sancao_id', 'cadastro', 'protocolo', 'enviado_em', 'responsavel_id', 'registrado_em', 'observacao'], envios);

  dados.contagens.ceisCnepSimulados = simulados.length;
  dados.contagens.certidoes = certidoes.length;
  dados.contagens.consultasCeisCnep = consultas.length;
  dados.contagens.enviosCeisCnep = envios.length;
}
