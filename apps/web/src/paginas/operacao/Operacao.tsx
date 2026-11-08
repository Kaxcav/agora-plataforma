/**
 * Operação da plataforma (RNF-10; IMR-01): situação atual dos componentes, disponibilidade do mês medida pela sonda
 * do servidor, ocorrências de indisponibilidade e janelas de manutenção do PNCP. O administrador pede uma sondagem
 * e registra as janelas programadas; o cálculo e a autorização são do servidor.
 */
import { useId, useState, type FormEvent } from 'react';
import { Activity, CalendarClock, FileDown, Gauge, RefreshCw, ServerCog, TimerOff } from 'lucide-react';
import type { ComponenteOperacao, JanelaManutencaoPncp, OcorrenciaIndisponibilidade, RelatorioDisponibilidade, SituacaoOperacao } from '@agora/contratos';
import { hojeISO } from '@agora/dominio';
import { urlCsvDisponibilidade, useRegistrarJanela, useRelatorioDisponibilidade, useSituacaoOperacao, useSondarAgora } from '../../api/operacao';
import {
  AreaTexto,
  Botao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  Indicador,
  ListaDefinicoes,
  Pagina,
  Secao,
  Tabela,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante, formatarMesLongo, formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import '../metas/metas.css';

const NOMES_CAUSAS: Record<ComponenteOperacao | 'sem_medicao', string> = {
  api: 'API',
  banco: 'Banco de dados',
  fila: 'Fila de integrações',
  sincronizacao: 'Sincronização com o PNCP',
  sem_medicao: 'Sem sondagem',
};

const AMBIENTES: Record<SituacaoOperacao['ambiente'], string> = { demonstracao: 'Demonstração', homologacao: 'Homologação', producao: 'Produção' };

function percentual(valor: number | null): string {
  return valor === null ? '—' : formatarPercentual(valor, 2);
}

function minutos(valor: number): string {
  return contar(valor, 'minuto', 'minutos');
}

// ───────────────────────── situação agora ─────────────────────────

function SituacaoAgora({ situacao }: { situacao: SituacaoOperacao }) {
  return (
    <Secao
      titulo="Situação agora"
      id="operacao-agora"
      descricao={
        situacao.verificadaEm
          ? `Última sondagem em ${formatarInstante(situacao.verificadaEm)}${situacao.sonda.ligada ? `; a sonda verifica a cada ${situacao.sonda.intervaloSegundos} segundos.` : '; a sonda periódica está desligada (só sob demanda).'}`
          : 'A sonda ainda não registrou nenhuma sondagem.'
      }
      acoes={
        situacao.atual ? (
          <Etiqueta tom="sucesso" compacta>
            Sondagem em dia
          </Etiqueta>
        ) : (
          <Etiqueta tom="aviso" compacta>
            Sondagem desatualizada
          </Etiqueta>
        )
      }
    >
      <ul className="componentes-operacao" aria-label="Componentes da plataforma">
        {situacao.componentes.map((c) => (
          <li key={c.componente}>
            <strong>{c.nome}</strong>
            <span>
              <Etiqueta tom={c.disponivel ? 'sucesso' : 'erro'} compacta>
                {c.disponivel ? 'Disponível' : 'Indisponível'}
              </Etiqueta>
            </span>
            <span className="texto-pequeno texto-secundario">{c.detalhe}</span>
          </li>
        ))}
      </ul>
      {situacao.pncpEmManutencao ? (
        <p className="texto-pequeno" role="status">
          O PNCP está recusando envios por indisponibilidade: a fila guarda as tarefas e as reenvia sozinha.
        </p>
      ) : null}
      <ListaDefinicoes
        colunas={4}
        itens={[
          { termo: 'Ambiente', valor: AMBIENTES[situacao.ambiente] },
          { termo: 'Versão', valor: <span className="numero">{situacao.versao}</span> },
          { termo: 'Integrações', valor: situacao.integracoes === 'online' ? 'Sistemas reais' : 'Simuladas (modo offline)' },
          { termo: 'Fila de integrações', valor: `${situacao.fila.transporte === 'rabbitmq' ? 'RabbitMQ' : 'PostgreSQL'}, trabalhador ${situacao.fila.trabalhador}` },
        ]}
      />
    </Secao>
  );
}

// ───────────────────────── relatório do mês ─────────────────────────

function tomDisponibilidade(r: RelatorioDisponibilidade): 'sucesso' | 'aviso' | 'neutro' {
  return r.situacao === 'atingida' ? 'sucesso' : r.situacao === 'nao_atingida' ? 'aviso' : 'neutro';
}

function RelatorioMes({ relatorio }: { relatorio: RelatorioDisponibilidade }) {
  return (
    <div className="pilha pilha--ampla">
      <section aria-labelledby="operacao-resumo" className="pilha pilha--compacta">
        <h2 id="operacao-resumo" className="sr-only">
          Resumo da disponibilidade de {formatarMesLongo(relatorio.mes)}
        </h2>
        <div className="grade grade--kpi">
          <Indicador
            rotulo="Disponibilidade no mês"
            valor={percentual(relatorio.percentual)}
            icone={Gauge}
            tom={tomDisponibilidade(relatorio)}
            detalhe={relatorio.metaPercentual === null ? 'Meta não configurada' : `Meta ${formatarPercentual(relatorio.metaPercentual, 2)}`}
          />
          <Indicador rotulo="Minutos considerados" valor={formatarNumero(relatorio.minutosConsiderados)} icone={Activity} detalhe={relatorio.inicioMedicao ? `Desde ${formatarInstante(relatorio.inicioMedicao)}` : 'Sem medição no mês'} />
          <Indicador rotulo="Minutos indisponíveis" valor={formatarNumero(relatorio.minutosIndisponiveis)} icone={ServerCog} tom={relatorio.minutosIndisponiveis > 0 ? 'aviso' : 'sucesso'} detalhe="Algum componente falhou" />
          <Indicador rotulo="Minutos sem sondagem" valor={formatarNumero(relatorio.minutosSemMedicao)} icone={TimerOff} tom={relatorio.minutosSemMedicao > 0 ? 'aviso' : 'sucesso'} detalhe="Contam como indisponíveis" />
        </div>
      </section>

      <Tabela<RelatorioDisponibilidade['componentes'][number]>
        id="operacao-componentes"
        legenda="Disponibilidade por componente no mês"
        semFerramentas
        linhas={relatorio.componentes}
        chave={(c) => c.componente}
        colunas={[
          { id: 'componente', cabecalho: 'Componente', identificadora: true, prioritaria: true, celula: (c) => c.nome },
          { id: 'indisponivel', cabecalho: 'Minutos indisponíveis', alinhamento: 'fim', celula: (c) => <span className="numero">{formatarNumero(c.minutosIndisponiveis)}</span> },
          { id: 'percentual', cabecalho: 'Disponibilidade', alinhamento: 'fim', prioritaria: true, celula: (c) => <span className="numero">{percentual(c.percentual)}</span> },
        ]}
      />

      <Tabela<OcorrenciaIndisponibilidade>
        id="operacao-ocorrencias"
        legenda="Ocorrências de indisponibilidade"
        semFerramentas
        linhas={relatorio.ocorrencias}
        chave={(o) => o.inicio}
        vazio={<EstadoVazio icone={Activity} titulo="Nenhuma indisponibilidade no mês" />}
        colunas={[
          { id: 'inicio', cabecalho: 'Início', identificadora: true, prioritaria: true, celula: (o) => formatarInstante(o.inicio) },
          { id: 'fim', cabecalho: 'Fim', celula: (o) => formatarInstante(o.fim) },
          { id: 'minutos', cabecalho: 'Duração', alinhamento: 'fim', prioritaria: true, celula: (o) => <span className="numero">{minutos(o.minutos)}</span> },
          { id: 'causas', cabecalho: 'Causa', prioritaria: true, celula: (o) => o.causas.map((c) => NOMES_CAUSAS[c]).join(', ') },
        ]}
      />

      <Tabela<JanelaManutencaoPncp>
        id="operacao-janelas"
        legenda="Janelas de manutenção do PNCP"
        semFerramentas
        linhas={relatorio.janelasPncp}
        chave={(j) => `${j.origem}-${j.inicio}`}
        vazio={<EstadoVazio icone={CalendarClock} titulo="Nenhuma janela do PNCP no mês" />}
        colunas={[
          { id: 'inicio', cabecalho: 'Início', identificadora: true, prioritaria: true, celula: (j) => formatarInstante(j.inicio) },
          { id: 'fim', cabecalho: 'Fim', celula: (j) => formatarInstante(j.fim) },
          { id: 'minutos', cabecalho: 'Duração', alinhamento: 'fim', celula: (j) => <span className="numero">{minutos(j.minutos)}</span> },
          {
            id: 'origem',
            cabecalho: 'Origem',
            prioritaria: true,
            celula: (j) => (
              <Etiqueta tom={j.origem === 'registrada' ? 'info' : 'neutro'} compacta>
                {j.origem === 'registrada' ? 'Informada pelo órgão' : 'Detectada pela fila'}
              </Etiqueta>
            ),
          },
          { id: 'tarefas', cabecalho: 'Tarefas absorvidas pela fila', alinhamento: 'fim', celula: (j) => <span className="numero">{formatarNumero(j.tarefasAbsorvidas)}</span> },
          { id: 'erro', cabecalho: 'Na fila de erro', alinhamento: 'fim', celula: (j) => <span className="numero">{formatarNumero(j.tarefasNaFilaDeErro)}</span> },
          { id: 'descricao', cabecalho: 'Descrição', celula: (j) => j.descricao ?? '—' },
        ]}
      />

      <Secao titulo="Premissas e fontes" id="operacao-fontes" simples>
        <ul>
          {[...relatorio.premissas, ...relatorio.fontes].map((texto) => (
            <li key={texto} className="texto-pequeno">
              {texto}
            </li>
          ))}
        </ul>
        <p className="texto-pequeno texto-secundario">Relatório montado pelo servidor em {formatarInstante(relatorio.geradoEm)}.</p>
      </Secao>
    </div>
  );
}

// ───────────────────────── janela de manutenção ─────────────────────────

function DialogoJanela({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const idFormulario = useId();
  const { avisar } = useAvisos();
  const registrar = useRegistrarJanela();
  const [inicio, definirInicio] = useState('');
  const [fim, definirFim] = useState('');
  const [descricao, definirDescricao] = useState('');
  const [erros, definirErros] = useState<{ inicio?: string; fim?: string; descricao?: string }>({});

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: typeof erros = {};
    const msInicio = Date.parse(inicio);
    const msFim = Date.parse(fim);
    if (Number.isNaN(msInicio)) novos.inicio = 'Informe a data e a hora de início.';
    if (Number.isNaN(msFim)) novos.fim = 'Informe a data e a hora de fim.';
    else if (!Number.isNaN(msInicio) && msFim <= msInicio) novos.fim = 'O fim deve ser posterior ao início.';
    else if (!Number.isNaN(msInicio) && msFim - msInicio > 7 * 86_400_000) novos.fim = 'Uma janela tem no máximo 7 dias.';
    if (descricao.trim().length < 10) novos.descricao = 'Descreva a janela com pelo menos 10 caracteres.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    registrar.mutate(
      { inicio: new Date(msInicio).toISOString(), fim: new Date(msFim).toISOString(), descricao: descricao.trim() },
      {
        onSuccess: (j) => {
          avisar({ tipo: 'sucesso', titulo: 'Janela registrada', mensagem: `Janela do PNCP de ${formatarInstante(j.inicio)} a ${formatarInstante(j.fim)}.` });
          definirInicio('');
          definirFim('');
          definirDescricao('');
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Registrar janela de manutenção do PNCP"
      descricao={<p>Informe a janela programada que o PNCP divulgou. Durante ela, a falha da sincronização não conta contra a disponibilidade da plataforma.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar janela
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <div className="formulario__linha">
          <CampoTexto rotulo="Início" type="datetime-local" obrigatorio value={inicio} onChange={(e) => definirInicio(e.target.value)} erro={erros.inicio} />
          <CampoTexto rotulo="Fim" type="datetime-local" obrigatorio value={fim} onChange={(e) => definirFim(e.target.value)} erro={erros.fim} />
        </div>
        <AreaTexto rotulo="Descrição" obrigatorio value={descricao} maxLength={500} onChange={(e) => definirDescricao(e.target.value)} erro={erros.descricao} />
      </form>
    </Dialogo>
  );
}

// ───────────────────────── página ─────────────────────────

export default function Operacao() {
  const { temPermissao } = useSessao();
  const p = useParametrosUrl();
  const mesAtual = hojeISO(new Date()).slice(0, 7);
  const mesUrl = p.texto('mes');
  const mes = mesUrl && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesUrl) && mesUrl <= mesAtual ? mesUrl : undefined;
  const situacao = useSituacaoOperacao();
  const relatorio = useRelatorioDisponibilidade(mes);
  const sondar = useSondarAgora();
  const { avisar } = useAvisos();
  const [registrando, definirRegistrando] = useState(false);
  const administra = temPermissao('operacao:administrar');

  return (
    <Pagina
      titulo="Operação da plataforma"
      subtitulo="Disponibilidade da plataforma e da sincronização com o PNCP (IMR-01), medida a cada minuto pela sonda do servidor, e as janelas de manutenção do PNCP."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="operacao"
      acoes={
        administra ? (
          <>
            <Botao
              variante="secundario"
              icone={RefreshCw}
              carregando={sondar.isPending}
              onClick={() =>
                sondar.mutate(undefined, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Sondagem concluída', mensagem: 'A situação dos componentes foi atualizada.' }) })
              }
            >
              Sondar agora
            </Botao>
            <Botao variante="primario" icone={CalendarClock} onClick={() => definirRegistrando(true)}>
              Registrar janela do PNCP
            </Botao>
          </>
        ) : undefined
      }
    >
      <div className="pilha pilha--ampla">
        <ConteudoConsulta consulta={situacao} rotuloCarregando="Carregando a situação da plataforma" tituloErro="Não foi possível carregar a situação da plataforma">
          {(s) => <SituacaoAgora situacao={s} />}
        </ConteudoConsulta>

        <div className="filtros-metas" role="group" aria-label="Mês do relatório">
          <CampoTexto rotulo="Mês" type="month" value={mes ?? mesAtual} max={mesAtual} onChange={(e) => p.atualizar({ mes: e.target.value === mesAtual ? undefined : e.target.value })} />
          <a className="botao botao--secundario" href={urlCsvDisponibilidade(mes)} download>
            <FileDown size={16} aria-hidden="true" />
            <span>Baixar relatório do mês (CSV)</span>
          </a>
        </div>
        <ConteudoConsulta consulta={relatorio} rotuloCarregando="Carregando o relatório de disponibilidade" tituloErro="Não foi possível carregar o relatório de disponibilidade">
          {(r) => <RelatorioMes relatorio={r} />}
        </ConteudoConsulta>

        <Secao titulo="Consumo de energia (TI verde)" id="operacao-ti-verde" simples nivel={2}>
          <p className="texto-pequeno">
            Na nuvem do órgão, a API, o trabalhador da fila e o OCR aumentam e reduzem o número de réplicas conforme a carga, e o ambiente de homologação é desligado
            fora do expediente, em horário configurável. Os arquivos ficam em deploy/k8s (autoescalonamento.yaml e homologacao-expediente.yaml).
          </p>
        </Secao>
      </div>
      {administra ? <DialogoJanela aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
    </Pagina>
  );
}
