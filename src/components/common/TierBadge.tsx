import React from 'react';
import { ModelTier, TierEvidence } from '../../types/provider';
import { t } from '../../locales/i18n';
import { Sparkles, HelpCircle } from 'lucide-react';

interface TierBadgeProps {
  tier?: ModelTier;
  evidence?: TierEvidence;
  size?: 'sm' | 'md';
}

export const TierBadge: React.FC<TierBadgeProps> = ({ tier, evidence, size = 'md' }) => {
  const isSm = size === 'sm';

  if (tier === 'free' && evidence && evidence !== 'none') {
    return (
      <span
        title={`Free Tier confirmed via evidence: ${evidence}`}
        className={`inline-flex items-center gap-1 font-semibold rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 ${
          isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
        }`}
      >
        <Sparkles size={isSm ? 10 : 12} className="text-emerald-400" />
        <span>{t('keys.tierFree')}</span>
      </span>
    );
  }

  if (tier === 'trial') {
    return (
      <span
        className={`inline-flex items-center font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 ${
          isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
        }`}
      >
        <span>{t('keys.tierTrial')}</span>
      </span>
    );
  }

  if (tier === 'paid') {
    return (
      <span
        className={`inline-flex items-center font-medium rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 ${
          isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
        }`}
      >
        <span>{t('keys.tierPaid')}</span>
      </span>
    );
  }

  // Tier unverified / unknown
  return (
    <span
      title="Pricing and free tier status not verified by API"
      className={`inline-flex items-center gap-1 font-normal rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 ${
        isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <HelpCircle size={isSm ? 10 : 11} className="text-zinc-500" />
      <span>{t('keys.tierUnknown')}</span>
    </span>
  );
};
