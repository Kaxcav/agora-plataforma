/**
 * Criação da sessão de disputa: uso (simulação ou acompanhamento da sessão oficial), critério, modo permitido pelo
 * critério (art. 56, §§ 1º e 2º), participantes do cadastro de fornecedores e parâmetros do edital.
 */
import { useId, useState, type FormEvent } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import type {
  CenarioSimulacaoDisputa,
  CriterioJulgamentoSessao,
  EntradaSessaoDisputa,
  FornecedorResumo,
  ModoDisputaSessao,
  ProcessoDetalhe,
  SessaoDisputa,
  UsoSessaoDisputa,
} from '@agora/contratos';
import { CENARIOS_SIMULACAO, CRITERIOS_JULGAMENTO_DISPUTA, MODOS_DISPUTA } from '@agora/dominio';
import { useCriarSessaoDisputa } from '../../api/disputa';
import { useFornecedores } from '../../api/fornecedores';
import { Alerta, Botao, CampoBusca, CampoTexto, GrupoOpcoes, Secao, Selecao, useAvisos } from '../../componentes';
import { ErroOperacao } from '../jornada/comum';
import { ROTULOS_USO } from './rotulos';

interface Participante {
  id: string;
  nome: string;
}

function modosPermitidos(criterio: CriterioJulgamentoSessao): ModoDisputaSessao[] {
  return criterio === 'tecnica_e_preco' ? ['fechado'] : ['aberto', 'aberto_fechado', 'fechado_aberto'];
}

function BuscaParticipante({ incluidos, aoIncluir }: { incluidos: ReadonlySet<string>; aoIncluir: (f: FornecedorResumo) => void }) {
  const idTitulo = useId();
  const [busca, definirBusca] = useState('');
  const termo = busca.trim();
  const buscando = termo.length >= 2;
  const consulta = useFornecedores({ busca: termo, tamanhoPagina: 8 }, buscando);
  const resultados = buscando ? (consulta.data?.itens ?? []) : [];
  let situacao = 'Digite ao menos 2 caracteres da razão social ou do CNPJ.';
  if (buscando && consulta.isPending) situacao = 'Buscando fornecedores…';
  else if (buscando && consulta.isError) situacao = 'Não foi possível consultar o cadastro de fornecedores. Tente novamente.';
  else if (buscando) situacao = resultados.length === 0 ? `Nenhum fornecedor encontrado para “${termo}”.` : `${resultados.length} fornecedor(es) na lista.`;
  return (
    <section className="disputa-busca" aria-labelledby={idTitulo}>
      <h4 id={idTitulo} className="disputa-busca__titulo">
        Incluir participante do cadastro de fornecedores
      </h4>
      <CampoBusca rotulo="Buscar participante por razão social ou CNPJ" valor={busca} aoMudar={definirBusca} atraso={300} placeholder="Ex.: Ária" />
      <p className="texto-pequeno texto-secundario" role="status" aria-live="polite" aria-atomic="true">
        {situacao}
      </p>
      {resultados.length > 0 ? (
        <ul className="disputa-busca__lista" aria-label="Fornecedores encontrados">
          {resultados.map((f) => {
            const incluido = incluidos.has(f.id);
            return (
              <li key={f.id} className="disputa-busca__item">
                <span>
                  <span className="texto-forte">{f.razaoSocial}</span> <span className="mono texto-pequeno texto-secundario">{f.documento}</span>
                </span>
                <Botao
                  tamanho="compacto"
                  icone={Plus}
                  disabled={incluido}
                  aria-label={incluido ? `${f.razaoSocial} já incluído` : `Incluir ${f.razaoSocial} na sessão`}
                  onClick={() => aoIncluir(f)}
                >
                  {incluido ? 'Incluído' : 'Incluir'}
                </Botao>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export function NovaSessao({ processo, aoCriar }: { processo: ProcessoDetalhe; aoCriar: (sessao: SessaoDisputa) => void }) {
  const base = useId();
  const { avisar } = useAvisos();
  const criar = useCriarSessaoDisputa(processo.id);
  const [uso, definirUso] = useState<UsoSessaoDisputa>('simulacao');
  const [criterio, definirCriterio] = useState<CriterioJulgamentoSessao>('menor_preco');
  const [modo, definirModo] = useState<ModoDisputaSessao>('aberto');
  const [cenario, definirCenario] = useState<CenarioSimulacaoDisputa>('concorrencia');
  const [idCompra, definirIdCompra] = useState('');
  const [intervalo, definirIntervalo] = useState('');
  const [participantes, definirParticipantes] = useState<Participante[]>([]);
  const [erro, definirErro] = useState<string | null>(null);
  const [anuncio, definirAnuncio] = useState('');
  const incluidos = new Set(participantes.map((p) => p.id));
  const doProcesso = processo.disputa.licitantes.filter((l) => !incluidos.has(l.id));

  const mudarCriterio = (valor: string) => {
    const novo = valor as CriterioJulgamentoSessao;
    definirCriterio(novo);
    if (!modosPermitidos(novo).includes(modo)) definirModo(modosPermitidos(novo)[0] ?? 'aberto');
  };

  const incluir = (lista: Participante[]) => {
    definirParticipantes((atual) => [...atual, ...lista.filter((p) => !atual.some((a) => a.id === p.id))]);
    definirErro(null);
    definirAnuncio(lista.length === 1 ? `${lista[0]?.nome ?? 'Participante'} incluído.` : `${lista.length} participantes incluídos.`);
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (uso === 'simulacao' && participantes.length < 2) {
      definirErro('Inclua ao menos 2 participantes do cadastro de fornecedores.');
      return;
    }
    if (uso === 'acompanhamento' && !/^\d{8,30}$/.test(idCompra.trim())) {
      definirErro('Informe só os dígitos do identificador da compra no Compras.gov.br.');
      return;
    }
    const percentual = intervalo.trim() === '' ? null : Number(intervalo.replace(',', '.'));
    if (percentual !== null && (!Number.isFinite(percentual) || percentual <= 0 || percentual > 20)) {
      definirErro('O intervalo mínimo entre lances deve ser um percentual maior que 0 e até 20.');
      return;
    }
    definirErro(null);
    const entrada: EntradaSessaoDisputa = {
      uso,
      criterio,
      modo,
      participantes: participantes.map((p) => ({ fornecedorId: p.id })),
      ...(uso === 'simulacao' ? { cenario } : { idCompra: idCompra.trim() }),
      ...(percentual !== null ? { parametros: { intervaloMinimo: { tipo: 'percentual', valor: percentual } } } : {}),
    };
    criar.mutate(entrada, {
      onSuccess: (sessao) => {
        avisar({ tipo: 'sucesso', titulo: 'Sessão criada', mensagem: `${ROTULOS_USO[sessao.uso]} com ${sessao.participantes.length} participante(s).` });
        aoCriar(sessao);
      },
    });
  };

  const criterioDef = CRITERIOS_JULGAMENTO_DISPUTA.find((c) => c.criterio === criterio);
  const modoDef = MODOS_DISPUTA.find((m) => m.modo === modo);

  return (
    <Secao
      titulo="Nova sessão de disputa"
      id="nova-sessao"
      descricao="Simule a sessão para treino e para a prova de conceito, ou acompanhe a sessão oficial do Compras.gov.br com os dados abertos consultados pelo servidor da Ágora."
    >
      <form className="pilha" onSubmit={enviar} noValidate aria-describedby={`${base}-erro`}>
        <GrupoOpcoes
          legenda="Uso da sala"
          nome={`${base}-uso`}
          horizontal
          valor={uso}
          aoMudar={definirUso}
          opcoes={[
            { valor: 'simulacao', rotulo: 'Simulação (treino e PoC)', ajuda: 'Licitantes sintéticos com lances determinísticos.' },
            { valor: 'acompanhamento', rotulo: 'Acompanhar a sessão oficial', ajuda: 'Dados abertos do Compras.gov.br e lances transcritos.' },
          ]}
        />
        <div className="formulario__linha">
          <Selecao
            rotulo="Critério de julgamento"
            ajuda={criterioDef?.fundamento}
            opcoes={CRITERIOS_JULGAMENTO_DISPUTA.map((c) => ({ valor: c.criterio, rotulo: c.rotulo }))}
            value={criterio}
            onChange={(e) => mudarCriterio(e.target.value)}
          />
          <Selecao
            rotulo="Modo de disputa"
            ajuda={`${modoDef?.fundamento ?? ''}${criterio === 'tecnica_e_preco' ? '. Na técnica e preço, só o modo fechado (art. 56, § 2º).' : '. O modo fechado isolado é vedado neste critério (art. 56, § 1º).'}`}
            opcoes={MODOS_DISPUTA.filter((m) => modosPermitidos(criterio).includes(m.modo)).map((m) => ({ valor: m.modo, rotulo: m.rotulo }))}
            value={modo}
            onChange={(e) => definirModo(e.target.value as ModoDisputaSessao)}
          />
        </div>
        <div className="formulario__linha">
          {uso === 'simulacao' ? (
            <Selecao
              rotulo="Cenário da simulação"
              ajuda={CENARIOS_SIMULACAO.find((c) => c.cenario === cenario)?.descricao}
              opcoes={CENARIOS_SIMULACAO.map((c) => ({ valor: c.cenario, rotulo: c.rotulo }))}
              value={cenario}
              onChange={(e) => definirCenario(e.target.value as CenarioSimulacaoDisputa)}
            />
          ) : (
            <CampoTexto
              rotulo="Identificador da compra no Compras.gov.br"
              ajuda="Só os dígitos (UASG, modalidade, número e ano)."
              inputMode="numeric"
              value={idCompra}
              onChange={(e) => definirIdCompra(e.target.value)}
              obrigatorio
            />
          )}
          {criterio !== 'tecnica_e_preco' ? (
            <CampoTexto
              rotulo="Intervalo mínimo entre lances (%)"
              ajuda="Opcional, conforme o edital (art. 57). Ex.: 0,5."
              inputMode="decimal"
              value={intervalo}
              onChange={(e) => definirIntervalo(e.target.value)}
            />
          ) : null}
        </div>

        <section className="pilha pilha--compacta" aria-labelledby={`${base}-participantes`}>
          <h3 id={`${base}-participantes`} className="disputa-subtitulo">
            Participantes ({participantes.length})
          </h3>
          {participantes.length === 0 ? (
            <p className="texto-secundario">{uso === 'simulacao' ? 'Nenhum participante. Inclua de 2 a 20 fornecedores do cadastro.' : 'Opcional: os fornecedores do resultado oficial entram na sessão ao consultar o Compras.gov.br.'}</p>
          ) : (
            <ul className="disputa-participantes-lista" aria-label="Participantes incluídos">
              {participantes.map((p, i) => (
                <li key={p.id} className="disputa-busca__item">
                  <span>
                    {i + 1}. {p.nome}
                  </span>
                  <Botao
                    tamanho="compacto"
                    variante="terciario"
                    icone={Trash2}
                    aria-label={`Remover ${p.nome}`}
                    onClick={() => {
                      definirParticipantes((atual) => atual.filter((x) => x.id !== p.id));
                      definirAnuncio(`${p.nome} removido.`);
                    }}
                  >
                    Remover
                  </Botao>
                </li>
              ))}
            </ul>
          )}
          {doProcesso.length > 0 ? (
            <div>
              <Botao tamanho="compacto" icone={Users} onClick={() => incluir(doProcesso.map((l) => ({ id: l.id, nome: l.nome })))}>
                Incluir os licitantes registrados no processo ({doProcesso.length})
              </Botao>
            </div>
          ) : null}
          <BuscaParticipante incluidos={incluidos} aoIncluir={(f) => incluir([{ id: f.id, nome: f.razaoSocial }])} />
        </section>

        {uso === 'simulacao' ? (
          <p className="texto-pequeno texto-secundario">
            Durante a etapa de lances, os participantes aparecem como “Licitante 1, 2…”, sem identificação (IN SEGES/ME 73/2022, art. 21, § 6º). As propostas
            iniciais são sintéticas, a partir do valor estimado do processo.
          </p>
        ) : null}
        <div id={`${base}-erro`}>
          {erro ? (
            <Alerta tipo="erro" anunciar compacto>
              <p>{erro}</p>
            </Alerta>
          ) : null}
          <ErroOperacao erro={criar.error} titulo="Não foi possível criar a sessão" />
        </div>
        <div className="linha">
          <Botao variante="primario" type="submit" carregando={criar.isPending}>
            Criar sessão
          </Botao>
        </div>
        <p className="sr-only" role="status">
          {anuncio}
        </p>
      </form>
    </Secao>
  );
}
