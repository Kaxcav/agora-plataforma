/**
 * Painel das três linhas de defesa (Lei 14.133/2021, art. 169; RF-23). Cada aba só aparece para o perfil da linha
 * correspondente, e cada painel é montado pelo servidor no escopo de UASG do usuário. A 3ª linha baixa o relatório
 * executivo de auditoria em PDF, gerado no servidor com fontes, data e período.
 */
import { Link } from 'react-router';
import {
  CircleAlert,
  ClipboardList,
  FileDown,
  FileSearch,
  Fingerprint,
  Gavel,
  History,
  Landmark,
  ListTodo,
  Receipt,
  Route,
  Scale,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { AchadoPreventivo, PainelPrimeiraLinha, PainelSegundaLinha, PainelTerceiraLinha } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO, validarDataISO } from '@agora/dominio';
import { urlRelatorioAuditoria, usePainelPrimeiraLinha, usePainelSegundaLinha, usePainelTerceiraLinha } from '../../api/controle';
import {
  Abas,
  Alerta,
  CampoTexto,
  ConteudoConsulta,
  EstadoVazio,
  Etiqueta,
  Indicador,
  ListaDefinicoes,
  Pagina,
  Secao,
  SemPermissao,
  Tabela,
  type DefinicaoAba,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { colunasSancao } from '../sancoes/colunasSancao';
import { ListaMedidas } from './comum';

const COLUNAS_SANCAO = colunasSancao({ comFornecedor: true });

function Fontes({ fontes, geradoEm }: { fontes: readonly string[]; geradoEm: string }) {
  return (
    <Secao titulo="Fontes dos dados" simples nivel={3}>
      <ul>
        {fontes.map((f) => (
          <li key={f} className="texto-pequeno">
            {f}
          </li>
        ))}
      </ul>
      <p className="texto-pequeno texto-secundario">Painel montado pelo servidor em {formatarInstante(geradoEm)}.</p>
    </Secao>
  );
}

function tomContagem(n: number, tom: 'erro' | 'aviso' = 'aviso'): 'sucesso' | 'erro' | 'aviso' {
  return n > 0 ? tom : 'sucesso';
}

// ───────────────────────── 1ª linha ─────────────────────────

function ConteudoPrimeiraLinha({ painel }: { painel: PainelPrimeiraLinha }) {
  const i = painel.indicadores;
  return (
    <div className="pilha pilha--ampla">
      <section aria-labelledby="indicadores-primeira" className="pilha pilha--compacta">
        <h2 id="indicadores-primeira" className="sr-only">
          Indicadores da 1ª linha
        </h2>
        <div className="grade grade--kpi">
          <Indicador
            rotulo="Pendências vencidas"
            valor={formatarNumero(i.pendenciasVencidas)}
            detalhe={`de ${contar(i.pendenciasAbertas, 'pendência aberta', 'pendências abertas')}`}
            tom={tomContagem(i.pendenciasVencidas, 'erro')}
            icone={ListTodo}
            para="/"
          />
          <Indicador rotulo="Tarefas em atraso" valor={formatarNumero(i.tarefasAtrasadas)} detalhe="Plano de gestão" tom={tomContagem(i.tarefasAtrasadas)} icone={ClipboardList} />
          <Indicador rotulo="Atestos atrasados" valor={formatarNumero(i.atestosAtrasados)} detalhe="Notas a atestar já vencidas" tom={tomContagem(i.atestosAtrasados)} icone={Receipt} />
          <Indicador rotulo="Processos com bloqueio" valor={formatarNumero(i.processosBloqueados)} detalhe="Jornada da contratação" tom={tomContagem(i.processosBloqueados)} icone={Route} para="/jornada" />
          <Indicador
            rotulo="Revisões de riscos pendentes"
            valor={formatarNumero(i.revisoesRiscosPendentes)}
            detalhe="Vencidas ou a vencer (RN-29)"
            tom={tomContagem(i.revisoesRiscosPendentes)}
            icone={ShieldAlert}
          />
          <Indicador
            rotulo="Cautelares suspensivas"
            valor={formatarNumero(i.cautelaresSuspensivas)}
            detalhe="Em vigor (RN-30)"
            tom={tomContagem(i.cautelaresSuspensivas, 'erro')}
            icone={Landmark}
          />
        </div>
      </section>

      <Secao titulo="Medidas do controle externo" id="primeira-medidas" descricao="Cautelares em vigor e prazos de resposta abertos que atingem os seus processos e contratos (art. 171).">
        {painel.medidas.length === 0 ? (
          <EstadoVazio icone={ShieldCheck} titulo="Nenhuma medida aberta" descricao="Não há prazo de resposta aberto nem suspensão em vigor no seu escopo." />
        ) : (
          <ListaMedidas medidas={painel.medidas} />
        )}
      </Secao>

      <Secao
        titulo="Revisão trimestral da matriz de riscos"
        id="primeira-riscos"
        descricao="Contratos com a revisão vencida ou vencendo em até 15 dias. Registre a revisão na aba Matriz de riscos do contrato (RN-29)."
      >
        {painel.revisoesRiscos.length === 0 ? (
          <EstadoVazio icone={ShieldCheck} titulo="Revisões em dia" descricao="Nenhum contrato vigente com a revisão trimestral vencida ou a vencer." />
        ) : (
          <ul className="lista-controle">
            {painel.revisoesRiscos.map((r) => (
              <li key={r.contrato.id}>
                <Link to={`${r.contrato.caminho}?aba=riscos`} className="lista-controle__titulo">
                  {r.contrato.identificador}
                </Link>
                <Etiqueta tom={r.revisao.situacao === 'vencida' ? 'erro' : 'aviso'} compacta>
                  {r.revisao.situacao === 'vencida' ? 'Revisão vencida' : 'Revisão a vencer'}
                </Etiqueta>
                <span className="lista-controle__descricao">{r.objeto}</span>
                <span className="lista-controle__explicacao texto-pequeno texto-secundario">
                  UASG <span className="numero">{r.uasg}</span> · {r.revisao.explicacao}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Processos com bloqueio" id="primeira-bloqueios" descricao="Regras que impedem o avanço na jornada, inclusive suspensão cautelar do controle externo.">
        {painel.processosBloqueados.length === 0 ? (
          <EstadoVazio icone={ShieldCheck} titulo="Nenhum processo bloqueado" />
        ) : (
          <ul className="lista-controle">
            {painel.processosBloqueados.map((p) => (
              <li key={p.processo.id}>
                <Link to={p.processo.caminho} className="lista-controle__titulo">
                  {p.processo.identificador}
                </Link>
                <span className="texto-pequeno texto-secundario">
                  Etapa {p.etapaAtual} · {contar(p.diasSemAtualizacao, 'dia', 'dias')} sem atualização
                </span>
                <span className="lista-controle__descricao">{p.titulo}</span>
                <ul className="lista-controle__descricao texto-pequeno">
                  {p.bloqueios.map((b, n) => (
                    <li key={`${b.regra}-${n}`}>
                      <strong>{b.regra}</strong>: {b.mensagem}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <div className="grade grade--2">
        <Secao titulo="Pendências vencidas" id="primeira-pendencias" descricao="As mais antigas primeiro. Resolva na fila de pendências do Início.">
          {painel.pendenciasVencidas.length === 0 ? (
            <EstadoVazio icone={ShieldCheck} titulo="Nenhuma pendência vencida" />
          ) : (
            <ul className="lista-controle">
              {painel.pendenciasVencidas.map((p) => (
                <li key={p.id}>
                  <Link to={`/${p.instrumento.tipo === 'ata' ? 'atas' : 'contratos'}/${p.instrumento.id}`} className="lista-controle__titulo">
                    {p.instrumento.identificador}
                  </Link>
                  <span className="texto-pequeno numero">{p.prazo ? formatarData(p.prazo) : '—'}</span>
                  <span className="lista-controle__descricao">{p.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao titulo="Tarefas do plano de gestão em atraso" id="primeira-tarefas">
          {painel.tarefasAtrasadas.length === 0 ? (
            <EstadoVazio icone={ShieldCheck} titulo="Nenhuma tarefa em atraso" />
          ) : (
            <ul className="lista-controle">
              {painel.tarefasAtrasadas.map((t) => (
                <li key={t.id}>
                  <Link to={t.instrumento.caminho} className="lista-controle__titulo">
                    {t.instrumento.identificador}
                  </Link>
                  <span className="texto-pequeno numero">{formatarData(t.prazo)}</span>
                  <span className="lista-controle__descricao">
                    {t.titulo}
                    {t.responsavel ? ` — ${t.responsavel.nome}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      {painel.atestosAtrasados.length > 0 ? (
        <Secao titulo="Notas fiscais com atesto atrasado" id="primeira-atestos">
          <ul className="lista-controle">
            {painel.atestosAtrasados.map((a) => (
              <li key={a.id}>
                <Link to={`${a.contrato.caminho}?aba=pagamentos`} className="lista-controle__titulo">
                  {a.contrato.identificador} — nota {a.notaFiscal}
                </Link>
                <span className="texto-pequeno numero">{formatarMoeda(a.valor)}</span>
                <span className="lista-controle__descricao texto-pequeno texto-secundario">Vencimento em {formatarData(a.vencimento)}</span>
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      <Fontes fontes={painel.fontes} geradoEm={painel.geradoEm} />
    </div>
  );
}

function PrimeiraLinha({ uasg }: { uasg: string | undefined }) {
  const consulta = usePainelPrimeiraLinha(uasg);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o painel da 1ª linha" tituloErro="Não foi possível carregar o painel da 1ª linha">
      {(painel) => <ConteudoPrimeiraLinha painel={painel} />}
    </ConteudoConsulta>
  );
}

// ───────────────────────── 2ª linha ─────────────────────────

function ListaAchados({ achados }: { achados: readonly AchadoPreventivo[] }) {
  return (
    <ul className="lista-controle">
      {achados.map((a, n) => (
        <li key={`${a.tipo}-${a.referencia.id}-${n}`}>
          <span className="lista-controle__titulo">{a.titulo}</span>
          <Etiqueta tom={a.nivel === 'risco' ? 'erro' : 'aviso'} compacta>
            {a.nivel === 'risco' ? 'Risco' : 'Atenção'}
          </Etiqueta>
          <span className="lista-controle__descricao">
            <Link to={a.referencia.caminho}>{a.referencia.identificador}</Link> — {a.descricao}
          </span>
          <span className="lista-controle__explicacao texto-pequeno texto-secundario">{a.fundamento}</span>
        </li>
      ))}
    </ul>
  );
}

function ConteudoSegundaLinha({ painel }: { painel: PainelSegundaLinha }) {
  const i = painel.indicadores;
  return (
    <div className="pilha pilha--ampla">
      <section aria-labelledby="indicadores-segunda" className="pilha pilha--compacta">
        <h2 id="indicadores-segunda" className="sr-only">
          Indicadores da 2ª linha
        </h2>
        <div className="grade grade--kpi">
          <Indicador rotulo="Pareceres pendentes" valor={formatarNumero(i.pareceresPendentes)} detalhe="Controle prévio (art. 53)" tom={tomContagem(i.pareceresPendentes)} icone={Scale} />
          <Indicador rotulo="Achados de risco" valor={formatarNumero(i.achadosRisco)} detalhe="Matriz de achados" tom={tomContagem(i.achadosRisco, 'erro')} icone={TriangleAlert} />
          <Indicador rotulo="Achados de atenção" valor={formatarNumero(i.achadosAtencao)} detalhe="Matriz de achados" tom={tomContagem(i.achadosAtencao)} icone={CircleAlert} />
          <Indicador rotulo="Exceções justificadas" valor={formatarNumero(i.excecoesJustificadas)} detalhe="Nos processos da jornada" tom="info" icone={FileSearch} />
          <Indicador rotulo="Sanções em andamento" valor={formatarNumero(i.sancoesEmAndamento)} detalhe="Instrução, defesa ou registro" tom={tomContagem(i.sancoesEmAndamento)} icone={Gavel} para="/sancoes" />
          <Indicador rotulo="Medidas com resposta pendente" valor={formatarNumero(i.medidasAbertas)} detalhe="TCU e CGU (art. 171)" tom={tomContagem(i.medidasAbertas)} icone={Landmark} para="/controle-externo" />
        </div>
      </section>

      <Secao
        titulo="Matriz de achados preventivos"
        id="segunda-achados"
        descricao="Desvios de regra encontrados nos dados: aditivos perto do limite, contrato sem fiscal, divulgação vencida, pagamento preterido na ordem cronológica, processos parados e revisões vencidas."
      >
        <Alerta tipo="info" compacto>
          Os achados são sinais para conferência humana. Não constituem conclusão de irregularidade nem imputação de responsabilidade.
        </Alerta>
        {painel.achados.length === 0 ? <EstadoVazio icone={ShieldCheck} titulo="Nenhum achado" /> : <ListaAchados achados={painel.achados} />}
      </Secao>

      <div className="grade grade--2">
        <Secao titulo="Pareceres jurídicos pendentes" id="segunda-pareceres" descricao="Processos na etapa 5 sem parecer emitido (art. 53).">
          {painel.pareceresPendentes.length === 0 ? (
            <EstadoVazio icone={ShieldCheck} titulo="Nenhum parecer pendente" />
          ) : (
            <ul className="lista-controle">
              {painel.pareceresPendentes.map((p) => (
                <li key={p.processo.id}>
                  <Link to={p.processo.caminho} className="lista-controle__titulo">
                    {p.processo.identificador}
                  </Link>
                  <span className="texto-pequeno texto-secundario">desde {formatarInstante(p.desde)}</span>
                  <span className="lista-controle__descricao">{p.titulo}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao titulo="Medidas do controle externo" id="segunda-medidas" descricao="Medidas abertas ou respondidas, ainda não revogadas.">
          {painel.medidas.length === 0 ? <EstadoVazio icone={ShieldCheck} titulo="Nenhuma medida em curso" /> : <ListaMedidas medidas={painel.medidas} />}
        </Secao>
      </div>

      <Secao
        titulo="Exceções justificadas"
        id="segunda-excecoes"
        descricao="Exceções às regras registradas com justificativa nos processos: fora do catálogo, artigo de luxo, ETP sem algum elemento e cotações expurgadas."
      >
        {painel.excecoes.length === 0 ? (
          <EstadoVazio icone={ShieldCheck} titulo="Nenhuma exceção registrada" />
        ) : (
          <ul className="lista-controle">
            {painel.excecoes.map((e, n) => (
              <li key={`${e.tipo}-${e.referencia.id}-${n}`}>
                <span className="lista-controle__titulo">{e.titulo}</span>
                <Link to={e.referencia.caminho} className="texto-pequeno">
                  {e.referencia.identificador}
                </Link>
                <span className="lista-controle__descricao">{e.justificativa}</span>
                <span className="lista-controle__explicacao texto-pequeno texto-secundario">{e.fundamento}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Tabela
        id="segunda-sancoes"
        legenda="Processos sancionatórios em andamento"
        colunas={COLUNAS_SANCAO}
        linhas={painel.sancoes}
        chave={(s) => s.id}
        semFerramentas
        vazio={<EstadoVazio icone={Gavel} titulo="Nenhum processo sancionatório em andamento" />}
      />

      <Fontes fontes={painel.fontes} geradoEm={painel.geradoEm} />
    </div>
  );
}

function SegundaLinha({ uasg }: { uasg: string | undefined }) {
  const consulta = usePainelSegundaLinha(uasg);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o painel da 2ª linha" tituloErro="Não foi possível carregar o painel da 2ª linha">
      {(painel) => <ConteudoSegundaLinha painel={painel} />}
    </ConteudoConsulta>
  );
}

// ───────────────────────── 3ª linha ─────────────────────────

function ConteudoTerceiraLinha({ painel }: { painel: PainelTerceiraLinha }) {
  const i = painel.indicadores;
  return (
    <div className="pilha pilha--ampla">
      <section aria-labelledby="indicadores-terceira" className="pilha pilha--compacta">
        <h2 id="indicadores-terceira" className="sr-only">
          Indicadores da 3ª linha
        </h2>
        <div className="grade grade--kpi">
          <Indicador rotulo="Medidas com resposta pendente" valor={formatarNumero(i.medidasAbertas)} detalhe="Art. 171, § 2º" tom={tomContagem(i.medidasAbertas)} icone={Landmark} />
          <Indicador rotulo="Respostas com prazo vencido" valor={formatarNumero(i.respostasVencidas)} detalhe="Art. 171, § 4º" tom={tomContagem(i.respostasVencidas, 'erro')} icone={TriangleAlert} />
          <Indicador rotulo="Cautelares suspensivas" valor={formatarNumero(i.cautelaresSuspensivas)} detalhe="Em vigor (RN-30)" tom={tomContagem(i.cautelaresSuspensivas, 'erro')} icone={ShieldAlert} />
          <Indicador rotulo="Eventos na trilha" valor={formatarNumero(i.eventosNoPeriodo)} detalhe="No período" tom="info" icone={History} para="/auditoria" />
          <Indicador rotulo="Acessos a dados pessoais" valor={formatarNumero(i.acessosDadosPessoais)} detalhe="No período (LGPD, art. 37)" tom="info" icone={Fingerprint} />
          <Indicador rotulo="Achados de risco" valor={formatarNumero(i.achadosRisco)} detalhe="Matriz de achados" tom={tomContagem(i.achadosRisco, 'erro')} icone={CircleAlert} />
        </div>
      </section>

      <Secao titulo="Integridade da trilha de auditoria" id="terceira-integridade" descricao="Cadeia de eventos encadeada por hash SHA-256, verificada a cada consulta.">
        {painel.integridade.integra ? (
          <Alerta tipo="sucesso" titulo="Trilha íntegra">
            <p>
              {contar(painel.integridade.eventosVerificados, 'evento verificado', 'eventos verificados')}, sem quebra na cadeia de hashes. Verificada em{' '}
              {formatarInstante(painel.integridade.verificadoEm)}.
            </p>
          </Alerta>
        ) : (
          <Alerta tipo="erro" titulo="Falha na verificação da trilha">
            <p>
              Evento nº {painel.integridade.primeiraFalha?.sequencia ?? '—'}: {painel.integridade.primeiraFalha?.motivo ?? 'motivo não informado'}.
            </p>
          </Alerta>
        )}
      </Secao>

      <Secao titulo="Medidas do controle externo e prazos" id="terceira-medidas" descricao="Todas as medidas registradas, com o prazo de resposta do órgão e, na suspensão cautelar, o prazo do tribunal para o mérito.">
        {painel.medidas.length === 0 ? <EstadoVazio icone={ShieldCheck} titulo="Nenhuma medida registrada" /> : <ListaMedidas medidas={painel.medidas} />}
      </Secao>

      <Secao titulo="Resumo da 1ª e da 2ª linha" id="terceira-resumo">
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Pendências vencidas', valor: <span className="numero">{formatarNumero(painel.primeiraLinha.pendenciasVencidas)}</span> },
            { termo: 'Tarefas em atraso', valor: <span className="numero">{formatarNumero(painel.primeiraLinha.tarefasAtrasadas)}</span> },
            { termo: 'Processos com bloqueio', valor: <span className="numero">{formatarNumero(painel.primeiraLinha.processosBloqueados)}</span> },
            { termo: 'Revisões de riscos pendentes', valor: <span className="numero">{formatarNumero(painel.primeiraLinha.revisoesRiscosPendentes)}</span> },
            { termo: 'Pareceres pendentes', valor: <span className="numero">{formatarNumero(painel.segundaLinha.pareceresPendentes)}</span> },
            { termo: 'Exceções justificadas', valor: <span className="numero">{formatarNumero(painel.segundaLinha.excecoesJustificadas)}</span> },
          ]}
        />
      </Secao>

      <Secao titulo="Matriz de achados preventivos" id="terceira-achados" descricao="Sinais para conferência; não constituem conclusão de auditoria.">
        {painel.achados.length === 0 ? <EstadoVazio icone={ShieldCheck} titulo="Nenhum achado" /> : <ListaAchados achados={painel.achados} />}
      </Secao>

      <div className="grade grade--2">
        <Tabela
          id="terceira-eventos-recurso"
          legenda="Eventos da trilha no período, por recurso"
          colunas={[
            { id: 'recurso', cabecalho: 'Recurso', identificadora: true, celula: (r) => <span className="mono">{r.recurso}</span> },
            { id: 'total', cabecalho: 'Eventos', alinhamento: 'fim', celula: (r) => <span className="numero">{formatarNumero(r.total)}</span> },
          ]}
          linhas={painel.eventosPorRecurso}
          chave={(r) => r.recurso}
          semFerramentas
          vazio={<EstadoVazio icone={History} titulo="Nenhum evento no período" />}
        />
        <Secao titulo="Últimos eventos do período" id="terceira-eventos" acoes={<Link to="/auditoria">Abrir a trilha completa</Link>}>
          {painel.ultimosEventos.length === 0 ? (
            <EstadoVazio icone={History} titulo="Nenhum evento no período" />
          ) : (
            <ul className="lista-controle">
              {painel.ultimosEventos.map((e) => (
                <li key={e.id}>
                  <span className="lista-controle__titulo">{e.resumo}</span>
                  <span className="texto-pequeno numero">nº {e.sequencia}</span>
                  <span className="lista-controle__explicacao texto-pequeno texto-secundario">
                    {formatarInstante(e.ocorridoEm)} · {e.usuario?.nome ?? 'Sistema'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      <Fontes fontes={painel.fontes} geradoEm={painel.geradoEm} />
    </div>
  );
}

function TerceiraLinha({ uasg }: { uasg: string | undefined }) {
  const p = useParametrosUrl();
  const hoje = hojeISO(new Date());
  const de = p.texto('de');
  const ate = p.texto('ate');
  const filtro = {
    uasg,
    de: de && validarDataISO(de) ? de : undefined,
    ate: ate && validarDataISO(ate) ? ate : undefined,
  };
  const consulta = usePainelTerceiraLinha(filtro);
  const periodo = consulta.data?.periodo;
  return (
    <div className="pilha pilha--ampla">
      <div className="controle-filtros" role="group" aria-label="Período do painel e do relatório">
        <CampoTexto
          rotulo="De"
          type="date"
          value={filtro.de ?? ''}
          max={filtro.ate ?? hoje}
          onChange={(e) => p.atualizar({ de: e.target.value })}
          ajuda="Padrão: 90 dias antes do fim."
        />
        <CampoTexto rotulo="Até" type="date" value={filtro.ate ?? ''} max={hoje} onChange={(e) => p.atualizar({ ate: e.target.value })} ajuda="Padrão: hoje." />
        <a className="botao botao--primario" href={urlRelatorioAuditoria(filtro)} download>
          <FileDown size={16} aria-hidden="true" />
          <span>Baixar relatório executivo (PDF)</span>
        </a>
      </div>
      {periodo ? (
        <p className="texto-pequeno texto-secundario" role="status">
          Período: {formatarData(periodo.de)} a {formatarData(periodo.ate)}. O relatório traz fontes, data de emissão e período, e a emissão fica registrada na trilha.
        </p>
      ) : null}
      <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o painel da 3ª linha" tituloErro="Não foi possível carregar o painel da 3ª linha">
        {(painel) => <ConteudoTerceiraLinha painel={painel} />}
      </ConteudoConsulta>
    </div>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function LinhasDefesa() {
  const { temPermissao } = useSessao();
  const p = useParametrosUrl();
  const uasg = p.texto('uasg');
  const abas: DefinicaoAba[] = [];
  if (temPermissao('controle:primeira_linha')) {
    abas.push({ id: 'primeira', rotulo: '1ª linha — gestão e fiscalização', conteudo: () => <PrimeiraLinha uasg={uasg} /> });
  }
  if (temPermissao('controle:segunda_linha')) {
    abas.push({ id: 'segunda', rotulo: '2ª linha — jurídico e controle interno', conteudo: () => <SegundaLinha uasg={uasg} /> });
  }
  if (temPermissao('controle:terceira_linha')) {
    abas.push({ id: 'terceira', rotulo: '3ª linha — auditoria (CGU e TCU)', conteudo: () => <TerceiraLinha uasg={uasg} /> });
  }

  return (
    <Pagina
      titulo="Linhas de defesa"
      subtitulo="Controle preventivo das contratações (Lei 14.133/2021, art. 169). Cada linha vê o painel que lhe cabe, no escopo de UASG do seu perfil."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="controle"
    >
      {abas.length === 0 ? (
        <SemPermissao />
      ) : (
        <div className="pilha">
          <div className="painel-filtro">
            <div className="painel-filtro__campo">
              <CampoUasg valor={uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
            </div>
          </div>
          <Abas abas={abas} rotulo="Linhas de defesa" parametro="linha" />
        </div>
      )}
    </Pagina>
  );
}

