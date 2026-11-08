/** Vínculos de um processo: sinais entre os licitantes (RIA-06 e RIA-10), declarações da equipe (RN-28) e vínculos registrados. */
import { useState } from 'react';
import { useParams } from 'react-router';
import type { AptidaoAgente, VinculosProcesso } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useVinculosProcesso } from '../../api/impedimentos';
import {
  Alerta,
  ConteudoConsulta,
  EsqueletoDetalhe,
  EstadoVazio,
  Etiqueta,
  LinkBotao,
  Pagina,
  Secao,
  Tabela,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { rotuloPapel } from '../jornada/rotulos';
import { BotaoRegistrarVinculo, COLUNAS_VINCULOS, DialogoRegistrarVinculo, ListaSinaisVinculo } from './comum';

const COLUNAS_EQUIPE: ColunaTabela<AptidaoAgente>[] = [
  { id: 'servidor', cabecalho: 'Servidor', identificadora: true, celula: (a) => a.usuario.nome },
  { id: 'papeis', cabecalho: 'Papéis no processo', celula: (a) => a.papeis.map((p) => rotuloPapel(p.papel)).join(', ') },
  {
    id: 'declaracao',
    cabecalho: 'Declaração',
    celula: (a) => (a.declaracao ? `Assinada; válida até ${formatarData(a.declaracao.validaAte)}` : 'Não assinada'),
  },
  {
    id: 'situacao',
    cabecalho: 'Pode atuar?',
    celula: (a) => {
      const pendencias = a.papeis.flatMap((p) => p.pendencias);
      return pendencias.length === 0 ? (
        <Etiqueta tom="sucesso" compacta>
          Apto
        </Etiqueta>
      ) : (
        <div className="pilha pilha--compacta">
          <Etiqueta tom="erro" compacta>
            Pendente
          </Etiqueta>
          <span className="texto-pequeno">{[...new Set(pendencias)].join(' ')}</span>
        </div>
      );
    },
  },
];

function Conteudo({ dados }: { dados: VinculosProcesso }) {
  const { temPermissao } = useSessao();
  const [registrando, definirRegistrando] = useState(false);
  const { analise } = dados;
  return (
    <>
      <Secao
        titulo="Sinais entre os licitantes"
        id="sinais"
        descricao={`Licitantes analisados: ${analise.licitantes.map((l) => l.nome).join('; ') || 'nenhum registrado'}.`}
      >
        {analise.licitantes.length === 0 ? (
          <p className="texto-secundario">A disputa ainda não tem licitantes registrados (etapa 6 da jornada).</p>
        ) : (
          <ListaSinaisVinculo sinais={analise.sinais} titulo="Sinais dos licitantes do processo" vazio="Nenhum vínculo encontrado nas fontes consultadas." />
        )}
        <Alerta tipo="info" compacto titulo="Requer revisão humana">
          <p>{analise.aviso}</p>
        </Alerta>
      </Secao>

      <Secao
        titulo="Equipe e declarações de impedimento (RN-28)"
        id="equipe"
        descricao="Cada agente só atua no processo depois de assinar a declaração de inexistência de impedimento (arts. 7º e 9º). A designação da equipe recusa quem estiver pendente."
      >
        <Tabela
          id="equipe-declaracoes"
          legenda="Declarações da equipe designada"
          colunas={COLUNAS_EQUIPE}
          linhas={dados.equipe}
          chave={(a) => a.usuario.id}
          semFerramentas
          vazio={<EstadoVazio titulo="Nenhum servidor designado" />}
        />
      </Secao>

      <Secao
        titulo="Vínculos registrados dos licitantes"
        id="vinculos"
        acoes={temPermissao('impedimentos:registrar') ? <BotaoRegistrarVinculo aoClicar={() => definirRegistrando(true)} /> : null}
      >
        <Tabela
          id="vinculos-processo"
          legenda="Vínculos registrados dos licitantes"
          colunas={COLUNAS_VINCULOS}
          linhas={dados.vinculos}
          chave={(v) => v.id}
          semFerramentas
          vazio={<EstadoVazio titulo="Nenhum vínculo registrado" />}
        />
      </Secao>
      {temPermissao('impedimentos:registrar') ? (
        <DialogoRegistrarVinculo aberto={registrando} aoFechar={() => definirRegistrando(false)} processoId={dados.processo.id} />
      ) : null}
    </>
  );
}

export default function ProcessoVinculos() {
  const { id = '' } = useParams();
  const consulta = useVinculosProcesso(id);
  const processo = consulta.data?.processo;
  return (
    <Pagina
      titulo={processo ? `Vínculos do processo ${processo.numeroSei}` : 'Vínculos do processo'}
      subtitulo={processo?.titulo}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Vínculos e impedimentos', para: '/impedimentos' },
      ]}
      tela="impedimentos.processo"
      acoes={
        <LinkBotao to={`/jornada/${id}`} variante="secundario">
          Abrir o processo na jornada
        </LinkBotao>
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando os vínculos do processo"
        naoEncontrado={{ titulo: 'Processo não encontrado', descricao: 'O processo não existe ou está fora das UASGs do seu escopo.' }}
      >
        {(dados) => <Conteudo dados={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
