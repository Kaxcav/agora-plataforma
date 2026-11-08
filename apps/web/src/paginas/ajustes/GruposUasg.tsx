import { useState } from 'react';
import { CircleCheck, Network } from 'lucide-react';
import type { GrupoUasg, Uasg } from '@agora/contratos';
import { useConfirmarGrupoUasg, useGruposUasg } from '../../api/ajustes';
import {
  Alerta,
  Botao,
  ConfirmarAcao,
  ConteudoConsulta,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  Pagina,
  Secao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar } from '../../utilitarios/formatacao';
import { AvisoSomenteLeitura } from './ErroFormulario';

const COLUNAS_UASG: ColunaTabela<Uasg>[] = [
  {
    id: 'codigo',
    cabecalho: 'Código',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (u) => u.codigo,
    celula: (u) => <span className="numero">{u.codigo}</span>,
  },
  { id: 'sigla', cabecalho: 'Sigla', prioritaria: true, ordenavel: true, valorOrdenacao: (u) => u.sigla, celula: (u) => u.sigla },
  { id: 'nome', cabecalho: 'Nome', prioritaria: true, ordenavel: true, valorOrdenacao: (u) => u.nome, celula: (u) => u.nome },
  { id: 'uf', cabecalho: 'UF', ordenavel: true, valorOrdenacao: (u) => u.uf, celula: (u) => u.uf },
];

function CartaoGrupo({ grupo, podeEditar, aoConfirmar }: { grupo: GrupoUasg; podeEditar: boolean; aoConfirmar: () => void }) {
  const pendente = grupo.situacao === 'pendente_confirmacao';
  return (
    <Secao
      id={`grupo-${grupo.id}`}
      titulo={grupo.nome}
      descricao={
        <span className="linha">
          {pendente ? (
            <Etiqueta tom="aviso" compacta>
              Pendente de confirmação
            </Etiqueta>
          ) : (
            <Etiqueta tom="sucesso" compacta>
              Confirmado
            </Etiqueta>
          )}
          <span>{contar(grupo.uasgs.length, 'UASG', 'UASGs')}</span>
        </span>
      }
      acoes={
        pendente && podeEditar ? (
          <Botao variante="primario" tamanho="compacto" icone={CircleCheck} onClick={aoConfirmar} aria-label={`Confirmar grupo ${grupo.nome}`}>
            Confirmar grupo
          </Botao>
        ) : null
      }
    >
      <Tabela
        id={`grupo-uasgs-${grupo.id}`}
        legenda={`UASGs do grupo ${grupo.nome}`}
        semFerramentas
        colunas={COLUNAS_UASG}
        linhas={grupo.uasgs}
        chave={(u) => u.codigo}
        ordenacaoInicial={{ por: 'codigo', ordem: 'asc' }}
        vazio={<EstadoVazio icone={Network} titulo="Grupo sem UASGs" descricao="Nenhuma UASG foi associada a este grupo." />}
      />
    </Secao>
  );
}

export default function GruposUasg() {
  const consulta = useGruposUasg();
  const confirmar = useConfirmarGrupoUasg();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const podeEditar = temPermissao('ajustes:editar');
  const [alvo, definirAlvo] = useState<GrupoUasg | null>(null);

  const executar = () => {
    if (!alvo) return;
    const nome = alvo.nome;
    confirmar.mutate(alvo.id, {
      onSuccess: () => {
        definirAlvo(null);
        avisar({ tipo: 'sucesso', mensagem: `Grupo “${nome}” confirmado.` });
      },
    });
  };

  return (
    <Pagina
      titulo="Grupos de UASG"
      subtitulo="Agrupamentos de unidades gestoras usados para consolidar demandas, carteiras e indicadores."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Ajustes' }]}
      tela="ajustes"
    >
      {podeEditar ? null : <AvisoSomenteLeitura />}
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} colunas={4} />} rotuloCarregando="Carregando grupos de UASG">
        {(grupos) => {
          if (grupos.length === 0) {
            return (
              <EstadoVazio
                icone={Network}
                titulo="Nenhum grupo de UASG cadastrado"
                descricao="Os grupos são formados a partir das UASGs do órgão e confirmados pela administração da Ágora."
              />
            );
          }
          const pendentes = grupos.filter((g) => g.situacao === 'pendente_confirmacao').length;
          return (
            <div className="pilha pilha--ampla">
              {pendentes > 0 ? (
                <Alerta tipo="aviso" titulo={`${contar(pendentes, 'grupo aguarda', 'grupos aguardam')} confirmação`}>
                  <p>Revise a composição de cada grupo pendente e confirme-o para concluir o cadastro.</p>
                </Alerta>
              ) : null}
              {grupos.map((g) => (
                <CartaoGrupo
                  key={g.id}
                  grupo={g}
                  podeEditar={podeEditar}
                  aoConfirmar={() => {
                    confirmar.reset();
                    definirAlvo(g);
                  }}
                />
              ))}
            </div>
          );
        }}
      </ConteudoConsulta>
      {podeEditar ? (
        <ConfirmarAcao
          aberto={alvo !== null}
          aoFechar={() => definirAlvo(null)}
          titulo="Confirmar grupo de UASG"
          descricao={
            <>
              <p>
                Confirmar o grupo <strong>{alvo?.nome}</strong> com {contar(alvo?.uasgs.length ?? 0, 'UASG', 'UASGs')}?
              </p>
              <p>
                A confirmação fica registrada na trilha de auditoria e <strong>não pode ser desfeita pela interface</strong>; para alterar o grupo
                depois, solicite ajuste à administração da Ágora.
              </p>
            </>
          }
          rotuloConfirmar="Confirmar grupo"
          aoConfirmar={executar}
          processando={confirmar.isPending}
          erro={confirmar.error}
        />
      ) : null}
    </Pagina>
  );
}
