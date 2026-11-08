/**
 * `/ajustes/politicas` — políticas do órgão. A de sustentabilidade obrigatória (RN-21) começa ligada; só o
 * administrador a altera, com justificativa registrada na trilha de auditoria. A API decide quem pode alterar.
 */
import { useId, useState, type FormEvent } from 'react';
import { Leaf, Save } from 'lucide-react';
import type { PoliticaSustentabilidade } from '@agora/contratos';
import { useAlterarPoliticaSustentabilidade, usePoliticaSustentabilidade } from '../../api/selecao';
import { Alerta, Alternador, AreaTexto, Botao, ConteudoConsulta, EsqueletoTexto, Etiqueta, ListaDefinicoes, Pagina, Secao, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { AvisoSomenteLeitura, ErroFormulario } from './ErroFormulario';

const MINIMO_JUSTIFICATIVA = 20;

function FormularioPolitica({ politica }: { politica: PoliticaSustentabilidade }) {
  const base = useId();
  const { avisar } = useAvisos();
  const alterar = useAlterarPoliticaSustentabilidade();
  const [ativa, definirAtiva] = useState(politica.ativa);
  const [justificativa, definirJustificativa] = useState('');
  const [tentou, definirTentou] = useState(false);
  const mudou = ativa !== politica.ativa;
  const erroJustificativa = tentou && justificativa.trim().length < MINIMO_JUSTIFICATIVA ? `Justifique a alteração em pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.` : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (!mudou || justificativa.trim().length < MINIMO_JUSTIFICATIVA) {
      document.getElementById(`${base}-justificativa`)?.focus();
      return;
    }
    alterar.mutate(
      { ativa, justificativa: justificativa.trim() },
      {
        onSuccess: (salva) => {
          definirJustificativa('');
          definirTentou(false);
          avisar({
            tipo: 'sucesso',
            titulo: 'Política alterada',
            mensagem: salva.ativa
              ? 'ETP e TR voltam a exigir os critérios de sustentabilidade e de logística reversa.'
              : 'Os critérios de sustentabilidade passam a ser recomendados, sem bloquear ETP e TR.',
          });
        },
      },
    );
  };

  return (
    <form className="pilha" onSubmit={enviar} noValidate aria-label="Alterar a política de sustentabilidade">
      <Alternador
        rotulo="Exigir critérios de sustentabilidade e logística reversa no ETP e no TR"
        ligado={ativa}
        aoMudar={definirAtiva}
        ajuda="Ligada: o ETP (etapa 3) e o TR (etapa 4) não se concluem sem os dois critérios. Desligada: os critérios são recomendados."
      />
      {mudou ? (
        <AreaTexto
          id={`${base}-justificativa`}
          rotulo="Justificativa da alteração"
          obrigatorio
          rows={3}
          value={justificativa}
          onChange={(e) => definirJustificativa(e.target.value)}
          erro={erroJustificativa}
          ajuda="Fica registrada na trilha de auditoria com o seu nome e a data."
        />
      ) : null}
      <ErroFormulario erro={alterar.error} titulo="Não foi possível alterar a política" />
      <div className="linha">
        <Botao variante="primario" type="submit" icone={Save} carregando={alterar.isPending} disabled={!mudou}>
          Salvar política
        </Botao>
      </div>
    </form>
  );
}

export default function Politicas() {
  const consulta = usePoliticaSustentabilidade();
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('ajustes:editar');

  return (
    <Pagina
      titulo="Políticas do órgão"
      subtitulo="Regras próprias do órgão aplicadas pela Ágora na jornada da contratação."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Ajustes' }]}
      tela="ajustes"
    >
      {podeEditar ? null : <AvisoSomenteLeitura texto="Somente administradores alteram as políticas do órgão. Você pode consultar a situação abaixo." />}
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando as políticas do órgão">
        {(politica) => (
          <Secao
            titulo="Sustentabilidade ambiental e logística reversa (RN-21)"
            id="politica-sustentabilidade"
            descricao="O desenvolvimento nacional sustentável é princípio das contratações; a lei permite ao órgão exigir os critérios em todos os ETPs e TRs (Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII)."
            acoes={
              <Etiqueta tom={politica.ativa ? 'sucesso' : 'neutro'} icone={Leaf}>
                {politica.ativa ? 'Ligada' : 'Desligada'}
              </Etiqueta>
            }
          >
            <ListaDefinicoes
              colunas={2}
              itens={[
                { termo: 'Situação', valor: politica.ativa ? 'Ligada: critérios obrigatórios no ETP e no TR' : 'Desligada: critérios recomendados' },
                {
                  termo: 'Última alteração',
                  valor: politica.alteradaEm ? `${formatarInstante(politica.alteradaEm)}${politica.alteradaPor ? ` por ${politica.alteradaPor.nome}` : ''}` : 'Padrão da instalação (ligada)',
                },
                { termo: 'Justificativa', valor: politica.justificativa ?? '—', largo: true },
              ]}
            />
            {podeEditar ? (
              <FormularioPolitica key={`${String(politica.ativa)}-${politica.alteradaEm ?? ''}`} politica={politica} />
            ) : (
              <Alerta tipo="info" compacto>
                <p>A alteração da política é registrada na trilha de auditoria.</p>
              </Alerta>
            )}
          </Secao>
        )}
      </ConteudoConsulta>
    </Pagina>
  );
}
