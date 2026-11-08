/**
 * `/atas/adesoes` — pedidos de adesão às atas gerenciadas pelas UASGs do usuário (art. 86, § 2º, III): o
 * gerenciador dá a anuência depois do aceite do fornecedor, conferidos de novo os limites dos §§ 4º e 5º no servidor.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, X } from 'lucide-react';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useAdesoesAtas, useAnuenciaAdesao } from '../../api/rotas-contratacao';
import { AreaTexto, Botao, ConfirmarAcao, Etiqueta, Pagina, Secao, Tabela, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';

const ROTULOS = { solicitada: 'Aguardando aceite do fornecedor', aceita_fornecedor: 'Aguardando anuência', autorizada: 'Autorizada', recusada: 'Recusada' } as const;

export default function AdesoesAtas() {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const adesoes = useAdesoesAtas();
  const anuencia = useAnuenciaAdesao();
  const [recusando, definirRecusando] = useState<string | null>(null);
  const [motivo, definirMotivo] = useState('');
  const pode = temPermissao('atas:editar');

  return (
    <Pagina titulo="Adesões às atas" tela="jornada.adesao" subtitulo="Anuência do órgão gerenciador (art. 86, § 2º, III; Decreto 11.462/2023, art. 31)" trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Atas', para: '/atas' }]}>
      <Secao titulo="Pedidos de adesão" descricao="Até 50% do registrado por órgão aderente e o dobro no total das adesões; contratação em até 90 dias da anuência.">
        <Tabela
          id="adesoes-atas"
          legenda="Pedidos de adesão às atas"
          semFerramentas
          linhas={adesoes.data}
          carregando={adesoes.isLoading}
          chave={(a) => a.id}
          vazio="Nenhum pedido de adesão às atas das suas UASGs."
          colunas={[
            { id: 'processo', cabecalho: 'Processo', celula: (a) => <Link to={`/jornada/${encodeURIComponent(a.processo.id)}`}>{a.processo.numeroSei}</Link>, identificadora: true, prioritaria: true },
            { id: 'ata', cabecalho: 'Ata e item', celula: (a) => `${a.ata.numero} — item ${a.item.numero}: ${a.item.descricao}`, prioritaria: true },
            { id: 'quantidade', cabecalho: 'Quantidade', celula: (a) => `${a.quantidade} (limite por órgão ${a.limites.limitePorOrgao}; aderido no total ${a.limites.aderidoTotal} de ${a.limites.limiteTotal})` },
            { id: 'valor', cabecalho: 'Valor', celula: (a) => <span className="numero">{formatarMoeda(a.valorTotal)}</span>, alinhamento: 'fim' },
            {
              id: 'situacao',
              cabecalho: 'Situação',
              prioritaria: true,
              celula: (a) => (
                <span>
                  <Etiqueta tom={a.situacao === 'autorizada' ? 'sucesso' : a.situacao === 'recusada' ? 'erro' : 'aviso'}>{ROTULOS[a.situacao]}</Etiqueta>
                  {a.limiteContratacao ? <span className="texto-pequeno"> contratar até {formatarData(a.limiteContratacao)}</span> : null}
                </span>
              ),
            },
          ]}
          acoes={{
            cabecalho: 'Decisão',
            celula: (a) =>
              pode && a.situacao === 'aceita_fornecedor' ? (
                <div className="linha">
                  <Botao
                    tamanho="compacto"
                    variante="primario"
                    icone={Check}
                    carregando={anuencia.isPending}
                    onClick={() => anuencia.mutate({ id: a.id, decisao: 'autorizada', motivo: null }, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Anuência registrada', mensagem: 'O órgão aderente tem 90 dias para contratar, na vigência da ata.' }) })}
                  >
                    Dar anuência
                  </Botao>
                  <Botao tamanho="compacto" icone={X} onClick={() => definirRecusando(a.id)}>
                    Recusar
                  </Botao>
                </div>
              ) : null,
          }}
        />
      </Secao>
      <ConfirmarAcao
        aberto={recusando !== null}
        aoFechar={() => definirRecusando(null)}
        titulo="Recusar a adesão"
        descricao={<p>A recusa fica registrada no processo do órgão aderente, com o motivo, e na trilha de auditoria.</p>}
        rotuloConfirmar="Recusar"
        processando={anuencia.isPending}
        erro={anuencia.error}
        aoConfirmar={() =>
          recusando && anuencia.mutate({ id: recusando, decisao: 'recusada', motivo }, { onSuccess: () => { definirRecusando(null); avisar({ tipo: 'sucesso', titulo: 'Adesão recusada', mensagem: 'O motivo fica registrado no processo do órgão aderente.' }); } })
        }
      >
        <AreaTexto rotulo="Motivo da recusa" ajuda="Mínimo de 30 caracteres." value={motivo} onChange={(e) => definirMotivo(e.target.value)} rows={3} obrigatorio />
      </ConfirmarAcao>
    </Pagina>
  );
}
