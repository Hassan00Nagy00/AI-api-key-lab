import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import { StorageService } from '../../services/storage';
import { BidiToken } from '../common/BidiToken';
import { t } from '../../locales/i18n';

interface MaskedKeyDisplayProps {
  keyId: string;
  maskedKey: string;
  onCopied?: () => void;
}

export const MaskedKeyDisplay: React.FC<MaskedKeyDisplayProps> = ({
  keyId,
  maskedKey,
  onCopied,
}) => {
  const [revealed, setRevealed] = useState(false);
  const [plainSecret, setPlainSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timer: any = null;
    if (revealed) {
      // Auto-hide after 15 seconds per §6
      timer = setTimeout(() => {
        setRevealed(false);
        setPlainSecret(null);
      }, 15000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [revealed]);

  const toggleReveal = () => {
    if (revealed) {
      setRevealed(false);
      setPlainSecret(null);
    } else {
      const secret = StorageService.getSecret(keyId);
      if (secret) {
        setPlainSecret(secret);
        setRevealed(true);
      }
    }
  };

  const handleCopy = () => {
    const secret = StorageService.getSecret(keyId) || maskedKey;
    navigator.clipboard.writeText(secret);
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="inline-flex items-center gap-1.5 bg-zinc-950/60 border border-zinc-800/80 px-2.5 py-1 rounded-lg text-xs font-mono text-zinc-300">
      <BidiToken monospace>
        {revealed && plainSecret ? plainSecret : maskedKey}
      </BidiToken>

      <div className="flex items-center gap-1 ltr:ml-1 rtl:mr-1">
        <button
          type="button"
          onClick={toggleReveal}
          title={revealed ? t('keys.hideKey') : t('keys.revealKey')}
          aria-label={revealed ? 'Hide secret' : 'Reveal secret for 15s'}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
        >
          {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          title={t('keys.copyKey')}
          aria-label="Copy secret"
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
};
