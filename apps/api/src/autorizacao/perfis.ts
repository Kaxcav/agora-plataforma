import type { CodigoPerfil, PerfilAcesso, Permissao } from '@agora/contratos';

/** Todas as permissões conhecidas (ordem de exibição na matriz). */
export const TODAS_PERMISSOES: readonly Permissao[] = [
  'painel:ler',
  'pendencias:resolver',
  'atas:ler',
  'atas:editar',
  'contratos:ler',
  'contratos:editar',
  'itens:ler',
  'empenhos:ler',
  'pagamentos:ler',
  'pagamentos:atestar',
  'vinculos:editar',
  'tarefas:editar',
  'ajustes:editar',
  'fornecedores:ler',
  'sancoes:ler',
  'sancoes:instruir',
  'jornada:ler',
  'jornada:editar',
  'jornada:aprovar_juridico',
  'jornada:publicar',
  'integracoes:executar',
  'admin:usuarios',
  'auditoria:ler',
  'lgpd:revelar',
  'lgpd:relatorio',
  'certidoes:registrar',
  'regularidade:consultar',
];

const PERMISSOES_LEITURA = TODAS_PERMISSOES.filter((p) => p.endsWith(':ler'));

/** Matriz fixa de perfis × permissões (ARQUITETURA §3.3), exibida em GET /perfis. */
export const PERFIS: readonly PerfilAcesso[] = [
  {
    codigo: 'administrador',
    nome: 'Administrador',
    descricao: 'Administra usuários, perfis, ajustes e integrações. Tem todas as permissões.',
    permissoes: [...TODAS_PERMISSOES],
  },
  {
    codigo: 'gestor_contratos',
    nome: 'Gestor de contratos',
    descricao: 'Acompanha atas e contratos, resolve pendências, vincula instrumentos e instrui sanções.',
    permissoes: [
      'painel:ler',
      'pendencias:resolver',
      'atas:ler',
      'atas:editar',
      'contratos:ler',
      'contratos:editar',
      'itens:ler',
      'empenhos:ler',
      'pagamentos:ler',
      'vinculos:editar',
      'tarefas:editar',
      'fornecedores:ler',
      'sancoes:ler',
      'sancoes:instruir',
      'jornada:ler',
      'certidoes:registrar',
      'regularidade:consultar',
    ],
  },
  {
    codigo: 'fiscal',
    nome: 'Fiscal de contrato',
    descricao: 'Fiscaliza a execução, cumpre tarefas do plano de gestão e atesta notas fiscais.',
    permissoes: [
      'painel:ler',
      'pendencias:resolver',
      'atas:ler',
      'contratos:ler',
      'itens:ler',
      'empenhos:ler',
      'pagamentos:ler',
      'pagamentos:atestar',
      'tarefas:editar',
      'fornecedores:ler',
      'sancoes:ler',
      'certidoes:registrar',
      'regularidade:consultar',
    ],
  },
  {
    codigo: 'financeiro',
    nome: 'Financeiro',
    descricao: 'Acompanha empenhos e pagamentos, vincula empenhos e executa sincronizações.',
    permissoes: [
      'painel:ler',
      'atas:ler',
      'contratos:ler',
      'itens:ler',
      'empenhos:ler',
      'pagamentos:ler',
      'vinculos:editar',
      'integracoes:executar',
      'fornecedores:ler',
      'certidoes:registrar',
      'regularidade:consultar',
    ],
  },
  {
    codigo: 'planejamento',
    nome: 'Planejamento',
    descricao: 'Conduz a fase preparatória da contratação (DFD, ETP, riscos e preços).',
    permissoes: ['painel:ler', 'atas:ler', 'contratos:ler', 'itens:ler', 'fornecedores:ler', 'jornada:ler', 'jornada:editar'],
  },
  {
    codigo: 'agente_contratacao',
    nome: 'Agente de contratação',
    descricao: 'Conduz a seleção do fornecedor e publica editais e avisos.',
    permissoes: [
      'painel:ler',
      'atas:ler',
      'contratos:ler',
      'itens:ler',
      'fornecedores:ler',
      'sancoes:ler',
      'jornada:ler',
      'jornada:editar',
      'jornada:publicar',
      'certidoes:registrar',
      'regularidade:consultar',
    ],
  },
  {
    codigo: 'juridico',
    nome: 'Assessoria jurídica',
    descricao: 'Realiza o controle prévio de legalidade (art. 53) e aprova a fase jurídica.',
    permissoes: ['painel:ler', 'atas:ler', 'contratos:ler', 'fornecedores:ler', 'sancoes:ler', 'jornada:ler', 'jornada:aprovar_juridico'],
  },
  {
    codigo: 'auditor',
    nome: 'Auditor',
    descricao: 'Consulta tudo, verifica a trilha de auditoria e acompanha os acessos a dados pessoais.',
    permissoes: [...PERMISSOES_LEITURA, 'lgpd:revelar', 'lgpd:relatorio'],
  },
  {
    codigo: 'consulta',
    nome: 'Consulta',
    descricao: 'Somente leitura dos instrumentos e da execução financeira das UASGs autorizadas.',
    permissoes: ['painel:ler', 'atas:ler', 'contratos:ler', 'itens:ler', 'empenhos:ler', 'pagamentos:ler', 'fornecedores:ler'],
  },
];

export const CODIGOS_PERFIS: readonly CodigoPerfil[] = PERFIS.map((p) => p.codigo);

export function ehCodigoPerfil(valor: string): valor is CodigoPerfil {
  return (CODIGOS_PERFIS as readonly string[]).includes(valor);
}

/** União das permissões dos perfis, na ordem da matriz. */
export function permissoesDosPerfis(perfis: readonly CodigoPerfil[]): Permissao[] {
  const conjunto = new Set<Permissao>();
  for (const perfil of PERFIS) {
    if (perfis.includes(perfil.codigo)) for (const p of perfil.permissoes) conjunto.add(p);
  }
  return TODAS_PERMISSOES.filter((p) => conjunto.has(p));
}

/** Perfis cujo escopo vazio de UASG significa "todas" (contrato: UsuarioSessao.uasgs). */
export const PERFIS_ESCOPO_TOTAL: readonly CodigoPerfil[] = ['administrador', 'auditor'];
