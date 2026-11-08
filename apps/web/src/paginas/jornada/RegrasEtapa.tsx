/**
 * Modo especificação técnica: regras do catálogo aplicadas à etapa exibida (`regrasPorEtapa`).
 * Carregado sob demanda, como o painel de regras da página.
 */
import { useId } from 'react';
import { Link } from 'react-router';
import { BookOpen } from 'lucide-react';
import type { EtapaJornada } from '@agora/contratos';
import { regrasPorEtapa } from '@agora/dominio';
import { CartaoRegra } from '../../componentes/PainelRegras';
import { tituloEtapa } from './rotulos';

export default function RegrasEtapa({ etapa }: { etapa: EtapaJornada }) {
  const idTitulo = useId();
  const regras = regrasPorEtapa(etapa);
  return (
    <section className="painel-regras jornada-regras-etapa" aria-labelledby={idTitulo}>
      <div className="painel-regras__cabecalho">
        <BookOpen size={18} aria-hidden="true" />
        <h3 id={idTitulo} className="painel-regras__titulo">
          Regras da etapa {etapa} — {tituloEtapa(etapa)}
        </h3>
        <span className="painel-regras__tela">
          <code>regrasPorEtapa({etapa})</code>
        </span>
      </div>
      {regras.length === 0 ? (
        <p className="texto-secundario">Nenhuma regra do catálogo está associada a esta etapa.</p>
      ) : (
        <div className="painel-regras__lista">
          {regras.map((r) => (
            <CartaoRegra key={r.id} regra={r} nivelTitulo={4} />
          ))}
        </div>
      )}
      <p className="painel-regras__rodape">
        Catálogo completo no <Link to="/regras">Caderno de regras</Link>. As referências legais devem ser validadas pela área técnica e pela
        consultoria jurídica.
      </p>
    </section>
  );
}
