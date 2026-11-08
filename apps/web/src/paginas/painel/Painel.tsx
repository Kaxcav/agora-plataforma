import { Link } from 'react-router';
import {
  BadgeCheck,
  Banknote,
  CalendarX2,
  CircleDollarSign,
  FileText,
  Flame,
  Inbox,
  Megaphone,
  PiggyBank,
  ScrollText,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { InstrumentoVencimento, Painel as DadosPainel } from '@agora/contratos';
import { formatarData, formatarMoeda, formatarMoedaCompacta } from '@agora/dominio';
import { usePainel } from '../../api/painel';
import {
  BarraProgresso,
  BarrasHorizontais,
  Esqueleto,
  EsqueletoTexto,
  EstadoVazio,
  FalhaConsulta,
  Indicador,
  Pagina,
  Proveniencia,
  Secao,
  Semaforo,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { FilaPendencias } from './FilaPendencias';
import { LinhaTempoVencimentos } from './LinhaTempoVencimentos';

function percentualDe(parte: number, total: number): number {
  return total > 0 ? (parte / total) * 100 : 0;
}

function Indicadores({ painel }: { painel: DadosPainel | undefined }) {
  const i = painel?.indicadores;
  const carregando = i === undefined;
  return (
    <section aria-labelledby="titulo-indicadores" className="pilha pilha--compacta">
      <h2 id="titulo-indicadores" className="sr-only">
        Indicadores da carteira
      </h2>
      <div className="grade grade--kpi">
        <Indicador
          rotulo="Atas vigentes"
          icone={ScrollText}
          tom="info"
          carregando={carregando}
          valor={i ? formatarNumero(i.atasVigentes) : null}
          detalhe="atas de registro de preços"
          para="/atas?situacao=vigente"
        />
        <Indicador
          rotulo="Contratos vigentes"
          icone={FileText}
          tom="info"
          carregando={carregando}
          valor={i ? formatarNumero(i.contratosVigentes) : null}
          detalhe="na carteira do seu escopo"
          para="/contratos?situacao=vigente"
        />
        <Indicador
          rotulo="Valor global"
          icone={CircleDollarSign}
          tom="neutro"
          carregando={carregando}
          valor={i ? formatarMoedaCompacta(i.valorGlobalContratos) : null}
          valorAcessivel={i ? formatarMoeda(i.valorGlobalContratos) : undefined}
          detalhe="dos contratos vigentes, com aditivos"
        />
        <Indicador
          rotulo="Empenhado"
          icone={Wallet}
          tom="info"
          carregando={carregando}
          valor={i ? formatarMoedaCompacta(i.valorEmpenhado) : null}
          valorAcessivel={i ? formatarMoeda(i.valorEmpenhado) : undefined}
          detalhe={
            i ? (
              <BarraProgresso
                valor={percentualDe(i.valorEmpenhado, i.valorGlobalContratos)}
                rotulo="Empenhado em relação ao valor global"
                tom="info"
                compacta
              />
            ) : null
          }
        />
        <Indicador
          rotulo="Pago"
          icone={Banknote}
          tom="sucesso"
          carregando={carregando}
          valor={i ? formatarMoedaCompacta(i.valorPago) : null}
          valorAcessivel={i ? formatarMoeda(i.valorPago) : undefined}
          detalhe={
            i ? (
              <BarraProgresso valor={percentualDe(i.valorPago, i.valorEmpenhado)} rotulo="Pago em relação ao empenhado" tom="sucesso" compacta />
            ) : null
          }
        />
        <Indicador
          rotulo="Saldo a empenhar"
          icone={PiggyBank}
          tom="aviso"
          carregando={carregando}
          valor={i ? formatarMoedaCompacta(i.saldoAEmpenhar) : null}
          valorAcessivel={i ? formatarMoeda(i.saldoAEmpenhar) : undefined}
          detalhe="valor contratado ainda sem empenho"
          para="/financeiro/empenhos"
        />
        <Indicador
          rotulo="Pendências abertas"
          icone={Inbox}
          tom={i && i.pendenciasAltaPrioridade > 0 ? 'erro' : 'sucesso'}
          carregando={carregando}
          valor={i ? formatarNumero(i.pendenciasAbertas) : null}
          detalhe={i ? `${formatarNumero(i.pendenciasAltaPrioridade)} de alta prioridade` : null}
        />
      </div>
    </section>
  );
}

function CartaoAlerta({
  icone: Icone,
  titulo,
  valor,
  texto,
  tom,
  link,
}: {
  icone: LucideIcon;
  titulo: string;
  valor: number | undefined;
  texto: string;
  tom: 'erro' | 'aviso' | 'ok';
  link?: { para: string; rotulo: string };
}) {
  return (
    <div className={`cartao-alerta cartao-alerta--${tom}`}>
      <span className="cartao-alerta__icone" aria-hidden="true">
        <Icone size={20} />
      </span>
      <div className="pilha pilha--compacta">
        <p className="cartao-alerta__titulo">{titulo}</p>
        {valor === undefined ? <Esqueleto largura="3rem" altura="1.75rem" /> : <p className="cartao-alerta__valor numero">{formatarNumero(valor)}</p>}
        <p className="cartao-alerta__texto">{texto}</p>
        {link && valor !== undefined && valor > 0 ? (
          <Link to={link.para} className="texto-pequeno">
            {link.rotulo}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Alertas({ painel }: { painel: DadosPainel | undefined }) {
  const v = painel?.vencimentos;
  return (
    <section aria-labelledby="titulo-alertas" className="pilha pilha--compacta">
      <h2 id="titulo-alertas" className="sr-only">
        Alertas que exigem atenção
      </h2>
      <div className="painel-alertas">
        <CartaoAlerta
          icone={CalendarX2}
          titulo="Instrumentos vencidos"
          valor={v?.vencidos}
          tom={v && v.vencidos > 0 ? 'erro' : 'ok'}
          texto="Atas e contratos com vigência encerrada ainda na carteira."
          link={{ para: '/contratos?situacao=encerrado', rotulo: 'Ver contratos encerrados' }}
        />
        <CartaoAlerta
          icone={Megaphone}
          titulo="Divulgação no PNCP pendente"
          valor={painel?.divulgacaoPncpPendente}
          tom={painel && painel.divulgacaoPncpPendente > 0 ? 'erro' : 'ok'}
          texto="Contratos com prazo do art. 94 vencido sem divulgação — condição de eficácia."
        />
        <CartaoAlerta
          icone={Flame}
          titulo="Queima de saldo acelerada"
          valor={painel?.queimaAcelerada}
          tom={painel && painel.queimaAcelerada > 0 ? 'aviso' : 'ok'}
          texto="Execução financeira muito acima do tempo decorrido (sinal para análise, RIA-07)."
        />
      </div>
    </section>
  );
}

function Vencimentos({ painel }: { painel: DadosPainel | undefined }) {
  return (
    <Secao id="vencimentos" titulo="Vencimentos" descricao="Atas e contratos por faixa de vigência restante (semáforo 30/60/90/120).">
      {painel ? (
        <BarrasHorizontais
          rotulo="Quantidade de instrumentos por faixa de vencimento"
          formatarValor={formatarNumero}
          itens={[
            { id: 'vencidos', rotulo: 'Vencidos', detalhe: 'vigência encerrada', valor: painel.vencimentos.vencidos, tom: 'erro' },
            { id: '30', rotulo: 'Até 30 dias', detalhe: 'crítico', valor: painel.vencimentos.em30, tom: 'critico' },
            { id: '60', rotulo: '31 a 60 dias', detalhe: 'atenção', valor: painel.vencimentos.em60, tom: 'aviso' },
            { id: '90', rotulo: '61 a 90 dias', detalhe: 'alerta', valor: painel.vencimentos.em90, tom: 'alerta' },
            { id: '120', rotulo: '91 a 120 dias', detalhe: 'planejamento', valor: painel.vencimentos.em120, tom: 'info' },
          ]}
        />
      ) : (
        <div aria-busy="true">
          <EsqueletoTexto linhas={4} />
        </div>
      )}
    </Secao>
  );
}

function caminho(i: InstrumentoVencimento): string {
  return i.tipo === 'ata' ? `/atas/${i.id}` : `/contratos/${i.id}`;
}

function ProximosVencimentos({ painel }: { painel: DadosPainel | undefined }) {
  return (
    <Secao id="proximos-vencimentos" titulo="Próximos vencimentos" descricao="Os oito instrumentos mais próximos do fim da vigência.">
      {!painel ? (
        <div aria-busy="true">
          <EsqueletoTexto linhas={6} />
        </div>
      ) : painel.proximosVencimentos.length === 0 ? (
        <EstadoVazio icone={BadgeCheck} titulo="Nenhum vencimento próximo" descricao="Não há atas ou contratos vencendo nos próximos 90 dias." />
      ) : (
        <ul className="lista-vencimentos">
          {painel.proximosVencimentos.map((i) => (
            <li key={`${i.tipo}-${i.id}`}>
              <Link to={caminho(i)} className="lista-vencimentos__titulo">
                {i.identificador}
              </Link>
              <Semaforo valor={i.semaforo} vigenciaFim={i.vigenciaFim} compacto />
              <span className="lista-vencimentos__objeto" title={i.objeto}>
                {i.objeto}
              </span>
              <span className="texto-pequeno texto-secundario">
                UASG <span className="numero">{i.uasg}</span> · fim em <span className="numero">{formatarData(i.vigenciaFim)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

export default function Painel() {
  const { usuario } = useSessao();
  const p = useParametrosUrl();
  const uasg = p.texto('uasg');
  const consulta = usePainel(uasg);
  const painel = consulta.data;
  const primeiroNome = usuario?.nome.split(' ')[0];

  return (
    <Pagina
      titulo="Início"
      tituloDocumento="Início"
      subtitulo={primeiroNome ? `Olá, ${primeiroNome}. Resumo da carteira de atas e contratos e o que exige sua atenção.` : 'Resumo da carteira de atas e contratos.'}
      tela="painel"
    >
      <div className="painel-filtro">
        <div className="painel-filtro__campo">
          <CampoUasg valor={uasg} aoMudar={(v) => p.atualizar({ uasg: v })} rotulo="UASG da carteira" />
        </div>
        {consulta.isFetching && painel ? (
          <p className="texto-pequeno texto-secundario" role="status">
            Atualizando indicadores…
          </p>
        ) : null}
      </div>

      {consulta.isError && !painel ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar os indicadores" />
      ) : (
        <>
          <Indicadores painel={painel} />
          {painel && painel.indicadores.valorGlobalContratos > 0 ? (
            <p className="texto-pequeno texto-secundario">
              Empenhado: {formatarPercentual(percentualDe(painel.indicadores.valorEmpenhado, painel.indicadores.valorGlobalContratos))} do valor
              global · Pago: {formatarPercentual(percentualDe(painel.indicadores.valorPago, painel.indicadores.valorEmpenhado))} do empenhado.
            </p>
          ) : null}
          <Alertas painel={painel} />
          <div className="painel-grade">
            <Vencimentos painel={painel} />
            <ProximosVencimentos painel={painel} />
          </div>
          <LinhaTempoVencimentos uasg={uasg} />
        </>
      )}

      <FilaPendencias uasg={uasg} />

      {painel ? <Proveniencia dados={painel.proveniencia} titulo="Proveniência dos dados do painel" /> : null}
    </Pagina>
  );
}
