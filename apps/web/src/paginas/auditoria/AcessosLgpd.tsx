import { FingerprintPattern } from 'lucide-react';
import type { RegistroAcessoDadoPessoal } from '@agora/contratos';
import { useAcessosLgpd } from '../../api/auditoria';
import { EstadoVazio, FalhaConsulta, Pagina, Paginacao, Tabela, TextoLongo, type ColunaTabela } from '../../componentes';
import { abreviarHash, contar, formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';

const RECURSOS: Record<string, string> = {
  fornecedor: 'Fornecedor',
  usuario: 'Usuário',
  credor_empenho: 'Credor de empenho',
};

const CAMPOS: Record<string, string> = {
  documento: 'Documento (CPF)',
  email: 'E-mail',
  telefone: 'Telefone',
};

const COLUNAS: ColunaTabela<RegistroAcessoDadoPessoal>[] = [
  {
    id: 'ocorridoEm',
    cabecalho: 'Ocorrido em',
    identificadora: true,
    fixa: true,
    celula: (r) => (
      <time dateTime={r.ocorridoEm} className="numero sem-quebra">
        {formatarInstante(r.ocorridoEm)}
      </time>
    ),
  },
  {
    id: 'usuario',
    cabecalho: 'Usuário',
    prioritaria: true,
    celula: (r) => r.usuario.nome,
  },
  {
    id: 'recurso',
    cabecalho: 'Titular do dado',
    prioritaria: true,
    celula: (r) => (
      <span className="pilha pilha--compacta">
        <span>{RECURSOS[r.recurso] ?? r.recurso}</span>
        <span className="texto-pequeno texto-secundario mono" title={r.recursoId}>
          {abreviarHash(r.recursoId, 8, 4)}
        </span>
      </span>
    ),
  },
  {
    id: 'campo',
    cabecalho: 'Dado revelado',
    prioritaria: true,
    celula: (r) => CAMPOS[r.campo] ?? r.campo,
  },
  {
    id: 'finalidade',
    cabecalho: 'Finalidade declarada',
    larguraMinima: '18rem',
    prioritaria: true,
    celula: (r) => <TextoLongo texto={r.finalidade} />,
  },
  {
    id: 'registro',
    cabecalho: 'Registro',
    ocultaPorPadrao: true,
    celula: (r) => (
      <code title={r.id}>{abreviarHash(r.id, 8, 4)}</code>
    ),
  },
];

export default function AcessosLgpd() {
  const p = useParametrosUrl();
  const parametros = { pagina: p.pagina, tamanhoPagina: p.tamanhoPagina };
  const consulta = useAcessosLgpd(parametros);
  const total = consulta.data?.total;

  return (
    <Pagina
      titulo="Acessos a dados pessoais"
      subtitulo="Relatório das revelações de dados pessoais mascarados, com usuário, momento e finalidade declarada."
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Auditoria', para: '/auditoria' },
      ]}
      tela="auditoria"
    >
      <p className="texto-secundario">
        Dados pessoais (CPF, e-mail, telefone) aparecem mascarados por padrão. Toda revelação exige finalidade e fica registrada aqui e na
        trilha de auditoria, atendendo ao registro das operações de tratamento (LGPD, art. 37) e aos princípios de finalidade e necessidade
        (art. 6º).
      </p>
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <p className="barra-filtros__contagem" aria-live="polite" aria-atomic="true">
            {total === undefined ? 'Carregando registros…' : total === 0 ? 'Nenhum acesso registrado' : `${contar(total, 'acesso registrado', 'acessos registrados')}`}
          </p>
          <Tabela
            id="acessos-lgpd"
            legenda="Registros de acesso a dados pessoais"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(r) => r.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            vazio={
              <EstadoVazio
                icone={FingerprintPattern}
                titulo="Nenhum acesso a dado pessoal registrado"
                descricao="Quando um usuário autorizado revelar um dado pessoal, o registro aparecerá aqui com a finalidade informada."
              />
            }
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={parametros.pagina}
                  tamanhoPagina={parametros.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos acessos a dados pessoais"
                />
              ) : null
            }
          />
        </>
      )}
    </Pagina>
  );
}
