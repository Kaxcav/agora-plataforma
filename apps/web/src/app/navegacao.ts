/**
 * Configuração do menu lateral. Cada item declara a permissão exigida; itens sem permissão
 * não aparecem (o servidor continua sendo quem autoriza). Para incluir uma nova área, basta
 * acrescentar um item à seção correspondente.
 */
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChartColumn,
  FileText,
  FingerprintPattern,
  Gavel,
  History,
  KeyRound,
  LayoutDashboard,
  Leaf,
  Link2,
  ListChecks,
  Network,
  Package,
  Receipt,
  RefreshCw,
  Route,
  ScrollText,
  Users,
  Wallet,
  Workflow,
  BellRing,
  Landmark,
  ShieldCheck,
  ShieldAlert,
  FileSignature,
  CalendarRange,
  Handshake,
  Gauge,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { RequisitoPermissao } from '../sessao/permissoes';

export interface ItemMenu {
  rotulo: string;
  caminho: string;
  icone: LucideIcon;
  permissao?: RequisitoPermissao;
  /** Ativo só no caminho exato (o Início não fica ativo em todas as rotas). */
  exato?: boolean;
}

export interface SecaoMenu {
  id: string;
  /** null = itens soltos, sem título de grupo. */
  titulo: string | null;
  itens: readonly ItemMenu[];
}

export const MENU: readonly SecaoMenu[] = [
  {
    id: 'inicio',
    titulo: null,
    itens: [
      { rotulo: 'Início', caminho: '/', icone: LayoutDashboard, permissao: 'painel:ler', exato: true },
      { rotulo: 'Jornada da contratação', caminho: '/jornada', icone: Route, permissao: 'jornada:ler' },
      { rotulo: 'Minha declaração de impedimentos', caminho: '/impedimentos/declaracao', icone: FileSignature, permissao: 'agentes:declarar' },
    ],
  },
  {
    id: 'carteira',
    titulo: 'Carteira',
    itens: [
      { rotulo: 'Atas', caminho: '/atas', icone: ScrollText, permissao: 'atas:ler' },
      { rotulo: 'Contratos', caminho: '/contratos', icone: FileText, permissao: 'contratos:ler' },
      { rotulo: 'Itens', caminho: '/itens', icone: Package, permissao: 'itens:ler' },
      { rotulo: 'Notificações', caminho: '/notificacoes', icone: BellRing, permissao: 'notificacoes:ler' },
    ],
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    itens: [
      { rotulo: 'Empenhos', caminho: '/financeiro/empenhos', icone: Wallet, permissao: 'empenhos:ler' },
      { rotulo: 'Pagamentos', caminho: '/financeiro/pagamentos', icone: Receipt, permissao: 'pagamentos:ler' },
      { rotulo: 'Previsão', caminho: '/financeiro/previsao', icone: ChartColumn, permissao: 'pagamentos:ler' },
    ],
  },
  {
    id: 'vinculos',
    titulo: null,
    itens: [{ rotulo: 'Vínculos', caminho: '/vinculos', icone: Link2, permissao: 'vinculos:editar' }],
  },
  {
    id: 'fornecedores',
    titulo: 'Fornecedores',
    itens: [
      { rotulo: 'Fornecedores', caminho: '/fornecedores', icone: Building2, permissao: 'fornecedores:ler' },
      { rotulo: 'Sanções', caminho: '/sancoes', icone: Gavel, permissao: 'sancoes:ler' },
      { rotulo: 'Vínculos e impedimentos', caminho: '/impedimentos', icone: ShieldAlert, permissao: 'impedimentos:ler', exato: true },
    ],
  },
  {
    id: 'ajustes',
    titulo: 'Ajustes',
    itens: [
      { rotulo: 'Modelos de gestão', caminho: '/ajustes/modelos', icone: ListChecks, permissao: 'ajustes:editar' },
      { rotulo: 'Unidades internas', caminho: '/ajustes/unidades', icone: Workflow, permissao: 'ajustes:editar' },
      { rotulo: 'Grupos de UASG', caminho: '/ajustes/grupos-uasg', icone: Network, permissao: 'ajustes:editar' },
      { rotulo: 'Feriados', caminho: '/ajustes/feriados', icone: CalendarDays, permissao: 'ajustes:editar' },
      { rotulo: 'Políticas do órgão', caminho: '/ajustes/politicas', icone: Leaf, permissao: 'ajustes:editar' },
    ],
  },
  {
    id: 'administracao',
    titulo: 'Administração',
    itens: [
      { rotulo: 'Usuários', caminho: '/admin/usuarios', icone: Users, permissao: 'admin:usuarios' },
      { rotulo: 'Perfis', caminho: '/admin/perfis', icone: KeyRound, permissao: 'admin:usuarios' },
      { rotulo: 'Integrações', caminho: '/admin/integracoes', icone: RefreshCw, permissao: ['integracoes:executar', 'admin:usuarios'] },
    ],
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria',
    itens: [
      { rotulo: 'Trilha', caminho: '/auditoria', icone: History, permissao: 'auditoria:ler', exato: true },
      { rotulo: 'Acessos a dados pessoais', caminho: '/auditoria/lgpd', icone: FingerprintPattern, permissao: 'lgpd:relatorio' },
    ],
  },
  {
    id: 'regras',
    titulo: null,
    itens: [{ rotulo: 'Caderno de regras', caminho: '/regras', icone: BookOpen }],
  },
  {
    id: 'controle',
    titulo: 'Controle',
    itens: [
      {
        rotulo: 'Linhas de defesa',
        caminho: '/controle',
        icone: ShieldCheck,
        permissao: ['controle:primeira_linha', 'controle:segunda_linha', 'controle:terceira_linha'],
      },
      { rotulo: 'Controle externo', caminho: '/controle-externo', icone: Landmark, permissao: 'controle_externo:ler' },
    ],
  },
  {
    id: 'planejamento',
    titulo: 'Planejamento',
    itens: [
      { rotulo: 'Plano de contratações', caminho: '/planejamento/pca', icone: CalendarRange, permissao: 'pca:ler' },
      { rotulo: 'Intenções de registro de preços', caminho: '/planejamento/irp', icone: Handshake, permissao: 'pca:ler' },
    ],
  },
  {
    id: 'resultados',
    titulo: 'Resultados e operação',
    itens: [
      { rotulo: 'Metas do ETP', caminho: '/metas-etp', icone: Target, permissao: 'metas:ler' },
      { rotulo: 'Operação', caminho: '/operacao', icone: Gauge, permissao: 'operacao:ler' },
    ],
  },
];
