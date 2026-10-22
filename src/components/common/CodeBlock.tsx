import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { t } from '../../locales/i18n';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'bash', title }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden text-left" dir="ltr">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/60 text-xs text-zinc-400">
        <span className="font-mono text-[11px] text-zinc-300">{title || language}</span>
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed selection:bg-blue-500/30">
        <code>{code}</code>
      </pre>
    </div>
  );
};
