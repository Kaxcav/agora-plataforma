import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CircleCheck, ListChecks, RotateCcw } from 'lucide-react';
import type { Tarefa } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useAtualizarTarefa } from '../../api/contratos';
import { useAvisos } from '../../componentes/Avisos';
import { Botao } from '../../componentes/Botao';
import { ConfirmarAcao } from '../../componentes/Dialogo';
import { EsqueletoTexto } from '../../componentes/Esqueleto';
import { ConteudoConsulta, EstadoVazio } from '../../componentes/Estados';
import { Etiqueta } from '../../componentes/Etiqueta';
import { useSessao } from '../../sessao/ContextoSessao';
import { SITUACOES_TAREFA } from './rotulos';

function agrupar(tarefas: readonly Tarefa[]): [string, Tarefa[]][] {
  const grupos = new Map<string, Tarefa[]>();
  for (const t of tarefas) {
    const lista = grupos.get(t.macrotarefa) ?? [];
    lista.push(t);
    grupos.set(t.macrotarefa, lista);
  }
  return [...grupos.entries()];
}

/**
 * Plano de gestão (tarefas por macrotarefa). Concluir/reabrir é escrita: pede confirmação e
 * oferece "Desfazer" no aviso (PATCH de volta à situação anterior).
 */
export function PlanoGestao({ consulta }: { consulta: UseQueryResult<Tarefa[]> }) {
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('tarefas:editar');
  const atualizar = useAtualizarTarefa();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<Tarefa | null>(null);

  const concluir = alvo?.situacao !== 'concluida';

  const confirmar = () => {
    if (!alvo) return;
    const anterior: 'pendente' | 'concluida' = alvo.situacao === 'concluida' ? 'concluida' : 'pendente';
    const nova: 'pendente' | 'concluida' = concluir ? 'concluida' : 'pendente';
    atualizar.mutate(
      { id: alvo.id, entrada: { situacao: nova } },
      {
        onSuccess: () => {
          const titulo = alvo.titulo;
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: nova === 'concluida' ? `Tarefa “${titulo}” concluída.` : `Tarefa “${titulo}” reaberta.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await atualizar.mutateAsync({ id: alvo.id, entrada: { situacao: anterior } });
                avisar({ tipo: 'info', mensagem: 'Alteração desfeita.' });
              },
            },
          });
        },
      },
    );
  };

  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando plano de gestão">
      {(tarefas) =>
        tarefas.length === 0 ? (
          <EstadoVazio
            icone={ListChecks}
            titulo="Plano de gestão sem tarefas"
            descricao="As tarefas são geradas a partir dos modelos de gestão (Ajustes) quando o instrumento é cadastrado."
          />
        ) : (
          <div>
            {agrupar(tarefas).map(([macrotarefa, lista]) => (
              <section key={macrotarefa} className="tarefas-grupo" aria-label={macrotarefa}>
                <h3 className="tarefas-grupo__titulo">{macrotarefa}</h3>
                <ul className="lista-tarefas">
                  {lista.map((t) => {
                    const situacao = SITUACOES_TAREFA[t.situacao];
                    return (
                      <li key={t.id}>
                        <span className="lista-tarefas__titulo">{t.titulo}</span>
                        <span className="lista-tarefas__meta">
                          <Etiqueta tom={situacao.tom} compacta>
                            {situacao.rotulo}
                          </Etiqueta>
                          <span>{t.prazo ? `Prazo ${formatarData(t.prazo)}` : 'Sem prazo'}</span>
                          <span>{t.responsavel ? t.responsavel.nome : 'Sem responsável'}</span>
                        </span>
                        {podeEditar ? (
                          <Botao
                            variante={t.situacao === 'concluida' ? 'terciario' : 'secundario'}
                            tamanho="compacto"
                            icone={t.situacao === 'concluida' ? RotateCcw : CircleCheck}
                            onClick={() => {
                              atualizar.reset();
                              definirAlvo(t);
                            }}
                            aria-label={t.situacao === 'concluida' ? `Reabrir tarefa ${t.titulo}` : `Concluir tarefa ${t.titulo}`}
                          >
                            {t.situacao === 'concluida' ? 'Reabrir' : 'Concluir'}
                          </Botao>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <ConfirmarAcao
              aberto={alvo !== null}
              aoFechar={() => definirAlvo(null)}
              titulo={concluir ? 'Concluir tarefa' : 'Reabrir tarefa'}
              descricao={
                <p>
                  {concluir ? 'Marcar como concluída' : 'Reabrir'} a tarefa <strong>{alvo?.titulo}</strong>? A alteração fica registrada na trilha de
                  auditoria e pode ser desfeita no aviso que aparecerá em seguida.
                </p>
              }
              rotuloConfirmar={concluir ? 'Concluir tarefa' : 'Reabrir tarefa'}
              aoConfirmar={confirmar}
              processando={atualizar.isPending}
              erro={atualizar.error}
            />
          </div>
        )
      }
    </ConteudoConsulta>
  );
}
