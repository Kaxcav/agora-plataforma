import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { ChecklistRegularidade as DadosChecklist, ItemChecklistRegularidade, VerificacaoRegularidade } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { urlComprovanteVerificacao } from '../../api/regularidade';
import { Alerta, Etiqueta, LinkExterno, type TomEtiqueta } from '../../componentes';
import { abreviarHash, formatarInstante } from '../../utilitarios/formatacao';

/**
 * Checklist de regularidade do contratado (RF-20): consulta ao CEIS e ao CNEP com fonte e data, sanções aplicadas
 * pelo órgão e certidões. Somente exibe o que o servidor avaliou.
 */

const SITUACOES: Record<ItemChecklistRegularidade['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  conforme: { rotulo: 'Conforme', tom: 'sucesso' },
  atencao: { rotulo: 'Atenção', tom: 'aviso' },
  pendente: { rotulo: 'Pendente', tom: 'aviso' },
  impeditivo: { rotulo: 'Impeditivo', tom: 'erro' },
};

export const MOMENTOS_REGULARIDADE: Record<DadosChecklist['momento'], string> = {
  assinatura: 'assinatura do contrato',
  prorrogacao: 'prorrogação da vigência',
  atesto: 'atesto da nota fiscal',
  pagamento: 'pagamento',
};

/** Referência do item: instante da consulta (com hora) ou data de validade da certidão. */
function referencia(item: ItemChecklistRegularidade): string | null {
  if (item.referencia === null) return null;
  if (item.id === 'ceis_cnep') return `consulta de ${formatarInstante(item.referencia)}`;
  if (item.id === 'sancoes_agora') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(item.referencia) ? `validade ${formatarData(item.referencia)}` : null;
}

export function ResumoRegularidade({ checklist }: { checklist: DadosChecklist }) {
  if (checklist.regular) {
    const comAtencao = checklist.itens.some((i) => i.situacao !== 'conforme');
    return (
      <Etiqueta tom={comAtencao ? 'aviso' : 'sucesso'} icone={comAtencao ? ShieldAlert : ShieldCheck}>
        {comAtencao ? 'Regular, com avisos' : 'Regular'}
      </Etiqueta>
    );
  }
  return (
    <Etiqueta tom="erro" icone={ShieldX}>
      {checklist.bloqueia ? 'Irregular — bloqueia o ato' : 'Irregular'}
    </Etiqueta>
  );
}

export function ChecklistRegularidade({
  checklist,
  titulo,
  idTitulo,
}: {
  checklist: DadosChecklist | VerificacaoRegularidade;
  /** Título do bloco (nível 3). */
  titulo?: string;
  idTitulo?: string;
}) {
  const verificacao = 'id' in checklist ? checklist : null;
  const consulta = checklist.consulta;
  return (
    <section className="regularidade" aria-labelledby={idTitulo} aria-label={idTitulo ? undefined : (titulo ?? 'Checklist de regularidade')}>
      <div className="regularidade__cabecalho">
        {titulo ? (
          <h3 className="secao__titulo" id={idTitulo}>
            {titulo}
          </h3>
        ) : null}
        <ResumoRegularidade checklist={checklist} />
        <span className="texto-pequeno texto-secundario">Antes de: {MOMENTOS_REGULARIDADE[checklist.momento]}</span>
      </div>

      <div className="regularidade__proveniencia">
        {consulta ? (
          <>
            <span>
              <strong>Fonte do CEIS/CNEP:</strong> {consulta.fonte}
            </span>
            <span>
              <strong>Consulta:</strong> {formatarInstante(consulta.consultadoEm)} ({consulta.modo === 'online' ? 'on-line' : 'modo offline'})
            </span>
            <span>
              <strong>Registros:</strong> {consulta.quantidade}
            </span>
            <span>
              <strong>Hash:</strong> <span className="mono">{abreviarHash(consulta.hashConteudo)}</span>
            </span>
          </>
        ) : (
          <span>O CEIS e o CNEP ainda não foram consultados para este fornecedor. A consulta é feita pelo servidor nas travas.</span>
        )}
        {checklist.falhaConsulta ? <span>Última tentativa falhou: {checklist.falhaConsulta}</span> : null}
      </div>

      <ul className="regularidade__itens" aria-label="Itens verificados">
        {checklist.itens.map((item) => {
          const def = SITUACOES[item.situacao];
          const ref = referencia(item);
          return (
            <li key={item.id} className={`regularidade__item regularidade__item--${item.situacao}`}>
              <div className="regularidade__item-topo">
                <span className="regularidade__item-titulo">{item.rotulo}</span>
                <Etiqueta tom={def.tom} compacta>
                  {def.rotulo}
                </Etiqueta>
              </div>
              <ul className="regularidade__detalhes">
                {item.detalhes.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <span className="regularidade__fonte">
                Fonte: {item.fonte}
                {ref ? ` · ${ref}` : ''} · {item.fundamento}
              </span>
            </li>
          );
        })}
      </ul>

      {checklist.providencias.length > 0 ? (
        <Alerta tipo={checklist.regular ? 'info' : checklist.bloqueia ? 'erro' : 'aviso'} titulo="Providências">
          <ul>
            {checklist.providencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}

      <p className="texto-pequeno texto-secundario">
        {checklist.aviso} Fundamento: {checklist.fundamento}.
      </p>
      {verificacao ? (
        <div className="regularidade__acoes">
          <LinkExterno href={urlComprovanteVerificacao(verificacao.id)}>Comprovante da verificação (PDF)</LinkExterno>
        </div>
      ) : null}
    </section>
  );
}
