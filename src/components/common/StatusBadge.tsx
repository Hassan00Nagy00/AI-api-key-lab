import React from 'react';
import { KeyStatus } from '../../types/key';
import { t } from '../../locales/i18n';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Clock,
  Ban,
  CreditCard,
  Radio,
  ServerCrash,
  WifiOff,
  Settings2,
  ShieldAlert,
} from 'lucide-react';

interface StatusBadgeProps {
  status: KeyStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const isSm = size === 'sm';
  const iconSize = isSm ? 12 : 14;

  switch (status) {
    case 'working':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <CheckCircle2 size={iconSize} className="text-emerald-400" />
          <span>{t('status.working')}</span>
        </span>
      );

    case 'rate-limited':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
          title="Rate limit reached — key is valid"
        >
          <AlertTriangle size={iconSize} className="text-amber-400" />
          <span>{t('status.rate-limited')}</span>
        </span>
      );

    case 'unauthorized':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <XCircle size={iconSize} className="text-rose-400" />
          <span>{t('status.unauthorized')}</span>
        </span>
      );

    case 'forbidden':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-red-500/10 text-red-400 border border-red-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Ban size={iconSize} className="text-red-400" />
          <span>{t('status.forbidden')}</span>
        </span>
      );

    case 'no-credit':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <CreditCard size={iconSize} className="text-purple-400" />
          <span>{t('status.no-credit')}</span>
        </span>
      );

    case 'no-usable-model':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Radio size={iconSize} className="text-orange-400" />
          <span>{t('status.no-usable-model')}</span>
        </span>
      );

    case 'provider-unavailable':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <ServerCrash size={iconSize} className="text-amber-300" />
          <span>{t('status.provider-unavailable')}</span>
        </span>
      );

    case 'network-error':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <WifiOff size={iconSize} className="text-slate-400" />
          <span>{t('status.network-error')}</span>
        </span>
      );

    case 'blocked-or-network':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
          title="Browser blocked request (CORS/Network) - key may be valid"
        >
          <ShieldAlert size={iconSize} className="text-cyan-400" />
          <span>{t('status.blocked-or-network')}</span>
        </span>
      );

    case 'config-error':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Settings2 size={iconSize} className="text-rose-300" />
          <span>{t('status.config-error')}</span>
        </span>
      );

    case 'testing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Clock size={iconSize} className="animate-spin text-blue-400" />
          <span>{t('status.testing')}</span>
        </span>
      );

    case 'untested':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <HelpCircle size={iconSize} className="text-zinc-400" />
          <span>{t('status.untested')}</span>
        </span>
      );
  }
};
