/**
 * Auditor contínuo na aba da 2ª linha de defesa (RIA-15; "Auditor IA contínuo" da conversa do cliente): sinais
 * determinísticos sobre notas fiscais, medições, aditivos e documentos dos processos, com fundamento e evidências.
 */
import { Link } from 'react-router';
import { FileStack, Radar, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { PainelAuditorIa } from '@agora/contratos';
import { usePainelAuditorIa } from '../../api/iaAncorada';
import { Alerta, ConteudoConsulta, EstadoVazio, Etiqueta, Indicador, Secao } from '../../componentes';
import { formatarNumero } from '../../utilitarios/formatacao';
import { ApoioResultado } from './comum';

function ConteudoAuditor({ painel }: { painel: PainelAuditorIa }) {
  const i = painel.indicadores;
  return (
    <div className="pilha">
      <div className="grade grade--kpi">
        <Indicador rotulo="Contratos varridos" valor={formatarNumero(i.contratosVarridos)} detalhe="Notas, medições e aditivos" tom="info" icone={Radar} />
        <Indicador rotulo="Processos varridos" valor={formatarNumero(i.processosVarridos)} detalhe="Documentos da jornada" tom="info" icone={FileStack} />
        <Indicador rotulo="Sinais de risco" valor={formatarNumero(i.sinaisRisco)} detalhe="Para conferência imediata" tom={i.sinaisRisco > 0 ? 'erro' : 'sucesso'} icone={ShieldAlert} />
        <Indicador rotulo="Sinais de atenção" valor={formatarNumero(i.sinaisAtencao)} detalhe="Para acompanhamento" tom={i.sinaisAtencao > 0 ? 'aviso' : 'sucesso'} icone={TriangleAlert} />
      </div>
      <Alerta tipo="info" compacto>
        {painel.aviso}
      </Alerta>
      {painel.sinais.length === 0 ? (
        <EstadoVazio icone={ShieldCheck} titulo="Nenhum sinal do auditor contínuo" />
      ) : (
        <ul className="lista-sinais">
          {painel.sinais.map((s, n) => (
            <li key={`${s.tipo}-${s.referencia.id}-${n}`}>
              <span className="lista-sinais__titulo">{s.titulo}</span>
              <Etiqueta tom={s.nivel === 'risco' ? 'erro' : 'aviso'} compacta>
                {s.nivel === 'risco' ? 'Risco' : 'Atenção'}
              </Etiqueta>
              <div className="lista-sinais__corpo">
                <p>
                  <Link to={s.referencia.caminho}>{s.referencia.identificador}</Link> — {s.descricao}
                </p>
                <details>
                  <summary className="texto-pequeno">Evidências ({s.evidencias.length})</summary>
                  <ul className="texto-pequeno">
                    {s.evidencias.map((e, k) => (
                      <li key={k}>{e}</li>
                    ))}
                  </ul>
                </details>
                <p className="texto-pequeno texto-secundario">Fundamento: {s.fundamento}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ApoioResultado premissas={painel.premissas} fontes={painel.fontes} aviso="Os sinais não são conclusão de auditoria: a 2ª linha confere as evidências e decide o encaminhamento." geradoEm={painel.geradoEm} />
    </div>
  );
}

export function SecaoAuditorIa({ uasg }: { uasg: string | undefined }) {
  const consulta = usePainelAuditorIa(uasg);
  return (
    <Secao
      titulo="Auditor contínuo"
      id="segunda-auditor"
      descricao="Varredura permanente das notas fiscais, medições, termos aditivos e documentos dos processos em busca de anomalias financeiras, desequilíbrio econômico-financeiro, sobrepreço ou superfaturamento (art. 6º, LVI e LVII; art. 169)."
    >
      <ConteudoConsulta consulta={consulta} rotuloCarregando="Varrendo contratos e processos" tituloErro="Não foi possível carregar o auditor contínuo">
        {(painel) => <ConteudoAuditor painel={painel} />}
      </ConteudoConsulta>
    </Secao>
  );
}
