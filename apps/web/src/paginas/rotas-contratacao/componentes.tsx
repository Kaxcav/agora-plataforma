/**
 * Peças comuns das telas das rotas de contratação (RF-34): rótulos, seletor de fornecedor e quadro de documentos.
 */
import { useId, useState } from 'react';
import type { DocumentoRotaContratacao, ExigenciaDocumentoRota, HipoteseDispensa, HipoteseInexigibilidade, RotaContratacao } from '@agora/contratos';
import { useFornecedores } from '../../api/fornecedores';
import { CampoBusca, Etiqueta, Selecao, type TomEtiqueta } from '../../componentes';

/**
 * Rota direta pela modalidade prevista que o servidor grava ao salvar a rota (dispensa, inexigibilidade, adesão ou
 * Sicx). Evita uma consulta a mais em cada etapa dos processos de licitação; os detalhes da rota vêm de GET /rota.
 */
export function rotaDiretaPelaModalidade(modalidade: string | null): boolean {
  return /^(Dispensa|Inexigibilidade|Adesão a ata|Comércio eletrônico)/.test(modalidade ?? '');
}

export const ROTULOS_ROTA: Record<RotaContratacao, { titulo: string; ajuda: string }> = {
  licitacao: { titulo: 'Licitação', ajuda: 'Pregão ou concorrência, com edital, disputa e atos da seleção (arts. 17 e 28).' },
  dispensa: { titulo: 'Dispensa de licitação', ajuda: 'Contratação direta do art. 75; por valor, com aviso de 3 dias úteis para propostas adicionais.' },
  inexigibilidade: { titulo: 'Inexigibilidade', ajuda: 'Competição inviável (art. 74): fornecedor exclusivo, notória especialização, credenciamento, artista ou imóvel.' },
  adesao_ata: { titulo: 'Adesão a ata de registro de preços', ajuda: 'Órgão não participante adere a ata de outro órgão (art. 86, § 2º), dentro dos limites.' },
  sicx: { titulo: 'Comércio eletrônico (Sicx)', ajuda: 'Bens e serviços comuns padronizados comprados na vitrine do Sistema de Compras Expressas (art. 79, IV).' },
};

export const ROTULOS_HIPOTESE_DISPENSA: Record<HipoteseDispensa, string> = {
  valor_demais: 'Por valor — compras e demais serviços (art. 75, II)',
  valor_obras_engenharia: 'Por valor — obras e serviços de engenharia (art. 75, I)',
  outra: 'Outra hipótese do art. 75 (incisos III a XVI)',
};

export const ROTULOS_HIPOTESE_INEXIGIBILIDADE: Record<HipoteseInexigibilidade, string> = {
  exclusividade: 'I — fornecedor ou prestador exclusivo',
  artista: 'II — profissional do setor artístico consagrado',
  notoria_especializacao: 'III — serviço técnico especializado com notória especialização',
  credenciamento: 'IV — credenciamento',
  imovel: 'V — aquisição ou locação de imóvel singular',
};

const EXIGENCIAS: Record<ExigenciaDocumentoRota, { rotulo: string; tom: TomEtiqueta }> = {
  obrigatorio: { rotulo: 'Obrigatório', tom: 'info' },
  facultativo: { rotulo: 'Facultativo', tom: 'neutro' },
  nao_se_aplica: { rotulo: 'Não se aplica', tom: 'neutro' },
};

export function EtiquetaExigencia({ exigencia }: { exigencia: ExigenciaDocumentoRota }) {
  const e = EXIGENCIAS[exigencia];
  return (
    <Etiqueta tom={e.tom} compacta icone={null}>
      {e.rotulo}
    </Etiqueta>
  );
}

/** Documentos e travas da rota (art. 72), em lista de definição acessível. */
export function QuadroDocumentos({ documentos, titulo }: { documentos: readonly DocumentoRotaContratacao[]; titulo: string }) {
  const id = useId();
  return (
    <div className="pilha pilha--compacta">
      <h4 id={id} className="secao__titulo">
        {titulo}
      </h4>
      <ul className="lista-simples" aria-labelledby={id}>
        {documentos.map((d) => (
          <li key={d.id} className="linha linha--entre">
            <span>
              {d.titulo} <span className="texto-pequeno texto-secundario">({d.fundamento})</span>
            </span>
            <EtiquetaExigencia exigencia={d.exigencia} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Busca no cadastro de fornecedores e escolha de um deles (nome de pessoa física vem mascarado do servidor). */
export function SeletorFornecedor({ valor, aoMudar, rotulo = 'Fornecedor', obrigatorio }: { valor: string; aoMudar: (id: string) => void; rotulo?: string; obrigatorio?: boolean }) {
  const [busca, definirBusca] = useState('');
  const consulta = useFornecedores({ busca: busca || undefined, tamanhoPagina: 20, pagina: 1 });
  const opcoes = (consulta.data?.itens ?? []).map((f) => ({ valor: f.id, rotulo: `${f.razaoSocial} — ${f.documento}${f.sancoesVigentes > 0 ? ' (com sanção vigente)' : ''}` }));
  return (
    <div className="pilha pilha--compacta">
      <CampoBusca rotulo={`Buscar ${rotulo.toLowerCase()} por nome ou CNPJ`} valor={busca} aoMudar={definirBusca} />
      <Selecao rotulo={rotulo} obrigatorio={obrigatorio} opcoes={opcoes} opcaoVazia="Selecione…" value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </div>
  );
}
