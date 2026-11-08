/**
 * Etapa 2 — Instrução no SEI e equipe: designação de papéis × servidores com verificação de segregação
 * de funções (RN-03) e assinatura simulada do DFD na árvore do processo SEI.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react';
import { verificarSegregacao, type Designacao, type PapelProcesso } from '@agora/dominio';
import { useDesignaveis, useSalvarEquipe } from '../../../api/jornada';
import { Alerta, Botao, useAvisos } from '../../../componentes';
import { NOMES_PERFIS } from '../../../sessao/permissoes';
import { calcular, ErroOperacao, novoId, Requisitos, type Requisito } from '../comum';
import { DocumentosEtapa, ultimaVersao } from '../Documentos';
import { ehPapel, PAPEIS, rotuloPapel } from '../rotulos';
import type { PropsEtapa } from './tipos';

interface Linha {
  chave: string;
  papel: PapelProcesso | '';
  usuarioId: string;
}

const LISTA_PAPEIS = Object.keys(PAPEIS).filter(ehPapel);

function linhasDoProcesso(equipe: PropsEtapa['processo']['equipe']): Linha[] {
  return equipe.map((e) => ({ chave: novoId(), papel: ehPapel(e.papel) ? e.papel : '', usuarioId: e.usuario.id }));
}

function assinaturaLinhas(linhas: readonly Linha[]): string {
  return linhas
    .map((l) => `${l.papel}:${l.usuarioId}`)
    .sort()
    .join('|');
}

export default function Etapa2Equipe({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarEquipe(processo.id);
  const designaveis = useDesignaveis(editavel);
  const [linhas, definirLinhas] = useState<Linha[]>(() => linhasDoProcesso(processo.equipe));
  const [erroLinhas, definirErroLinhas] = useState<string | null>(null);
  const [anuncio, definirAnuncio] = useState('');
  const alertaConflitos = useRef<HTMLDivElement>(null);
  const botaoAdicionar = useRef<HTMLButtonElement>(null);
  const alterado = assinaturaLinhas(linhas) !== assinaturaLinhas(linhasDoProcesso(processo.equipe));

  // Servidores designáveis no escopo de UASG; os já designados continuam visíveis mesmo fora da lista.
  const servidores = new Map<string, { nome: string; dica: string }>();
  for (const e of processo.equipe) servidores.set(e.usuario.id, { nome: e.usuario.nome, dica: 'designado neste processo' });
  for (const u of designaveis.data ?? []) {
    const perfis = u.perfis.map((p) => NOMES_PERFIS[p]).join(', ') || 'sem perfil';
    servidores.set(u.id, { nome: u.nome, dica: u.unidadeInterna ? `${perfis} · ${u.unidadeInterna}` : perfis });
  }
  const candidatos = new Map([...servidores.entries()].map(([id, s]) => [id, s.nome]));
  const opcoesServidores = [...servidores.entries()].map(([id, s]) => ({ id, ...s })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const designacoes: Designacao[] = linhas.flatMap((l) =>
    l.papel !== '' && l.usuarioId !== '' ? [{ papel: l.papel, servidorId: l.usuarioId, nome: candidatos.get(l.usuarioId) ?? 'Servidor' }] : [],
  );
  const segregacao = calcular(() => verificarSegregacao(designacoes));
  const conflitos = segregacao.ok ? segregacao.valor.conflitos.filter((c) => c.tipo === 'acumulo_funcoes') : [];
  const papeisPresentes = new Set(designacoes.map((d) => d.papel));

  const documentoDfd = ultimaVersao(processo.documentos, 'dfd');
  const dfdNaArvore = documentoDfd?.numeroSei
    ? processo.arvoreSei.find((a) => a.numero === documentoDfd.numeroSei)
    : processo.arvoreSei.find((a) => /\bDFD\b/i.test(a.titulo));

  const requisitos: Requisito[] = [
    { id: 'planejamento', rotulo: 'Equipe de planejamento da contratação designada', atendido: papeisPresentes.has('equipe_planejamento') },
    {
      id: 'agente',
      rotulo: 'Agente de contratação ou pregoeiro designado (art. 8º)',
      atendido: papeisPresentes.has('agente_contratacao') || papeisPresentes.has('pregoeiro'),
    },
    { id: 'autoridade', rotulo: 'Autoridade competente indicada', atendido: papeisPresentes.has('autoridade_competente') },
    {
      id: 'segregacao',
      rotulo: 'Segregação de funções respeitada (RN-03, art. 7º, § 1º)',
      atendido: segregacao.ok && conflitos.length === 0,
      detalhe: conflitos.length > 0 ? ` — ${conflitos.length} conflito(s)` : undefined,
    },
    {
      id: 'dfd',
      rotulo: 'DFD aprovado e assinado na árvore do processo SEI',
      atendido: dfdNaArvore?.assinado === true,
      detalhe: dfdNaArvore ? (dfdNaArvore.assinado ? undefined : ` — documento ${dfdNaArvore.numero} aguarda assinatura`) : ' — gere e aprove o DFD abaixo',
    },
  ];

  const alterarLinha = (chave: string, mudanca: Partial<Linha>) => definirLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));

  const adicionar = () => {
    const chave = novoId();
    definirLinhas((ls) => [...ls, { chave, papel: '', usuarioId: '' }]);
    definirAnuncio(`Designação ${linhas.length + 1} adicionada.`);
    window.requestAnimationFrame(() => document.getElementById(`${base}-${chave}-papel`)?.focus());
  };

  const remover = (chave: string, posicao: number) => {
    definirLinhas((ls) => ls.filter((l) => l.chave !== chave));
    definirAnuncio(`Designação ${posicao} removida.`);
    botaoAdicionar.current?.focus();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const incompleta = linhas.findIndex((l) => l.papel === '' || l.usuarioId === '');
    if (incompleta >= 0) {
      definirErroLinhas(`Complete ou remova a designação ${incompleta + 1}: informe o papel e o servidor.`);
      return;
    }
    const repetidas = new Set<string>();
    for (const l of linhas) {
      const chave = `${l.papel}:${l.usuarioId}`;
      if (repetidas.has(chave)) {
        definirErroLinhas(`O servidor ${candidatos.get(l.usuarioId) ?? ''} está designado mais de uma vez como ${rotuloPapel(l.papel)}.`);
        return;
      }
      repetidas.add(chave);
    }
    definirErroLinhas(null);
    if (conflitos.length > 0) {
      alertaConflitos.current?.focus();
      return;
    }
    salvar.mutate(
      { designacoes: designacoes.map((d) => ({ papel: d.papel, usuarioId: d.servidorId })) },
      {
        onSuccess: (atualizado) => {
          definirLinhas(linhasDoProcesso(atualizado.equipe));
          avisar({ tipo: 'sucesso', titulo: 'Equipe designada', mensagem: 'As designações foram registradas e a segregação de funções foi verificada.' });
        },
      },
    );
  };

  const descartar = () => {
    definirLinhas(linhasDoProcesso(processo.equipe));
    definirErroLinhas(null);
    salvar.reset();
    definirAnuncio('Alterações descartadas.');
  };

  const sinaisVinculo = processo.sinais.filter((s) => s.regra === 'RN-03' || s.regra === 'RIA-06');

  return (
    <div className="pilha pilha--ampla">
      <form className="formulario" onSubmit={enviar} noValidate>
        <section className="secao" aria-labelledby={`${base}-titulo-equipe`}>
          <div>
            <h3 id={`${base}-titulo-equipe`} className="secao__titulo">
              Designação da equipe
            </h3>
            <p className="secao__descricao">
              O mesmo servidor não pode acumular funções suscetíveis a riscos no mesmo processo (art. 7º, § 1º). A verificação é feita ao
              alterar e novamente pelo servidor ao salvar.
            </p>
          </div>
          {editavel ? (
            <>
              <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-legenda`} tabIndex={0}>
                <table className="tabela tabela--compacta jornada-tabela-edicao">
                  <caption id={`${base}-legenda`} className="tabela__legenda">
                    Papéis e servidores designados
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Nº</th>
                      <th scope="col">Papel no processo</th>
                      <th scope="col">Servidor</th>
                      <th scope="col">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="texto-secundario">
                          Nenhuma designação. Use “Adicionar designação”.
                        </td>
                      </tr>
                    ) : (
                      linhas.map((l, i) => {
                        const emConflito = conflitos.some((c) => c.servidorId === l.usuarioId && l.papel !== '' && c.papeis.includes(l.papel));
                        return (
                          <tr key={l.chave} className={emConflito ? 'tabela__linha--erro' : undefined}>
                            <th scope="row" className="numero">
                              {i + 1}
                            </th>
                            <td>
                              <select
                                id={`${base}-${l.chave}-papel`}
                                className="campo__controle campo__controle--selecao"
                                aria-label={`Papel da designação ${i + 1}`}
                                value={l.papel}
                                onChange={(e) => {
                                  const valor = e.target.value;
                                  alterarLinha(l.chave, { papel: ehPapel(valor) ? valor : '' });
                                }}
                              >
                                <option value="">Selecione o papel…</option>
                                {LISTA_PAPEIS.map((p) => (
                                  <option key={p} value={p}>
                                    {PAPEIS[p]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                className="campo__controle campo__controle--selecao"
                                aria-label={`Servidor da designação ${i + 1}`}
                                aria-describedby={l.usuarioId ? `${base}-${l.chave}-dica` : undefined}
                                value={l.usuarioId}
                                onChange={(e) => alterarLinha(l.chave, { usuarioId: e.target.value })}
                              >
                                <option value="">{designaveis.isPending ? 'Carregando servidores…' : 'Selecione o servidor…'}</option>
                                {opcoesServidores.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.nome} — {s.dica}
                                  </option>
                                ))}
                              </select>
                              {l.usuarioId ? (
                                <span id={`${base}-${l.chave}-dica`} className="jornada-dica-campo">
                                  {servidores.get(l.usuarioId)?.dica ?? ''}
                                </span>
                              ) : null}
                              {emConflito ? <span className="campo__erro">Acúmulo de funções conflitantes</span> : null}
                            </td>
                            <td>
                              <Botao
                                variante="terciario"
                                tamanho="compacto"
                                somenteIcone
                                icone={Trash2}
                                aria-label={`Remover designação ${i + 1}${l.papel ? ` — ${rotuloPapel(l.papel)}` : ''}`}
                                onClick={() => remover(l.chave, i + 1)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <Botao ref={botaoAdicionar} icone={Plus} onClick={adicionar}>
                  Adicionar designação
                </Botao>
              </div>
              {designaveis.isError ? (
                <Alerta
                  tipo="aviso"
                  compacto
                  titulo="Não foi possível carregar os servidores designáveis"
                  acoes={
                    <Botao variante="terciario" tamanho="compacto" icone={RefreshCw} carregando={designaveis.isFetching} onClick={() => void designaveis.refetch()}>
                      Tentar novamente
                    </Botao>
                  }
                >
                  <p>Enquanto isso, a lista mostra apenas os servidores já designados neste processo.</p>
                </Alerta>
              ) : null}
            </>
          ) : processo.equipe.length === 0 ? (
            <p className="texto-secundario">Nenhum servidor designado.</p>
          ) : (
            <dl className="jornada-equipe">
              {processo.equipe.map((e, i) => (
                <div key={`${e.papel}-${e.usuario.id}-${i}`} className="jornada-equipe__item">
                  <dt>{rotuloPapel(e.papel)}</dt>
                  <dd>{e.usuario.nome}</dd>
                </div>
              ))}
            </dl>
          )}

          <div aria-live="polite">
            {conflitos.length > 0 ? (
              <div ref={alertaConflitos} tabIndex={-1} className="jornada-foco">
                <Alerta tipo="erro" titulo="Conflito de segregação de funções (RN-03)">
                  <ul>
                    {conflitos.map((c, i) => (
                      <li key={`${c.servidorId}-${i}`}>
                        <strong>{c.nome}</strong>: {c.papeis.map(rotuloPapel).join(' e ')}. {c.descricao}
                      </li>
                    ))}
                  </ul>
                  <p className="texto-pequeno">{conflitos[0]?.fundamento}</p>
                </Alerta>
              </div>
            ) : null}
            {!segregacao.ok ? (
              <Alerta tipo="aviso" compacto>
                <p>{segregacao.mensagem}</p>
              </Alerta>
            ) : null}
          </div>
          {sinaisVinculo.map((s, i) => (
            <Alerta key={`${s.regra}-${i}`} tipo="aviso" compacto titulo={`Sinal para análise (${s.regra})`}>
              <p>{s.mensagem}</p>
              <p className="texto-pequeno">{s.fundamento}</p>
            </Alerta>
          ))}
        </section>

        {editavel ? (
          <>
            <Requisitos titulo="Condições para avançar à etapa 3" itens={requisitos} />
            {erroLinhas ? (
              <Alerta tipo="erro" anunciar compacto>
                <p>{erroLinhas}</p>
              </Alerta>
            ) : null}
            <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar a equipe" />
            <div className="jornada-barra-acoes">
              <p className="texto-pequeno texto-secundario" aria-live="polite">
                {alterado ? 'Há alterações não salvas.' : 'Sem alterações pendentes.'}
              </p>
              <div className="linha">
                <Botao variante="terciario" icone={RotateCcw} onClick={descartar} disabled={!alterado || salvar.isPending}>
                  Descartar alterações
                </Botao>
                <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
                  Salvar designações
                </Botao>
              </div>
            </div>
          </>
        ) : null}
        <p className="sr-only" role="status">
          {anuncio}
        </p>
      </form>

      <DocumentosEtapa
        processo={processo}
        tipos={['dfd']}
        editavel={editavel}
        titulo="Instrução no SEI"
        descricao={
          <>
            Documentos aprovados entram na árvore do processo SEI (coluna ao lado), onde são assinados. A abertura do processo e a inclusão
            automática de documentos no SEI (RIA-02) dependem da integração com a API do SEI do órgão.
          </>
        }
      />
    </div>
  );
}
