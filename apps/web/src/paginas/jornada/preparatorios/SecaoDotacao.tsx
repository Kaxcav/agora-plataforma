/**
 * Dotação orçamentária estruturada do processo (RN-39): créditos por unidade gestora, programa de trabalho, natureza
 * da despesa, fonte, exercício e valor, e a situação da declaração de adequação orçamentária da autoridade.
 * O servidor confere os formatos e decide se o processo pode seguir para o edital; aqui só se mostra a situação.
 */
import { useId, useState, type FormEvent } from 'react';
import { Landmark, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { DotacaoProcesso, LinhaDotacao, ProcessoDetalhe } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { useDotacao, useSalvarDotacao } from '../../../api/preparatorios';
import { Alerta, Botao, CampoMoeda, CampoTexto, Carregando, EsqueletoTexto, Etiqueta, FalhaConsulta, ListaDefinicoes, useAvisos } from '../../../componentes';
import { formatarInstante } from '../../../utilitarios/formatacao';
import { ErroOperacao, mesmoConteudo } from '../comum';
import { SITUACOES_DECLARACAO } from './rotulos';

interface Rascunho {
  chave: string;
  unidadeGestora: string;
  programaTrabalho: string;
  naturezaDespesa: string;
  fonteRecursos: string;
  exercicio: string;
  valor: number | null;
  preEmpenho: string;
}

let sequencia = 0;
function novaChave(): string {
  sequencia += 1;
  return `linha-${sequencia}`;
}

function paraRascunho(l: LinhaDotacao): Rascunho {
  return { chave: novaChave(), ...l, exercicio: String(l.exercicio), preEmpenho: l.preEmpenho ?? '' };
}

function linhaVazia(exercicio: number): Rascunho {
  return { chave: novaChave(), unidadeGestora: '', programaTrabalho: '', naturezaDespesa: '', fonteRecursos: '', exercicio: String(exercicio), valor: null, preEmpenho: '' };
}

function paraEntrada(r: Rascunho): LinhaDotacao {
  return {
    unidadeGestora: r.unidadeGestora.trim(),
    programaTrabalho: r.programaTrabalho.trim(),
    naturezaDespesa: r.naturezaDespesa.trim(),
    fonteRecursos: r.fonteRecursos.trim(),
    exercicio: Number(r.exercicio),
    valor: r.valor ?? 0,
    preEmpenho: r.preEmpenho.trim() === '' ? null : r.preEmpenho.trim(),
  };
}

function TabelaDotacao({ dotacao }: { dotacao: DotacaoProcesso }) {
  const id = useId();
  if (dotacao.linhas.length === 0) return <p className="texto-secundario">Nenhum crédito orçamentário informado.</p>;
  return (
    <div className="tabela-rolagem" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption id={id} className="tabela__legenda">
          Créditos orçamentários do processo
        </caption>
        <thead>
          <tr>
            <th scope="col">Unidade gestora</th>
            <th scope="col">Programa de trabalho</th>
            <th scope="col">Natureza da despesa</th>
            <th scope="col">Fonte</th>
            <th scope="col">Exercício</th>
            <th scope="col" className="tabela__alinhar--fim">
              Valor
            </th>
            <th scope="col">Pré-empenho</th>
          </tr>
        </thead>
        <tbody>
          {dotacao.linhas.map((l, i) => (
            <tr key={i}>
              <td className="mono">{l.unidadeGestora}</td>
              <td className="mono">{l.programaTrabalho}</td>
              <td className="mono">{l.naturezaDespesa}</td>
              <td className="mono">{l.fonteRecursos}</td>
              <td className="numero">{l.exercicio}</td>
              <td className="numero tabela__alinhar--fim">{formatarMoeda(l.valor)}</td>
              <td className="mono">{l.preEmpenho ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SituacaoDeclaracao({ dotacao }: { dotacao: DotacaoProcesso }) {
  const { declaracao } = dotacao;
  const situacao = SITUACOES_DECLARACAO[declaracao.situacao];
  return (
    <ListaDefinicoes
      colunas={2}
      itens={[
        { termo: 'Total dos créditos', valor: <span className="numero">{formatarMoeda(dotacao.total)}</span> },
        { termo: `No exercício de ${dotacao.exercicioReferencia}`, valor: <span className="numero">{formatarMoeda(dotacao.totalExercicio)}</span> },
        {
          termo: 'Declaração de adequação orçamentária',
          valor: (
            <span className="linha">
              <Etiqueta tom={situacao.tom} compacta>
                {situacao.rotulo}
              </Etiqueta>
              {declaracao.versao !== null ? <span className="texto-pequeno">versão {declaracao.versao}</span> : null}
              {declaracao.aprovadaPor ? <span className="texto-pequeno">por {declaracao.aprovadaPor.nome}</span> : null}
              {declaracao.numeroSei ? <span className="texto-pequeno mono">SEI {declaracao.numeroSei}</span> : null}
            </span>
          ),
        },
        {
          termo: 'Registrada',
          valor: dotacao.registradaEm ? `${formatarInstante(dotacao.registradaEm)}${dotacao.registradaPor ? ` por ${dotacao.registradaPor.nome}` : ''}` : 'Ainda não informada',
        },
      ]}
    />
  );
}

function Pendencias({ dotacao }: { dotacao: DotacaoProcesso }) {
  if (dotacao.declarada && dotacao.sinais.length === 0) return null;
  const orientacao: Record<DotacaoProcesso['declaracao']['situacao'], string> = {
    nao_gerada: 'Gere a "Declaração de adequação orçamentária" nas peças complementares desta etapa; a autoridade competente designada a aprova.',
    rascunho: 'A declaração foi gerada e aguarda a aprovação da autoridade competente designada no processo.',
    desatualizada: 'A dotação mudou depois da declaração: gere nova versão da declaração para a autoridade aprovar.',
    aprovada: '',
  };
  return (
    <>
      {!dotacao.declarada ? (
        <Alerta tipo="aviso" compacto titulo="Sem a dotação declarada, o processo não segue para o edital (RN-39)">
          {dotacao.pendencias.length > 0 ? (
            <ul className="jornada-lista-compacta">
              {dotacao.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {orientacao[dotacao.declaracao.situacao] ? <p>{orientacao[dotacao.declaracao.situacao]}</p> : null}
        </Alerta>
      ) : null}
      {dotacao.sinais.length > 0 ? (
        <Alerta tipo="info" compacto titulo="Pontos de atenção">
          <ul className="jornada-lista-compacta">
            {dotacao.sinais.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
    </>
  );
}

function FormularioDotacao({ processo, dotacao }: { processo: ProcessoDetalhe; dotacao: DotacaoProcesso }) {
  const { avisar } = useAvisos();
  const salvar = useSalvarDotacao(processo.id);
  const [linhas, definirLinhas] = useState<Rascunho[]>(() =>
    dotacao.linhas.length > 0 ? dotacao.linhas.map(paraRascunho) : [linhaVazia(dotacao.exercicioReferencia)],
  );
  const salvas = dotacao.linhas.map((l) => ({ ...l }));
  const alterado = !mesmoConteudo(linhas.map(paraEntrada), salvas);
  const mudar = (chave: string, campo: keyof Omit<Rascunho, 'chave'>, valor: string | number | null) =>
    definirLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(
      { linhas: linhas.map(paraEntrada) },
      {
        onSuccess: (atualizada) => {
          definirLinhas(atualizada.linhas.length > 0 ? atualizada.linhas.map(paraRascunho) : [linhaVazia(atualizada.exercicioReferencia)]);
          avisar({
            tipo: atualizada.valida ? 'sucesso' : 'aviso',
            titulo: 'Dotação salva',
            mensagem: atualizada.valida
              ? atualizada.declarada
                ? 'A dotação continua declarada pela autoridade.'
                : 'Gere a declaração de adequação orçamentária para a aprovação da autoridade competente.'
              : 'A dotação tem pendências a resolver antes da declaração (RN-39).',
          });
        },
      },
    );
  };

  return (
    <form className="pilha" onSubmit={enviar} noValidate aria-label="Créditos orçamentários">
      {linhas.map((l, i) => (
        <fieldset key={l.chave} className="grupo-campos preparatorios-credito">
          <legend>Crédito {i + 1}</legend>
          <div className="grade grade--3">
            <CampoTexto
              rotulo="Unidade gestora"
              obrigatorio
              inputMode="numeric"
              maxLength={6}
              ajuda="6 dígitos."
              value={l.unidadeGestora}
              onChange={(e) => mudar(l.chave, 'unidadeGestora', e.target.value)}
            />
            <CampoTexto
              rotulo="Programa de trabalho"
              obrigatorio
              maxLength={25}
              ajuda="Função.subfunção.programa.ação.localizador (00.000.0000.0000.0000)."
              value={l.programaTrabalho}
              onChange={(e) => mudar(l.chave, 'programaTrabalho', e.target.value)}
            />
            <CampoTexto
              rotulo="Natureza da despesa"
              obrigatorio
              maxLength={12}
              ajuda="Categoria.grupo.modalidade.elemento (ex.: 3.3.90.30)."
              value={l.naturezaDespesa}
              onChange={(e) => mudar(l.chave, 'naturezaDespesa', e.target.value)}
            />
            <CampoTexto
              rotulo="Fonte de recursos"
              obrigatorio
              inputMode="numeric"
              maxLength={10}
              ajuda="10 dígitos (ou 3 a 4 na classificação anterior)."
              value={l.fonteRecursos}
              onChange={(e) => mudar(l.chave, 'fonteRecursos', e.target.value)}
            />
            <CampoTexto
              rotulo="Exercício"
              obrigatorio
              inputMode="numeric"
              maxLength={4}
              value={l.exercicio}
              onChange={(e) => mudar(l.chave, 'exercicio', e.target.value)}
            />
            <CampoMoeda rotulo="Valor do crédito" obrigatorio valor={l.valor} aoMudar={(v) => mudar(l.chave, 'valor', v)} />
            <CampoTexto
              rotulo="Pré-empenho"
              maxLength={12}
              ajuda="Opcional: AAAAPE000000."
              value={l.preEmpenho}
              onChange={(e) => mudar(l.chave, 'preEmpenho', e.target.value)}
            />
          </div>
          {linhas.length > 1 ? (
            <div className="linha">
              <Botao variante="terciario" tamanho="compacto" icone={Trash2} onClick={() => definirLinhas((atuais) => atuais.filter((x) => x.chave !== l.chave))}>
                Remover crédito {i + 1}
              </Botao>
            </div>
          ) : null}
        </fieldset>
      ))}
      <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar a dotação" />
      <div className="jornada-barra-acoes">
        <p className="texto-pequeno texto-secundario" aria-live="polite">
          {alterado ? 'Há alterações não salvas na dotação.' : 'Dotação sem alterações pendentes.'}
        </p>
        <div className="linha">
          <Botao
            variante="terciario"
            icone={Plus}
            disabled={linhas.length >= 20}
            onClick={() => definirLinhas((atuais) => [...atuais, linhaVazia(dotacao.exercicioReferencia)])}
          >
            Incluir crédito
          </Botao>
          <Botao
            variante="terciario"
            icone={RotateCcw}
            disabled={!alterado || salvar.isPending}
            onClick={() => {
              definirLinhas(dotacao.linhas.length > 0 ? dotacao.linhas.map(paraRascunho) : [linhaVazia(dotacao.exercicioReferencia)]);
              salvar.reset();
            }}
          >
            Descartar alterações
          </Botao>
          <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
            Salvar dotação
          </Botao>
        </div>
      </div>
    </form>
  );
}

export function SecaoDotacao({ processo, editavel }: { processo: ProcessoDetalhe; editavel: boolean }) {
  const idTitulo = useId();
  const consulta = useDotacao(processo.id, processo.atualizadoEm);
  const dotacao = consulta.data;
  const situacao = dotacao ? SITUACOES_DECLARACAO[dotacao.declaracao.situacao] : null;
  return (
    <section className="secao jornada-subsecao" aria-labelledby={idTitulo}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={idTitulo} className="secao__titulo">
            Dotação orçamentária
          </h3>
          <p className="secao__descricao">
            Créditos que pagam a contratação (art. 150) e trazidos pelo TR e pela minuta (art. 6º, XXIII, &ldquo;j&rdquo;, e art. 92, VIII). O
            processo só segue para o edital com a dotação declarada pela autoridade competente (RN-39).
          </p>
        </div>
        {situacao ? (
          <Etiqueta tom={situacao.tom} icone={Landmark}>
            {situacao.rotulo}
          </Etiqueta>
        ) : null}
      </div>
      {consulta.isPending ? (
        <Carregando rotulo="Carregando a dotação">
          <EsqueletoTexto linhas={3} />
        </Carregando>
      ) : consulta.isError || !dotacao ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar a dotação" />
      ) : (
        <>
          <SituacaoDeclaracao dotacao={dotacao} />
          <Pendencias dotacao={dotacao} />
          {editavel && dotacao.editavel ? (
            <FormularioDotacao key={dotacao.registradaEm ?? 'nova'} processo={processo} dotacao={dotacao} />
          ) : (
            <TabelaDotacao dotacao={dotacao} />
          )}
        </>
      )}
    </section>
  );
}
