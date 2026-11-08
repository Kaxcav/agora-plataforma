/**
 * Tela "Desempenho de fornecedores" (RN-37, RF-30): ranking pelo registro cadastral de desempenho e simulador de
 * impacto em editais futuros — empate no pregão desfeito pelo art. 60, II, com as notas do registro, e conversão da
 * nota do registro em parte da nota técnica na técnica e preço (art. 37, III). A simulação não registra resultado.
 */
import { useId, useState, type FormEvent } from 'react';
import { Calculator, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import type { NotaRegistroDesempenho, ResultadoSimulacaoDesempenho } from '@agora/contratos';
import { formatarMoeda } from '@agora/dominio';
import { useRankingDesempenho, useSimularDesempenho } from '../../api/desempenho';
import {
  Alerta,
  Alternador,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoMoeda,
  CampoTexto,
  ConteudoConsulta,
  EstadoVazio,
  Etiqueta,
  Pagina,
  Secao,
  Tabela,
} from '../../componentes';
import { FAIXAS_IDC } from '../compartilhado/rotulos';
import { formatarNotaIdc } from '../fornecedores/idc';
import { ErroOperacao } from '../jornada/comum';

function numero(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim());
  return texto.trim() === '' || !Number.isFinite(n) ? null : n;
}

function Resultado({ resultado }: { resultado: ResultadoSimulacaoDesempenho }) {
  const primeiro = resultado.desempate.classificacao.find((c) => c.posicao === 1);
  return (
    <div className="pilha" aria-live="polite">
      <Secao titulo="Pregão com propostas iguais: desempate do art. 60" simples nivel={3}>
        <p className="linha">
          <Trophy size={18} aria-hidden="true" />
          <strong>Primeiro colocado: {primeiro?.nome ?? '—'}</strong>
          {resultado.desempate.sorteioNecessario ? (
            <Etiqueta tom="aviso" compacta>
              Persistiu o empate: sorteio
            </Etiqueta>
          ) : null}
        </p>
        {resultado.desempate.criterioDecisivo ? <p className="texto-pequeno">Critério decisivo: {resultado.desempate.criterioDecisivo}</p> : null}
        <ol aria-label="Critérios de desempate aplicados na simulação">
          {resultado.desempate.passos.map((p) => (
            <li key={`${p.ordem}-${p.criterio}`}>
              <strong>{p.criterio}</strong> — {p.resultado} <span className="texto-pequeno texto-secundario">({p.fundamento})</span>
            </li>
          ))}
        </ol>
      </Secao>
      {resultado.tecnicaEPreco ? (
        <Tabela
          id="simulacao-tecnica-preco"
          legenda="Técnica e preço com o desempenho anterior na nota técnica"
          semFerramentas
          linhas={resultado.tecnicaEPreco}
          chave={(l) => l.id}
          colunas={[
            { id: 'posicao', cabecalho: 'Posição', identificadora: true, fixa: true, celula: (l) => <span className="numero">{l.posicao}º</span> },
            { id: 'nome', cabecalho: 'Licitante', prioritaria: true, celula: (l) => l.nome },
            { id: 'proposta', cabecalho: 'Proposta técnica', alinhamento: 'fim', celula: (l) => <span className="numero">{formatarNotaIdc(l.notaProposta)}</span> },
            {
              id: 'desempenho',
              cabecalho: 'Desempenho',
              alinhamento: 'fim',
              celula: (l) => (
                <span className="numero">
                  {formatarNotaIdc(l.notaDesempenho)}
                  {l.origem === 'sem_historico' ? ' (sem histórico)' : ''}
                </span>
              ),
            },
            { id: 'tecnica', cabecalho: 'Nota técnica', alinhamento: 'fim', prioritaria: true, celula: (l) => <span className="numero">{formatarNotaIdc(l.notaTecnica)}</span> },
            { id: 'final', cabecalho: 'Nota final', alinhamento: 'fim', prioritaria: true, celula: (l) => <span className="numero">{formatarNotaIdc(l.notaFinal)}</span> },
          ]}
        />
      ) : null}
      <p className="texto-pequeno texto-secundario">{resultado.aviso}</p>
    </div>
  );
}

function Simulador({ ranking }: { ranking: readonly NotaRegistroDesempenho[] }) {
  const base = useId();
  const simular = useSimularDesempenho();
  const [selecionados, definirSelecionados] = useState<string[]>([]);
  const [valor, definirValor] = useState<number | null>(10_000_000);
  const [tecnica, definirTecnica] = useState(false);
  const [notaProposta, definirNotaProposta] = useState('80');
  const [peso, definirPeso] = useState('20');
  const [semHistorico, definirSemHistorico] = useState('50');
  const [pesoTecnico, definirPesoTecnico] = useState('70');
  const [regulamento, definirRegulamento] = useState('');
  const [tentou, definirTentou] = useState(false);

  const erroSelecao = selecionados.length < 2 ? 'Escolha ao menos dois fornecedores.' : null;
  const erroValor = valor === null || valor <= 0 ? 'Informe o valor da proposta.' : null;
  const erroRegulamento = tecnica && regulamento.trim().length < 10 ? 'Indique o regulamento que disciplina o critério (art. 36, § 3º).' : null;
  const alternar = (id: string, marcado: boolean) => definirSelecionados((lista) => (marcado ? [...lista, id] : lista.filter((x) => x !== id)));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (erroSelecao || erroValor || erroRegulamento || valor === null) return;
    simular.mutate({
      licitantes: selecionados.map((id) => ({ fornecedorId: id, valorProposta: valor, notaProposta: tecnica ? numero(notaProposta) : null })),
      criterio: tecnica
        ? {
            pesoDesempenhoPercentual: numero(peso) ?? 20,
            notaSemHistorico: numero(semHistorico) ?? 50,
            regulamento: regulamento.trim(),
            pesoTecnicoPercentual: numero(pesoTecnico) ?? 70,
          }
        : null,
    });
  };

  return (
    <form className="pilha" onSubmit={enviar} noValidate aria-label="Simulador de impacto em editais futuros">
      <fieldset className="pilha pilha--compacta">
        <legend className="campo__rotulo">Licitantes da simulação (propostas iguais, para simular o empate)</legend>
        {ranking.map((r) => (
          <CaixaSelecao
            key={r.fornecedorId}
            id={`${base}-${r.fornecedorId}`}
            rotulo={`Incluir na simulação — ${r.razaoSocial} (${r.nota === null ? 'sem nota no registro' : `nota ${formatarNotaIdc(r.nota)}`})`}
            checked={selecionados.includes(r.fornecedorId)}
            onChange={(e) => alternar(r.fornecedorId, e.target.checked)}
          />
        ))}
        {tentou && erroSelecao ? (
          <p className="campo__erro" role="alert">
            {erroSelecao}
          </p>
        ) : null}
      </fieldset>
      <CampoMoeda rotulo="Valor da proposta de todos os licitantes" valor={valor} aoMudar={definirValor} erro={tentou ? erroValor : null} />
      <Alternador rotulo="Simular também a técnica e preço com o desempenho na nota técnica" ligado={tecnica} aoMudar={definirTecnica} />
      {tecnica ? (
        <>
          <div className="formulario__linha">
            <CampoTexto id={`${base}-nota`} rotulo="Nota da proposta técnica (todos)" inputMode="decimal" value={notaProposta} onChange={(e) => definirNotaProposta(e.target.value)} />
            <CampoTexto id={`${base}-peso`} rotulo="Parte do desempenho na nota técnica (%)" inputMode="decimal" value={peso} onChange={(e) => definirPeso(e.target.value)} />
            <CampoTexto id={`${base}-sem`} rotulo="Nota para quem não tem histórico" inputMode="decimal" value={semHistorico} onChange={(e) => definirSemHistorico(e.target.value)} />
            <CampoTexto id={`${base}-tec`} rotulo="Peso da proposta técnica (até 70%)" inputMode="decimal" value={pesoTecnico} onChange={(e) => definirPesoTecnico(e.target.value)} />
          </div>
          <AreaTexto rotulo="Regulamento que disciplina o critério" rows={2} maxLength={500} value={regulamento} erro={tentou ? erroRegulamento : null} onChange={(e) => definirRegulamento(e.target.value)} />
        </>
      ) : null}
      <div className="linha">
        <Botao type="submit" variante="primario" icone={Calculator} carregando={simular.isPending}>
          Simular
        </Botao>
      </div>
      <ErroOperacao erro={simular.error} titulo="A simulação não foi feita" />
      {simular.data ? <Resultado resultado={simular.data} /> : null}
    </form>
  );
}

export default function Desempenho() {
  const consulta = useRankingDesempenho();
  return (
    <Pagina
      titulo="Desempenho de fornecedores"
      tela="desempenho"
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Fornecedores', para: '/fornecedores' },
      ]}
      subtitulo="Registro cadastral de desempenho (art. 88, §§ 3º e 4º) e seu uso em licitações futuras"
    >
      <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o registro de desempenho">
        {(ranking) => (
          <>
            <Secao titulo="Ranking pelo registro de desempenho" id="ranking-desempenho" descricao="Nota do registro: média das avaliações definitivas por contrato nos últimos 36 meses. A ausência de avaliação não penaliza.">
              <Tabela<NotaRegistroDesempenho>
                id="ranking-desempenho"
                legenda="Fornecedores com avaliação de desempenho"
                semFerramentas
                linhas={ranking}
                chave={(r) => r.fornecedorId}
                colunas={[
                  { id: 'fornecedor', cabecalho: 'Fornecedor', identificadora: true, fixa: true, celula: (r) => <Link to={`/fornecedores/${r.fornecedorId}`}>{r.razaoSocial}</Link> },
                  { id: 'nota', cabecalho: 'Nota do registro', alinhamento: 'fim', prioritaria: true, celula: (r) => <span className="numero">{r.nota === null ? '—' : formatarNotaIdc(r.nota)}</span> },
                  {
                    id: 'faixa',
                    cabecalho: 'Faixa',
                    prioritaria: true,
                    celula: (r) => (
                      <Etiqueta tom={FAIXAS_IDC[r.faixa].tom} compacta>
                        {FAIXAS_IDC[r.faixa].rotulo}
                      </Etiqueta>
                    ),
                  },
                  { id: 'contratos', cabecalho: 'Contratos avaliados', alinhamento: 'fim', celula: (r) => <span className="numero">{r.contratosConsiderados}</span> },
                ]}
                vazio={<EstadoVazio icone={Trophy} titulo="Nenhuma avaliação de desempenho registrada" />}
              />
            </Secao>
            <Secao
              titulo="Simulador de impacto em editais futuros"
              id="simulador-desempenho"
              descricao={`Mostra como a nota do registro decide um empate no pregão (art. 60, II) e como entra na nota técnica (art. 37, III). Valores de exemplo: ${formatarMoeda(10_000_000)} por licitante.`}
            >
              {ranking.length < 2 ? (
                <Alerta tipo="info" compacto titulo="Simulação indisponível">
                  <p>É preciso ao menos dois fornecedores com avaliação registrada.</p>
                </Alerta>
              ) : (
                <Simulador ranking={ranking} />
              )}
            </Secao>
          </>
        )}
      </ConteudoConsulta>
    </Pagina>
  );
}
