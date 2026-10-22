import React from 'react';

interface BidiTokenProps {
  children: React.ReactNode;
  className?: string;
  monospace?: boolean;
}

/**
 * Isolates LTR tokens (API keys, URLs, model IDs, latency ms, numbers)
 * within bidirectional or RTL contexts to prevent text order corruption.
 */
export const BidiToken: React.FC<BidiTokenProps> = ({
  children,
  className = '',
  monospace = true,
}) => {
  return (
    <bdi
      dir="ltr"
      className={`inline-block ${monospace ? 'font-mono' : ''} ${className}`}
      style={{ unicodeBidi: 'isolate' }}
    >
      {children}
    </bdi>
  );
};
