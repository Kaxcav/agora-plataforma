/**
 * Parâmetros de seleção do edital (etapa 4): prova de conceito ou amostra do licitante provisoriamente vencedor
 * (RN-20; art. 17, § 3º, e art. 41, II) e inversão de fases (art. 17, § 1º; RN-22). A prévia usa as mesmas regras
 * do domínio; quem decide o avanço é o servidor.
 */
import type { ExigenciaProvaConceito, InversaoFasesEdital, ProvaConceitoEdital } from '@agora/contratos';
import { PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS, validarInversaoFases, validarProvaConceito } from '@agora/dominio';
import { Alternador, AreaTexto, CampoTexto, GrupoOpcoes, type ItemDefinicao } from '../../../componentes';
import { MINIMO_TEXTO } from './tipos';

export const PROVA_CONCEITO_VAZIA: ProvaConceitoEdital = { exigencia: 'nenhuma', roteiro: null, justificativa: null, prazoDiasUteis: null };
export const INVERSAO_VAZIA: InversaoFasesEdital = { adotada: false, motivacao: null };

export const ROTULOS_EXIGENCIA: Record<ExigenciaProvaConceito, string> = {
  nenhuma: 'Não exigida',
  prova_conceito: 'Prova de conceito',
  amostra: 'Amostra',
};

/** Pendências de RN-20 e RN-22 nos parâmetros (mesmas funções do domínio usadas pelo servidor). */
export function pendenciasParametrosSelecao(prova: ProvaConceitoEdital, inversao: InversaoFasesEdital): string[] {
  return [...validarProvaConceito(prova, MINIMO_TEXTO).pendencias.map((p) => `${p.mensagem} (RN-20)`), ...validarInversaoFases(inversao, MINIMO_TEXTO).pendencias.map((p) => `${p} (RN-22)`)];
}

/** Itens de consulta dos parâmetros de seleção (painel somente leitura). */
export function itensParametrosSelecao(prova: ProvaConceitoEdital, inversao: InversaoFasesEdital): ItemDefinicao[] {
  const itens: ItemDefinicao[] = [{ termo: 'Prova de conceito ou amostra', valor: ROTULOS_EXIGENCIA[prova.exigencia] }];
  if (prova.exigencia !== 'nenhuma') {
    itens.push(
      { termo: 'Prazo da prova', valor: prova.prazoDiasUteis === null ? 'Não informado' : `${prova.prazoDiasUteis} dias úteis contados da convocação` },
      { termo: 'Roteiro e critérios de aprovação', valor: prova.roteiro ?? 'Não informado', largo: true },
      { termo: 'Justificativa da exigência', valor: prova.justificativa ?? 'Não informada', largo: true },
    );
  }
  itens.push({ termo: 'Inversão de fases', valor: inversao.adotada ? `Adotada — ${inversao.motivacao ?? 'sem motivação'}` : 'Não adotada', largo: inversao.adotada });
  return itens;
}

interface PropsCampos {
  prova: ProvaConceitoEdital;
  inversao: InversaoFasesEdital;
  textoPrazo: string;
  aoMudarProva: (prova: ProvaConceitoEdital) => void;
  aoMudarInversao: (inversao: InversaoFasesEdital) => void;
  aoMudarTextoPrazo: (texto: string) => void;
  erroPrazo: string | null;
  idPrazo: string;
}

/** Campos editáveis da prova de conceito ou amostra e da inversão de fases. */
export function CamposParametrosSelecao({ prova, inversao, textoPrazo, aoMudarProva, aoMudarInversao, aoMudarTextoPrazo, erroPrazo, idPrazo }: PropsCampos) {
  const exigida = prova.exigencia !== 'nenhuma';
  return (
    <>
      <fieldset className="grupo-campos">
        <legend>Prova de conceito ou amostra (art. 17, § 3º, e art. 41, II — RN-20)</legend>
        <GrupoOpcoes<ExigenciaProvaConceito>
          legenda="Exigência do licitante provisoriamente vencedor"
          nome="exigencia-prova-conceito"
          horizontal
          valor={prova.exigencia}
          aoMudar={(exigencia) => aoMudarProva({ ...prova, exigencia })}
          opcoes={[
            { valor: 'nenhuma', rotulo: 'Não exigir' },
            { valor: 'prova_conceito', rotulo: 'Prova de conceito' },
            { valor: 'amostra', rotulo: 'Amostra' },
          ]}
        />
        {exigida ? (
          <>
            <CampoTexto
              id={idPrazo}
              rotulo="Prazo para a realização (dias úteis contados da convocação)"
              obrigatorio
              inputMode="numeric"
              className="jornada-campo-percentual"
              value={textoPrazo}
              onChange={(e) => aoMudarTextoPrazo(e.target.value)}
              erro={erroPrazo}
              ajuda={`De 1 a ${PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS} dias úteis. A sessão é pública, transmitida e gravada; o link da gravação é registrado com o resultado.`}
            />
            <AreaTexto
              rotulo="Roteiro de testes e critérios objetivos de aprovação"
              obrigatorio
              rows={3}
              ajuda={`O que será testado e como se aprova, de forma objetiva. Mínimo de ${MINIMO_TEXTO} caracteres.`}
              value={prova.roteiro ?? ''}
              onChange={(e) => aoMudarProva({ ...prova, roteiro: e.target.value })}
            />
            <AreaTexto
              rotulo="Justificativa da necessidade (art. 41, II)"
              obrigatorio
              rows={2}
              ajuda={`Por que a aderência do objeto só se comprova com a prova ou a amostra. Mínimo de ${MINIMO_TEXTO} caracteres.`}
              value={prova.justificativa ?? ''}
              onChange={(e) => aoMudarProva({ ...prova, justificativa: e.target.value })}
            />
          </>
        ) : null}
      </fieldset>
      <fieldset className="grupo-campos">
        <legend>Inversão de fases (art. 17, § 1º — RN-22)</legend>
        <Alternador
          rotulo="Habilitação antes do julgamento das propostas"
          ligado={inversao.adotada}
          aoMudar={(adotada) => aoMudarInversao({ ...inversao, adotada })}
          ajuda="Exceção à regra: exige ato motivado com os benefícios esperados. Com a inversão, a fase recursal única ocorre depois do julgamento."
        />
        {inversao.adotada ? (
          <AreaTexto
            rotulo="Motivação e benefícios da inversão de fases"
            obrigatorio
            rows={2}
            ajuda={`Mínimo de ${MINIMO_TEXTO} caracteres.`}
            value={inversao.motivacao ?? ''}
            onChange={(e) => aoMudarInversao({ ...inversao, motivacao: e.target.value })}
          />
        ) : null}
      </fieldset>
    </>
  );
}
