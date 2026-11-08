/**
 * Consulta automática de preços (RF-25, art. 23, §§ 1º e 2º) e projeção do valor estimado (RIA-11).
 * O servidor consulta as fontes oficiais e devolve sugestões enquadradas no art. 23; o agente escolhe o que entra
 * na cesta. A projeção é sinal, com premissas e fontes: não altera o valor estimado.
 */
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { FileUp, Search, TrendingUp } from 'lucide-react';
import type { ConsultaPrecos, EntradaImportacaoReferencias, FontePesquisaPrecos, ProjecaoValorEstimado, SituacaoFontePesquisa } from '@agora/contratos';
import { adicionarDias, formatarData, formatarMoeda, hojeISO, validarDataISO } from '@agora/dominio';
import { useConsultarPrecos, useImportarReferencias, useIncluirSugestoes, usePesquisaPrecos, useProjetarValor } from '../../../api/precos';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  Campo,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  Etiqueta,
  ListaDefinicoes,
  Selecao,
  useAvisos,
  type TomEtiqueta,
} from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { formatarInstante, formatarNumero, formatarPercentual } from '../../../utilitarios/formatacao';
import { ErroOperacao } from '../comum';
import type { PropsEtapa } from './tipos';

const NOME_FONTE: Record<FontePesquisaPrecos, string> = {
  PAINEL_PRECOS: 'Painel de Preços',
  CONTRATACOES_SIMILARES: 'Contratação similar',
  NOTAS_FISCAIS: 'Nota fiscal eletrônica',
  SINAPI: 'Sinapi',
  SICRO: 'Sicro',
};

const SITUACAO: Record<SituacaoFontePesquisa, { rotulo: string; tom: TomEtiqueta }> = {
  ok: { rotulo: 'Consultada', tom: 'sucesso' },
  sem_resultado: { rotulo: 'Sem resultado', tom: 'neutro' },
  falhou: { rotulo: 'Falhou', tom: 'erro' },
  dependente_de_acesso: { rotulo: 'Depende de acesso', tom: 'aviso' },
  nao_aplicavel: { rotulo: 'Não se aplica', tom: 'neutro' },
};

const MODO_FONTE = { offline: 'simulação (demonstração)', online: 'API oficial', local: 'tabela oficial importada' } as const;

function contarPrecos(n: number): string {
  return n === 1 ? '1 preço' : `${formatarNumero(n)} preços`;
}

function TabelaFontes({ consulta }: { consulta: ConsultaPrecos }) {
  const id = useId();
  return (
    <div className="tabela-rolagem" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption id={id} className="tabela__legenda">
          Fontes consultadas pelo servidor
        </caption>
        <thead>
          <tr>
            <th scope="col">Fonte</th>
            <th scope="col">Situação</th>
            <th scope="col" className="tabela__alinhar--fim">
              Preços
            </th>
            <th scope="col">Proveniência</th>
          </tr>
        </thead>
        <tbody>
          {consulta.fontes.map((f) => (
            <tr key={f.fonte}>
              <th scope="row">{f.nome}</th>
              <td>
                <Etiqueta tom={SITUACAO[f.situacao].tom} compacta>
                  {SITUACAO[f.situacao].rotulo}
                </Etiqueta>
              </td>
              <td className="tabela__alinhar--fim numero">{formatarNumero(f.registros)}</td>
              <td className="jornada-celula-texto">
                <span className="pilha pilha--compacta">
                  <span>{f.mensagem}</span>
                  <span className="texto-pequeno texto-secundario">
                    {MODO_FONTE[f.modo]} · {formatarInstante(f.consultadoEm)}
                    {f.hashConteudo ? ` · conteúdo ${f.hashConteudo.slice(0, 12)}` : ''}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SugestoesConsulta({ processoId, consulta, editavel }: { processoId: string; consulta: ConsultaPrecos; editavel: boolean }) {
  const { avisar } = useAvisos();
  const incluir = useIncluirSugestoes(processoId);
  const [escolhidas, definirEscolhidas] = useState<string[]>([]);
  const disponiveis = consulta.sugestoes.filter((s) => s.cotacaoId === null);
  const n = escolhidas.length;

  if (consulta.sugestoes.length === 0) {
    return <p className="texto-secundario">Nenhum preço das fontes oficiais pôde ser sugerido nesta consulta.</p>;
  }
  return (
    <fieldset className="grupo-campos">
      <legend>Preços sugeridos (RF-25)</legend>
      <p className="texto-pequeno texto-secundario">{consulta.aviso}</p>
      {consulta.sugestoes.map((s) => {
        const rotulo = `${NOME_FONTE[s.fonte]} — ${formatarMoeda(s.valorUnitario)} em ${formatarData(s.data)} (${s.inciso})`;
        const ajuda = `${s.identificador}${s.local ? ` · ${s.local}` : ''}${s.unidade ? ` · unidade: ${s.unidade}` : ''}`;
        if (s.cotacaoId !== null) {
          return (
            <div key={s.id} className="linha">
              <Etiqueta tom="sucesso" compacta>
                Incluído na cesta
              </Etiqueta>
              <span>
                {rotulo} <span className="texto-pequeno texto-secundario">{ajuda}</span>
              </span>
            </div>
          );
        }
        return (
          <CaixaSelecao
            key={s.id}
            rotulo={rotulo}
            ajuda={ajuda}
            disabled={!editavel}
            checked={escolhidas.includes(s.id)}
            onChange={(e) => definirEscolhidas((atuais) => (e.target.checked ? [...atuais, s.id] : atuais.filter((x) => x !== s.id)))}
          />
        );
      })}
      {editavel && disponiveis.length > 0 ? (
        <div>
          <Botao
            variante="secundario"
            disabled={n === 0}
            carregando={incluir.isPending}
            onClick={() =>
              incluir.mutate(
                { consultaId: consulta.id, sugestoes: escolhidas },
                {
                  onSuccess: () => {
                    avisar({ tipo: 'sucesso', titulo: 'Preços incluídos na cesta', mensagem: `${contarPrecos(n)} com fonte, data e inciso do art. 23; a análise foi recalculada.` });
                    definirEscolhidas([]);
                  },
                },
              )
            }
          >
            {n === 0 ? 'Incluir preços selecionados' : `Incluir ${contarPrecos(n)} na cesta`}
          </Botao>
        </div>
      ) : null}
      <ErroOperacao erro={incluir.error} titulo="Não foi possível incluir os preços na cesta" />
    </fieldset>
  );
}

function ResultadoConsulta({ processoId, consulta, editavel }: { processoId: string; consulta: ConsultaPrecos; editavel: boolean }) {
  return (
    <div className="pilha" aria-live="polite">
      <p className="texto-pequeno texto-secundario">
        Consulta de {formatarInstante(consulta.executadaEm)}
        {consulta.executadaPor ? ` por ${consulta.executadaPor}` : ''} · termo “{consulta.termo}” · UF {consulta.uf}
      </p>
      <TabelaFontes consulta={consulta} />
      {consulta.alertas.length > 0 ? (
        <Alerta tipo="aviso" titulo="Alertas da consulta">
          <ul>
            {consulta.alertas.map((a) => (
              <li key={a.codigo}>
                {a.mensagem} <span className="texto-pequeno">({a.fundamento})</span>
              </li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      <SugestoesConsulta key={consulta.id} processoId={processoId} consulta={consulta} editavel={editavel} />
      {consulta.descartadas.length > 0 ? (
        <details className="jornada-criterios">
          <summary className="jornada-criterios__resumo">Amostras descartadas ({formatarNumero(consulta.descartadas.length)})</summary>
          <ul className="jornada-lista-compacta">
            {consulta.descartadas.map((d, i) => (
              <li key={`${d.fonte}-${d.identificador}-${i}`}>
                {NOME_FONTE[d.fonte]} — {d.identificador}: {d.motivo}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ImportarReferencias({ processoId, uf, aberto, aoFechar }: { processoId: string; uf: string; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const importar = useImportarReferencias(processoId);
  const [entrada, definirEntrada] = useState<EntradaImportacaoReferencias>({ sistema: 'SINAPI', uf, dataBase: '', desonerado: false, conteudo: '' });
  const [tentou, definirTentou] = useState(false);
  const idFormulario = useId();
  const idArquivo = useId();
  const erros = {
    uf: /^[A-Za-z]{2}$/.test(entrada.uf) ? null : 'Informe a UF com 2 letras.',
    dataBase: /^\d{4}-\d{2}$/.test(entrada.dataBase) ? null : 'Informe o mês de referência da tabela.',
    conteudo: entrada.conteudo.trim() === '' ? 'Cole o conteúdo da tabela ou escolha o arquivo.' : null,
  };
  const fechar = () => {
    importar.reset();
    definirTentou(false);
    aoFechar();
  };
  const escolherArquivo = async (evento: ChangeEvent<HTMLInputElement>) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    const texto = await arquivo.text();
    definirEntrada((atual) => ({ ...atual, conteudo: texto }));
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (Object.values(erros).some(Boolean)) return;
    importar.mutate(
      { ...entrada, uf: entrada.uf.toUpperCase() },
      {
        onSuccess: (r) => {
          avisar({ tipo: 'sucesso', titulo: 'Tabela importada', mensagem: `${r.tabela.sistema} ${r.tabela.uf}: ${formatarNumero(r.tabela.itens)} composição(ões) da data-base ${r.tabela.dataBase}.` });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo="Importar tabela do Sinapi ou do Sicro"
      largura="ampla"
      descricao={
        <p>
          O Sinapi (Caixa) e o Sicro (DNIT) são publicados como planilhas, sem API pública. Exporte da planilha oficial um CSV com as colunas código;
          descrição; unidade; preço. A tabela da mesma UF, data-base e desoneração é substituída e a importação fica na trilha de auditoria.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={importar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={importar.isPending}>
            Importar tabela
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <div className="formulario__linha">
          <Selecao
            rotulo="Sistema"
            obrigatorio
            opcoes={[
              { valor: 'SINAPI', rotulo: 'Sinapi — demais obras e serviços de engenharia' },
              { valor: 'SICRO', rotulo: 'Sicro — infraestrutura de transportes' },
            ]}
            value={entrada.sistema}
            onChange={(e) => definirEntrada({ ...entrada, sistema: e.target.value === 'SICRO' ? 'SICRO' : 'SINAPI' })}
          />
          <CampoTexto rotulo="UF" obrigatorio maxLength={2} value={entrada.uf} erro={tentou ? erros.uf : null} onChange={(e) => definirEntrada({ ...entrada, uf: e.target.value })} />
          <CampoTexto
            rotulo="Mês de referência (data-base)"
            obrigatorio
            type="month"
            value={entrada.dataBase}
            erro={tentou ? erros.dataBase : null}
            onChange={(e) => definirEntrada({ ...entrada, dataBase: e.target.value })}
          />
        </div>
        <CaixaSelecao rotulo="Tabela desonerada" checked={entrada.desonerado} onChange={(e) => definirEntrada({ ...entrada, desonerado: e.target.checked })} />
        <Campo id={idArquivo} rotulo="Arquivo da tabela (CSV)" ajuda="Opcional: o conteúdo do arquivo é copiado para o campo abaixo.">
          {(props) => <input {...props} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void escolherArquivo(e)} />}
        </Campo>
        <AreaTexto
          rotulo="Conteúdo da tabela"
          obrigatorio
          rows={6}
          value={entrada.conteudo}
          erro={tentou ? erros.conteudo : null}
          onChange={(e) => definirEntrada({ ...entrada, conteudo: e.target.value })}
        />
        <ErroOperacao erro={importar.error} titulo="Não foi possível importar a tabela" />
      </form>
    </Dialogo>
  );
}

function ResultadoProjecao({ projecao }: { projecao: ProjecaoValorEstimado }) {
  return (
    <div className="pilha" aria-live="polite">
      <p className="linha">
        <Etiqueta tom="aviso" compacta>
          Requer revisão humana
        </Etiqueta>
        <span className="texto-pequeno texto-secundario">
          Projeção de {formatarInstante(projecao.geradaEm)}
          {projecao.geradaPor ? ` por ${projecao.geradaPor}` : ''}
        </span>
      </p>
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: `Valor estimado em ${formatarData(projecao.dataBase)}`, valor: <span className="numero">{formatarMoeda(projecao.valorBase)}</span> },
          { termo: `Valor projetado para ${formatarData(projecao.dataPrevista)}`, valor: <strong className="numero">{formatarMoeda(projecao.valorProjetado)}</strong> },
          { termo: 'Variação projetada', valor: <span className="numero">{formatarPercentual(projecao.variacaoPercentual, 2)}</span> },
          { termo: 'Faixa provável', valor: <span className="numero">{`${formatarMoeda(projecao.faixa.minimo)} a ${formatarMoeda(projecao.faixa.maximo)}`}</span> },
          {
            termo: 'Valor unitário da cesta',
            valor:
              projecao.valorUnitarioBase !== null && projecao.valorUnitarioProjetado !== null ? (
                <span className="numero">{`${formatarMoeda(projecao.valorUnitarioBase)} → ${formatarMoeda(projecao.valorUnitarioProjetado)}`}</span>
              ) : (
                'sem análise da cesta'
              ),
          },
          { termo: 'Parcela sujeita ao câmbio', valor: <span className="numero">{formatarPercentual(projecao.percentualCambial, 0)}</span> },
        ]}
      />
      <Alerta tipo={projecao.sinal.nivel === 'atencao' ? 'aviso' : 'info'} titulo="Sinal da projeção (RIA-11)">
        <p>{projecao.sinal.mensagem}</p>
      </Alerta>
      <div>
        <h4 className="jornada-seletor__titulo">Premissas</h4>
        <ul className="jornada-lista-compacta">
          {projecao.premissas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="jornada-seletor__titulo">Fontes</h4>
        <ul className="jornada-lista-compacta">
          {projecao.fontes.map((f) => (
            <li key={f.serie}>
              {f.nome}: {f.fonte}; competências {f.competencias[0]?.competencia ?? '—'} a {f.competencias[f.competencias.length - 1]?.competencia ?? '—'}; consultada em{' '}
              {formatarInstante(f.consultadoEm)} ({f.modo === 'online' ? 'API oficial' : 'modo offline'}; conteúdo {f.hashConteudo.slice(0, 12)})
            </li>
          ))}
        </ul>
      </div>
      <details className="jornada-criterios">
        <summary className="jornada-criterios__resumo">Memória de cálculo</summary>
        <ul className="jornada-lista-compacta">
          {projecao.memoriaCalculo.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
      <p className="texto-pequeno texto-secundario">
        {projecao.aviso} Fundamento: {projecao.fundamento}.
      </p>
    </div>
  );
}

function FormularioProjecao({ processoId, editavel }: { processoId: string; editavel: boolean }) {
  const projetar = useProjetarValor(processoId);
  const hoje = hojeISO(new Date());
  const [dataPrevista, definirDataPrevista] = useState('');
  const [percentual, definirPercentual] = useState('0');
  const [tentou, definirTentou] = useState(false);
  const numero = Number(percentual.replace(',', '.'));
  const erros = {
    data: !validarDataISO(dataPrevista) ? 'Informe a data prevista da contratação.' : dataPrevista <= hoje ? 'A data prevista deve ser posterior a hoje.' : null,
    percentual: percentual.trim() === '' || !Number.isFinite(numero) || numero < 0 || numero > 100 ? 'Informe um percentual de 0 a 100.' : null,
  };
  if (!editavel) return null;
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (erros.data || erros.percentual) return;
    projetar.mutate({ dataPrevista, percentualCambial: numero });
  };
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <div className="formulario__linha">
        <CampoTexto
          rotulo="Data prevista da contratação"
          obrigatorio
          type="date"
          min={adicionarDias(hoje, 1)}
          value={dataPrevista}
          erro={tentou ? erros.data : null}
          onChange={(e) => definirDataPrevista(e.target.value)}
        />
        <CampoTexto
          rotulo="Parcela do valor sujeita ao câmbio (%)"
          obrigatorio
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={1}
          value={percentual}
          erro={tentou ? erros.percentual : null}
          ajuda="Ex.: equipamento importado cotado em dólar. Use 0 quando não houver."
          onChange={(e) => definirPercentual(e.target.value)}
        />
      </div>
      <div>
        <Botao type="submit" icone={TrendingUp} carregando={projetar.isPending}>
          Projetar valor
        </Botao>
      </div>
      <ErroOperacao erro={projetar.error} titulo="Não foi possível projetar o valor" />
    </form>
  );
}

export function SecaoPesquisaPrecos({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { temPermissao } = useSessao();
  const consulta = usePesquisaPrecos(processo.id);
  const consultar = useConsultarPrecos(processo.id);
  const [termo, definirTermo] = useState<string | null>(null);
  const [catmat, definirCatmat] = useState<string | null>(null);
  const [importando, definirImportando] = useState(false);
  const dados = consulta.data;
  const termoAtual = termo ?? dados?.termoSugerido ?? '';
  const catmatAtual = catmat ?? dados?.itemReferencia?.catmat ?? '';
  const erroTermo = termoAtual.trim().length < 3 ? 'Informe ao menos 3 caracteres.' : null;
  const erroCatmat = catmatAtual.trim() !== '' && !/^\d{1,9}$/.test(catmatAtual.trim()) ? 'Use só números.' : null;

  const buscar = (evento: FormEvent) => {
    evento.preventDefault();
    if (erroTermo || erroCatmat) return;
    consultar.mutate({ termo: termoAtual.trim(), catmat: catmatAtual.trim() === '' ? null : catmatAtual.trim() });
  };
  const ultima = dados?.consultas[0] ?? null;

  return (
    <>
      <section className="secao jornada-subsecao" id="etapa3-pesquisa" aria-labelledby={`${base}-titulo`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-titulo`} className="secao__titulo">
              Consulta automática de preços
            </h3>
            <p className="secao__descricao">
              Lei 14.133/2021, art. 23, §§ 1º e 2º (RF-25). O servidor da Ágora consulta as fontes oficiais; você escolhe os preços que entram na cesta.
            </p>
          </div>
          {editavel && dados?.engenharia && temPermissao('integracoes:executar') ? (
            <div className="secao__acoes">
              <Botao icone={FileUp} variante="terciario" onClick={() => definirImportando(true)}>
                Importar tabela do Sinapi ou do Sicro
              </Botao>
            </div>
          ) : null}
        </div>
        <ConteudoConsulta consulta={consulta}>
          {(d) => (
            <div className="pilha">
              {d.itemReferencia ? (
                <p>
                  Item de referência da cesta (item 1): <strong>{d.itemReferencia.descricao}</strong>
                  {d.itemReferencia.catmat ? ` · CATMAT/CATSER ${d.itemReferencia.catmat}` : ' · sem código do catálogo'} · UF {d.uf}
                </p>
              ) : (
                <p className="texto-secundario">Inclua os itens no DFD para pesquisar preços.</p>
              )}
              {d.modo === 'offline' ? (
                <p className="linha">
                  <Etiqueta tom="info" compacta>
                    Demonstração
                  </Etiqueta>
                  <span className="texto-pequeno">Integrações em modo offline: painel, contratações similares e notas fiscais são simulados de forma determinística.</span>
                </p>
              ) : null}
              {d.engenharia ? (
                <p className="texto-pequeno texto-secundario">
                  Tabelas de obras importadas para a UF {d.uf}:{' '}
                  {d.tabelasEngenharia.length === 0
                    ? 'nenhuma.'
                    : d.tabelasEngenharia.map((t) => `${t.sistema} ${t.dataBase}${t.desonerado ? ' (desonerada)' : ''}, ${formatarNumero(t.itens)} composições`).join('; ')}
                </p>
              ) : null}
              {editavel && d.itemReferencia ? (
                <form className="formulario" onSubmit={buscar} noValidate>
                  <div className="formulario__linha">
                    <CampoTexto
                      rotulo="Termo de busca"
                      obrigatorio
                      value={termoAtual}
                      erro={erroTermo}
                      ajuda="Palavras principais do item (usadas nas notas fiscais e nas tabelas de obras)."
                      onChange={(e) => definirTermo(e.target.value)}
                    />
                    <CampoTexto
                      rotulo="Código CATMAT/CATSER"
                      inputMode="numeric"
                      value={catmatAtual}
                      erro={erroCatmat}
                      ajuda="O painel de preços e as contratações similares são consultados pelo código do catálogo."
                      onChange={(e) => definirCatmat(e.target.value)}
                    />
                  </div>
                  <div>
                    <Botao type="submit" icone={Search} carregando={consultar.isPending}>
                      Buscar preços
                    </Botao>
                  </div>
                  <ErroOperacao erro={consultar.error} titulo="Não foi possível consultar as fontes de preços" />
                </form>
              ) : null}
              {ultima ? (
                <ResultadoConsulta processoId={processo.id} consulta={ultima} editavel={editavel} />
              ) : (
                <p className="texto-secundario">Nenhuma consulta automática feita neste processo.</p>
              )}
            </div>
          )}
        </ConteudoConsulta>
        {dados && importando ? <ImportarReferencias processoId={processo.id} uf={dados.uf} aberto={importando} aoFechar={() => definirImportando(false)} /> : null}
      </section>

      <section className="secao jornada-subsecao" id="etapa3-projecao" aria-labelledby={`${base}-projecao`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-projecao`} className="secao__titulo">
              Projeção do valor estimado
            </h3>
            <p className="secao__descricao">
              RIA-11: variação inflacionária (IPCA, IBGE) e cambial (dólar, Banco Central) até a data prevista da contratação. É sinal: não altera o valor estimado.
            </p>
          </div>
        </div>
        <FormularioProjecao processoId={processo.id} editavel={editavel} />
        {dados?.projecao ? (
          <ResultadoProjecao projecao={dados.projecao} />
        ) : (
          <p className="texto-secundario">Nenhuma projeção feita neste processo.</p>
        )}
      </section>
    </>
  );
}
