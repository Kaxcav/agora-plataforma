/**
 * Tabela de rotas. Cada rota é UMA entrada: caminho, página (carregada sob demanda com `React.lazy`)
 * e, se autenticada, a permissão exigida. O roteador (`roteador.tsx`) monta tudo a partir daqui.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { RequisitoPermissao } from '../sessao/permissoes';

export interface DefinicaoRota {
  caminho: string;
  pagina: LazyExoticComponent<ComponentType>;
  /** Exige sessão (padrão). Rotas públicas: `publica: true`. */
  publica?: boolean;
  permissao?: RequisitoPermissao;
}

export const ROTAS: readonly DefinicaoRota[] = [
  // Públicas
  { caminho: '/entrar', publica: true, pagina: lazy(() => import('../paginas/publicas/Entrar')) },
  { caminho: '/transparencia', publica: true, pagina: lazy(() => import('../paginas/publicas/Transparencia')) },
  { caminho: '/transparencia/contratos/:id', publica: true, pagina: lazy(() => import('../paginas/publicas/TransparenciaContrato')) },
  { caminho: '/transparencia/editais', publica: true, pagina: lazy(() => import('../paginas/publicas/TransparenciaEditais')) },
  { caminho: '/transparencia/editais/:id', publica: true, pagina: lazy(() => import('../paginas/publicas/TransparenciaEdital')) },
  { caminho: '/privacidade', publica: true, pagina: lazy(() => import('../paginas/publicas/Privacidade')) },
  { caminho: '/acessibilidade', publica: true, pagina: lazy(() => import('../paginas/publicas/Acessibilidade')) },
  { caminho: '/regras', publica: true, pagina: lazy(() => import('../paginas/publicas/CadernoRegras')) },

  // Conta (autenticada, sem permissão específica; obrigatória enquanto a senha for temporária)
  { caminho: '/trocar-senha', pagina: lazy(() => import('../paginas/conta/TrocarSenha')) },

  // Operação
  { caminho: '/', permissao: 'painel:ler', pagina: lazy(() => import('../paginas/painel/Painel')) },
  { caminho: '/jornada', permissao: 'jornada:ler', pagina: lazy(() => import('../paginas/jornada/Jornada')) },
  { caminho: '/jornada/:id', permissao: 'jornada:ler', pagina: lazy(() => import('../paginas/jornada/ProcessoDetalhe')) },
  { caminho: '/atas', permissao: 'atas:ler', pagina: lazy(() => import('../paginas/atas/Atas')) },
  { caminho: '/atas/:id', permissao: 'atas:ler', pagina: lazy(() => import('../paginas/atas/AtaDetalhe')) },
  { caminho: '/contratos', permissao: 'contratos:ler', pagina: lazy(() => import('../paginas/contratos/Contratos')) },
  { caminho: '/contratos/:id', permissao: 'contratos:ler', pagina: lazy(() => import('../paginas/contratos/ContratoDetalhe')) },
  { caminho: '/itens', permissao: 'itens:ler', pagina: lazy(() => import('../paginas/itens/Itens')) },
  { caminho: '/financeiro/empenhos', permissao: 'empenhos:ler', pagina: lazy(() => import('../paginas/financeiro/Empenhos')) },
  { caminho: '/financeiro/pagamentos', permissao: 'pagamentos:ler', pagina: lazy(() => import('../paginas/financeiro/Pagamentos')) },
  { caminho: '/financeiro/previsao', permissao: 'pagamentos:ler', pagina: lazy(() => import('../paginas/financeiro/Previsao')) },
  { caminho: '/vinculos', permissao: 'vinculos:editar', pagina: lazy(() => import('../paginas/vinculos/Vinculos')) },
  { caminho: '/fornecedores', permissao: 'fornecedores:ler', pagina: lazy(() => import('../paginas/fornecedores/Fornecedores')) },
  { caminho: '/fornecedores/:id', permissao: 'fornecedores:ler', pagina: lazy(() => import('../paginas/fornecedores/FornecedorDetalhe')) },
  { caminho: '/sancoes', permissao: 'sancoes:ler', pagina: lazy(() => import('../paginas/sancoes/Sancoes')) },
  { caminho: '/notificacoes', permissao: 'notificacoes:ler', pagina: lazy(() => import('../paginas/notificacoes/Notificacoes')) },

  // Ajustes: leitura para qualquer sessão; escrita só com ajustes:editar (a API decide).
  { caminho: '/ajustes/modelos', pagina: lazy(() => import('../paginas/ajustes/ModelosGestao')) },
  { caminho: '/ajustes/unidades', pagina: lazy(() => import('../paginas/ajustes/UnidadesInternas')) },
  { caminho: '/ajustes/grupos-uasg', pagina: lazy(() => import('../paginas/ajustes/GruposUasg')) },
  { caminho: '/ajustes/feriados', pagina: lazy(() => import('../paginas/ajustes/Feriados')) },

  // Administração e auditoria
  { caminho: '/admin/usuarios', permissao: 'admin:usuarios', pagina: lazy(() => import('../paginas/admin/Usuarios')) },
  { caminho: '/admin/perfis', permissao: 'admin:usuarios', pagina: lazy(() => import('../paginas/admin/Perfis')) },
  { caminho: '/admin/integracoes', permissao: ['integracoes:executar', 'admin:usuarios'], pagina: lazy(() => import('../paginas/admin/Integracoes')) },
  { caminho: '/auditoria', permissao: 'auditoria:ler', pagina: lazy(() => import('../paginas/auditoria/TrilhaAuditoria')) },
  { caminho: '/auditoria/lgpd', permissao: 'lgpd:relatorio', pagina: lazy(() => import('../paginas/auditoria/AcessosLgpd')) },
  { caminho: '/jornada/:id/disputa', permissao: 'jornada:ler', pagina: lazy(() => import('../paginas/disputa/SalaDisputa')) },

  // Controle das contratações (arts. 169 a 171)
  {
    caminho: '/controle',
    permissao: ['controle:primeira_linha', 'controle:segunda_linha', 'controle:terceira_linha'],
    pagina: lazy(() => import('../paginas/controle/LinhasDefesa')),
  },
  { caminho: '/controle-externo', permissao: 'controle_externo:ler', pagina: lazy(() => import('../paginas/controle/ControleExterno')) },
  // Políticas do órgão (RN-21): leitura para qualquer sessão; alteração só com ajustes:editar (a API decide).
  { caminho: '/ajustes/politicas', pagina: lazy(() => import('../paginas/ajustes/Politicas')) },

  // Documentos do processo e leitura assistida de atestados (RF-21, RIA-08, RN-25)
  { caminho: '/jornada/:id/documentos', permissao: 'documentos:ler', pagina: lazy(() => import('../paginas/documentos/DocumentosProcesso')) },

  // Vínculos e impedimentos (F4 e F14)
  { caminho: '/impedimentos', permissao: 'impedimentos:ler', pagina: lazy(() => import('../paginas/impedimentos/Impedimentos')) },
  { caminho: '/impedimentos/processos/:id', permissao: 'impedimentos:ler', pagina: lazy(() => import('../paginas/impedimentos/ProcessoVinculos')) },
  { caminho: '/impedimentos/fornecedores/:id', permissao: 'impedimentos:ler', pagina: lazy(() => import('../paginas/impedimentos/FornecedorVinculos')) },
  { caminho: '/impedimentos/extensoes/:id', permissao: 'impedimentos:ler', pagina: lazy(() => import('../paginas/impedimentos/ExtensaoDetalhe')) },
  { caminho: '/impedimentos/declaracao', permissao: 'agentes:declarar', pagina: lazy(() => import('../paginas/impedimentos/MinhaDeclaracao')) },

  // Execução contratual: prazos de pagamento e alteração justificada da ordem cronológica (F22, frente L)
  { caminho: '/financeiro/prazos', permissao: 'pagamentos:ler', pagina: lazy(() => import('../paginas/financeiro/PrazosPagamento')) },
  // Planejamento: plano de contratações anual e intenções de registro de preços (RF-31, RN-38)
  { caminho: '/planejamento/pca', permissao: 'pca:ler', pagina: lazy(() => import('../paginas/planejamento/PlanoContratacoes')) },
  { caminho: '/planejamento/irp', permissao: 'pca:ler', pagina: lazy(() => import('../paginas/planejamento/IntencoesRegistroPrecos')) },
  // Operação (RNF-10, IMR-01) e painel das metas do ETP (RF-39)
  { caminho: '/operacao', permissao: 'operacao:ler', pagina: lazy(() => import('../paginas/operacao/Operacao')) },
  { caminho: '/metas-etp', permissao: 'metas:ler', pagina: lazy(() => import('../paginas/metas/PainelMetas')) },
  // IMR e conferência da nota fiscal (F7: RF-29 e RN-36)
  { caminho: '/financeiro/pagamentos/:id/conferencia', permissao: 'pagamentos:ler', pagina: lazy(() => import('../paginas/financeiro/ConferenciaNota')) },
  // Gestão compartilhada com a sociedade (RF-37) e dados abertos (RF-38)
  { caminho: '/dados-abertos', publica: true, pagina: lazy(() => import('../paginas/publicas/DadosAbertos')) },
  { caminho: '/sociedade', permissao: 'sociedade:ler', pagina: lazy(() => import('../paginas/sociedade/GestaoCompartilhada')) },
  { caminho: '/sociedade/contratos/:id', permissao: 'sociedade:ler', pagina: lazy(() => import('../paginas/sociedade/ContratoSociedade')) },
  { caminho: '/sociedade/minhas-manifestacoes', permissao: 'sociedade:manifestar', pagina: lazy(() => import('../paginas/sociedade/MinhasManifestacoes')) },
  // IA ancorada: base normativa, qualidade normativa (IMR-02) e conferência dos documentos (F24)
  { caminho: '/base-normativa', permissao: 'normas:ler', pagina: lazy(() => import('../paginas/ia/BaseNormativa')) },
  { caminho: '/qualidade-normativa', permissao: 'qualidade_ia:ler', pagina: lazy(() => import('../paginas/ia/QualidadeNormativa')) },
  { caminho: '/jornada/:id/conferencia', permissao: 'jornada:ler', pagina: lazy(() => import('../paginas/ia/ConferenciaProcesso')) },
  // Publicações no DOU (RF-36): avisos de licitação e extratos, envio pelo INCom e conferência da publicação
  { caminho: '/publicacoes-dou', permissao: ['jornada:ler', 'contratos:ler'], pagina: lazy(() => import('../paginas/publicacoes/PublicacoesDou')) },
  // Sigilo de segurança pública (F25: RN-40, RF-33 e RNF-09)
  { caminho: '/jornada/:id/sigilo', permissao: 'sigilo:ler', pagina: lazy(() => import('../paginas/sigilo/SigiloProcesso')) },
  // Desempenho de fornecedores: registro cadastral, ranking e simulador (RN-37, RF-30)
  { caminho: '/desempenho', permissao: 'fornecedores:ler', pagina: lazy(() => import('../paginas/desempenho/Desempenho')) },
];

export const PAGINA_NAO_ENCONTRADA = lazy(() => import('../paginas/NaoEncontrada'));
