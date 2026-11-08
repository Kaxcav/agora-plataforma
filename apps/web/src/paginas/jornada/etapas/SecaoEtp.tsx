/**
 * ETP com os 13 incisos do art. 18, § 1º: obrigatórios marcados (§ 2º), progresso e pendências calculados
 * ao digitar com `validarEtp` (RN-04); incisos não obrigatórios podem ter a ausência justificada.
 */
import { useId, useState, type FormEvent } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { INCISOS_ETP, validarEtp, type IncisoEtp } from '@agora/dominio';
import { useSalvarEtp, type DadosEtp } from '../../../api/jornada';
import { AreaTexto, BarraProgresso, Botao, CaixaSelecao, Etiqueta, useAvisos } from '../../../componentes';
import { ErroOperacao, mesmoConteudo } from '../comum';
import type { PropsEtapa } from './tipos';

type Ausencias = Partial<Record<IncisoEtp, boolean>>;

function ausenciasDe(etp: DadosEtp): Ausencias {
  const resultado: Ausencias = {};
  for (const { inciso, obrigatorio } of INCISOS_ETP) {
    const item = etp[inciso];
    resultado[inciso] = !obrigatorio && !(item?.texto ?? '').trim() && Boolean((item?.justificativaAusencia ?? '').trim());
  }
  return resultado;
}

/** Conteúdo enviado: texto, ou justificativa de ausência para inciso não obrigatório marcado como não aplicável. */
function montarEtp(etp: DadosEtp, ausencias: Ausencias): DadosEtp {
  const resultado: DadosEtp = {};
  for (const { inciso } of INCISOS_ETP) {
    const item = etp[inciso];
    if (ausencias[inciso]) {
      const justificativa = (item?.justificativaAusencia ?? '').trim();
      if (justificativa) resultado[inciso] = { justificativaAusencia: justificativa };
    } else {
      const texto = (item?.texto ?? '').trim();
      if (texto) resultado[inciso] = { texto };
    }
  }
  return resultado;
}

export function SecaoEtp({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarEtp(processo.id);
  const [etp, definirEtp] = useState<DadosEtp>(() => processo.etp);
  const [ausencias, definirAusencias] = useState<Ausencias>(() => ausenciasDe(processo.etp));

  const conteudo = montarEtp(etp, ausencias);
  const validacao = validarEtp(conteudo);
  const atendidos = INCISOS_ETP.length - validacao.pendencias.length;
  const alterado = !mesmoConteudo(conteudo, montarEtp(processo.etp, ausenciasDe(processo.etp)));

  const alterarTexto = (inciso: IncisoEtp, campo: 'texto' | 'justificativaAusencia', valor: string) =>
    definirEtp((atual) => ({ ...atual, [inciso]: { ...atual[inciso], [campo]: valor } }));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(conteudo, {
      onSuccess: (atualizado) => {
        definirEtp(atualizado.etp);
        definirAusencias(ausenciasDe(atualizado.etp));
        avisar({ tipo: 'sucesso', titulo: 'ETP salvo', mensagem: `${atendidos} de ${INCISOS_ETP.length} incisos atendidos.` });
      },
    });
  };

  const descartar = () => {
    definirEtp(processo.etp);
    definirAusencias(ausenciasDe(processo.etp));
    salvar.reset();
  };

  return (
    <section className="secao jornada-subsecao" id="etapa3-etp" aria-labelledby={`${base}-titulo`}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Estudo técnico preliminar (ETP)
          </h3>
          <p className="secao__descricao">
            Lei 14.133/2021, art. 18, § 1º. Os incisos I, IV, VI, VIII e XIII são obrigatórios (§ 2º); a ausência dos demais deve ser
            justificada.
          </p>
        </div>
        <Etiqueta tom={validacao.completo ? 'sucesso' : 'aviso'}>{validacao.completo ? 'ETP completo (RN-04)' : 'ETP com pendências (RN-04)'}</Etiqueta>
      </div>
      <div className="jornada-progresso-etp">
        <BarraProgresso
          valor={validacao.percentualPreenchido}
          rotulo="Incisos do ETP atendidos"
          tom={validacao.completo ? 'sucesso' : 'info'}
          textoValor={`${atendidos} de ${INCISOS_ETP.length} incisos`}
        />
        <p className="sr-only" aria-live="polite">
          {atendidos} de {INCISOS_ETP.length} incisos do ETP atendidos.
        </p>
      </div>

      {editavel ? (
        <form className="formulario" onSubmit={enviar} noValidate>
          <ol className="jornada-incisos">
            {INCISOS_ETP.map(({ inciso, titulo, obrigatorio }) => {
              const pendencia = validacao.pendencias.find((p) => p.inciso === inciso);
              const ausente = ausencias[inciso] === true;
              const item = etp[inciso];
              const situacao = (
                <span className="linha">
                  <Etiqueta tom={pendencia ? (obrigatorio ? 'erro' : 'aviso') : 'sucesso'} compacta>
                    {pendencia ? 'Pendente' : ausente ? 'Ausência justificada' : 'Atendido'}
                  </Etiqueta>
                  {pendencia ? (
                    <span>
                      {pendencia.motivo === 'obrigatorio_vazio'
                        ? 'Inciso obrigatório: escreva ao menos 30 caracteres.'
                        : 'Preencha, ou marque “Não se aplica” e justifique com ao menos 30 caracteres.'}
                    </span>
                  ) : null}
                </span>
              );
              return (
                <li key={inciso} className={`jornada-inciso${pendencia ? '' : ' jornada-inciso--ok'}`}>
                  {ausente ? (
                    <AreaTexto
                      id={`${base}-${inciso}`}
                      rotulo={`Inciso ${inciso} — ${titulo}: justificativa da ausência`}
                      rows={2}
                      value={item?.justificativaAusencia ?? ''}
                      onChange={(e) => alterarTexto(inciso, 'justificativaAusencia', e.target.value)}
                      ajuda={situacao}
                    />
                  ) : (
                    <AreaTexto
                      id={`${base}-${inciso}`}
                      rotulo={`Inciso ${inciso} — ${titulo}`}
                      obrigatorio={obrigatorio}
                      rows={3}
                      value={item?.texto ?? ''}
                      onChange={(e) => alterarTexto(inciso, 'texto', e.target.value)}
                      ajuda={situacao}
                    />
                  )}
                  {!obrigatorio ? (
                    <CaixaSelecao
                      rotulo="Não se aplica a esta contratação (justificar a ausência)"
                      checked={ausente}
                      onChange={(e) => definirAusencias((a) => ({ ...a, [inciso]: e.target.checked }))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
          <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar o ETP" />
          <div className="jornada-barra-acoes">
            <p className="texto-pequeno texto-secundario" aria-live="polite">
              {alterado ? 'Há alterações não salvas no ETP.' : 'Sem alterações pendentes.'}
            </p>
            <div className="linha">
              <Botao variante="terciario" icone={RotateCcw} onClick={descartar} disabled={!alterado || salvar.isPending}>
                Descartar alterações
              </Botao>
              <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
                Salvar ETP
              </Botao>
            </div>
          </div>
        </form>
      ) : (
        <dl className="jornada-incisos-leitura">
          {INCISOS_ETP.map(({ inciso, titulo, obrigatorio }) => {
            const item = processo.etp[inciso];
            const texto = (item?.texto ?? '').trim();
            const justificativa = (item?.justificativaAusencia ?? '').trim();
            return (
              <div key={inciso}>
                <dt>
                  Inciso {inciso} — {titulo}
                  {obrigatorio ? <span className="campo__obrigatorio"> (obrigatório)</span> : null}
                </dt>
                <dd>
                  {texto ? texto : justificativa ? <em>Ausência justificada: {justificativa}</em> : <span className="texto-secundario">Não preenchido</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
