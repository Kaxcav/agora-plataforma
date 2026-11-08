/**
 * Vínculos e impedimentos (F4 e F14): análise de vínculos entre licitantes (RIA-06 e RIA-10), possíveis sucessões
 * de empresas sancionadas, extensões de sanção (RN-27), processos em seleção e vínculos registrados.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Gavel, Network, Search } from 'lucide-react';
import type { ExtensaoSancao, ProcessoComLicitantes, SinalVinculo } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useFornecedores } from '../../api/fornecedores';
import { useAnalisarVinculos, useExtensoes, useProcessosComLicitantes, useSucessoes, useVinculos } from '../../api/impedimentos';
import {
  Alerta,
  Botao,
  CaixaSelecao,
  CampoBusca,
  EstadoVazio,
  FalhaConsulta,
  Pagina,
  Secao,
  Tabela,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import {
  ALVOS_EXTENSAO,
  BotaoRegistrarVinculo,
  COLUNAS_VINCULOS,
  DialogoProporExtensao,
  DialogoRegistrarVinculo,
  EtiquetaSituacaoExtensao,
  ListaSinaisVinculo,
  SeletorFornecedor,
} from './comum';

const MAXIMO_ANALISE = 50;

function AnaliseLicitantes() {
  const fornecedores = useFornecedores({ tamanhoPagina: 100 });
  const analisar = useAnalisarVinculos();
  const [filtro, definirFiltro] = useState('');
  const [selecionados, definirSelecionados] = useState<Set<string>>(new Set());
  const [erro, definirErro] = useState<string | null>(null);
  const todos = fornecedores.data?.itens ?? [];
  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLocaleLowerCase('pt-BR');
    return termo === '' ? todos : todos.filter((f) => `${f.razaoSocial} ${f.documento}`.toLocaleLowerCase('pt-BR').includes(termo));
  }, [todos, filtro]);
  const nomes = new Map(todos.map((f) => [f.id, f.razaoSocial]));

  const alternar = (id: string) =>
    definirSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (selecionados.size < 2 || selecionados.size > MAXIMO_ANALISE) {
      definirErro(`Selecione de 2 a ${MAXIMO_ANALISE} fornecedores.`);
      return;
    }
    definirErro(null);
    analisar.mutate({ fornecedorIds: [...selecionados] });
  };

  return (
    <Secao
      titulo="Analisar vínculos entre licitantes"
      id="analise"
      descricao="Escolha os licitantes de uma sessão (por exemplo, os quatro de uma prova de conceito) para cruzar o quadro societário, o endereço e o contato do cadastro, os vínculos registrados com evidência e as sanções vigentes. Não grava nada."
    >
      {fornecedores.isError ? (
        <FalhaConsulta consulta={fornecedores} titulo="Não foi possível listar os fornecedores" />
      ) : (
        <form className="formulario" onSubmit={enviar} noValidate>
          <CampoBusca rotulo="Filtrar fornecedores" placeholder="Razão social ou CNPJ" valor={filtro} aoMudar={definirFiltro} atraso={0} />
          <fieldset className="grupo-campos">
            <legend>
              Fornecedores a analisar ({selecionados.size} de no máximo {MAXIMO_ANALISE})
            </legend>
            <div className="seletor-fornecedores">
              {fornecedores.isPending ? (
                <p className="texto-secundario" role="status">
                  Carregando fornecedores…
                </p>
              ) : visiveis.length === 0 ? (
                <p className="texto-secundario" role="status">
                  Nenhum fornecedor corresponde ao filtro.
                </p>
              ) : (
                visiveis.map((f) => (
                  <CaixaSelecao key={f.id} rotulo={f.razaoSocial} ajuda={f.documento} checked={selecionados.has(f.id)} onChange={() => alternar(f.id)} />
                ))
              )}
            </div>
          </fieldset>
          {selecionados.size > 0 ? (
            <ul className="lista-chips" aria-label="Fornecedores selecionados">
              {[...selecionados].map((id) => (
                <li key={id}>{nomes.get(id) ?? id}</li>
              ))}
            </ul>
          ) : null}
          {erro ? (
            <Alerta tipo="erro" anunciar compacto>
              <p>{erro}</p>
            </Alerta>
          ) : null}
          <div className="linha">
            <Botao type="submit" variante="primario" icone={Search} carregando={analisar.isPending}>
              Analisar vínculos
            </Botao>
            {selecionados.size > 0 ? (
              <Botao variante="terciario" onClick={() => definirSelecionados(new Set())}>
                Limpar seleção
              </Botao>
            ) : null}
          </div>
        </form>
      )}
      {analisar.isError ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível analisar">
          <p>{analisar.error.message}</p>
        </Alerta>
      ) : null}
      {analisar.data ? (
        <div className="resultado-simulacao" role="status">
          <h3 className="secao__titulo">
            Resultado: {analisar.data.sinais.length === 0 ? 'nenhum sinal' : `${analisar.data.sinais.length} sinal(is) para análise`}
          </h3>
          {analisar.data.grupos.length > 0 ? (
            <p>
              Licitantes ligados entre si:{' '}
              {analisar.data.grupos.map((g) => g.fornecedores.map((f) => f.nome).join(' e ')).join('; ')}.
            </p>
          ) : null}
          <ListaSinaisVinculo sinais={analisar.data.sinais} titulo="Sinais da análise" vazio="Nenhum vínculo encontrado nas fontes consultadas." />
          <Alerta tipo="info" compacto titulo="Requer revisão humana">
            <p>{analisar.data.aviso}</p>
            <ul>
              {analisar.data.premissas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="texto-pequeno">
              Fundamento: {analisar.data.fundamento}. Análise de {formatarInstante(analisar.data.analisadoEm)}.
            </p>
          </Alerta>
        </div>
      ) : null}
    </Secao>
  );
}

function Sucessoes() {
  const { temPermissao } = useSessao();
  const podePropor = temPermissao('sancoes:instruir');
  const sucessoes = useSucessoes();
  const [sinal, definirSinal] = useState<SinalVinculo | null>(null);
  return (
    <Secao
      titulo="Possíveis sucessões de empresas sancionadas"
      id="sucessoes"
      descricao="Empresas com sócio, administrador ou endereço em comum com fornecedor impedido ou inidôneo (art. 14, § 1º). O sinal é o ponto de partida de uma apuração; estender a sanção exige o procedimento do art. 160."
    >
      {sucessoes.isError ? (
        <FalhaConsulta consulta={sucessoes} />
      ) : sucessoes.isPending ? (
        <p className="texto-secundario" role="status">
          Carregando sinais…
        </p>
      ) : (
        <ListaSinaisVinculo
          sinais={sucessoes.data}
          titulo="Possíveis sucessões"
          vazio="Nenhuma empresa com sócio, administrador ou endereço de fornecedor impedido ou inidôneo."
          acao={
            podePropor
              ? (s) =>
                  s.sancaoOrigemId ? (
                    <Botao variante="secundario" tamanho="compacto" icone={Gavel} onClick={() => definirSinal(s)}>
                      Propor extensão da sanção
                    </Botao>
                  ) : null
              : undefined
          }
        />
      )}
      {podePropor ? <DialogoProporExtensao aberto={sinal !== null} aoFechar={() => definirSinal(null)} sinal={sinal} /> : null}
    </Secao>
  );
}

const COLUNAS_EXTENSOES: ColunaTabela<ExtensaoSancao>[] = [
  {
    id: 'alcancado',
    cabecalho: 'Alcançado',
    identificadora: true,
    celula: (e) => (
      <Link to={`/impedimentos/extensoes/${e.id}`}>{e.alvo.fornecedor?.nome ?? (e.alvo.pessoa ? `${e.alvo.pessoa.nome} (CPF ${e.alvo.pessoa.documento})` : '—')}</Link>
    ),
  },
  { id: 'alvo', cabecalho: 'Como', celula: (e) => ALVOS_EXTENSAO[e.alvo.tipo] },
  { id: 'origem', cabecalho: 'Sanção de origem', celula: (e) => e.sancaoOrigem.fornecedor.nome },
  { id: 'situacao', cabecalho: 'Situação', celula: (e) => <EtiquetaSituacaoExtensao situacao={e.situacao} /> },
  { id: 'prazo', cabecalho: 'Prazo de defesa', celula: (e) => <span className="numero">{formatarData(e.prazoDefesa)}</span> },
];

function Extensoes() {
  const extensoes = useExtensoes();
  return (
    <Secao titulo="Extensões de sanção (art. 160)" id="extensoes" descricao="Procedimentos com contraditório, análise jurídica prévia e decisão da autoridade competente.">
      {extensoes.isError ? (
        <FalhaConsulta consulta={extensoes} />
      ) : (
        <Tabela
          id="extensoes-sancao"
          legenda="Procedimentos de extensão de sanção"
          colunas={COLUNAS_EXTENSOES}
          linhas={extensoes.data}
          chave={(e) => e.id}
          semFerramentas
          vazio={<EstadoVazio icone={Gavel} titulo="Nenhum procedimento de extensão" descricao="As propostas feitas a partir dos sinais de possível sucessão aparecem aqui." />}
        />
      )}
    </Secao>
  );
}

const COLUNAS_PROCESSOS: ColunaTabela<ProcessoComLicitantes>[] = [
  { id: 'numero', cabecalho: 'Processo', identificadora: true, celula: (p) => <Link to={`/impedimentos/processos/${p.id}`}>{p.numeroSei}</Link> },
  { id: 'titulo', cabecalho: 'Objeto', celula: (p) => p.titulo },
  { id: 'etapa', cabecalho: 'Etapa', alinhamento: 'fim', celula: (p) => <span className="numero">{p.etapaAtual}</span> },
  { id: 'licitantes', cabecalho: 'Licitantes', alinhamento: 'fim', celula: (p) => <span className="numero">{p.licitantes}</span> },
];

function Processos() {
  const processos = useProcessosComLicitantes();
  return (
    <Secao titulo="Processos com licitantes" id="processos" descricao="Vínculos entre os licitantes de cada processo e as declarações da equipe designada.">
      {processos.isError ? (
        <FalhaConsulta consulta={processos} />
      ) : (
        <Tabela
          id="processos-licitantes"
          legenda="Processos com licitantes registrados"
          colunas={COLUNAS_PROCESSOS}
          linhas={processos.data}
          chave={(p) => p.id}
          semFerramentas
          vazio={<EstadoVazio icone={Network} titulo="Nenhum processo com licitantes" descricao="Os processos aparecem aqui quando a disputa da etapa 6 é registrada." />}
        />
      )}
    </Secao>
  );
}

function Vinculos() {
  const { temPermissao } = useSessao();
  const vinculos = useVinculos();
  const [registrando, definirRegistrando] = useState(false);
  return (
    <Secao
      titulo="Vínculos registrados"
      id="vinculos"
      descricao="Vínculos de fonte lícita, com a evidência: declarados pelos licitantes ou pelos agentes, ou informados por agente público."
      acoes={temPermissao('impedimentos:registrar') ? <BotaoRegistrarVinculo aoClicar={() => definirRegistrando(true)} /> : null}
    >
      {vinculos.isError ? (
        <FalhaConsulta consulta={vinculos} />
      ) : (
        <Tabela
          id="vinculos-registrados"
          legenda="Vínculos registrados"
          colunas={COLUNAS_VINCULOS}
          linhas={vinculos.data}
          chave={(v) => v.id}
          semFerramentas
          vazio={<EstadoVazio icone={Network} titulo="Nenhum vínculo registrado" />}
        />
      )}
      {temPermissao('impedimentos:registrar') ? <DialogoRegistrarVinculo aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
    </Secao>
  );
}

function ConsultarFornecedor() {
  const navegar = useNavigate();
  return (
    <Secao titulo="Consultar um fornecedor" id="fornecedor" descricao="Quadro societário, vínculos, sinais e extensões de sanção de um fornecedor.">
      <SeletorFornecedor
        rotulo="Fornecedor"
        nome="consultar-fornecedor"
        selecionado={null}
        aoSelecionar={(f) => void navegar(`/impedimentos/fornecedores/${f.id}`)}
        ativo
      />
    </Secao>
  );
}

export default function Impedimentos() {
  return (
    <Pagina
      titulo="Vínculos e impedimentos"
      subtitulo="Sinais de vínculo entre licitantes e com agentes públicos (arts. 9º e 14), possíveis sucessões de empresas sancionadas e extensão de sanção (art. 160)."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="impedimentos"
    >
      <Alerta tipo="info" titulo="Fontes lícitas e decisão humana">
        <p>
          A Ágora cruza só fontes lícitas: o quadro societário dos dados abertos do CNPJ (com CPF mascarado), o cadastro do fornecedor, as
          declarações dos licitantes e dos agentes e os vínculos informados com evidência. Parentesco não é deduzido por cruzamento de dados
          pessoais nem por endereço IP. Cada resultado é um sinal que requer revisão humana: nada aqui desclassifica, impede ou sanciona.
        </p>
      </Alerta>
      <AnaliseLicitantes />
      <Sucessoes />
      <Extensoes />
      <Processos />
      <Vinculos />
      <ConsultarFornecedor />
    </Pagina>
  );
}
