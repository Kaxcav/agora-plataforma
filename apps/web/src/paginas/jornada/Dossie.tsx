/**
 * Dossiê do processo (visão de impressão): dados do processo, registros de cada etapa, documentos gerados
 * e regras aplicadas. Pensado para `@media print` ("Imprimir ou salvar em PDF").
 */
import type { ReactNode } from 'react';
import type { DocumentoGerado, ProcessoDetalhe } from '@agora/contratos';
import { formatarData, formatarMoeda, INCISOS_ETP, regrasPorEtapa, validarDataISO } from '@agora/dominio';
import { ehAnaliseCesta, ehResultadoDesempate, type TipoDocumento } from '../../api/jornada';
import { formatarInstante, formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { ultimaVersao } from './Documentos';
import { textoAssinatura } from './Lateral';
import { Markdown } from './Markdown';
import {
  ALOCACOES,
  CONCLUSOES_PARECER,
  CRITERIOS_JULGAMENTO,
  NIVEIS_RISCO,
  NIVEIS_SINAL,
  nivelRisco,
  NUMEROS_ETAPAS,
  ORGAOS,
  REGIMES_EXECUCAO,
  rotuloFonte,
  rotuloPapel,
  SITUACOES_DOCUMENTO,
  SITUACOES_PUBLICACAO,
  TIPOS_DOCUMENTO,
  TIPOS_OBJETO,
  TOTAL_ETAPAS,
  tituloEtapa,
  vedacoesEdital,
} from './rotulos';

const ORDEM_DOCUMENTOS: readonly TipoDocumento[] = ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato', 'parecer_checklist'];

function TabelaDossie({ legenda, cabecalhos, linhas, vazio }: { legenda: string; cabecalhos: readonly string[]; linhas: readonly ReactNode[][]; vazio: string }) {
  if (linhas.length === 0) return <p className="texto-secundario">{vazio}</p>;
  return (
    <div className="tabela-rolagem" role="region" aria-label={legenda} tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption className="tabela__legenda">{legenda}</caption>
        <thead>
          <tr>
            {cabecalhos.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i}>
              {linha.map((celula, j) => (
                <td key={j}>{celula}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Campo({ termo, children }: { termo: string; children: ReactNode }) {
  return (
    <div>
      <dt>{termo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DocumentoDossie({ documento }: { documento: DocumentoGerado }) {
  return (
    <section className="jornada-dossie__documento" aria-label={TIPOS_DOCUMENTO[documento.tipo].rotulo}>
      <h3>
        {TIPOS_DOCUMENTO[documento.tipo].rotulo} — versão {documento.versao}
      </h3>
      <p className="texto-pequeno">
        {SITUACOES_DOCUMENTO[documento.situacao].rotulo} · gerado em {formatarInstante(documento.geradoEm)} por{' '}
        {documento.geradoPor === 'ia' ? 'IA auto-hospedada' : 'modelo de texto'}
        {documento.revisadoPor ? ` · aprovado por ${documento.revisadoPor.nome}` : ''}
        {documento.numeroSei ? ` · documento SEI ${documento.numeroSei}` : ''}
      </p>
      {documento.situacao !== 'aprovado' ? <p className="jornada-documento__marca">Rascunho — requer revisão humana</p> : null}
      <Markdown conteudo={documento.conteudo} nivelInicial={4} rotuloTabelas={`Tabela — ${TIPOS_DOCUMENTO[documento.tipo].rotulo}`} />
      <div className="jornada-dossie__apoio">
        <p className="texto-forte">Premissas</p>
        {documento.premissas.length > 0 ? (
          <ul>
            {documento.premissas.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : (
          <p>Nenhuma premissa registrada.</p>
        )}
        <p className="texto-forte">Fontes</p>
        {documento.fontes.length > 0 ? (
          <ul>
            {documento.fontes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : (
          <p>Nenhuma fonte registrada.</p>
        )}
      </div>
    </section>
  );
}

export default function Dossie({ processo }: { processo: ProcessoDetalhe }) {
  const emitidoEm = new Date().toISOString();
  const encerrado = processo.contratoGerado !== null;
  const etapasConsideradas = NUMEROS_ETAPAS.filter((e) => e <= processo.etapaAtual);
  const regras = etapasConsideradas.flatMap((e) => regrasPorEtapa(e));
  const cesta = processo.cestaPrecos;
  const analise = ehAnaliseCesta(cesta.analise) ? cesta.analise : null;
  const resultado = ehResultadoDesempate(processo.disputa.resultado) ? processo.disputa.resultado : null;
  const documentos = ORDEM_DOCUMENTOS.flatMap((t) => {
    const d = ultimaVersao(processo.documentos, t);
    return d ? [d] : [];
  });
  const dfd = processo.dfd;
  const totalDfd = dfd.itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitarioEstimado), 0);
  const pub = processo.publicacao;

  return (
    <article className="jornada-dossie" aria-label="Dossiê do processo">
      <header className="jornada-dossie__cabecalho">
        <p className="jornada-dossie__marca">Ágora — Contratações Públicas · Jornada da contratação (Lei 14.133/2021)</p>
        <dl className="jornada-dossie__dados">
          <Campo termo="Processo SEI">
            <span className="mono">{processo.numeroSei}</span>
          </Campo>
          <Campo termo="Objeto">{processo.titulo}</Campo>
          <Campo termo="Órgão requisitante">
            {ORGAOS[processo.orgao].nome} ({processo.orgao})
          </Campo>
          <Campo termo="Situação">
            {encerrado ? 'Concluído — contrato gerado' : `Etapa ${processo.etapaAtual} de ${TOTAL_ETAPAS} — ${tituloEtapa(processo.etapaAtual)}`}
          </Campo>
          <Campo termo="Responsável">{processo.responsavel?.nome ?? 'Sem responsável designado'}</Campo>
          <Campo termo="Valor estimado">
            {processo.valorEstimado !== null ? `${formatarMoeda(processo.valorEstimado)}${cesta.orcamentoSigiloso ? ' (sigiloso — art. 24)' : ''}` : 'Não estimado'}
          </Campo>
          <Campo termo="Modalidade prevista">{processo.modalidadePrevista ?? 'A definir'}</Campo>
          <Campo termo="Emitido em">{formatarInstante(emitidoEm)}</Campo>
        </dl>
        <p className="texto-pequeno">
          Documento de apoio para conferência, emitido a partir dos registros da Ágora. Não substitui os autos do processo no SEI. Pode conter
          informação de acesso restrito (orçamento sigiloso, art. 24): trate conforme a classificação do processo.
        </p>
      </header>

      <section className="jornada-dossie__secao">
        <h2>1. Demanda (DFD)</h2>
        <dl className="jornada-dossie__dados">
          <Campo termo="Descrição da necessidade">{dfd.descricaoNecessidade || 'Não preenchida'}</Campo>
          <Campo termo="Justificativa">{dfd.justificativa || 'Não preenchida'}</Campo>
          <Campo termo="Natureza do objeto">{TIPOS_OBJETO[dfd.tipoObjeto]}</Campo>
          <Campo termo="Previsto no PCA">{dfd.previstoNoPca ? 'Sim' : 'Não'}</Campo>
          <Campo termo="Catálogo padronizado">
            {dfd.usaCatalogoPadronizado ? 'Utilizado' : `Não utilizado — ${dfd.justificativaNaoPadronizacao ?? 'sem justificativa'}`}
          </Campo>
          {dfd.justificativaArtigoLuxo ? <Campo termo="Justificativa (art. 20)">{dfd.justificativaArtigoLuxo}</Campo> : null}
        </dl>
        <TabelaDossie
          legenda={`Itens da demanda — total ${formatarMoeda(totalDfd)}`}
          cabecalhos={['Nº', 'CATMAT/CATSER', 'Descrição', 'Unidade', 'Quantidade', 'Valor unitário', 'Valor total']}
          linhas={dfd.itens.map((i, n) => [
            n + 1,
            i.catmat ?? '—',
            i.descricao,
            i.unidade,
            formatarNumero(i.quantidade),
            formatarMoeda(i.valorUnitarioEstimado),
            formatarMoeda(Math.round(i.quantidade * i.valorUnitarioEstimado)),
          ])}
          vazio="Nenhum item registrado."
        />
      </section>

      <section className="jornada-dossie__secao">
        <h2>2. Equipe e árvore do processo SEI</h2>
        <TabelaDossie
          legenda="Designações"
          cabecalhos={['Papel', 'Servidor']}
          linhas={processo.equipe.map((e) => [rotuloPapel(e.papel), e.usuario.nome])}
          vazio="Nenhum servidor designado."
        />
        <TabelaDossie
          legenda="Árvore do processo SEI (simulação)"
          cabecalhos={['Número', 'Documento', 'Assinatura']}
          linhas={processo.arvoreSei.map((a) => [a.numero, a.titulo, a.assinado ? textoAssinatura(a) : 'Pendente'])}
          vazio="Nenhum documento na árvore."
        />
        <p className="texto-pequeno">Numeração e assinatura simuladas; a integração real depende da API do SEI do órgão e de certificado ICP-Brasil.</p>
      </section>

      <section className="jornada-dossie__secao">
        <h2>3. Estudo técnico preliminar (art. 18)</h2>
        <dl className="jornada-dossie__dados jornada-dossie__dados--lista">
          {INCISOS_ETP.map(({ inciso, titulo, obrigatorio }) => {
            const item = processo.etp[inciso];
            return (
              <Campo key={inciso} termo={`Inciso ${inciso} — ${titulo}${obrigatorio ? ' (obrigatório)' : ''}`}>
                {item?.texto?.trim() ? item.texto : item?.justificativaAusencia?.trim() ? `Ausência justificada: ${item.justificativaAusencia}` : 'Não preenchido'}
              </Campo>
            );
          })}
        </dl>
      </section>

      <section className="jornada-dossie__secao">
        <h2>4. Matriz de riscos (art. 22)</h2>
        <TabelaDossie
          legenda="Riscos"
          cabecalhos={['Risco', 'Probabilidade', 'Impacto', 'Nível', 'Alocação', 'Tratamento']}
          linhas={processo.riscos.map((r) => [
            r.descricao,
            r.probabilidade,
            r.impacto,
            NIVEIS_RISCO[nivelRisco(r.probabilidade, r.impacto)].rotulo,
            ALOCACOES[r.alocacao],
            r.mitigacao,
          ])}
          vazio="Nenhum risco registrado."
        />
      </section>

      <section className="jornada-dossie__secao">
        <h2>5. Pesquisa de preços (art. 23)</h2>
        <TabelaDossie
          legenda="Cotações"
          cabecalhos={['Fonte', 'Identificação', 'Valor unitário', 'Data', 'Situação']}
          linhas={cesta.cotacoes.map((c) => [
            rotuloFonte(c.fonte),
            c.descricaoFonte,
            formatarMoeda(c.valorUnitario),
            validarDataISO(c.dataCotacao) ? formatarData(c.dataCotacao) : c.dataCotacao,
            c.expurgada ? `Expurgada${c.motivoExpurgo ? ` — ${c.motivoExpurgo}` : ''}` : 'Válida',
          ])}
          vazio="Nenhuma cotação registrada."
        />
        {analise ? (
          <dl className="jornada-dossie__dados">
            <Campo termo="Preços após saneamento">{formatarNumero(analise.estatisticasSaneadas.n)}</Campo>
            <Campo termo="Média / mediana saneadas">
              {formatarMoeda(analise.estatisticasSaneadas.media)} / {formatarMoeda(analise.estatisticasSaneadas.mediana)}
            </Campo>
            <Campo termo="Coeficiente de variação saneado">{formatarPercentual(analise.estatisticasSaneadas.coeficienteVariacao)}</Campo>
            <Campo termo="Metodologia">{analise.metodologiaRecomendada === 'media' ? 'Média' : 'Mediana'}</Campo>
            <Campo termo="Valor unitário estimado">{formatarMoeda(analise.valorEstimado)}</Campo>
            <Campo termo="Alertas">{analise.alertas.length > 0 ? analise.alertas.map((a) => a.mensagem).join(' ') : 'Nenhum'}</Campo>
          </dl>
        ) : (
          <p className="texto-secundario">Sem análise estatística registrada.</p>
        )}
        <p>
          Orçamento sigiloso: {cesta.orcamentoSigiloso ? `sim — ${cesta.motivoSigilo ?? 'motivo não informado'}` : 'não'}.
        </p>
      </section>

      <section className="jornada-dossie__secao">
        <h2>6. Documentos gerados</h2>
        {documentos.length === 0 ? <p className="texto-secundario">Nenhum documento gerado.</p> : documentos.map((d) => <DocumentoDossie key={d.id} documento={d} />)}
      </section>

      <section className="jornada-dossie__secao">
        <h2>7. Edital, controle jurídico e publicação</h2>
        <TabelaDossie
          legenda="Checklist do parecer (art. 53)"
          cabecalhos={['Item', 'Situação', 'Observação']}
          linhas={processo.parecer.itens.map((i) => [i.texto, i.atendido === null ? 'Não verificado' : i.atendido ? 'Atendido' : 'Não atendido', i.observacao ?? '—'])}
          vazio="Checklist não montado."
        />
        <dl className="jornada-dossie__dados">
          <Campo termo="Critério de julgamento">{CRITERIOS_JULGAMENTO[processo.parametrosEdital.criterioJulgamento]}</Campo>
          <Campo termo="Regime de execução">{REGIMES_EXECUCAO[processo.parametrosEdital.regimeExecucao]}</Campo>
          <Campo termo="Habilitação (RN-06)">
            {vedacoesEdital(processo.parametrosEdital).join(' ') ||
              `Sem faturamento mínimo; patrimônio líquido mínimo ${
                processo.parametrosEdital.patrimonioLiquidoMinimoPercentual === null
                  ? 'não exigido'
                  : `de ${String(processo.parametrosEdital.patrimonioLiquidoMinimoPercentual).replace('.', ',')}% do valor estimado`
              }; acesso ao edital sem cadastro.`}
          </Campo>
          <Campo termo="Conclusão">{processo.parecer.conclusao ? CONCLUSOES_PARECER[processo.parecer.conclusao].rotulo : 'Sem conclusão'}</Campo>
          <Campo termo="Parecerista">{processo.parecer.parecerista?.nome ?? '—'}</Campo>
          <Campo termo="PNCP / DOU">
            {SITUACOES_PUBLICACAO[pub.pncp].rotulo} / {SITUACOES_PUBLICACAO[pub.dou].rotulo}
          </Campo>
          <Campo termo="Publicado em">{pub.publicadoEm ? formatarData(pub.publicadoEm) : '—'}</Campo>
          <Campo termo="Propostas a partir de">{pub.dataMinimaPropostas ? formatarData(pub.dataMinimaPropostas) : '—'}</Campo>
          <Campo termo="Identificador PNCP">{pub.idPncp ?? '—'}</Campo>
        </dl>
      </section>

      <section className="jornada-dossie__secao">
        <h2>8. Seleção do fornecedor</h2>
        <TabelaDossie
          legenda="Propostas"
          cabecalhos={['Licitante', 'Valor', 'ME/EPP', 'Desempenho prévio']}
          linhas={processo.disputa.licitantes.map((l) => [l.nome, formatarMoeda(l.valorProposta), l.meEpp ? 'Sim' : 'Não', l.notaDesempenhoPrevio ?? '—'])}
          vazio="Nenhuma proposta registrada."
        />
        {resultado ? (
          <>
            <TabelaDossie
              legenda="Classificação"
              cabecalhos={['Posição', 'Licitante', 'Valor considerado']}
              linhas={[...resultado.classificacao].sort((a, b) => a.posicao - b.posicao).map((c) => [`${c.posicao}º`, c.nome, formatarMoeda(c.valorConsiderado)])}
              vazio="Sem classificação."
            />
            {resultado.passos.length > 0 ? (
              <ol className="jornada-dossie__passos">
                {resultado.passos.map((p, i) => (
                  <li key={`${p.ordem}-${i}`}>
                    <strong>{p.criterio}</strong>: {p.resultado} <span className="texto-pequeno">({p.fundamento})</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {resultado.sorteioNecessario ? <p>Empate persistente após os critérios do art. 60.</p> : null}
          </>
        ) : null}
      </section>

      <section className="jornada-dossie__secao">
        <h2>9. Contrato</h2>
        <p>{processo.contratoGerado ? `Contrato ${processo.contratoGerado.numero} criado na carteira.` : 'Contrato ainda não gerado.'}</p>
      </section>

      <section className="jornada-dossie__secao">
        <h2>10. Bloqueios e sinais na emissão</h2>
        <TabelaDossie
          legenda={`Bloqueios da etapa ${processo.etapaAtual}`}
          cabecalhos={['Regra', 'Mensagem', 'Fundamento']}
          linhas={encerrado ? [] : processo.bloqueiosDetalhe.map((b) => [b.regra, b.mensagem, b.fundamento])}
          vazio="Nenhum bloqueio."
        />
        <TabelaDossie
          legenda="Sinais"
          cabecalhos={['Regra', 'Nível', 'Mensagem', 'Fundamento']}
          linhas={processo.sinais.map((s) => [s.regra, NIVEIS_SINAL[s.nivel].rotulo, s.mensagem, s.fundamento])}
          vazio="Nenhum sinal."
        />
      </section>

      <section className="jornada-dossie__secao">
        <h2>11. Regras aplicadas (etapas 1 a {processo.etapaAtual})</h2>
        <TabelaDossie
          legenda="Regras do catálogo"
          cabecalhos={['Regra', 'Etapa', 'Título', 'Fundamento']}
          linhas={regras.map((r) => [r.id, r.etapa ?? '—', r.titulo, r.fundamento])}
          vazio="Nenhuma regra associada."
        />
        <p className="texto-pequeno">As referências legais devem ser validadas pela área técnica e pela consultoria jurídica do órgão.</p>
      </section>
    </article>
  );
}
