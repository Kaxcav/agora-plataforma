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
];

export const PAGINA_NAO_ENCONTRADA = lazy(() => import('../paginas/NaoEncontrada'));
