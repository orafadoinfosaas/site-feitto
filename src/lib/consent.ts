/**
 * Consentimento de cookies — LGPD (Lei 13.709/2018).
 *
 * Regra que governa este arquivo: nenhuma tag de terceiro existe no HTML.
 * GA4 e Meta Pixel só são injetados depois do aceite da categoria, e são
 * removidos quando o aceite é revogado.
 */

export type Category = 'necessarios' | 'analise' | 'marketing';

export interface ConsentRecord {
  /** identificador anônimo do registro, para prova sem identificar a pessoa */
  id: string;
  /** versão do texto da política que estava no ar quando a escolha foi feita */
  policy: string;
  /** RFC 3339 */
  at: string;
  analise: boolean;
  marketing: boolean;
}

/** Sobe junto com qualquer mudança relevante na Política de Privacidade. */
export const POLICY_VERSION = '2026-09-20';

/** Vencido o prazo, o banner volta a perguntar. */
export const CONSENT_MAX_AGE_DAYS = 180;

export const STORAGE_KEY = 'feitto.consent.v1';

/** Preenchidos quando a Luana enviar as contas. Vazio = script não sobe. */
export const GA4_ID = '';
export const META_PIXEL_ID = '';

export function readConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as ConsentRecord;
    if (typeof parsed?.at !== 'string') return null;

    // política nova invalida a escolha antiga: o texto mudou, a pergunta refaz
    if (parsed.policy !== POLICY_VERSION) return null;

    const ageDays = (Date.now() - Date.parse(parsed.at)) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays > CONSENT_MAX_AGE_DAYS) return null;

    return parsed;
  } catch {
    // navegação anônima, storage bloqueado ou JSON corrompido
    return null;
  }
}

export function writeConsent(choice: { analise: boolean; marketing: boolean }): ConsentRecord {
  const record: ConsentRecord = {
    id: cryptoRandomId(),
    policy: POLICY_VERSION,
    at: new Date().toISOString(),
    analise: choice.analise,
    marketing: choice.marketing,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* sem storage o site segue funcionando; a escolha só não persiste */
  }
  return record;
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/* ------------------------------------------------------------------ *
 * Google Consent Mode v2
 * Os quatro sinais nascem negados. A escolha do visitante os atualiza,
 * nunca o contrário.
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[] };
    _fbq?: unknown;
  }
}

function gtag(...args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

export function initConsentMode() {
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500,
  });
}

export function applyConsent(record: ConsentRecord | null) {
  const analise = record?.analise === true;
  const marketing = record?.marketing === true;

  gtag('consent', 'update', {
    analytics_storage: analise ? 'granted' : 'denied',
    ad_storage: marketing ? 'granted' : 'denied',
    ad_user_data: marketing ? 'granted' : 'denied',
    ad_personalization: marketing ? 'granted' : 'denied',
  });

  if (analise) loadAnalytics();
  else dropCookies(['_ga', '_gid', '_gat']);

  if (marketing) loadPixel();
  else dropCookies(['_fbp', '_fbc']);
}

let analyticsLoaded = false;
function loadAnalytics() {
  if (analyticsLoaded || !GA4_ID) return;
  analyticsLoaded = true;

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);

  gtag('js', new Date());
  gtag('config', GA4_ID, { anonymize_ip: true });
}

let pixelLoaded = false;
function loadPixel() {
  if (pixelLoaded || !META_PIXEL_ID) return;
  pixelLoaded = true;

  /* eslint-disable */
  const n: any = (window.fbq = function (...args: unknown[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  /* eslint-enable */

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);

  window.fbq?.('init', META_PIXEL_ID);
  window.fbq?.('track', 'PageView');
}

/**
 * Revogar tem que ser tão fácil quanto aceitar: ao desmarcar uma categoria,
 * os cookies dela saem na hora, sem recarregar a página.
 */
function dropCookies(names: string[]) {
  const host = location.hostname;
  const domains = [host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];

  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
    }
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}
