import React from 'react';
import { Search, X } from 'lucide-react';
import { t } from '../../locales/i18n';

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
}) => {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search size={15} className="absolute left-3.5 text-zinc-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || t('common.search')}
        className="w-full pl-9 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/80 transition-all"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2.5 p-1 text-zinc-500 hover:text-zinc-300 rounded cursor-pointer"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
