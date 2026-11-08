import { useParams } from 'react-router';
import { Banknote, CircleDollarSign } from 'lucide-react';
import { formatarData, formatarMoeda, formatarMoedaCompacta } from '@agora/dominio';
import { useContratoPublico } from '../../api/publico';
import {
  Alerta,
  BarraProgresso,
  ConteudoConsulta,
  EsqueletoDetalhe,
  Indicador,
  LinkBotao,
  LinkExterno,
  ListaDefinicoes,
  Pagina,
  Secao,
} from '../../componentes';
import { formatarPercentual } from '../../utilitarios/formatacao';

export default function TransparenciaContrato() {
  const { id = '' } = useParams();
  const consulta = useContratoPublico(id);
  const contrato = consulta.data;

  return (
    <Pagina
      titulo={contrato ? `Contrato ${contrato.numero}` : 'Contrato'}
      trilha={[{ rotulo: 'Transparência', para: '/transparencia' }]}
      tela="transparencia"
      subtitulo={contrato?.objeto}
      acoes={
        contrato?.linkPncp ? (
          <LinkExterno href={contrato.linkPncp} comoBotao="secundario">
            Abrir no PNCP
          </LinkExterno>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando o contrato"
        naoEncontrado={{
          titulo: 'Contrato não encontrado',
          descricao: 'O contrato não existe ou não está disponível para consulta pública.',
          acao: (
            <LinkBotao to="/transparencia" variante="primario">
              Voltar para a lista
            </LinkBotao>
          ),
        }}
      >
        {(c) => {
          const percentualPago = c.valorGlobal > 0 ? (c.valorPago / c.valorGlobal) * 100 : 0;
          return (
            <>
              {c.sigilo ? (
                <Alerta tipo="aviso" titulo="Contrato sigiloso: registro mínimo">
                  <p>{c.sigilo.mensagem}</p>
                  <p className="texto-pequeno">{c.sigilo.fundamento}</p>
                </Alerta>
              ) : null}
              <div className="grade grade--kpi" hidden={Boolean(c.sigilo)}>
                <Indicador
                  rotulo="Valor global"
                  icone={CircleDollarSign}
                  tom="info"
                  valor={formatarMoedaCompacta(c.valorGlobal)}
                  valorAcessivel={formatarMoeda(c.valorGlobal)}
                />
                <Indicador
                  rotulo="Valor pago"
                  icone={Banknote}
                  tom="sucesso"
                  valor={formatarMoedaCompacta(c.valorPago)}
                  valorAcessivel={formatarMoeda(c.valorPago)}
                  detalhe={`${formatarPercentual(percentualPago)} do valor global`}
                />
              </div>
              <Secao titulo="Dados do contrato" id="dados-contrato-publico">
                <ListaDefinicoes
                  itens={[
                    { termo: 'Número', valor: c.numero },
                    { termo: 'Órgão', valor: c.orgao },
                    { termo: 'UASG', valor: <span className="numero">{c.uasg}</span> },
                    { termo: 'Fornecedor', valor: c.fornecedor },
                    { termo: 'Documento do fornecedor', valor: <span className="mono">{c.documentoFornecedor}</span> },
                    { termo: 'Vigência', valor: `${formatarData(c.vigenciaInicio)} a ${formatarData(c.vigenciaFim)}` },
                    { termo: 'Valor global', valor: formatarMoeda(c.valorGlobal) },
                    { termo: 'Valor pago', valor: formatarMoeda(c.valorPago) },
                    { termo: 'Objeto', valor: c.objeto, largo: true },
                  ]}
                />
                <BarraProgresso valor={percentualPago} rotulo="Execução financeira (pago em relação ao valor global)" tom="sucesso" />
              </Secao>
            </>
          );
        }}
      </ConteudoConsulta>
    </Pagina>
  );
}
